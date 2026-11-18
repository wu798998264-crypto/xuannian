'use strict';
const {createReadStream} = require('node:fs');
const {lstat, open, rename, unlink} = require('node:fs/promises');
const {createHash} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {Readable} = require('node:stream');

// Chromium uses the system proxy. Expose each redirect so the caller can check
// its destination before following it. net.fetch rejects manual redirects.
function createElectronReleaseFetch(net, session) {
  return (url, {headers={}, signal, redirect='error'}={}) => new Promise((resolve,reject) => {
    signal?.throwIfAborted();
    const request=net.request({url,session,redirect:'manual',credentials:'omit',useSessionCookies:false});
    let incoming;
    const abort=()=>{request.abort();incoming?.destroy(signal.reason);reject(signal.reason);};
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    signal?.addEventListener('abort',abort,{once:true});
    request.on('error',error=>{cleanup();incoming?.destroy(error);reject(error);});
    request.on('redirect',(status,_method,location)=>{
      cleanup();
      if(redirect==='manual')resolve(new Response(null,{status,headers:{location}}));
      else reject(Error('Unexpected update redirect'));
      request.abort();
    });
    request.on('response',response=>{
      incoming=response;
      response.once('close',cleanup);
      response.once('end',cleanup);
      response.once('aborted',()=>response.destroy(transient('更新连接中断，已保存下载进度')));
      const fields=new Headers();
      for(const [key,values] of Object.entries(response.headers))for(const value of [].concat(values||[]))fields.append(key,value);
      if([204,205,304].includes(response.statusCode)){response.resume();resolve(new Response(null,{status:response.statusCode,headers:fields}));return;}
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:fields}));
    });
    for(const [key,value] of new Headers(headers))request.setHeader(key,value);
    request.end();
  });
}

const githubHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const retryable = error => error?.retryable === true || ['TimeoutError', 'TypeError'].includes(error?.name)
  || /ECONNRESET|ETIMEDOUT|UND_ERR_|ERR_CONNECTION_|ERR_NETWORK_|ERR_INTERNET_|ERR_TIMED_OUT|ERR_CONTENT_LENGTH_MISMATCH|ERR_HTTP2_PROTOCOL_ERROR|socket hang up|terminated|network error/i.test([error?.code,error?.message].join(' '));
const transient = message => Object.assign(new Error(message), {retryable:true});
const badContent = message => Object.assign(new Error(message), {invalidContents:true});
const missing = async file => { try { return await lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
async function matches(file, size, algorithm, digest) {
  const info = await missing(file);
  if (!info?.isFile() || info.size !== size) return false;
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === digest;
}

// A fixed published digest identifies a partial across retries and app restarts.
// Always ask the release URL for a fresh signed CDN redirect on each attempt.
async function downloadReleaseFile({url, destination, size, digest, algorithm='sha256', fetchImpl=fetch,
  signal, onProgress=()=>{}, idleMs=90000, retryMs=1000, attempts=3}) {
  if (!['sha256','sha512'].includes(algorithm) || !Number.isSafeInteger(size) || size < 1 || size > 2 * 1024**3 ||
      typeof digest !== 'string' || digest.length !== (algorithm==='sha256'?64:128) || /[^a-f0-9]/.test(digest)) throw Error('安装包发布大小或摘要无效');
  signal?.throwIfAborted();
  if (await matches(destination, size, algorithm, digest)) {onProgress(size);return destination;}
  const partial = destination+'.'+digest.slice(0,16)+'.part';
  for (let attempt=0; attempt<attempts; attempt++) {
    signal?.throwIfAborted();
    const timer = new AbortController();
    const active = signal ? AbortSignal.any([signal,timer.signal]) : timer.signal;
    let timeout, handle;
    const touch = () => {clearTimeout(timeout); timeout=setTimeout(()=>timer.abort(transient('更新下载无数据响应，连接超时')),idleMs);};
    try {
      const file = await missing(partial);
      if (file && (!file.isFile() || file.nlink!==1)) throw Error('临时安装包不是普通独立文件');
      let offset = file?.size || 0;
      if (file && offset >= size) {
        if (offset===size && await matches(partial,size,algorithm,digest)) {
          await rename(partial,destination);onProgress(size);return destination;
        }
        await unlink(partial);offset=0;
      }
      onProgress(offset);let next=url,response;
      for (let i=0;i<6;i++) {
        const parsed = new URL(next);
        if (parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!githubHosts.has(parsed.hostname)) throw Error('安装包下载跳转来源不可信');
        touch();
        response=await fetchImpl(parsed.href,{redirect:'manual',credentials:'omit',signal:active,headers:{
          Accept:'application/octet-stream',...(offset?{Range:'bytes='+offset+'-'}:{})}});
        if (![301,302,303,307,308].includes(response.status)) break;
        const location=response.headers.get('location');await response.body?.cancel();
        if (!location) throw Error('安装包下载跳转无效');
        next=new URL(location,parsed).href;response=null;
      }
      if (!response) throw Error('安装包下载跳转过多');
      const status=response.status;
      if (status!==200&&status!==206) {
        await response.body?.cancel();
        if ([408,429,500,502,503,504].includes(status)) throw transient('安装包下载失败（HTTP '+status+'）');
        throw Error('安装包下载失败（HTTP '+status+'）');
      }
      let end=size;
      if (status===206) {
        const range=/^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range')||'');
        if (!range||Number(range[1])!==offset||Number(range[2])<offset||Number(range[2])>=size||Number(range[3])!==size) {
          await response.body?.cancel();throw Error('安装包续传位置或大小与发布清单不一致');
        }
        end=Number(range[2])+1;
      } else offset=0; // The server ignored Range; rewrite from byte zero.
      if (!response.body || response.headers.has('content-length')&&Number(response.headers.get('content-length'))!==end-offset) {
        await response.body?.cancel();throw Error('安装包大小与发布清单不一致');
      }
      handle=await open(partial,offset?'a':'w',0o600);
      onProgress(offset);touch();
      for await (const bytes of response.body) {
        active.throwIfAborted();
        if (offset+bytes.length>end) throw badContent('安装包超过发布清单大小');
        await handle.writeFile(bytes);offset+=bytes.length;onProgress(offset);touch();
      }
      active.throwIfAborted();clearTimeout(timeout);await handle.sync();await handle.close();handle=null;
      if (offset!==size) throw transient('更新连接中断，已保存下载进度');
      if (!await matches(partial,size,algorithm,digest)) throw badContent('安装包完整性校验失败，未提供安装');
      await rename(partial,destination);return destination;
    } catch (error) {
      clearTimeout(timeout);timer.abort(error);await handle?.close();handle=null;
      if (error.invalidContents) await unlink(partial).catch(e=>{if(e.code!=='ENOENT')throw e;});
      signal?.throwIfAborted();
      const reason=timer.signal.reason;
      if (attempt+1===attempts || !retryable(reason)) throw reason;
      await delay(retryMs*(attempt+1),undefined,{signal});
    } finally {clearTimeout(timeout);await handle?.close();}
  }
}
module.exports={downloadReleaseFile,createElectronReleaseFetch};
