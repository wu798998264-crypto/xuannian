// Source overlay for the verified original archive. The archive is never edited.
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {join,basename}=require('node:path');
const fs=require('node:fs/promises');
const baiduPage=url=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='baidu.com'||u.hostname.endsWith('.baidu.com'))&&!u.username&&!u.password;}catch{return false;}};
exports.baiduPage=baiduPage;
exports.install=function({app,ipcMain,parserModule,shareModule,runtimeModule,mediaRoot,owner,directory,completed,electron=require('electron')}){
 let parser,share,job,closed=false,loginView,loginOwner;
 const closeLogin=()=>{if(!loginView)return;const view=loginView;loginView=null;if(owner()&&!owner().isDestroyed())owner().contentView.removeChildView(view);view.webContents.close();};
 const accountStatus=async()=>{const session=electron.session.fromPartition('persist:xuannian-yunx-baidu');session.flushStorageData();await session.cookies.flushStore();return {hasLoginRecord:(await session.cookies.get({url:'https://pan.baidu.com/'})).some(c=>c.name==='BDUSS'&&c.value&&!/[\r\n;]/.test(c.value))};};
 const ready=Promise.all([import(parserModule),import(shareModule),runtimeModule?import(runtimeModule):null]).then(([a,b,runtime])=>{runtime?.configureBundledMedia({root:mediaRoot});share=b;parser=a.createYunxVideoParser({BrowserWindow:electron.BrowserWindow});parser.connectAccounts({list:async()=>[{id:'xuannian-baidu',name:'玄念百度账号'}],withSession:async(id,consume)=>{if(id!=='xuannian-baidu')throw Error('网盘账号身份无效');const cookies=await electron.session.fromPartition('persist:xuannian-yunx-baidu').cookies.get({url:'https://pan.baidu.com/'}),items=cookies.filter(c=>/^(BDUSS|STOKEN|BAIDUID|BDUSS_BFESS|STOKEN_BFESS|BAIDUID_BFESS)$/.test(c.name)&&!/[\r\n;]/.test(c.value));if(!items.some(c=>c.name==='BDUSS'&&c.value))throw Error('请先登录玄念的百度账号');return consume(items.map(c=>c.name+'='+c.value).join('; '));}});if(closed)parser.close();});
 const handle=(action,fn)=>ipcMain.handle('yunx:'+action,async(event,body={})=>{try{if(event.sender!==owner()?.webContents)throw Error('解析请求不属于当前窗口');await ready;if(closed)throw Error('解析已关闭');return {ok:true,...await fn(body)};}catch(error){return {ok:false,code:error.code||'YUNX_FAILED',reason:String(error.message).slice(0,500)};}});
 handle('inspect',async b=>({share:share.inspectShareLink(b.source)}));
 handle('account',async b=>{if(b.action==='status')return accountStatus();if(b.action==='close'){const status=await accountStatus();closeLogin();return status;}const bounds=b.bounds;if(!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k])))throw Error('登录区域无效');const [width,height]=owner().getContentSize(),x=Math.max(0,Math.round(bounds.x)),y=Math.max(0,Math.round(bounds.y));if(x>=width||y>=height||bounds.width<=0||bounds.height<=0)throw Error('登录区域不可见');if(!loginView){loginView=new electron.WebContentsView({webPreferences:{partition:'persist:xuannian-yunx-baidu',contextIsolation:true,sandbox:true,nodeIntegration:false}});if(loginOwner!==owner()){loginOwner=owner();loginOwner.on('resize',closeLogin);loginOwner.once('closed',closeLogin);}owner().contentView.addChildView(loginView);const guard=(event,url)=>{if(!baiduPage(url))event.preventDefault();};loginView.webContents.on('will-navigate',guard);loginView.webContents.on('will-redirect',guard);loginView.webContents.setWindowOpenHandler(({url})=>{if(baiduPage(url))void loginView?.webContents.loadURL(url).catch(()=>{});return {action:'deny'};});await loginView.webContents.loadURL('https://pan.baidu.com/');}loginView?.setBounds({x,y,width:Math.min(width-x,Math.max(1,Math.round(bounds.width))),height:Math.min(height-y,Math.max(1,Math.round(bounds.height)))});return {opened:!!loginView};});
 handle('parse',async b=>{
  closeLogin();if(job)parser.stop(job.id);job={id:'video-'+randomUUID(),startedAt:Date.now(),message:'正在解析',outputs:new Map()};const current=job;
  const parsed=await parser.parse({jobId:current.id,sourceText:String(b.source||''),accessCode:b.accessCode,onProgress:p=>Object.assign(current,p)});
  if(job!==current)throw Error('已切换解析链接');current.parsed=parsed;current.parseMs=Date.now()-current.startedAt;current.message='解析完成';
  return {jobId:current.id,parsed,parseMs:current.parseMs};
 });
 handle('status',async b=>{if(!job||job.id!==b.jobId)return {};return {message:job.message,bytes:job.bytes||0,total:job.total||0,busy:!!job.busy};});
 handle('browse',async b=>{if(!job||job.id!==b.jobId)throw Error('解析已过期');const current=job,parsed=await parser.browse({jobId:current.id,optionId:b.optionId});if(job!==current)throw Error('已切换解析链接');current.parsed=parsed;return {jobId:current.id,parsed,parseMs:current.parseMs};});
 async function media(b){
  if(!job||job.id!==b.jobId||job.busy)throw Error('解析已过期或正在下载');const current=job,option=current.parsed.options.find(o=>o.id===b.optionId);
  if(!option||option.kind==='folder')throw Error('请选择分享文件');
  const audioOnly=b.audioOnly===true;if(audioOnly&&option.kind!=='video')throw Error('仅视频可选择仅下载音频');const key=option.id+(audioOnly?':audio':'');
  if(current.outputs.has(key))return {current,option,out:current.outputs.get(key)};
  current.busy=true;current.message='正在下载所选内容';current.bytes=0;current.total=0;
  try{
   const staging=join(app.getPath('userData'),'yunx-downloads',current.id,createHash('sha256').update(option.id).digest('hex').slice(0,20));
   let out=current.outputs.get(option.id);
   if(!out){out=await parser.download({jobId:current.id,optionId:option.id,format:option.formats.includes('source')?'source':option.formats[0],directory:staging,shareProfileId:'xuannian-baidu',allowTemporaryTransfer:b.allowTemporaryTransfer===true,onProgress:p=>Object.assign(current,p)});if(job!==current)throw Error('解析已停止，完整文件保留在暂存');current.outputs.set(option.id,out);}
   if(audioOnly){current.message='正在从已下载视频提取音频';out=await parser.extractAudio({jobId:current.id,output:out,directory:join(staging,'audio'),onProgress:p=>Object.assign(current,p)});if(job!==current)throw Error('解析已停止，完整文件保留在暂存');current.outputs.set(key,out);}
   return {current,option,out};
  }finally{current.busy=false;}
 }
 handle('preview',async b=>{
  const {current,option,out}=await media({...b,audioOnly:false});if(!['video','audio','image'].includes(option.kind))throw Error('此文件类型不支持预览');
  const path=join(require('node:path').dirname(out.path),'preview.'+out.extension);if(path!==out.path)await fs.copyFile(out.path,path);
  if(job!==current)throw Error('已切换解析链接');current.message='预览已就绪，下载会复用本次文件';return {url:pathToFileURL(path).href,kind:option.kind,name:out.name,size:out.size};
 });
 handle('download',async b=>{
  const {current,option,out}=await media(b),folder=directory(b.favorite===true,out.kind);await fs.mkdir(folder,{recursive:true});
  let destination;for(let i=0;i<100;i++){destination=join(folder,(i?'('+i+') ':'')+basename(out.name));try{await fs.copyFile(out.path,destination,require('node:fs').constants.COPYFILE_EXCL);break;}catch(e){if(e.code!=='EEXIST'||i===99)throw e;}}
  await completed({path:destination,name:basename(destination),size:out.size,favorite:b.favorite===true});current.message='已下载：'+basename(destination);return {path:destination,name:basename(destination)};
 });
 handle('stop',async()=>{closeLogin();if(job)parser.stop(job.id);job=null;return {};});
 app.on('before-quit',()=>{closed=true;closeLogin();parser?.close();});
};
