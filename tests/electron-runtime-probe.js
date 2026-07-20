const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, nativeImage } = require('electron');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-runtime-probe-'));
app.setPath('userData', tempDirectory);

function removeVerifiedTempDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('xuannian-runtime-probe-')) {
    throw new Error(`Refusing to remove unexpected probe directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function waitForRenderer(window, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for renderer expression: ${expression}`);
}

async function collectRendererHeap(window) {
  const shouldDetach = !window.webContents.debugger.isAttached();
  if (shouldDetach) window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    const usage = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    return Number(usage.usedSize || 0);
  } finally {
    if (shouldDetach && window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
  }
}

async function run() {
  await app.whenReady();
  const thumbnailSource = path.resolve(__dirname, '..', 'src', 'xuannian-logo-256.png');
  const systemThumbnail = await nativeImage.createThumbnailFromPath(thumbnailSource, { width: 96, height: 64 });
  assert(!systemThumbnail.isEmpty(), 'Electron system thumbnail service should load a local PNG');
  const thumbnailDataUrl = systemThumbnail.toDataURL();
  const mediaProbeWindow = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await mediaProbeWindow.loadFile(path.resolve(__dirname, '..', 'src', 'video-thumbnail.html'));
  const decodedImageDataUrl = await mediaProbeWindow.webContents.executeJavaScript(
    `window.captureImageThumbnail(${JSON.stringify(require('url').pathToFileURL(thumbnailSource).href)},96,64,3200)`,
    true,
  );
  assert(String(decodedImageDataUrl).startsWith('data:image/'), 'internal media decoder should load a local image');
  if (process.env.XUANNIAN_RUNTIME_VIDEO) {
    const videoPath = path.resolve(process.env.XUANNIAN_RUNTIME_VIDEO);
    let videoDataUrl = '';
    try {
      const systemVideoThumbnail = await nativeImage.createThumbnailFromPath(videoPath, { width: 160, height: 90 });
      if (!systemVideoThumbnail.isEmpty()) videoDataUrl = systemVideoThumbnail.toDataURL();
    } catch {}
    let source = 'system';
    if (!videoDataUrl) {
      source = 'renderer-fallback';
      videoDataUrl = await mediaProbeWindow.webContents.executeJavaScript(
        `window.captureVideoThumbnail(${JSON.stringify(require('url').pathToFileURL(videoPath).href)},160,90,3200)`,
        true,
      );
    }
    assert(String(videoDataUrl).startsWith('data:image/'), 'Electron should load or decode a local video frame');
    console.log(`system video thumbnail metrics ${JSON.stringify({ source, bytes: videoDataUrl.length })}`);
  }
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: { backgroundThrottling: false },
  });
  const rendererErrors = [];
  window.webContents.on('console-message', ({ level, message }) => {
    if (level >= 2 && !String(message).includes('Electron Security Warning')) rendererErrors.push(message);
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  if (!mediaProbeWindow.isDestroyed()) mediaProbeWindow.destroy();
  await window.webContents.executeJavaScript(`
    (() => {
      const now=Date.now();
      const data={
        records:Array.from({length:500},(_,index)=>({id:'record-'+index,type:'text',content:'synthetic clipboard '+index,createdAt:now-index})),
        noteProjects:[{id:'stress-project',name:'Stress',description:''}],
        notes:Array.from({length:10000},(_,index)=>({id:'note-'+index,projectId:'stress-project',order:index+1,type:'text',title:'Synthetic '+index,content:'Runtime favorite '+index+' '+('content '.repeat(10)),note:'',createdAt:now-index})),
        stickyProjects:[],stickyNotes:[],inspirationCategories:[],inspirations:[],
        settings:{theme:'light',storagePath:'browser',retentionDays:30,quickMenuHotkey:'Ctrl+Alt+X',screenshotHotkey:'Ctrl+Alt+D',quickStickyHotkey:'Ctrl+Alt+S',fileSearchHotkey:'Ctrl+Alt+A',inspirationSendHotkey:'Ctrl+Enter'}
      };
      localStorage.setItem('xuannian-notes-store-v1',JSON.stringify(data));
      localStorage.setItem('xuannian.onboarding.first-run.v1','seen');
      return data.notes.length;
    })()
  `);
  await window.webContents.reload();
  await waitForRenderer(window, "typeof state!=='undefined' && state.notes.length===10000");

  const thumbnailBridgeMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      let nativeCalls=0;
      const bridge=createUnifiedAPI({
        getFileThumbnail:async(filePath,size)=>{
          nativeCalls+=1;
          return filePath==='C:\\\\Media\\\\preview.png'&&size?.width===96?'native-thumbnail':'';
        }
      },fallbackApi);
      const result=await bridge.getFileThumbnail('C:\\\\Media\\\\preview.png',{width:96,height:64});
      return {nativeCalls,result};
    })()
  `, true);
  assert.deepStrictEqual(thumbnailBridgeMetrics, { nativeCalls: 1, result: 'native-thumbnail' });

  const metrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;
      await switchView('notes',{skipCoach:true});
      const list=document.querySelector('#noteList');
      list.scrollTop=0;
      renderNotes();
      list.querySelector('[data-note-card]')?.dispatchEvent(new WheelEvent('wheel',{deltaY:360,bubbles:true,cancelable:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const wheelScrollTop=list.scrollTop;
      let maxCards=0;
      const scrollDurations=[];
      for(let index=0;index<100;index+=1){
        const started=performance.now();
        list.scrollTop=(list.scrollHeight-list.clientHeight)*(index/99);
        renderNotes();
        scrollDurations.push(performance.now()-started);
        maxCards=Math.max(maxCards,list.querySelectorAll('[data-note-card]').length);
      }
      list.scrollTop=list.scrollHeight;
      renderNotes();
      const reachedLast=Boolean(list.querySelector('[data-note-card="note-9999"]'));
      const switchDurations=[];
      for(let index=0;index<40;index+=1){
        let started=performance.now();
        await switchView('clipboard',{skipCoach:true});
        await switchView('notes',{skipCoach:true});
        switchDurations.push(performance.now()-started);
        maxCards=Math.max(maxCards,list.querySelectorAll('[data-note-card]').length);
      }
      const search=document.querySelector('#noteSearch');
      search.value='Synthetic 9999';
      list.scrollTop=0;
      renderNotes();
      const searchFound=Boolean(list.querySelector('[data-note-card="note-9999"]'));
      return {
        noteCount:state.notes.length,
        maxCards,
        reachedLast,
        searchFound,
        wheelScrollTop,
        finalDomNodes:document.querySelectorAll('*').length,
        scrollP95Ms:Number(percentile(scrollDurations,.95).toFixed(2)),
        scrollMaxMs:Number(Math.max(...scrollDurations).toFixed(2)),
        switchP95Ms:Number(percentile(switchDurations,.95).toFixed(2)),
        switchMaxMs:Number(Math.max(...switchDurations).toFixed(2))
      };
    })()
  `, true);

  console.log(`electron runtime probe metrics ${JSON.stringify(metrics)}`);
  assert.strictEqual(metrics.noteCount, 10000);
  assert(metrics.maxCards <= 64, `virtual note DOM exceeded 64 cards: ${metrics.maxCards}`);
  assert(metrics.reachedLast, 'virtual list must reach the final favorite');
  assert(metrics.searchFound, 'search must scan favorites outside the current DOM window');
  assert(metrics.wheelScrollTop > 0, 'favorite list must react to a real wheel event');
  assert(metrics.finalDomNodes < 1700, `renderer DOM should stay bounded, received ${metrics.finalDomNodes} nodes`);
  assert.strictEqual(rendererErrors.length, 0, `renderer errors: ${rendererErrors.join(' | ')}`);
  const clipboardInitialRenderMs = await window.webContents.executeJavaScript(`
    (async()=>{
      state.notes=state.notes.map((note,index)=>({...note,sourceRecordId:'record-'+(index%500)}));
      await switchView('clipboard',{skipCoach:true});
      state.clipboardRenderLimit=500;
      document.querySelector('#clipboardList').scrollTop=0;
      state.records=[...state.records];
      const started=performance.now();
      renderClipboard();
      return Number((performance.now()-started).toFixed(2));
    })()
  `, true);
  const runClipboardEnduranceRound = () => window.webContents.executeJavaScript(`
    (()=>{
      const durations=[];
      for(let index=0;index<30;index+=1){
        const started=performance.now();
        renderClipboard();
        durations.push(performance.now()-started);
      }
      const sorted=[...durations].sort((a,b)=>a-b);
      return {
        renderP95Ms:Number(sorted[Math.floor(sorted.length*.95)].toFixed(2)),
        recordNodes:document.querySelectorAll('#clipboardList [data-record-card]').length,
        delegatedClicks:Array.from(document.querySelectorAll('#clipboardList [data-record-card],#clipboardList [data-pin-record],#clipboardList [data-save-record],#clipboardList [data-delete-record]')).every(element=>element.onclick===null)
      };
    })()
  `, true);
  const clipboardRoundOne = await runClipboardEnduranceRound();
  const clipboardHeapOne = await collectRendererHeap(window);
  const clipboardRoundTwo = await runClipboardEnduranceRound();
  const clipboardHeapTwo = await collectRendererHeap(window);
  const clipboardCompaction = await window.webContents.executeJavaScript(`
    (()=>{
      const list=document.querySelector('#clipboardList');
      list.scrollTop=0;
      const compacted=compactClipboardViewForBackground();
      return {compacted,renderLimit:state.clipboardRenderLimit,recordNodes:list.querySelectorAll('[data-record-card]').length};
    })()
  `, true);
  const clipboardEnduranceMetrics = {
    initialRenderMs: clipboardInitialRenderMs,
    roundOne: clipboardRoundOne,
    roundTwo: clipboardRoundTwo,
    heapOne: clipboardHeapOne,
    heapTwo: clipboardHeapTwo,
    heapGrowth: clipboardHeapTwo - clipboardHeapOne,
    compaction: clipboardCompaction,
  };
  console.log(`clipboard endurance metrics ${JSON.stringify(clipboardEnduranceMetrics)}`);
  assert(clipboardInitialRenderMs < 100, `initial 500-record clipboard render is too slow: ${clipboardInitialRenderMs}ms`);
  assert.strictEqual(clipboardRoundOne.recordNodes, 500);
  assert.strictEqual(clipboardRoundTwo.recordNodes, 500);
  assert.strictEqual(clipboardRoundOne.delegatedClicks, true, 'clipboard cards must use one delegated click handler');
  assert.strictEqual(clipboardRoundTwo.delegatedClicks, true, 'clipboard rerenders must not attach per-card click closures');
  assert(clipboardRoundTwo.renderP95Ms < 80, `clipboard rerender p95 is too slow: ${clipboardRoundTwo.renderP95Ms}ms`);
  assert(clipboardHeapTwo <= clipboardHeapOne + 8 * 1024 * 1024, `clipboard heap kept growing after GC: ${clipboardHeapTwo - clipboardHeapOne} bytes`);
  assert.deepStrictEqual(clipboardCompaction, { compacted: true, renderLimit: 60, recordNodes: 0 });
  const nativeIconMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      let active=0;
      let maxActive=0;
      let calls=0;
      window.nativeAPI={...(window.nativeAPI||{}),getFileIcon:async()=>{
        calls+=1;
        active+=1;
        maxActive=Math.max(maxActive,active);
        await new Promise(resolve=>setTimeout(resolve,4));
        active-=1;
        return ${JSON.stringify(thumbnailDataUrl)};
      }};
      const host=document.createElement('div');
      host.style.position='fixed';
      host.style.left='-10000px';
      for(let index=0;index<300;index+=1){
        const element=document.createElement('span');
        element.dataset.iconPath='C:\\\\Synthetic\\\\file-'+index+'.bin';
        host.appendChild(element);
      }
      document.body.appendChild(host);
      host.querySelectorAll('[data-icon-path]').forEach(queueNativeFileIcon);
      const deadline=Date.now()+10000;
      while((nativeFileIconQueue.length||nativeFileIconActive)&&Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      const result={calls,maxActive,active:nativeFileIconActive,queued:nativeFileIconQueue.length,cacheSize:nativeFileIconCache.size,cacheLimit:NATIVE_FILE_ICON_CACHE_LIMIT,concurrency:NATIVE_FILE_ICON_CONCURRENCY};
      releaseNativeFileIconTargets(host);
      host.remove();
      return result;
    })()
  `, true);
  console.log(`native icon queue metrics ${JSON.stringify(nativeIconMetrics)}`);
  assert.strictEqual(nativeIconMetrics.calls, 300);
  assert(nativeIconMetrics.maxActive <= nativeIconMetrics.concurrency, `native icon concurrency exceeded limit: ${nativeIconMetrics.maxActive}`);
  assert.strictEqual(nativeIconMetrics.active, 0);
  assert.strictEqual(nativeIconMetrics.queued, 0);
  assert(nativeIconMetrics.cacheSize <= nativeIconMetrics.cacheLimit, `native icon cache exceeded limit: ${nativeIconMetrics.cacheSize}`);
  const mediaPreviewMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const mockThumbnailDelayMs=300;
      api.getFileThumbnail=async()=>{
        await new Promise(resolve=>setTimeout(resolve,mockThumbnailDelayMs));
        return ${JSON.stringify(thumbnailDataUrl)};
      };
      await switchView('search',{skipCoach:true});
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='logo';
      state.fileSearch.results=[{
        path:${JSON.stringify(thumbnailSource)},
        directory:${JSON.stringify(path.dirname(thumbnailSource))},
        name:${JSON.stringify(path.basename(thumbnailSource))},
        kind:'file',fileType:'image',size:1,modifiedAt:1
      }];
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='logo';
      const renderStarted=performance.now();
      renderFileSearch();
      const firstPaintMs=performance.now()-renderStarted;
      const deadline=Date.now()+5000;
      let target;
      while(Date.now()<deadline){
        target=document.querySelector('.file-kind-icon.has-thumbnail');
        if(target) break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      if(target){
        target.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:null}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      const previewShown=document.querySelector('#fileThumbnailPreview')?.classList.contains('show')||false;
      if(target) target.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));
      const previewHidden=!document.querySelector('#fileThumbnailPreview')?.classList.contains('show');
      return {
        firstPaintMs:Number(firstPaintMs.toFixed(2)),
        mockThumbnailDelayMs,
        thumbnailLoaded:Boolean(target?.querySelector('.file-thumbnail')?.src?.startsWith('data:image/')),
        previewShown,
        previewHidden,
        active:fileThumbnailActive,
        concurrency:FILE_THUMBNAIL_CONCURRENCY,
        cacheSize:fileThumbnailCache.size,
        cacheLimit:FILE_THUMBNAIL_CACHE_LIMIT,
        filters:Array.from(document.querySelectorAll('#fileSearchFilters [data-file-type]')).map(node=>node.dataset.fileType)
      };
    })()
  `, true);
  console.log(`file search media preview metrics ${JSON.stringify(mediaPreviewMetrics)}`);
  assert(mediaPreviewMetrics.firstPaintMs < mediaPreviewMetrics.mockThumbnailDelayMs, `media result first paint must not wait for thumbnail: ${mediaPreviewMetrics.firstPaintMs}ms`);
  assert.strictEqual(mediaPreviewMetrics.thumbnailLoaded, true, 'visible image result should load a system thumbnail');
  assert.strictEqual(mediaPreviewMetrics.previewShown, true, 'hovering a loaded thumbnail should show the enlarged preview');
  assert.strictEqual(mediaPreviewMetrics.previewHidden, true, 'leaving a thumbnail should hide the enlarged preview');
  assert.strictEqual(mediaPreviewMetrics.concurrency, 3);
  assert(mediaPreviewMetrics.active <= mediaPreviewMetrics.concurrency, `thumbnail concurrency exceeded limit: ${mediaPreviewMetrics.active}`);
  assert(mediaPreviewMetrics.cacheSize <= mediaPreviewMetrics.cacheLimit, `thumbnail cache exceeded limit: ${mediaPreviewMetrics.cacheSize}`);
  assert.deepStrictEqual(mediaPreviewMetrics.filters, ['all', 'file', 'folder', 'document', 'image', 'video', 'audio']);
  const thumbnailWindowMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const waitUntil=async(predicate,timeoutMs=5000)=>{
        const deadline=Date.now()+timeoutMs;
        while(Date.now()<deadline){
          if(predicate()) return true;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        return false;
      };
      await waitUntil(()=>fileThumbnailActive===0);
      resetFileThumbnailQueue();
      const requested=[];
      api.getFileThumbnail=async filePath=>{
        const match=String(filePath).match(/thumbnail-window-(\\d+)\\.png$/);
        if(match) requested.push(Number(match[1]));
        return ${JSON.stringify(thumbnailDataUrl)};
      };
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='thumbnail-window';
      state.fileSearch.results=Array.from({length:120},(_,index)=>({
        path:'C:/Synthetic/thumbnail-window-'+index+'.png',directory:'C:/Synthetic',
        name:'thumbnail-window-'+index+'.png',kind:'file',fileType:'image',size:2000+index,modifiedAt:index+100
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='thumbnail-window';
      const list=document.querySelector('#fileResultList');
      list.scrollTop=0;
      renderFileSearch();
      const immediateRequests=requested.length;
      const initialRange=fileThumbnailWindowRange(list,state.fileSearch.results.length);
      const initialReady=await waitUntil(()=>{
        for(let index=initialRange.start;index<initialRange.end;index+=1){
          if(!requested.includes(index)) return false;
        }
        return true;
      });
      const initialRequests=[...requested];
      const initialLoaded=Array.from(list.querySelectorAll('.file-kind-icon[data-file-thumbnail-key]'))
        .filter(element=>{
          const index=Number(element.closest('[data-file-index]')?.dataset.fileIndex);
          return index>=initialRange.start&&index<initialRange.end&&element.classList.contains('has-thumbnail');
        }).length;
      list.scrollTop=30*FILE_RESULT_ROW_HEIGHT;
      renderFileSearchResults();
      const scrolledRange=fileThumbnailWindowRange(list,state.fileSearch.results.length);
      const scrolledReady=await waitUntil(()=>{
        for(let index=scrolledRange.start;index<scrolledRange.end;index+=1){
          if(!requested.includes(index)) return false;
        }
        return true;
      });
      const scrolledRequests=requested.filter(index=>index>=scrolledRange.start&&index<scrolledRange.end);
      resetFileThumbnailQueue();
      await waitUntil(()=>fileThumbnailActive===0);
      return {
        immediateRequests,
        prefetchRows:FILE_THUMBNAIL_PREFETCH_ROWS,
        initialRange,
        initialReady,
        initialRequests,
        initialLoaded,
        scrolledRange,
        scrolledReady,
        scrolledRequests,
        totalRequested:new Set(requested).size,
      };
    })()
  `, true);
  console.log(`file thumbnail viewport metrics ${JSON.stringify(thumbnailWindowMetrics)}`);
  assert.strictEqual(thumbnailWindowMetrics.immediateRequests, 0, 'thumbnail work must start after the result list first paint');
  assert.strictEqual(thumbnailWindowMetrics.prefetchRows, 10, 'thumbnail prefetch must stay at exactly ten rows');
  assert.strictEqual(thumbnailWindowMetrics.initialReady, true, 'initial visible thumbnail window should finish loading');
  assert.strictEqual(thumbnailWindowMetrics.initialRequests.length, thumbnailWindowMetrics.initialRange.end - thumbnailWindowMetrics.initialRange.start, 'initial requests must be limited to the visible rows plus ten');
  assert.strictEqual(thumbnailWindowMetrics.initialLoaded, thumbnailWindowMetrics.initialRange.end - thumbnailWindowMetrics.initialRange.start, 'initial thumbnail window should render every loaded preview');
  assert.strictEqual(thumbnailWindowMetrics.scrolledReady, true, 'scrolling should advance the thumbnail window');
  assert.strictEqual(thumbnailWindowMetrics.scrolledRequests.length, thumbnailWindowMetrics.scrolledRange.end - thumbnailWindowMetrics.scrolledRange.start, 'scrolled requests must cover the new visible rows plus ten');
  assert(thumbnailWindowMetrics.totalRequested < 60, `thumbnail loading should not scan all results: ${thumbnailWindowMetrics.totalRequested}`);
  const thumbnailJumpMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const waitUntil=async(predicate,timeoutMs=5000)=>{
        const deadline=Date.now()+timeoutMs;
        while(Date.now()<deadline){
          if(predicate()) return true;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        return false;
      };
      await waitUntil(()=>fileThumbnailActive===0&&fileThumbnailRequestKeys.size===0);
      resetFileThumbnailQueue();
      const requested=[];
      api.getFileThumbnail=async filePath=>{
        const match=String(filePath).match(/thumbnail-jump-(\\d+)\\.(?:png|mp4)$/);
        const index=match?Number(match[1]):-1;
        requested.push(index);
        await new Promise(resolve=>setTimeout(resolve,180));
        return ${JSON.stringify(thumbnailDataUrl)};
      };
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='thumbnail-jump';
      state.fileSearch.results=Array.from({length:160},(_,index)=>({
        path:'C:/Synthetic/thumbnail-jump-'+index+(index%2?'.mp4':'.png'),directory:'C:/Synthetic',
        name:'thumbnail-jump-'+index+(index%2?'.mp4':'.png'),kind:'file',fileType:index%2?'video':'image',size:8000+index,modifiedAt:index+800
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='thumbnail-jump';
      const list=document.querySelector('#fileResultList');
      list.scrollTop=0;
      renderFileSearch();
      const initialStarted=await waitUntil(()=>requested.length>=3);
      const initialRequested=[...requested];
      const jumpStartedAt=performance.now();
      list.scrollTop=70*FILE_RESULT_ROW_HEIGHT;
      renderFileSearchResults();
      queueVisibleFileThumbnails();
      const pendingAfterJump=fileThumbnailRequestKeys.size;
      const finalRange=fileThumbnailWindowRange(list,state.fileSearch.results.length);
      const finalStarted=await waitUntil(()=>requested.includes(finalRange.start));
      const finalStartDelayMs=performance.now()-jumpStartedAt;
      const finalLoaded=await waitUntil(()=>{
        for(let index=finalRange.start;index<finalRange.end;index+=1){
          const row=list.querySelector('[data-file-index="'+index+'"]');
          if(!row?.querySelector('.file-kind-icon')?.classList.contains('has-thumbnail')) return false;
        }
        return true;
      });
      const skippedRequests=requested.filter(index=>index>=3&&index<finalRange.start);
      const skippedCacheEntries=initialRequested.filter(index=>{
        const item=state.fileSearch.results[index];
        return fileThumbnailCache.has(fileThumbnailKey(item));
      });
      const requestedVideo=requested.some(index=>index>=finalRange.start&&index<finalRange.end&&index%2===1);
      resetFileThumbnailQueue();
      await waitUntil(()=>fileThumbnailActive===0&&fileThumbnailRequestKeys.size===0);
      return {
        initialStarted,
        initialRequested,
        finalRange,
        finalStarted,
        finalStartDelayMs:Number(finalStartDelayMs.toFixed(1)),
        finalLoaded,
        skippedRequests,
        skippedCacheEntries,
        requestedVideo,
        pendingAfterJump,
        maxPending:FILE_THUMBNAIL_MAX_PENDING_REQUESTS,
      };
    })()
  `, true);
  console.log(`file thumbnail jump metrics ${JSON.stringify(thumbnailJumpMetrics)}`);
  assert.strictEqual(thumbnailJumpMetrics.initialStarted, true, 'initial viewport should start thumbnail work');
  assert.strictEqual(thumbnailJumpMetrics.finalStarted, true, 'jumped-to viewport must take priority immediately');
  assert(thumbnailJumpMetrics.finalStartDelayMs < 250, `jumped-to viewport should not wait for skipped rows: ${thumbnailJumpMetrics.finalStartDelayMs}ms`);
  assert.strictEqual(thumbnailJumpMetrics.finalLoaded, true, 'jumped-to visible image and video previews should all render');
  assert.deepStrictEqual(thumbnailJumpMetrics.skippedRequests, [], 'rows skipped by a fast scroll must be dropped before thumbnail generation');
  assert.deepStrictEqual(thumbnailJumpMetrics.skippedCacheEntries, [], 'completed thumbnails from an ignored viewport must not consume cache');
  assert.strictEqual(thumbnailJumpMetrics.requestedVideo, true, 'video results must use the same viewport-priority thumbnail queue');
  assert(thumbnailJumpMetrics.pendingAfterJump <= thumbnailJumpMetrics.maxPending, 'background thumbnail requests must remain bounded');
  const thumbnailRetryMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const waitUntil=async(predicate,timeoutMs=8000)=>{
        const deadline=Date.now()+timeoutMs;
        while(Date.now()<deadline){
          if(predicate()) return true;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        return false;
      };
      await waitUntil(()=>fileThumbnailActive===0&&fileThumbnailRequestKeys.size===0);
      resetFileThumbnailQueue();
      const attempts=new Map();
      api.getFileThumbnail=async filePath=>{
        const match=String(filePath).match(/thumbnail-retry-(\\d+)\\.png$/);
        const index=match?Number(match[1]):-1;
        const count=(attempts.get(index)||0)+1;
        attempts.set(index,count);
        return count>=3?${JSON.stringify(thumbnailDataUrl)}:'';
      };
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='thumbnail-retry';
      state.fileSearch.results=Array.from({length:30},(_,index)=>({
        path:'C:/Synthetic/thumbnail-retry-'+index+'.png',directory:'C:/Synthetic',
        name:'thumbnail-retry-'+index+'.png',kind:'file',fileType:'image',size:7000+index,modifiedAt:index+700
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='thumbnail-retry';
      const list=document.querySelector('#fileResultList');
      list.scrollTop=0;
      renderFileSearch();
      const range=fileThumbnailWindowRange(list,state.fileSearch.results.length);
      const unavailableShown=await waitUntil(()=>{
        for(let index=range.start;index<range.visibleEnd;index+=1){
          const row=list.querySelector('[data-file-index="'+index+'"]');
          if(row?.querySelector('.file-preview-unavailable')?.textContent!=='不可预览') return false;
        }
        return true;
      });
      const recoveredWithoutScroll=await waitUntil(()=>{
        for(let index=range.start;index<range.visibleEnd;index+=1){
          const row=list.querySelector('[data-file-index="'+index+'"]');
          if(!row?.querySelector('.file-kind-icon')?.classList.contains('has-thumbnail')) return false;
        }
        return true;
      });
      const visibleAttempts=Array.from({length:range.visibleEnd-range.start},(_,offset)=>attempts.get(range.start+offset)||0);
      const retryStateCleared=Array.from({length:range.visibleEnd-range.start},(_,offset)=>range.start+offset)
        .every(index=>{
          const key=fileThumbnailKey(state.fileSearch.results[index]);
          return !fileThumbnailFailureCounts.has(key)&&!fileThumbnailRetryDue.has(key);
        });
      const unavailableCleared=Array.from({length:range.visibleEnd-range.start},(_,offset)=>range.start+offset)
        .every(index=>!list.querySelector('[data-file-index="'+index+'"] .file-preview-unavailable'));
      resetFileThumbnailQueue();
      await waitUntil(()=>fileThumbnailActive===0&&fileThumbnailRequestKeys.size===0);
      return {unavailableShown,recoveredWithoutScroll,visibleAttempts,retryStateCleared,unavailableCleared};
    })()
  `, true);
  console.log(`file thumbnail retry metrics ${JSON.stringify(thumbnailRetryMetrics)}`);
  assert.strictEqual(thumbnailRetryMetrics.unavailableShown, true, 'media that fails both preview paths must show an unavailable label before its name');
  assert.strictEqual(thumbnailRetryMetrics.recoveredWithoutScroll, true, 'visible thumbnail failures must recover without another scroll event');
  assert(thumbnailRetryMetrics.visibleAttempts.every(count => count >= 3), 'every visible failed thumbnail must keep retrying until it succeeds');
  assert.strictEqual(thumbnailRetryMetrics.retryStateCleared, true, 'successful thumbnails must clear retry state');
  assert.strictEqual(thumbnailRetryMetrics.unavailableCleared, true, 'a recovered thumbnail must remove its unavailable label');
  const thumbnailRecoveryMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const waitUntil=async(predicate,timeoutMs=7000)=>{
        const deadline=Date.now()+timeoutMs;
        while(Date.now()<deadline){
          if(predicate()) return true;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        return false;
      };
      await waitUntil(()=>fileThumbnailActive===0);
      resetFileThumbnailQueue();
      const requested=[];
      api.getFileThumbnail=async filePath=>{
        const match=String(filePath).match(/thumbnail-recovery-(\\d+)\\.png$/);
        const index=match?Number(match[1]):-1;
        requested.push(index);
        if(index>=0&&index<3) await new Promise(resolve=>setTimeout(resolve,FILE_THUMBNAIL_TIMEOUT_MS+300));
        return ${JSON.stringify(thumbnailDataUrl)};
      };
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='thumbnail-recovery';
      state.fileSearch.results=Array.from({length:40},(_,index)=>({
        path:'C:/Synthetic/thumbnail-recovery-'+index+'.png',directory:'C:/Synthetic',
        name:'thumbnail-recovery-'+index+'.png',kind:'file',fileType:'image',size:5000+index,modifiedAt:index+500
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='thumbnail-recovery';
      const list=document.querySelector('#fileResultList');
      list.scrollTop=0;
      const started=performance.now();
      renderFileSearch();
      const queueAdvanced=await waitUntil(()=>requested.includes(3));
      const advancedAfterMs=performance.now()-started;
      const latePreviewsLoaded=await waitUntil(()=>[0,1,2].every(index=>{
        const row=list.querySelector('[data-file-index="'+index+'"]');
        return row?.querySelector('.file-kind-icon')?.classList.contains('has-thumbnail');
      }));
      resetFileThumbnailQueue();
      await waitUntil(()=>fileThumbnailActive===0);
      return {queueAdvanced,advancedAfterMs:Number(advancedAfterMs.toFixed(1)),latePreviewsLoaded,requested:[...requested]};
    })()
  `, true);
  console.log(`file thumbnail recovery metrics ${JSON.stringify(thumbnailRecoveryMetrics)}`);
  assert.strictEqual(thumbnailRecoveryMetrics.queueAdvanced, true, 'three slow thumbnails must not permanently block the remaining queue');
  assert(thumbnailRecoveryMetrics.advancedAfterMs >= 4000 && thumbnailRecoveryMetrics.advancedAfterMs < 6000, `thumbnail timeout should advance the queue promptly: ${thumbnailRecoveryMetrics.advancedAfterMs}ms`);
  assert.strictEqual(thumbnailRecoveryMetrics.latePreviewsLoaded, true, 'slow thumbnails should still render when they finish after the queue timeout');
  assert(thumbnailRecoveryMetrics.requested.includes(3), 'the fourth thumbnail request should start after stalled slots are released');
  const thumbnailQueueMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const idleDeadline=Date.now()+5000;
      while((fileThumbnailActive||fileThumbnailRequestKeys.size)&&Date.now()<idleDeadline) await new Promise(resolve=>setTimeout(resolve,10));
      api.getFileThumbnail=async()=>{
        await new Promise(resolve=>setTimeout(resolve,180));
        return ${JSON.stringify(thumbnailDataUrl)};
      };
      resetFileThumbnailQueue();
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='media-stress';
      state.fileSearch.results=Array.from({length:1000},(_,index)=>({
        path:${JSON.stringify(thumbnailSource)},directory:${JSON.stringify(path.dirname(thumbnailSource))},
        name:'media-'+index+'.png',kind:'file',fileType:'image',size:1000+index,modifiedAt:index+1
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='media-stress';
      renderFileSearch();
      const list=document.querySelector('#fileResultList');
      let maxQueue=fileThumbnailQueue.length;
      let maxActive=fileThumbnailActive;
      let maxPending=fileThumbnailRequestKeys.size;
      const durations=[];
      for(let index=0;index<80;index+=1){
        list.scrollTop=(list.scrollHeight-list.clientHeight)*(index/79);
        const started=performance.now();
        renderFileSearchResults();
        queueVisibleFileThumbnails();
        durations.push(performance.now()-started);
        maxQueue=Math.max(maxQueue,fileThumbnailQueue.length);
        maxActive=Math.max(maxActive,fileThumbnailActive);
        maxPending=Math.max(maxPending,fileThumbnailRequestKeys.size);
      }
      resetFileThumbnailQueue();
      const deadline=Date.now()+5000;
      while((fileThumbnailActive||fileThumbnailRequestKeys.size)&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
      const sorted=[...durations].sort((a,b)=>a-b);
      return {maxQueue,maxActive,maxPending,pendingLimit:FILE_THUMBNAIL_MAX_PENDING_REQUESTS,renderP95Ms:Number(sorted[75].toFixed(2)),concurrency:FILE_THUMBNAIL_CONCURRENCY};
    })()
  `, true);
  console.log(`file thumbnail queue stress metrics ${JSON.stringify(thumbnailQueueMetrics)}`);
  assert(thumbnailQueueMetrics.maxActive <= thumbnailQueueMetrics.concurrency, `thumbnail stress exceeded concurrency: ${thumbnailQueueMetrics.maxActive}`);
  assert(thumbnailQueueMetrics.maxPending <= thumbnailQueueMetrics.pendingLimit, `thumbnail pending requests exceeded limit: ${thumbnailQueueMetrics.maxPending}`);
  assert(thumbnailQueueMetrics.maxQueue <= 32, `thumbnail pending queue should stay near the visible window: ${thumbnailQueueMetrics.maxQueue}`);
  assert(thumbnailQueueMetrics.renderP95Ms < 45, `media virtual-list render p95 is too slow: ${thumbnailQueueMetrics.renderP95Ms}ms`);
  const hotkeyHelpMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      await switchView('settings',{skipCoach:true});
      document.querySelector('#showScreenshotHotkeyHelp').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      const screenshotTitle=document.querySelector('#modalBox h3')?.textContent||'';
      const screenshotMessage=document.querySelector('#modalBox .modal-message')?.textContent||'';
      document.querySelector('#confirmModal')?.click();
      document.querySelector('#showFileSearchHotkeyHelp').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      const searchTitle=document.querySelector('#modalBox h3')?.textContent||'';
      const searchMessage=document.querySelector('#modalBox .modal-message')?.textContent||'';
      document.querySelector('#confirmModal')?.click();
      return {screenshotTitle,screenshotMessage,searchTitle,searchMessage};
    })()
  `, true);
  assert.strictEqual(hotkeyHelpMetrics.screenshotTitle, '截图快捷键说明');
  assert(hotkeyHelpMetrics.screenshotMessage.includes('Ctrl + Alt + D'));
  assert.strictEqual(hotkeyHelpMetrics.searchTitle, '全盘查找快捷键说明');
  assert(hotkeyHelpMetrics.searchMessage.includes('不阻塞文件查询'));
  const fileSearchMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      await switchView('search',{skipCoach:true});
      const now=Date.now();
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='Synthetic';
      state.fileSearch.results=Array.from({length:10000},(_,index)=>({
        path:'C:\\\\Synthetic\\\\Folder\\\\item-'+index+'.txt',
        directory:'C:\\\\Synthetic\\\\Folder',
        name:'item-'+index+'.txt',kind:'file',size:index*1024,modifiedAt:now-index*1000
      }));
      state.fileSearch.selectedIndex=0;
      document.querySelector('#fileSearchInput').value='Synthetic';
      renderFileSearch();
      const list=document.querySelector('#fileResultList');
      let maxRows=0;
      const scrollDurations=[];
      for(let index=0;index<100;index+=1){
        const started=performance.now();
        list.scrollTop=(list.scrollHeight-list.clientHeight)*(index/99);
        renderFileSearchResults();
        scrollDurations.push(performance.now()-started);
        maxRows=Math.max(maxRows,list.querySelectorAll('.file-row').length);
      }
      list.scrollTop=list.scrollHeight;
      renderFileSearchResults();
      return {
        resultCount:state.fileSearch.results.length,
        maxRows,
        reachedLast:Boolean(list.querySelector('[data-file-index="9999"]')),
        finalDomNodes:document.querySelectorAll('*').length,
        scrollP95Ms:Number([...scrollDurations].sort((a,b)=>a-b)[94].toFixed(2)),
        shortcut:document.querySelector('#fileSearchShortcutLabel').textContent.trim(),
        stateView:state.view,
        activeView:document.querySelector('.view.active')?.id||'',
        activeNav:document.querySelector('.nav-btn.active')?.dataset.view||''
      };
    })()
  `, true);
  console.log(`file search runtime probe metrics ${JSON.stringify(fileSearchMetrics)}`);
  assert.strictEqual(fileSearchMetrics.resultCount, 10000);
  assert(fileSearchMetrics.maxRows <= 48, `virtual file-search DOM exceeded 48 rows: ${fileSearchMetrics.maxRows}`);
  assert(fileSearchMetrics.reachedLast, 'virtual file-search list must reach the final result');
  assert(fileSearchMetrics.finalDomNodes < 2150, `file-search DOM should stay bounded, received ${fileSearchMetrics.finalDomNodes} nodes`);
  assert.strictEqual(fileSearchMetrics.shortcut, 'Ctrl + Alt + A');
  assert.strictEqual(fileSearchMetrics.stateView, 'search');
  assert.strictEqual(fileSearchMetrics.activeView, 'searchView');
  assert.strictEqual(fileSearchMetrics.activeNav, 'search');
  const fileDoubleClickMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const opened=[];
      const copied=[];
      const contextMenus=[];
      api.openPath=async filePath=>{ opened.push(filePath); return true; };
      api.copyFileToClipboard=async filePath=>{ copied.push(filePath); return true; };
      api.showFileContextMenu=async filePath=>{ contextMenus.push(filePath); return true; };
      state.fileSearch.engineStatus='ready';
      state.fileSearch.query='double-click';
      state.fileSearch.results=[
        {path:'C:/Synthetic/double-click-one.txt',directory:'C:/Synthetic',name:'double-click-one.txt',kind:'file',fileType:'document',size:10,modifiedAt:2},
        {path:'C:/Synthetic/double-click-two.txt',directory:'C:/Synthetic',name:'double-click-two.txt',kind:'file',fileType:'document',size:20,modifiedAt:1},
      ];
      state.fileSearch.selectedIndex=-1;
      document.querySelector('#fileSearchInput').value='double-click';
      document.querySelector('#fileResultList').scrollTop=0;
      renderFileSearch();
      const row=document.querySelector('#fileResultList [data-file-index="0"]');
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      const rowPreserved=row.isConnected&&document.querySelector('#fileResultList [data-file-index="0"]')===row;
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));
      const selectedAfterDouble=state.fileSearch.selectedIndex;
      const second=document.querySelector('#fileResultList [data-file-index="1"]');
      second.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      second.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      second.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      await new Promise(resolve=>setTimeout(resolve,250));
      return {rowPreserved,selectedAfterDouble,selectedIndex:state.fileSearch.selectedIndex,opened,copied,contextMenus};
    })()
  `, true);
  console.log(`file result double-click metrics ${JSON.stringify(fileDoubleClickMetrics)}`);
  assert.strictEqual(fileDoubleClickMetrics.rowPreserved, true, 'single-click selection must preserve the row for a native double-click');
  assert.strictEqual(fileDoubleClickMetrics.selectedAfterDouble, 0, 'double-click should keep the clicked result selected');
  assert.deepStrictEqual(fileDoubleClickMetrics.opened, ['C:/Synthetic/double-click-one.txt'], 'double-clicking a result row should open that file exactly once');
  assert.deepStrictEqual(fileDoubleClickMetrics.copied, ['C:/Synthetic/double-click-two.txt'], 'single-clicking a result row should copy that file exactly once');
  assert.deepStrictEqual(fileDoubleClickMetrics.contextMenus, ['C:/Synthetic/double-click-two.txt'], 'right-clicking a result row should open its file context menu');
  const noteCategoryMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const original={
        projects:state.noteProjects,
        notes:state.notes,
        active:state.activeNoteProject,
        showItemContextMenu:api.showItemContextMenu,
        updateNoteProject:api.updateNoteProject,
        deleteNoteProject:api.deleteNoteProject,
        getNotes:api.getNotes,
      };
      const menuCalls=[];
      const menuActions=['rename','delete'];
      state.noteProjects=[{id:'category-a',name:'分类甲'},{id:'category-b',name:'分类乙'}];
      state.notes=[{id:'category-note',projectId:'category-b',title:'分类收藏',content:'收藏内容',createdAt:1,order:1}];
      state.activeNoteProject='category-b';
      api.showItemContextMenu=async(kind,options)=>{ menuCalls.push({kind,options}); return menuActions.shift()||''; };
      api.updateNoteProject=async(id,patch)=>state.noteProjects.map(project=>project.id===id?{...project,...patch}:project);
      api.deleteNoteProject=async id=>{
        const remaining=state.noteProjects.filter(project=>project.id!==id);
        state.notes=state.notes.map(note=>note.projectId===id?{...note,projectId:remaining[0].id}:note);
        return remaining;
      };
      api.getNotes=async()=>state.notes;
      await switchView('notes',{skipCoach:true});
      renderNoteProjects();
      document.querySelector('[data-project-id="category-a"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,10));
      const renameTitle=document.querySelector('#modalBox h3')?.textContent||'';
      document.querySelector('#editCategoryName').value='修改后的分类';
      document.querySelector('#saveCategory').click();
      await new Promise(resolve=>setTimeout(resolve,10));
      const renamed=state.noteProjects.find(project=>project.id==='category-a')?.name||'';
      document.querySelector('[data-project-id="category-b"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,10));
      const deleteTitle=document.querySelector('#modalBox h3')?.textContent||'';
      const deleteMessage=document.querySelector('#modalBox .modal-message')?.textContent||'';
      document.querySelector('#confirmModal').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      const result={
        menuCalls,renameTitle,renamed,deleteTitle,deleteMessage,
        remaining:state.noteProjects.map(project=>project.name),
        movedProjectId:state.notes[0]?.projectId||'',
        activeProject:state.activeNoteProject,
      };
      state.noteProjects=original.projects;
      state.notes=original.notes;
      state.activeNoteProject=original.active;
      state.noteFilterCache=null;
      api.showItemContextMenu=original.showItemContextMenu;
      api.updateNoteProject=original.updateNoteProject;
      api.deleteNoteProject=original.deleteNoteProject;
      api.getNotes=original.getNotes;
      renderNoteProjects();
      renderNotes();
      return result;
    })()
  `, true);
  console.log(`note category context-menu metrics ${JSON.stringify(noteCategoryMetrics)}`);
  assert.deepStrictEqual(noteCategoryMetrics.menuCalls, [
    {kind:'note-category',options:{canDelete:true}},
    {kind:'note-category',options:{canDelete:true}},
  ]);
  assert.strictEqual(noteCategoryMetrics.renameTitle, '修改收藏分类');
  assert.strictEqual(noteCategoryMetrics.renamed, '修改后的分类');
  assert.strictEqual(noteCategoryMetrics.deleteTitle, '删除收藏分类');
  assert(noteCategoryMetrics.deleteMessage.includes('移动到剩余分类'));
  assert.deepStrictEqual(noteCategoryMetrics.remaining, ['修改后的分类']);
  assert.strictEqual(noteCategoryMetrics.movedProjectId, 'category-a');
  assert.strictEqual(noteCategoryMetrics.activeProject, 'category-a');
  const mediaLibraryMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const openedPortals=[];
      const portalTargets=[];
      const copiedText=[];
      const copiedFiles=[];
      const contextMenus=[];
      const portalInputs=[];
      const favoriteCollections=[];
      const movedFavorites=[];
      const deletedFavorites=[];
      const syntheticDownloads=Array.from({length:5000},(_,index)=>({path:'C:/Downloads/archive/video-'+index+'.mp4',directory:'C:/Downloads/archive',name:'video-'+index+'.mp4',kind:'video',size:4096+index,modifiedAt:index,favorite:false,location:'downloads',collection:'项目视频'}));
      api.resolveMediaVideoProvider=async value=>resolveMediaVideoProviderFallback(value);
      api.openMediaPortal=async(url,target,sourceText,autoSubmit,collection)=>{ openedPortals.push(url); portalTargets.push(target); portalInputs.push({sourceText,autoSubmit,collection}); return true; };
      api.copyText=async value=>{ copiedText.push(value); return true; };
      api.copyFileToClipboard=async value=>{ copiedFiles.push(value); return true; };
      api.showItemContextMenu=async(kind,options)=>{ contextMenus.push({kind,options}); return ''; };
      api.favoriteLocalMedia=async(filePath,collection)=>{ favoriteCollections.push({filePath,collection}); return {ok:true}; };
      api.moveLocalMedia=async(filePath,location,collection)=>{ movedFavorites.push({filePath,location,collection}); return {ok:true}; };
      api.deleteLocalMedia=async(filePath,location)=>{ deletedFavorites.push({filePath,location}); return {ok:true}; };
      api.listLocalMedia=async()=>({
        ok:true,
        downloadPath:'C:/Downloads',
        favoritePath:'C:/Favorites',
        collections:{downloads:{video:['项目视频'],audio:['常用音乐']},favorites:{video:['项目收藏'],audio:['常用音乐']}},
        items:[
          {path:'C:/Downloads/demo.mp4',directory:'C:/Downloads',name:'demo.mp4',kind:'video',size:2048,modifiedAt:2,favorite:false,location:'downloads',collection:''},
          {path:'C:/Downloads/music.flac',directory:'C:/Downloads',name:'music.flac',kind:'audio',size:1024,modifiedAt:1,favorite:false,location:'downloads',collection:''},
          ...syntheticDownloads,
          {path:'C:/Favorites/favorite.mp4',directory:'C:/Favorites',name:'favorite.mp4',kind:'video',size:8192,modifiedAt:3,favorite:true,location:'favorites',collection:''},
        ],
      });
      await switchView('media',{skipCoach:true});
      const videoInput=document.querySelector('#mediaVideoInput');
      videoInput.value='https://www.bilibili.com/video/BV1runtime';
      videoInput.dispatchEvent(new Event('input',{bubbles:true}));
      await openMediaVideoPortal(false);
      const favoritePortalPromise=openMediaVideoPortal(false,true);
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#mediaCollectionPicker').value='项目收藏';
      document.querySelector('#confirmModal').click();
      await favoritePortalPromise;
      document.querySelector('#mediaKindTabs [data-media-kind="audio"]').click();
      const audioPortalSelected=state.media.kind==='audio'&&state.media.tab==='portal';
      const videoProviderHiddenOnAudio=document.querySelector('#mediaVideoProvider').closest('[data-media-launcher]').hidden;
      document.querySelector('#mediaKindTabs [data-media-kind="video"]').click();
      const videoPortalSelected=state.media.kind==='video'&&state.media.tab==='portal';
      setMediaTab('downloads');
      const noKindSelectedOnDownloads=!document.querySelector('#mediaKindTabs [data-media-kind].active');
      await new Promise(resolve=>setTimeout(resolve,20));
      const allDownloadedCount=filteredMediaItems('downloads').length;
      const initialVirtualRows=document.querySelectorAll('#mediaDownloadsList [data-media-row]').length;
      const first=document.querySelector('#mediaDownloadsList [data-media-row="0"]');
      first.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      await new Promise(resolve=>setTimeout(resolve,240));
      first.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      const mediaSearch=document.querySelector('#mediaDownloadsSearch');
      mediaSearch.value='demo';
      mediaSearch.dispatchEvent(new Event('input',{bubbles:true}));
      const matchingSearchRows=document.querySelectorAll('#mediaDownloadsList [data-media-row]').length;
      mediaSearch.value='missing';
      mediaSearch.dispatchEvent(new Event('input',{bubbles:true}));
      const missingSearchRows=document.querySelectorAll('#mediaDownloadsList [data-media-row]').length;
      mediaSearch.value='';
      mediaSearch.dispatchEvent(new Event('input',{bubbles:true}));
      const downloadList=document.querySelector('#mediaDownloadsList');
      downloadList.scrollTop=downloadList.scrollHeight;
      renderMediaList('downloads',{force:true});
      const reachedLastDownload=Boolean(document.querySelector('#mediaDownloadsList [data-media-row="'+(allDownloadedCount-1)+'"]'));
      const maxVirtualRows=document.querySelectorAll('#mediaDownloadsList [data-media-row]').length;
      const favoritePromise=performMediaAction('favorite','downloads',0);
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#mediaCollectionPicker').value='项目收藏';
      document.querySelector('#confirmModal').click();
      await favoritePromise;
      setMediaTab('favorites');
      const noKindSelectedOnFavorites=!document.querySelector('#mediaKindTabs [data-media-kind].active');
      await new Promise(resolve=>setTimeout(resolve,30));
      state.media.draggedFavoritePath='C:/Favorites/favorite.mp4';
      const favoriteFolder=document.querySelector('#mediaFavoriteCollections [data-media-collection="项目收藏"]');
      await handleMediaFavoriteDrop({target:favoriteFolder,preventDefault(){},dataTransfer:{getData(){return 'C:/Favorites/favorite.mp4';}}});
      const removeFavoritePromise=performMediaAction('favorite','favorites',0);
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#confirmModal').click();
      await removeFavoritePromise;
      setMediaTab('downloads');
      await new Promise(resolve=>setTimeout(resolve,20));
      updateMediaDownloadTask({id:'runtime-download',name:'runtime.mp4',status:'downloading',receivedBytes:50,totalBytes:100,percent:50});
      state.media.downloadsExpanded=true;
      renderMediaDownloadBubble();
      const downloadBubble={
        active:document.querySelector('#mediaDownloadBubble').classList.contains('active'),
        open:document.querySelector('#mediaDownloadBubble').classList.contains('open'),
        ring:document.querySelector('#mediaDownloadRing').getAttribute('stroke-dasharray'),
        tasks:document.querySelectorAll('#mediaDownloadTaskList .media-download-task').length,
      };
      for(let index=0;index<12;index+=1){
        updateMediaDownloadTask({
          id:'runtime-completed-'+index,
          name:'completed-'+index+'.mp4',
          status:'completed',
          receivedBytes:100,
          totalBytes:100,
          percent:100,
          updatedAt:1000+index,
        });
      }
      const completedHistory={
        count:state.media.downloadTasks.filter(task=>task.status==='completed').length,
        names:state.media.downloadTasks.filter(task=>task.status==='completed').map(task=>task.name),
        rendered:document.querySelectorAll('#mediaDownloadTaskList .media-download-task').length,
        summary:document.querySelector('#mediaDownloadSummary').textContent.trim(),
      };
      const bubbleVisibility={};
      for(const tab of ['portal','downloads','favorites']){
        setMediaTab(tab);
        bubbleVisibility[tab]=getComputedStyle(document.querySelector('#mediaDownloadBubble')).display!=='none';
      }
      setMediaTab('downloads');
      const downloadsSearchRow=document.querySelector('#mediaDownloadsSearch').closest('.media-search-row');
      const favoritesSearchRow=document.querySelector('#mediaFavoritesSearch').closest('.media-search-row');
      const mediaLayout={
        libraryTabsLeft:!!document.querySelector('.media-nav-left > #mediaTabs'),
        libraryTabOrder:[...document.querySelectorAll('#mediaTabs [data-media-tab]')].map(button=>button.dataset.mediaTab),
        bubbleInNav:!!document.querySelector('.media-nav-right > #mediaDownloadBubble'),
        downloadCountAfterSearch:downloadsSearchRow?.children[1]?.id==='mediaDownloadsSummary',
        favoriteCountAfterSearch:favoritesSearchRow?.children[1]?.id==='mediaFavoritesSummary',
      };
      state.media.downloadTasks=[];
      state.media.downloadsExpanded=false;
      renderMediaDownloadBubble();
      return {
        openedPortals,portalTargets,portalInputs,copiedText,copiedFiles,contextMenus,favoriteCollections,movedFavorites,deletedFavorites,
        activeView:document.querySelector('.view.active')?.id||'',
        activeNav:document.querySelector('.nav-btn.active')?.dataset.view||'',
        rows:document.querySelectorAll('#mediaDownloadsList [data-media-row]').length,
        typeOptions:[...document.querySelectorAll('#mediaKindTabs [data-media-kind]')].map(button=>button.textContent.trim()),
        audioPortalSelected,videoPortalSelected,noKindSelectedOnDownloads,noKindSelectedOnFavorites,videoProviderHiddenOnAudio,matchingSearchRows,missingSearchRows,
        allDownloadedCount,initialVirtualRows,maxVirtualRows,reachedLastDownload,
        hasDownloadTab:!!document.querySelector('#mediaTabs [data-media-tab="portal"]'),
        hasDownloadCollections:!!document.querySelector('#mediaDownloadCollections'),
        hasMediaCacheClear:!!document.querySelector('#clearMediaCache'),
        hasInlinePaths:!!document.querySelector('#mediaDownloadPath, #mediaFavoritePath'),
        hasAllFilter:!!document.querySelector('[data-media-filters] [data-media-type="all"]'),
        copyActions:document.querySelectorAll('#mediaDownloadsList [data-media-action="copy"]').length,
        deleteActions:document.querySelectorAll('#mediaDownloadsList [data-media-action="delete"]').length,
        downloadBubble,completedHistory,bubbleVisibility,mediaLayout,
        bubblePanel:document.querySelector('#mediaDownloadBubble').closest('[data-media-panel]')?.dataset.mediaPanel||'',
        provider:document.querySelector('#mediaVideoProvider').textContent.trim(),
      };
    })()
  `, true);
  console.log(`media library runtime metrics ${JSON.stringify(mediaLibraryMetrics)}`);
  assert.deepStrictEqual(mediaLibraryMetrics.openedPortals, ['https://www.seekin.ai/zh/bilibili-downloader/','https://www.seekin.ai/zh/bilibili-downloader/']);
  assert.deepStrictEqual(mediaLibraryMetrics.portalTargets, ['download','favorite']);
  assert.strictEqual(mediaLibraryMetrics.portalInputs.every((item) => item.sourceText === 'https://www.bilibili.com/video/BV1runtime' && item.autoSubmit === true), true);
  assert.deepStrictEqual(mediaLibraryMetrics.portalInputs.map((item) => item.collection), ['', '项目收藏']);
  assert.deepStrictEqual(mediaLibraryMetrics.copiedText, ['https://www.bilibili.com/video/BV1runtime','https://www.bilibili.com/video/BV1runtime']);
  assert.deepStrictEqual(mediaLibraryMetrics.copiedFiles, ['C:/Downloads/demo.mp4']);
  assert.deepStrictEqual(mediaLibraryMetrics.contextMenus.map(item=>item.kind), ['media']);
  assert.deepStrictEqual(mediaLibraryMetrics.contextMenus[0].options.collections, []);
  assert.deepStrictEqual(mediaLibraryMetrics.favoriteCollections, [{filePath:'C:/Downloads/demo.mp4',collection:'项目收藏'}]);
  assert.deepStrictEqual(mediaLibraryMetrics.movedFavorites, [{filePath:'C:/Favorites/favorite.mp4',location:'favorites',collection:'项目收藏'}]);
  assert.deepStrictEqual(mediaLibraryMetrics.deletedFavorites, [{filePath:'C:/Favorites/favorite.mp4',location:'favorites'}]);
  assert.strictEqual(mediaLibraryMetrics.activeView, 'mediaView');
  assert.strictEqual(mediaLibraryMetrics.activeNav, 'media');
  assert(mediaLibraryMetrics.rows > 0 && mediaLibraryMetrics.rows <= 48, `media virtual DOM exceeded 48 rows: ${mediaLibraryMetrics.rows}`);
  assert.deepStrictEqual(mediaLibraryMetrics.typeOptions, ['视频','音乐']);
  assert.strictEqual(mediaLibraryMetrics.audioPortalSelected, true);
  assert.strictEqual(mediaLibraryMetrics.videoPortalSelected, true);
  assert.strictEqual(mediaLibraryMetrics.noKindSelectedOnDownloads, true);
  assert.strictEqual(mediaLibraryMetrics.noKindSelectedOnFavorites, true);
  assert.strictEqual(mediaLibraryMetrics.videoProviderHiddenOnAudio, true);
  assert.strictEqual(mediaLibraryMetrics.matchingSearchRows, 1);
  assert.strictEqual(mediaLibraryMetrics.missingSearchRows, 0);
  assert.strictEqual(mediaLibraryMetrics.allDownloadedCount, 5001, 'downloaded media in legacy subfolders must remain visible without categories');
  assert(mediaLibraryMetrics.initialVirtualRows <= 48, `initial media virtual DOM exceeded 48 rows: ${mediaLibraryMetrics.initialVirtualRows}`);
  assert(mediaLibraryMetrics.maxVirtualRows <= 48, `scrolled media virtual DOM exceeded 48 rows: ${mediaLibraryMetrics.maxVirtualRows}`);
  assert.strictEqual(mediaLibraryMetrics.reachedLastDownload, true, 'virtual media list must reach the final downloaded file');
  assert.strictEqual(mediaLibraryMetrics.hasDownloadTab, false);
  assert.strictEqual(mediaLibraryMetrics.hasDownloadCollections, false);
  assert.strictEqual(mediaLibraryMetrics.hasMediaCacheClear, false);
  assert.strictEqual(mediaLibraryMetrics.hasInlinePaths, false);
  assert.strictEqual(mediaLibraryMetrics.hasAllFilter, false);
  assert.strictEqual(mediaLibraryMetrics.copyActions, 0);
  assert.strictEqual(mediaLibraryMetrics.deleteActions, mediaLibraryMetrics.rows);
  assert.deepStrictEqual(mediaLibraryMetrics.downloadBubble, {active:true,open:true,ring:'50 100',tasks:1});
  assert.strictEqual(mediaLibraryMetrics.completedHistory.count, 10);
  assert.strictEqual(mediaLibraryMetrics.completedHistory.rendered, 11, 'active task plus ten completed records should be visible');
  assert.strictEqual(mediaLibraryMetrics.completedHistory.names.includes('completed-0.mp4'), false);
  assert.strictEqual(mediaLibraryMetrics.completedHistory.names.includes('completed-1.mp4'), false);
  assert(mediaLibraryMetrics.completedHistory.summary.includes('1 项进行中'));
  assert.deepStrictEqual(mediaLibraryMetrics.bubbleVisibility, {portal:true,downloads:true,favorites:true});
  assert.deepStrictEqual(mediaLibraryMetrics.mediaLayout, {
    libraryTabsLeft:true,
    libraryTabOrder:['downloads','favorites'],
    bubbleInNav:true,
    downloadCountAfterSearch:true,
    favoriteCountAfterSearch:true,
  });
  assert.strictEqual(mediaLibraryMetrics.bubblePanel, '');
  assert(mediaLibraryMetrics.provider.includes('哔哩哔哩'));
  assert.strictEqual(rendererErrors.length, 0, `renderer errors: ${rendererErrors.join(' | ')}`);
  if (process.env.XUANNIAN_RUNTIME_SCREENSHOT) {
    await window.webContents.executeJavaScript(`
      (async()=>{
        await switchView('search',{skipCoach:true});
        const base=${JSON.stringify(thumbnailSource)};
        const directory=${JSON.stringify(path.dirname(thumbnailSource))};
        state.fileSearch.engineStatus='ready';
        state.fileSearch.query='媒体';
        state.fileSearch.elapsedMs=18;
        state.fileSearch.results=[
          {path:base,directory,name:'品牌参考图.png',kind:'file',fileType:'image',size:20525,modifiedAt:10},
          {path:base,directory,name:'产品演示.mp4',kind:'file',fileType:'video',size:28310200,modifiedAt:9},
          {path:${JSON.stringify('C:\\Media\\背景音乐.flac')},directory:${JSON.stringify('C:\\Media')},name:'背景音乐.flac',kind:'file',fileType:'audio',size:16831020,modifiedAt:8},
          {path:${JSON.stringify('C:\\Media\\项目资料')},directory:${JSON.stringify('C:\\Media')},name:'项目资料',kind:'folder',size:null,modifiedAt:7},
          {path:${JSON.stringify('C:\\Media\\项目说明.docx')},directory:${JSON.stringify('C:\\Media')},name:'项目说明.docx',kind:'file',fileType:'document',size:8400,modifiedAt:6}
        ];
        state.fileSearch.selectedIndex=0;
        document.querySelector('#fileSearchInput').value='媒体';
        document.querySelector('#fileResultList').scrollTop=0;
        renderFileSearch();
        await new Promise(resolve=>setTimeout(resolve,360));
      })()
    `, true);
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const image = await window.webContents.capturePage();
    const screenshotPath = path.resolve(process.env.XUANNIAN_RUNTIME_SCREENSHOT);
    fs.writeFileSync(screenshotPath, image.toPNG());
    await window.webContents.executeJavaScript(`
      (()=>{
        const target=document.querySelector('.file-kind-icon.has-thumbnail');
        target?.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:null}));
      })()
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const hoverImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-hover.png'), hoverImage.toPNG());
    await window.webContents.executeJavaScript("hideFileThumbnailPreview()", true);
    await window.webContents.executeJavaScript("switchView('settings',{skipCoach:true})", true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const settingsImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-settings.png'), settingsImage.toPNG());
    await window.webContents.executeJavaScript("switchView('media',{skipCoach:true}).then(()=>setMediaTab('downloads'))", true);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const mediaImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-media.png'), mediaImage.toPNG());
    await window.webContents.executeJavaScript(`
      (()=>{
        state.media.loading=true;
        setMediaTab('favorites');
        state.media.loading=false;
        state.media.collections.favorites.video=['未完成项目','常用素材','客户交付','短视频','课程参考','宣传片','社交平台','个人收藏','工作归档','待整理','重要'];
        state.media.activeCollections.favorites.video='';
        renderMediaLists({force:true});
      })()
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const favoriteMediaImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-media-favorites.png'), favoriteMediaImage.toPNG());
    await window.webContents.executeJavaScript("setMediaTab('downloads')", true);
    window.setSize(620, 760);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const narrowMediaImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-media-620.png'), narrowMediaImage.toPNG());
    await window.webContents.executeJavaScript("state.media.loading=true; setMediaTab('favorites'); state.media.loading=false; state.media.collections.favorites.video=['未完成项目','常用素材','客户交付','短视频','课程参考','宣传片','社交平台','个人收藏','工作归档','待整理','重要']; renderMediaLists({force:true})", true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const narrowFavoriteMediaImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-media-favorites-620.png'), narrowFavoriteMediaImage.toPNG());
    await window.webContents.executeJavaScript("switchView('settings',{skipCoach:true})", true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const narrowSettingsImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-settings-620.png'), narrowSettingsImage.toPNG());
    await window.webContents.executeJavaScript("switchView('search',{skipCoach:true})", true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const narrowImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-620.png'), narrowImage.toPNG());
    window.hide();
  }
  const quickWindow = new BrowserWindow({
    show: false,
    width: 560,
    height: 720,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'quick-probe-preload.js'),
    },
  });
  quickWindow.webContents.on('console-message', ({ level, message }) => {
    if (level >= 2 && !String(message).includes('Electron Security Warning')) rendererErrors.push(message);
  });
  const quickLoadStarted = Date.now();
  await quickWindow.loadFile(path.join(__dirname, '..', 'quick.html'));
  await waitForRenderer(quickWindow, "typeof state!=='undefined' && state.notes.length===10000");
  const quickLoadMs = Date.now() - quickLoadStarted;
  const quickMetrics = await quickWindow.webContents.executeJavaScript(`
    (async()=>{
      const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;
      switchTab('notes');
      const list=document.querySelector('#noteList');
      list.scrollTop=0;
      renderNotes();
      list.querySelector('[data-note]')?.dispatchEvent(new WheelEvent('wheel',{deltaY:360,bubbles:true,cancelable:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const wheelScrollTop=list.scrollTop;
      let maxCards=0;
      const scrollDurations=[];
      for(let index=0;index<100;index+=1){
        const started=performance.now();
        list.scrollTop=(list.scrollHeight-list.clientHeight)*(index/99);
        renderNotes();
        scrollDurations.push(performance.now()-started);
        maxCards=Math.max(maxCards,list.querySelectorAll('[data-note]').length);
      }
      list.scrollTop=list.scrollHeight;
      renderNotes();
      const reachedLast=Boolean(list.querySelector('[data-note="note-9999"]'));
      const switchDurations=[];
      for(let index=0;index<60;index+=1){
        const started=performance.now();
        switchTab('clipboard');
        switchTab('notes');
        switchDurations.push(performance.now()-started);
        maxCards=Math.max(maxCards,list.querySelectorAll('[data-note]').length);
      }
      state.quickSearch='Synthetic 9999';
      list.scrollTop=0;
      renderNotes();
      return {
        noteCount:state.notes.length,
        maxCards,
        reachedLast,
        searchFound:Boolean(list.querySelector('[data-note="note-9999"]')),
        wheelScrollTop,
        finalDomNodes:document.querySelectorAll('*').length,
        scrollP95Ms:Number(percentile(scrollDurations,.95).toFixed(2)),
        scrollMaxMs:Number(Math.max(...scrollDurations).toFixed(2)),
        switchP95Ms:Number(percentile(switchDurations,.95).toFixed(2)),
        switchMaxMs:Number(Math.max(...switchDurations).toFixed(2))
      };
    })()
  `, true);
  quickMetrics.loadMs = quickLoadMs;
  console.log(`quick runtime probe metrics ${JSON.stringify(quickMetrics)}`);
  assert.strictEqual(quickMetrics.noteCount, 10000);
  assert(quickMetrics.maxCards <= 36, `quick virtual DOM exceeded 36 cards: ${quickMetrics.maxCards}`);
  assert(quickMetrics.reachedLast, 'quick virtual list must reach the final favorite');
  assert(quickMetrics.searchFound, 'quick search must scan favorites outside the current DOM window');
  assert(quickMetrics.wheelScrollTop > 0, 'quick favorite list must react to a real wheel event');
  assert(quickMetrics.finalDomNodes < 1600, `quick DOM should stay bounded, received ${quickMetrics.finalDomNodes} nodes`);
  assert.strictEqual(rendererErrors.length, 0, `renderer errors: ${rendererErrors.join(' | ')}`);
  console.log('electron runtime probes passed');
  quickWindow.destroy();
  window.destroy();
}

async function cleanUpAndExit(code) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    removeVerifiedTempDirectory(tempDirectory);
  } catch (error) {
    console.warn(`runtime probe cleanup warning: ${error.message}`);
  }
  app.exit(code);
}

run()
  .then(() => cleanUpAndExit(0))
  .catch((error) => {
    console.error(error);
    cleanUpAndExit(1);
  });
