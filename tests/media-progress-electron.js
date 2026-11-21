const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-progress-probe-'));
app.setPath('userData', directory);
let window;
const snapshots = process.env.XUANNIAN_PROGRESS_SNAPSHOTS || path.resolve(__dirname, '..', 'artifacts', 'media-progress-9.2.1');

async function evaluate(script) {
  return window.webContents.executeJavaScript(script, true);
}

async function waitFor(expression) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`Renderer did not reach ${expression}`);
}

async function screenshot(name) {
  let lastError;
  for (let attempt=0;attempt<4;attempt+=1) {
    try {
      const image=await window.webContents.capturePage();
      fs.writeFileSync(path.join(snapshots,name),image.toPNG());
      return;
    } catch(error) {
      lastError=error;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
  throw lastError;
}

async function geometry(stage, determinate) {
  const result = await evaluate(`(()=>{
    const panel=document.querySelector('.yunx-panel'),progress=panel.querySelector('progress');
    const bounds=panel.getBoundingClientRect(),bar=progress.getBoundingClientRect(),style=getComputedStyle(panel);
    const status=panel.querySelector('.yunx-status').getBoundingClientRect();
    return {visible:!progress.hidden&&bar.height>0,width:bar.width,available:panel.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),left:bar.left,bottom:bar.bottom,statusBottom:status.bottom,inside:bar.left>=bounds.left&&bar.right<=bounds.right+1&&bar.bottom<=innerHeight,determinate:progress.hasAttribute('value'),value:progress.value,max:progress.max};
  })()`);
  assert(result.visible, `${stage}: progress must be visible`);
  assert(result.width >= result.available - 1, `${stage}: progress must span available content width: ${JSON.stringify(result)}`);
  assert(result.inside && result.bottom >= result.statusBottom, `${stage}: text and bar must stay ordered inside the viewport`);
  assert.strictEqual(result.determinate, determinate, `${stage}: only real byte totals may set a percentage`);
  if (determinate) {
    assert.strictEqual(result.value, 50);
    assert.strictEqual(result.max, 200);
  }
  return result;
}

async function run() {
  await app.whenReady();
  fs.mkdirSync(snapshots, { recursive: true });
  // Seed file-origin storage before index.html starts its asynchronous init and
  // first-run timer. Marking it after loadFile races with the guide on slow Macs.
  const preload=path.join(directory,'isolate-onboarding.cjs');
  fs.writeFileSync(preload,'localStorage.setItem("xuannian.onboarding.first-run.v1","seen");localStorage.setItem("xuannian.quick-guide.v4","seen");');
  window = new BrowserWindow({ show: false, width: 1280, height: 820, webPreferences: { backgroundThrottling: false, contextIsolation: true, preload } });
  await window.loadFile(path.resolve(__dirname, '..', 'index.html'));
  console.log('media progress UI loaded');
  if (!process.argv.includes('--hidden-fixture')) window.showInactive();
  await new Promise(resolve => setTimeout(resolve, 150));
  await evaluate(`(async()=>{
    if(localStorage.getItem('xuannian.onboarding.first-run.v1')!=='seen')throw Error('First-run guide was not isolated before application init');
    window.videoReply={ok:true,jobId:'progress-video',parseMs:25,parsed:{title:'跨平台进度布局测试',options:[{id:'folder',kind:'folder',label:'子目录'},{id:'video',kind:'video',label:'测试视频',quality:'1080P',formats:['source']}]}};
    window.pending={};window.bytesKnown=false;
    api.yunxInspect=async()=>({ok:true,share:null});api.yunxStop=async()=>({ok:true});
    api.yunxParse=()=>new Promise(resolve=>window.pending.parse=resolve);
    api.yunxPreview=()=>new Promise(resolve=>window.pending.preview=resolve);
    api.yunxDownload=()=>new Promise(resolve=>window.pending.download=resolve);
    api.yunxBrowse=()=>new Promise(resolve=>window.pending.browse=resolve);
    api.yunxStatus=async()=>({ok:true,message:'正在读取媒体文件',bytes:window.bytesKnown?50:0,total:window.bytesKnown?200:0});
    api.listLocalMedia=async()=>({ok:true,items:[],collections:{downloads:{video:[],audio:[]},favorites:{video:[],audio:[]}}});
    api.setMediaBrowserBounds=()=>true;
    await switchView('media',{skipCoach:true});setMediaKind('video',{showPortal:true});
    document.querySelector('#mediaVideoInput').value='https://example.com/video';
  })()`);

  const layouts=[];
  for (const [width,height] of [[1280,820],[620,560],[1280,560]]) {
    console.log(`checking media progress at ${width}x${height}`);
    window.setSize(width,height);
    await evaluate(`void (window.parsePromise=parseMediaVideo())`);
    await waitFor('typeof window.pending.parse===\'function\'');
    layouts.push({size:[width,height],stage:'parse',...await geometry('parse',false)});
    await new Promise(resolve => setTimeout(resolve, 120));
    await screenshot(`parse-${width}x${height}.png`);
    await evaluate(`window.pending.parse(window.videoReply);delete window.pending.parse;`);
    await waitFor('typeof window.pending.preview===\'function\'');
    layouts.push({size:[width,height],stage:'preview',...await geometry('preview',false)});
    await evaluate('window.bytesKnown=true');
    await waitFor("document.querySelector('.yunx-panel progress').hasAttribute('value')");
    await geometry('preview bytes',true);
    await screenshot(`preview-${width}x${height}.png`);
    await evaluate(`window.pending.preview({ok:true,kind:'video',url:'data:video/mp4;base64,AAAA'});delete window.pending.preview;`);
    await waitFor("document.querySelector('.yunx-panel progress').hidden");
    await evaluate(`document.querySelector('[data-yunx-download]').click()`);
    await waitFor('typeof window.pending.download===\'function\'');
    await waitFor("document.querySelector('.yunx-panel progress').hasAttribute('value')");
    layouts.push({size:[width,height],stage:'download',...await geometry('download',true)});
    await screenshot(`download-${width}x${height}.png`);
    await evaluate(`window.pending.download({ok:true,name:'已下载视频.mp4'});delete window.pending.download;window.bytesKnown=false;`);
    await waitFor("document.querySelector('.yunx-panel progress').hidden");
  }

  await evaluate(`document.querySelector('[data-yunx-options] button').click()`);
  await waitFor('typeof window.pending.browse===\'function\'');
  await geometry('browse',false);
  await evaluate(`window.pending.browse({...window.videoReply,ok:false,reason:'模拟目录读取失败'});delete window.pending.browse;`);
  await waitFor("document.querySelector('.yunx-panel progress').hidden");
  await evaluate(`document.querySelector('[data-yunx-download]').click()`);
  await waitFor('typeof window.pending.download===\'function\'');
  await evaluate(`document.querySelector('[data-yunx-stop]').click()`);
  await waitFor("document.querySelector('.yunx-panel progress').hidden");
  await evaluate(`window.pending.download({ok:true,name:'旧任务.mp4'});delete window.pending.download;void (window.parsePromise=parseMediaVideo());`);
  await waitFor('typeof window.pending.parse===\'function\'');
  await evaluate(`window.pending.parse({ok:false,reason:'模拟解析失败'});delete window.pending.parse;`);
  await waitFor("document.querySelector('.yunx-panel progress').hidden");

  const music=await evaluate(`(async()=>{
    if(document.querySelector('#modalBackdrop').classList.contains('show'))throw Error('Unexpected dialog before music test: '+document.querySelector('#modalBox').textContent);
    setMediaKind('audio',{showPortal:true});window.openRequests=[];let resumes=0;
    const originalConfirm=showConfirmModal;let musicConfirmCalls=0;
    showConfirmModal=(...args)=>{musicConfirmCalls++;return originalConfirm(...args);};
    api.getMediaMusicSearchUrl=async keyword=>'https://www.gequbao.com/s/'+encodeURIComponent(keyword);
    api.openMediaPortal=async(url,target,keyword)=>new Promise(resolve=>window.openRequests.push({keyword,resolve}));
    api.resumeMediaPortalAfterVerification=async()=>{resumes++;return {ok:true};};
    const input=document.querySelector('#mediaMusicInput');
    input.value='旧歌曲';const first=searchMediaMusic();await new Promise(resolve=>setTimeout(resolve,0));
    input.value='新歌曲';const second=searchMediaMusic();await new Promise(resolve=>setTimeout(resolve,0));
    applyMediaMusicResults({ok:true,query:'旧歌曲',requestId:101,results:[{url:'https://www.gequbao.com/music/old',title:'旧歌曲'}]});
    const rejectedOld=state.media.musicSearch.query==='新歌曲'&&state.media.musicSearch.results.length===0;
    applyMediaMusicResults({ok:true,query:'新歌曲',requestId:102,results:[{url:'https://www.gequbao.com/music/new',title:'新歌曲',artist:'歌手'}]});
    const displayedImmediately=!document.querySelector('#mediaMusicResults').hidden&&document.querySelector('#mediaMusicResults strong')?.textContent==='新歌曲';
    window.openRequests[0].resolve({ok:true,requestId:101});window.openRequests[1].resolve({ok:true,requestId:102});await Promise.all([first,second]);
    applyMediaMusicResults({ok:true,query:'新歌曲',requestId:101,results:[{url:'https://www.gequbao.com/music/stale',title:'过期结果'}]});
    const rejectedOldRequest=state.media.musicSearch.requestId===102&&state.media.musicSearch.results[0].title==='新歌曲';
    applyMediaMusicResults({ok:false,query:'新歌曲',requestId:102,reason:'search-timeout',results:[]});
    const lateFailurePreserved=state.media.musicSearch.status==='ready'&&state.media.musicSearch.results.length===1;
    const normalHidden=!state.media.browserVisible&&document.querySelector('#mediaBrowserShell').hidden;
    await offerMediaManualPortal('audio','load-error','https://www.gequbao.com/');
    const noErrorPopup=musicConfirmCalls===0&&!document.querySelector('#modalBackdrop').classList.contains('show')&&!state.media.browserVisible;
    state.media.browser={...state.media.browser,ready:true,url:'https://www.gequbao.com/s/test'};
    await toggleMediaManualPortal('audio');const eyeOpened=state.media.browserVisible&&!document.querySelector('#mediaBrowserShell').hidden;
    await toggleMediaManualPortal('audio');const eyeClosed=!state.media.browserVisible&&document.querySelector('#mediaBrowserShell').hidden;
    input.value='等待验证的歌曲';const managedSearch=searchMediaMusic();
    await new Promise(resolve=>setTimeout(resolve,0));
    window.openRequests.at(-1).resolve({ok:true,requestId:103});await managedSearch;
    const gate={securityCheckPending:true,requestId:103,automationStage:'music-search',ready:true,url:'https://www.gequbao.com/s/test'};
    setMediaTab('favorites');
    applyMediaBrowserState(gate);
    const keptOtherTab=state.media.tab==='favorites'&&document.querySelector('#mediaBrowserShell').hidden;
    setMediaTab('portal');
    const verificationButton=document.querySelector('#mediaMusicVerificationOpen');
    const verificationOnly=state.media.musicVerification?.showing&&!document.querySelector('#mediaBrowserShell').hidden&&document.querySelector('#mediaBrowserBack').closest('.media-browser-toolbar').hidden;
    await toggleMediaManualPortal('audio');
    applyMediaBrowserState(gate);
    applyMediaBrowserState({...gate,verificationRequired:true,verificationPending:true});
    const stayedClosed=!state.media.browserVisible&&document.querySelector('#mediaBrowserShell').hidden&&!verificationButton.hidden;
    verificationButton.click();
    const manuallyReopened=state.media.musicVerification?.showing&&state.media.browserVisible&&!document.querySelector('#mediaBrowserShell').hidden&&!document.querySelector('#modalBackdrop').classList.contains('show');
    applyMediaBrowserState({verificationCompleted:true,requestId:103,automationStage:'music-search'});
    const verificationClosed=!state.media.browserVisible&&verificationButton.hidden;
    applyMediaMusicResults({ok:true,query:input.value,requestId:103,results:[{url:'https://www.gequbao.com/music/117',title:input.value}]});
    showConfirmModal=originalConfirm;
    return {rejectedOld,rejectedOldRequest,displayedImmediately,lateFailurePreserved,normalHidden,noErrorPopup,eyeOpened,eyeClosed,keptOtherTab,verificationOnly,stayedClosed,manuallyReopened,verificationClosed,resumes,requestId:state.media.musicSearch.requestId};
  })()`);
  assert.deepStrictEqual(music,{rejectedOld:true,rejectedOldRequest:true,displayedImmediately:true,lateFailurePreserved:true,normalHidden:true,noErrorPopup:true,eyeOpened:true,eyeClosed:true,keptOtherTab:true,verificationOnly:true,stayedClosed:true,manuallyReopened:true,verificationClosed:true,resumes:0,requestId:103});
  const musicProgress=await evaluate(`(()=>{
    state.media.portalProgress={kind:'audio',operation:'download',status:'running',percent:97,message:'正在连接文件'};
    renderMediaAutomationProgress();
    const bar=document.querySelector('#mediaAutomationProgressBar'),label=document.querySelector('#mediaAutomationProgressPercent');
    const waiting=bar.matches(':indeterminate')&&!label.textContent&&!document.querySelector('#mediaAutomationProgress').hidden;
    state.media.portalProgress={kind:'audio',operation:'search',status:'running',percent:45};
    renderMediaAutomationProgress();
    const searching=bar.value===45&&label.textContent==='45%';
    applyMediaBrowserState({automationStage:'music-download',autoActionMissing:true,failureReason:'quota-or-ad-required'});
    const refusal=document.querySelector('#mediaBrowserStatus').textContent;
    return {waiting,searching,refusal};
  })()`);
  assert(musicProgress.waiting&&musicProgress.searching);
  assert.match(musicProgress.refusal,/歌曲宝.*额度/);
  assert.doesNotMatch(musicProgress.refusal,/关键词|备用站/);
  const operationVerification=await evaluate(`(async()=>{
    const url=state.media.musicSearch.results[0].url;
    let previewOpen,downloadOpen;
    api.previewMediaMusicResult=()=>new Promise(resolve=>previewOpen=resolve);
    api.downloadMediaMusicResult=()=>new Promise(resolve=>downloadOpen=resolve);
    const preview=previewMediaMusicVersion(0);
    applyMediaBrowserState({verificationRequired:true,verificationPending:true,requestId:201,automationMode:'music-preview',ready:true,url});
    const previewOpened=state.media.browserVisible&&state.media.musicVerification?.showing&&state.media.musicPreview.requestId===201;
    applyMediaBrowserState({verificationRequired:false,verificationPending:false,verificationCompleted:true,requestId:201,automationMode:'music-preview',url});
    const previewClosed=!state.media.browserVisible;
    previewOpen({ok:true,requestId:201});await preview;
    const download=downloadMediaMusicVersion(0);
    updateMediaDownloadTask({id:'queued-probe',status:'preparing',requestId:202,sourceUrl:url});
    await switchView('notes',{skipCoach:true});
    applyMediaBrowserState({verificationRequired:true,verificationPending:true,requestId:202,automationMode:'music-download',ready:true,url});
    const keptOtherView=state.view==='notes'&&document.querySelector('#mediaBrowserShell').hidden;
    await switchView('media',{skipCoach:true});
    const downloadOpened=state.media.browserVisible&&state.media.musicVerification?.showing&&!document.querySelector('#mediaBrowserShell').hidden&&state.media.musicOperation.requestId===202;
    applyMediaBrowserState({verificationRequired:false,verificationPending:false,verificationCompleted:true,requestId:202,automationMode:'music-download',url});
    const downloadClosed=!state.media.browserVisible;
    downloadOpen({ok:true,requestId:202});await download;
    updateMediaDownloadTask({id:'queued-probe',status:'downloading'});
    document.querySelector('#mediaMusicInput').value='另一首';
    const search=searchMediaMusic();await new Promise(resolve=>setTimeout(resolve,0));
    applyMediaBrowserState({verificationRequired:true,verificationPending:true,requestId:202,automationMode:'music-download',ready:true,url});
    const oldDownloadRejected=!state.media.browserVisible;
    applyMediaBrowserState({verificationRequired:true,verificationPending:true,requestId:203,automationMode:'music-search',ready:true,url:'https://www.gequbao.com/s/new'});
    applyMediaBrowserState({verificationRequired:false,verificationPending:false,verificationCompleted:true,requestId:202,automationMode:'music-download',url});
    const oldCompletionRejected=state.media.browserVisible;
    applyMediaMusicResults({ok:true,query:'另一首',requestId:203,results:[{url,title:'另一首'}]});
    window.openRequests.at(-1).resolve({ok:true,requestId:203});await search;
    return {previewOpened,previewClosed,keptOtherView,downloadOpened,downloadClosed,oldDownloadRejected,oldCompletionRejected,searchCompleteHidden:!state.media.browserVisible};
  })()`);
  assert.deepStrictEqual(operationVerification,{previewOpened:true,previewClosed:true,keptOtherView:true,downloadOpened:true,downloadClosed:true,oldDownloadRejected:true,oldCompletionRejected:true,searchCompleteHidden:true});
  console.log(`media progress UI metrics ${JSON.stringify({layouts,music,operationVerification,snapshots})}`);
  window.destroy();
}

run().then(()=>app.exit(0)).catch(error=>{console.error(error);if(window&&!window.isDestroyed())window.destroy();app.exit(1);});
