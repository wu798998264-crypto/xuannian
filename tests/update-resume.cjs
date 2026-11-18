// Run the desktop update handlers with a local release fixture and real files.
const assert=require('node:assert/strict');
const {readFileSync,promises:fs}=require('node:fs');
const path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{createHash}=require('node:crypto');
const {CancellationToken}=require('builder-util-runtime');
const transport=require('../src/release-download.cjs');
const source=readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const handlers=source.slice(source.indexOf('function normalizeReleaseNotes'),source.indexOf('function installAppUpdate'));
const repo='https://github.com/wu798998264-crypto/xuannian',bytes=Buffer.from('local release fixture, never executed');
const sha=algorithm=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
async function run(platform,arch,manual){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xuannian-update-'));
 const name=platform==='darwin'?'XuanNian-10.0.0-'+arch+'.dmg':'XuanNian-10.0.0-'+(manual?'Portable':'Setup')+'.exe';
 const url=repo+'/releases/download/v10.0.0/'+name,asset={name,size:bytes.length,url:name,sha512:sha('sha512'),browser_download_url:url,digest:'sha256:'+sha('sha256')};
 const calls=[];let checks=0,nativeFallbacks=0;
 const get=async (target,options)=>{
   if(target.startsWith('https://api.github.com/')){checks++;if(checks===1)throw Error('检查更新超时');return Response.json({tag_name:'v10.0.0',assets:[asset]});}
   assert.equal(target,url);
   const range=options.headers.Range||'';calls.push(range);
   if(calls.length===1)return new Response(bytes.subarray(0,9));
   assert.equal(range,'bytes=9-');return new Response(bytes.subarray(9),{status:206,headers:{'Content-Range':'bytes 9-'+(bytes.length-1)+'/'+bytes.length}});
 };
 const updater=new EventEmitter();updater.httpExecutor={download:async()=>{nativeFallbacks++;return 'original';}};
 const token=new CancellationToken();const pending=path.join(dir,'pending');await fs.mkdir(pending);const temp=path.join(pending,'temp-setup.exe');
 updater.checkForUpdates=async()=>updater.emit('update-available',{version:'10.0.0',files:[asset]});
 updater.downloadUpdate=async()=>{try{await updater.httpExecutor.download(new URL(url),temp,{sha512:asset.sha512,cancellationToken:token,onProgress:p=>updater.emit('download-progress',p)});updater.emit('update-downloaded',{version:'10.0.0'});}catch(error){updater.emit('error',error);throw error;}};
 const state={supported:true,manualInstall:manual,status:'idle'};
 const ctx={require:id=>id==='electron'?{net:{},session:{fromPartition(){}}}:{...transport,createElectronReleaseFetch:()=>get},process:{platform,arch},updateState:state,
   UPDATE_REPOSITORY_URL:repo,UPDATE_OWNER:'wu798998264-crypto',UPDATE_REPO:'xuannian',sleep:async()=>{},fs:require('node:fs'),path,Buffer,AbortController,AbortSignal,
   app:{getVersion:()=>'9.2.1',getPath:()=>dir,isPackaged:true},autoUpdater:updater,runtimeLog:()=>{},publicUpdateState:()=>({...state}),setUpdateState:s=>Object.assign(state,s)};
 vm.runInNewContext('let updateCheckInFlight=false,updateDownloadFlight,releaseFetch,installedReleaseFiles=[],installedUpdaterInitialized=false,portableUpdateDownload=null;'+handlers,ctx);
 try{
   await ctx.checkForAppUpdates();assert.equal(state.status,'available');if(manual)assert.equal(checks,2);
   const a=ctx.downloadAppUpdate(),b=ctx.downloadAppUpdate();assert.equal(a,b);
   const final=await a;assert.equal(final.status,'downloaded');assert.deepEqual(calls,['','bytes=9-']);
   assert.deepEqual(await fs.readFile(manual?state.downloadedFile:temp),bytes);
   assert.equal(token.listenerCount('cancel'),0);if(!manual){assert.equal(await updater.httpExecutor.download(new URL('https://example.invalid/foreign'),temp,{sha512:asset.sha512}),'original');assert.equal(nativeFallbacks,1);}
   assert.equal(ctx.isTransientUpdateError(Error('下载连接中断')),true);assert.equal(ctx.isTransientUpdateError(Error('签名错误')),false);
   console.log('PASS',platform,arch,manual?'manual':'installed',name);
 }finally{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('xuannian-update-'))await fs.rm(dir,{recursive:true,force:true});}
}
(async()=>{for(const args of [['win32','x64',false],['win32','x64',true],['darwin','arm64',true],['darwin','x64',true]])await run(...args);})().catch(e=>{console.error(e);process.exitCode=1;});
