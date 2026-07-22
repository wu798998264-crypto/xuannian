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
  const clipboardBatchDeleteMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const original={
        records:state.records,
        clipType:state.clipType,
        renderLimit:state.clipboardRenderLimit,
        saveRecords:api.saveRecords,
        showItemContextMenu:api.showItemContextMenu,
      };
      const savePayloads=[];
      const now=Date.now();
      state.records=[
        {id:'batch-a',type:'text',content:'batch alpha',createdAt:now},
        {id:'batch-b',type:'text',content:'batch beta',createdAt:now-1},
        {id:'batch-c',type:'text',content:'batch gamma',createdAt:now-2},
      ];
      state.clipType='all';
      state.clipboardRenderLimit=60;
      state.clipboardFilterCache=null;
      state.clipboardRenderSnapshot=null;
      document.querySelector('#clipboardSearch').value='';
      api.saveRecords=async records=>{
        savePayloads.push(records.map(item=>item.id));
        return records;
      };
      api.showItemContextMenu=async kind=>kind==='clipboard'?'batch-delete':'';
      if(state.clipboardBatchDelete.active) cancelClipboardBatchDelete();
      await switchView('clipboard',{skipCoach:true});
      renderClipboard();
      document.querySelector('[data-record-card="batch-a"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,10));
      const contextEntry={
        active:state.clipboardBatchDelete.active,
        selected:[...state.clipboardBatchDelete.selectedIds],
      };
      document.querySelector('#cancelClipboardBatchDelete').click();
      const cancelled={
        active:state.clipboardBatchDelete.active,
        selected:state.clipboardBatchDelete.selectedIds.size,
      };
      document.querySelector('#startClipboardBatchDelete').click();
      document.querySelector('[data-record-card="batch-a"]').click();
      document.querySelector('[data-record-card="batch-b"]').click();
      const beforeSwitch={
        active:state.clipboardBatchDelete.active,
        selected:[...state.clipboardBatchDelete.selectedIds].sort(),
        confirmText:document.querySelector('#confirmClipboardBatchDelete').textContent,
      };
      await switchView('notes',{skipCoach:true});
      const activeAway=state.clipboardBatchDelete.active;
      await switchView('clipboard',{skipCoach:true});
      const afterReturn={
        active:state.clipboardBatchDelete.active,
        selected:[...state.clipboardBatchDelete.selectedIds].sort(),
        selectedCards:document.querySelectorAll('#clipboardList .batch-selected').length,
      };
      document.querySelector('#confirmClipboardBatchDelete').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      const confirmTitle=document.querySelector('#modalBox h3')?.textContent||'';
      const confirmMessage=document.querySelector('#modalBox .modal-message')?.textContent||'';
      document.querySelector('#confirmModal').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      const result={
        contextEntry,
        cancelled,
        beforeSwitch,
        activeAway,
        afterReturn,
        confirmTitle,
        confirmMessage,
        remaining:state.records.map(item=>item.id),
        savePayloads,
        activeAfterConfirm:state.clipboardBatchDelete.active,
        normalEntryVisible:!document.querySelector('#startClipboardBatchDelete').hidden,
      };
      if(state.clipboardBatchDelete.active) cancelClipboardBatchDelete();
      state.records=original.records;
      state.clipType=original.clipType;
      state.clipboardRenderLimit=original.renderLimit;
      state.clipboardFilterCache=null;
      state.clipboardRenderSnapshot=null;
      api.saveRecords=original.saveRecords;
      api.showItemContextMenu=original.showItemContextMenu;
      renderClipboardFilters();
      renderClipboard();
      return result;
    })()
  `, true);
  console.log(`clipboard batch-delete metrics ${JSON.stringify(clipboardBatchDeleteMetrics)}`);
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.contextEntry, {active:true,selected:['batch-a']}, 'right-click batch delete must preselect the clicked record');
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.cancelled, {active:false,selected:0}, 'cancel must be the only non-destructive exit from batch mode');
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.beforeSwitch, {active:true,selected:['batch-a','batch-b'],confirmText:'确认删除 (2)'});
  assert.strictEqual(clipboardBatchDeleteMetrics.activeAway, true, 'batch mode must remain active outside the clipboard view');
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.afterReturn, {active:true,selected:['batch-a','batch-b'],selectedCards:2}, 'batch selection must survive switching away and back');
  assert.strictEqual(clipboardBatchDeleteMetrics.confirmTitle, '批量删除剪切板记录');
  assert(clipboardBatchDeleteMetrics.confirmMessage.includes('2 条'));
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.remaining, ['batch-c']);
  assert.deepStrictEqual(clipboardBatchDeleteMetrics.savePayloads, [['batch-c']], 'batch deletion must save exactly once');
  assert.strictEqual(clipboardBatchDeleteMetrics.activeAfterConfirm, false);
  assert.strictEqual(clipboardBatchDeleteMetrics.normalEntryVisible, true);
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
      const dragged=[];
      api.openPath=async filePath=>{ opened.push(filePath); return true; };
      api.copyFileToClipboard=async filePath=>{ copied.push(filePath); return true; };
      api.showFileContextMenu=async filePath=>{ contextMenus.push(filePath); return true; };
      api.startFileDrag=filePath=>{ dragged.push(filePath); return true; };
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
      second.dispatchEvent(new Event('dragstart',{bubbles:true,cancelable:true}));
      second.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      second.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      second.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      await new Promise(resolve=>setTimeout(resolve,250));
      return {rowPreserved,selectedAfterDouble,selectedIndex:state.fileSearch.selectedIndex,opened,copied,contextMenus,dragged,draggable:[row.draggable,second.draggable]};
    })()
  `, true);
  console.log(`file result double-click metrics ${JSON.stringify(fileDoubleClickMetrics)}`);
  assert.strictEqual(fileDoubleClickMetrics.rowPreserved, true, 'single-click selection must preserve the row for a native double-click');
  assert.strictEqual(fileDoubleClickMetrics.selectedAfterDouble, 0, 'double-click should keep the clicked result selected');
  assert.deepStrictEqual(fileDoubleClickMetrics.opened, ['C:/Synthetic/double-click-one.txt'], 'double-clicking a result row should open that file exactly once');
  assert.deepStrictEqual(fileDoubleClickMetrics.copied, ['C:/Synthetic/double-click-two.txt'], 'single-clicking a result row should copy that file exactly once');
  assert.deepStrictEqual(fileDoubleClickMetrics.contextMenus, ['C:/Synthetic/double-click-two.txt'], 'right-clicking a result row should open its file context menu');
  assert.deepStrictEqual(fileDoubleClickMetrics.dragged, ['C:/Synthetic/double-click-two.txt'], 'dragging a full-disk result should start a native file drag');
  assert.deepStrictEqual(fileDoubleClickMetrics.draggable, [true,true], 'full-disk result rows must expose draggable semantics');
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
        addNoteProject:api.addNoteProject,
        getNoteProjects:api.getNoteProjects,
      };
      const menuCalls=[];
      const menuActions=['rename','delete','create'];
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
      api.addNoteProject=async project=>{
        const item={id:'category-new',...project};
        state.noteProjects.push(item);
        return item;
      };
      api.getNoteProjects=async()=>state.noteProjects;
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
      const activeAfterDelete=state.activeNoteProject;
      document.querySelector('#noteProjectList').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,10));
      const createTitle=document.querySelector('#modalBox h3')?.textContent||'';
      document.querySelector('#newProjectName').value='新增分类';
      document.querySelector('#confirmProject').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      const result={
        menuCalls,renameTitle,renamed,deleteTitle,deleteMessage,activeAfterDelete,createTitle,
        remaining:state.noteProjects.map(project=>project.name),
        created:state.noteProjects.find(project=>project.id==='category-new')?.name||'',
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
      api.addNoteProject=original.addNoteProject;
      api.getNoteProjects=original.getNoteProjects;
      renderNoteProjects();
      renderNotes();
      return result;
    })()
  `, true);
  console.log(`note category context-menu metrics ${JSON.stringify(noteCategoryMetrics)}`);
  assert.deepStrictEqual(noteCategoryMetrics.menuCalls, [
    {kind:'note-category',options:{canDelete:true}},
    {kind:'note-category',options:{canDelete:true}},
    {kind:'note-category-empty',options:undefined},
  ]);
  assert.strictEqual(noteCategoryMetrics.renameTitle, '修改收藏分类');
  assert.strictEqual(noteCategoryMetrics.renamed, '修改后的分类');
  assert.strictEqual(noteCategoryMetrics.deleteTitle, '删除收藏分类');
  assert(noteCategoryMetrics.deleteMessage.includes('移动到剩余分类'));
  assert.strictEqual(noteCategoryMetrics.activeAfterDelete, 'category-a');
  assert.strictEqual(noteCategoryMetrics.createTitle, '新建收藏分类');
  assert.deepStrictEqual(noteCategoryMetrics.remaining, ['修改后的分类','新增分类']);
  assert.strictEqual(noteCategoryMetrics.created, '新增分类');
  assert.strictEqual(noteCategoryMetrics.movedProjectId, 'category-a');
  assert.strictEqual(noteCategoryMetrics.activeProject, 'category-new');
  const mediaLibraryMetrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const openedPortals=[];
      const portalTargets=[];
      const copiedText=[];
      const copiedFiles=[];
      const draggedFiles=[];
      const contextMenus=[];
      const portalInputs=[];
      const externalUrls=[];
      const downloadedVideos=[];
      const downloadedVideoQualities=[];
      const downloadedSongs=[];
      const previewedSongs=[];
      const highQualityRequests=[];
      const openedDownloadHistory=[];
      const downloadHistoryContextMenus=[];
      const deletedDownloadHistory=[];
      const cancelledDownloadTasks=[];
      const pausedDownloadTasks=[];
      const createdMediaCollections=[];
      const browserBoundsRequests=[];
      const localPlaybackRequests=[];
      let verificationResumeCalls=0;
      const nativeMediaBridgeAvailableBeforeStub=typeof api.downloadParsedMediaVideo==='function'&&typeof api.downloadMediaMusicResult==='function'&&typeof api.openHighQualityMusic==='function';
      const favoriteCollections=[];
      const movedFavorites=[];
      const deletedFavorites=[];
      const syntheticDownloads=Array.from({length:5000},(_,index)=>({path:'C:/Downloads/archive/video-'+index+'.mp4',directory:'C:/Downloads/archive',name:'video-'+index+'.mp4',kind:'video',size:4096+index,modifiedAt:index,favorite:false,location:'downloads',collection:'项目视频'}));
      api.resolveMediaVideoProvider=async value=>resolveMediaVideoProviderFallback(value);
      api.openMediaPortal=async(url,target,sourceText,autoSubmit,collection,qualityPreference,automationMode)=>{ openedPortals.push(url); portalTargets.push(target); portalInputs.push({sourceText,autoSubmit,collection,qualityPreference,automationMode}); return true; };
      api.getMediaMusicSearchUrl=async keyword=>'https://www.gequbao.com/s/'+encodeURIComponent(keyword);
      api.downloadParsedMediaVideo=async(target,collection,qualityIndex)=>{ downloadedVideos.push({target,collection}); downloadedVideoQualities.push(qualityIndex); return {ok:true}; };
      api.resumeMediaPortalAfterVerification=async()=>{ verificationResumeCalls+=1; return {ok:true}; };
      api.downloadMediaMusicResult=async(url,target,collection,preferredName)=>{ downloadedSongs.push({url,target,collection,preferredName}); return true; };
      api.previewMediaMusicResult=async url=>{ previewedSongs.push(url); return {ok:true,requestId:77}; };
      api.openHighQualityMusic=async query=>{ highQualityRequests.push(query); return {ok:true,target:'quark',message:'已打开夸克'}; };
      api.openPath=async filePath=>{ openedDownloadHistory.push(filePath); return true; };
      api.showFileContextMenu=async filePath=>{ downloadHistoryContextMenus.push(filePath); return true; };
      api.deleteMediaDownloadHistoryItem=async taskId=>{ deletedDownloadHistory.push(taskId); return {ok:true}; };
      api.cancelMediaDownloadTask=async taskId=>{ cancelledDownloadTasks.push(taskId); return {ok:true,cancelled:true}; };
      api.setMediaDownloadTaskPaused=async(taskId,paused)=>{ pausedDownloadTasks.push({taskId,paused}); return {ok:true,paused}; };
      api.getLocalMediaPlaybackUrl=async filePath=>{ localPlaybackRequests.push(filePath); return 'file:///C:/Downloads/music.flac'; };
      api.setMediaBrowserBounds=(bounds,visible,mode)=>{ browserBoundsRequests.push({visible,mode}); return true; };
      api.openExternal=async url=>{ externalUrls.push(url); return true; };
      api.copyText=async value=>{ copiedText.push(value); return true; };
      api.copyFileToClipboard=async value=>{ copiedFiles.push(value); return true; };
      api.startFileDrag=value=>{ draggedFiles.push(value); return true; };
      api.showItemContextMenu=async(kind,options)=>{ contextMenus.push({kind,options}); return ''; };
      api.favoriteLocalMedia=async(filePath,collection)=>{ favoriteCollections.push({filePath,collection}); return {ok:true}; };
      api.moveLocalMedia=async(filePath,location,collection)=>{ movedFavorites.push({filePath,location,collection}); return {ok:true}; };
      api.deleteLocalMedia=async(filePath,location)=>{ deletedFavorites.push({filePath,location}); return {ok:true}; };
      api.createMediaCollection=async(location,kind,name)=>{ createdMediaCollections.push({location,kind,name}); return {ok:true,name}; };
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
      const manualPortalInitiallyVisible=!document.querySelector('#mediaVideoManualPortal').hidden&&!document.querySelector('#mediaMusicManualPortal').hidden;
      const videoInput=document.querySelector('#mediaVideoInput');
      const douyinProvider=resolveMediaVideoProviderFallback('https://v.douyin.com/runtime');
      const tiktokProvider=resolveMediaVideoProviderFallback('https://www.tiktok.com/@runtime/video/1');
      videoInput.value='https://v.douyin.com/runtime';
      await parseMediaVideo(false);
      state.media.videoParse={status:'ready',sourceUrl:'https://v.douyin.com/runtime',previewUrl:'https://cdn.example.com/runtime.mp4',title:'测试视频',qualityLabel:'1080P 无水印下载',downloadReady:true,error:''};
      state.media.videoParse.qualityOptions=[
        {label:'1080P - 80 MB',href:'https://cdn.example.com/runtime-1080.mp4'},
        {label:'720P - 40 MB',href:'https://cdn.example.com/runtime-720.mp4'},
      ];
      state.media.videoParse.selectedQualityIndex=0;
      renderMediaPortalWorkspace();
      const videoPreview=document.querySelector('#mediaVideoPreview');
      Object.defineProperty(videoPreview,'duration',{configurable:true,get:()=>435.259});
      videoPreview.dispatchEvent(new Event('loadedmetadata'));
      const qualitySelect=document.querySelector('#mediaVideoQualitySelect');
      qualitySelect.value='1';
      qualitySelect.dispatchEvent(new Event('change',{bubbles:true}));
      const videoProgressUi={
        controls:videoPreview.controls,
        controlsAttribute:videoPreview.hasAttribute('controls'),
        customProgressPresent:!!document.querySelector('#mediaVideoProgress,#mediaVideoSeek,#mediaVideoPlay,#mediaVideoFullscreen'),
        sourceDurationEndsWith:document.querySelector('#mediaVideoSourceDuration').textContent.endsWith('07:15'),
        longDurationFormat:formatMediaVideoTime(7200.9),
      };
      const videoUi={
        previewSrc:document.querySelector('#mediaVideoPreview').src,
        actions:[document.querySelector('#mediaDownloadVideo').textContent.trim(),document.querySelector('#mediaDownloadFavoriteVideo').textContent.trim()],
        topActions:!!document.querySelector('#mediaOpenVideoPortal, #mediaFavoriteVideoPortal'),
        fallbackHidden:document.querySelector('#mediaVideoFallback').hidden,
        qualityChoiceHidden:document.querySelector('#mediaVideoQualityChoice').hidden,
        qualityOptions:[...qualitySelect.options].map(option=>option.textContent.trim()),
        selectedQualityIndex:Number(qualitySelect.value),
      };
      const readyVideoParse={...state.media.videoParse};
      state.media.videoParse={
        ...readyVideoParse,
        status:'error',
        error:'parse-timeout',
        portalIndex:Math.max(0,mediaPortalRoutes(state.media.videoProvider).length-1),
      };
      renderMediaPortalWorkspace();
      videoUi.exhaustedFallbackHidden=document.querySelector('#mediaVideoFallback').hidden;
      state.media.videoParse=readyVideoParse;
      renderMediaPortalWorkspace();
      const videoDownloadButton=document.querySelector('#mediaDownloadVideo');
      const videoDownloadRect=videoDownloadButton.getBoundingClientRect();
      const videoButtonHitElements=[
        document.elementFromPoint(videoDownloadRect.left+6,videoDownloadRect.top+videoDownloadRect.height/2),
        document.elementFromPoint(videoDownloadRect.left+videoDownloadRect.width/2,videoDownloadRect.top+6),
        document.elementFromPoint(videoDownloadRect.left+videoDownloadRect.width/2,videoDownloadRect.top+videoDownloadRect.height/2),
        document.elementFromPoint(videoDownloadRect.right-6,videoDownloadRect.top+videoDownloadRect.height/2),
        document.elementFromPoint(videoDownloadRect.left+videoDownloadRect.width/2,videoDownloadRect.bottom-6),
      ];
      const videoButtonHitTargets=videoButtonHitElements.map(element=>element?.closest?.('#mediaDownloadVideo')===videoDownloadButton);
      videoDownloadButton.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));
      videoDownloadButton.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,detail:1}));
      await new Promise(resolve=>setTimeout(resolve,20));
      state.media.videoParse={...state.media.videoParse,embeddedPreview:true,previewUrl:''};
      const favoriteBoundsStart=browserBoundsRequests.length;
      const favoriteVideoPromise=downloadParsedVideo(true);
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#mediaCollectionPicker').value='项目收藏';
      document.querySelector('#confirmModal').click();
      await favoriteVideoPromise;
      await new Promise(resolve=>setTimeout(resolve,20));
      const favoritePreviewModal={
        requests:browserBoundsRequests.slice(favoriteBoundsStart),
      };
      const createCollectionPromise=showMediaCollectionPicker('video');
      await new Promise(resolve=>setTimeout(resolve,20));
      const pickerCreateVisible=!!document.querySelector('#createMediaCollectionFromPicker');
      document.querySelector('#createMediaCollectionFromPicker').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#textInputModal').value='新建视频分类';
      document.querySelector('#confirmModal').click();
      const createdCollectionChoice=await createCollectionPromise;
      videoInput.value='https://www.bilibili.com/video/BV1runtime';
      await parseMediaVideo(false);
      document.querySelector('#mediaKindTabs [data-media-kind="audio"]').click();
      const audioPortalSelected=state.media.kind==='audio'&&state.media.tab==='portal';
      const videoProviderHiddenOnAudio=document.querySelector('#mediaVideoProvider').closest('[data-media-launcher]').hidden;
      const musicInput=document.querySelector('#mediaMusicInput');
      musicInput.value='测试歌曲 测试歌手';
      await searchMediaMusic();
      state.media.musicSearch={status:'ready',query:musicInput.value,results:[
        {url:'https://www.gequbao.com/music/101',title:'测试歌曲',artist:'测试歌手',label:'测试歌曲 - 测试歌手'},
        {url:'https://www.gequbao.com/music/102',title:'测试歌曲（现场版）',artist:'现场歌手',label:'测试歌曲（现场版） - 现场歌手'},
      ],error:''};
      renderMediaPortalWorkspace();
      document.querySelectorAll('#mediaMusicResults .media-music-result')[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));
      await new Promise(resolve=>setTimeout(resolve,20));
      await previewMediaMusicVersion(0);
      state.media.musicPreview={...state.media.musicPreview,status:'ready',previewUrl:'https://cdn.example.com/test-song.mp3'};
      renderMediaPortalWorkspace();
      chooseMediaMusicFormat(0,false);
      const musicUi={
        rows:document.querySelectorAll('#mediaMusicResults .media-music-result').length,
        actions:[...document.querySelectorAll('#mediaMusicResults [data-music-action]')].map(button=>button.textContent.trim()),
        formatChoices:[...document.querySelectorAll('#mediaMusicResults [data-music-format-choice]')].map(button=>button.textContent.trim()),
        previewButtons:document.querySelectorAll('#mediaMusicResults [data-music-preview]').length,
        activeAudioControls:!!document.querySelector('#mediaMusicResults audio[data-music-preview-audio][controls]'),
        topFormatControls:!!document.querySelector('#mediaMusicFormats'),
      };
      await downloadMediaMusicVersion(0,'mp3',false);
      await downloadMediaMusicVersion(1,'wav',false);
      const backgroundPortal={browserHidden:document.querySelector('#mediaBrowserShell').hidden,directVisible:!document.querySelector('#mediaDirectShell').hidden};
      state.media.browser={...state.media.browser,ready:true};
      state.media.manualPortal={available:true,kind:'audio',url:'https://www.gequbao.com/',reason:'human-verification',prompting:false};
      state.media.browserVisible=true;
      renderMediaBrowserState();
      const browserTogglePersistence={
        available:!document.querySelector('#mediaMusicManualPortal').hidden,
        browserVisible:!document.querySelector('#mediaBrowserShell').hidden,
      };
      state.media.browserVisible=false;
      renderMediaBrowserState();
      setMediaTab('downloads');
      await new Promise(resolve=>setTimeout(resolve,20));
      const downloadedMusicControls={
        rowPlayButtons:document.querySelectorAll('#mediaDownloadsList [data-media-action="play"]').length,
        localPlayerVisible:!document.querySelector('#mediaLocalPlayer').hidden,
        musicProviderLabel:document.querySelector('#mediaMusicProvider')?.textContent.trim()||'',
        musicManualPortalAvailable:!document.querySelector('#mediaMusicManualPortal').hidden,
      };
      document.querySelector('#mediaKindTabs [data-media-kind="video"]').click();
      const videoDownloadModeSelected=state.media.kind==='video'&&state.media.tab==='downloads';
      setMediaTab('downloads');
      const downloadKindLabel=document.querySelector('#mediaKindLabel').textContent.trim();
      await new Promise(resolve=>setTimeout(resolve,20));
      const allDownloadedCount=filteredMediaItems('downloads').length;
      const initialVirtualRows=document.querySelectorAll('#mediaDownloadsList [data-media-row]').length;
      const first=document.querySelector('#mediaDownloadsList [data-media-row="0"]');
      first.dispatchEvent(new Event('dragstart',{bubbles:true,cancelable:true}));
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
      document.querySelector('#mediaKindToggle').click();
      const kindMenuOpened=!document.querySelector('#mediaKindMenu').hidden;
      document.querySelector('#mediaKindTabs [data-media-kind="audio"]').click();
      const kindDropdownKeepsFavorites={kind:state.media.kind,tab:state.media.tab,label:document.querySelector('#mediaKindLabel').textContent.trim(),menuHidden:document.querySelector('#mediaKindMenu').hidden};
      document.querySelector('#mediaKindTabs [data-media-kind="video"]').click();
      document.querySelector('#mediaKindHome').click();
      const kindHomeOpensPortal={kind:state.media.kind,tab:state.media.tab};
      setMediaTab('favorites');
      await new Promise(resolve=>setTimeout(resolve,30));
      const favoriteRow=document.querySelector('#mediaFavoritesList [data-media-row="0"]');
      favoriteRow.dispatchEvent(new Event('dragstart',{bubbles:true,cancelable:true}));
      handleMediaFavoriteWindowDragLeave({relatedTarget:null,clientX:0,clientY:120});
      const favoriteFolder=document.querySelector('#mediaFavoriteCollections [data-media-collection="项目收藏"]');
      await handleMediaFavoriteDrop({target:favoriteFolder,preventDefault(){},dataTransfer:{getData(){return 'C:/Favorites/favorite.mp4';}}});
      const removeFavoritePromise=performMediaAction('favorite','favorites',0);
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#confirmModal').click();
      await removeFavoritePromise;
      state.media.favoriteOrders={};
      state.media.activeCollections.favorites.video='';
      state.media.items=state.media.items.filter(item=>item.location!=='favorites').concat([
        {path:'C:/Favorites/first.mp4',directory:'C:/Favorites',name:'first.mp4',kind:'video',size:1,modifiedAt:2,favorite:true,location:'favorites',collection:''},
        {path:'C:/Favorites/second.mp4',directory:'C:/Favorites',name:'second.mp4',kind:'video',size:1,modifiedAt:1,favorite:true,location:'favorites',collection:''},
      ]);
      renderMediaList('favorites',{force:true});
      const reorderedFavorites=reorderMediaFavorites('C:/Favorites/first.mp4','C:/Favorites/second.mp4',true);
      const favoriteOrder={
        changed:reorderedFavorites,
        names:filteredMediaItems('favorites').map(item=>item.name),
        persisted:JSON.parse(localStorage.getItem(MEDIA_FAVORITE_ORDER_KEY)||'{}')[mediaFavoriteOrderKey('video','')],
      };
      setMediaTab('downloads');
      await new Promise(resolve=>setTimeout(resolve,20));
      updateMediaDownloadTask({id:'runtime-download',name:'runtime.mp4',status:'downloading',receivedBytes:50,totalBytes:100,percent:50});
      state.media.downloadsExpanded=true;
      renderMediaDownloadBubble();
      const downloadToggleRect=document.querySelector('#mediaDownloadToggle').getBoundingClientRect();
      const downloadRingRect=document.querySelector('.media-download-ring').getBoundingClientRect();
      const downloadBubble={
        active:document.querySelector('#mediaDownloadBubble').classList.contains('active'),
        open:document.querySelector('#mediaDownloadBubble').classList.contains('open'),
        ring:document.querySelector('#mediaDownloadRing').getAttribute('stroke-dasharray'),
        tasks:document.querySelectorAll('#mediaDownloadTaskList .media-download-task').length,
        toggleSize:[downloadToggleRect.width,downloadToggleRect.height],
        ringSize:[downloadRingRect.width,downloadRingRect.height],
        ringAligned:Math.abs(downloadToggleRect.left-downloadRingRect.left)<0.1&&Math.abs(downloadToggleRect.top-downloadRingRect.top)<0.1,
      };
      updateMediaDownloadTask({id:'runtime-pause-delete',name:'pause-delete.mp4',status:'downloading',receivedBytes:25,totalBytes:100,percent:25});
      await toggleMediaDownloadTaskPause('runtime-pause-delete');
      const pausedTask={
        status:mediaDownloadTaskById('runtime-pause-delete')?.status||'',
        hasResume:document.querySelector('[data-download-task-id="runtime-pause-delete"] [data-download-task-pause]')?.title==='继续下载',
        hasDelete:!!document.querySelector('[data-download-task-id="runtime-pause-delete"] [data-download-task-delete]'),
      };
      await deleteMediaDownloadTask('runtime-pause-delete');
      pausedTask.removed=!mediaDownloadTaskById('runtime-pause-delete');
      updateMediaDownloadTask({id:'runtime-music-preparing',name:'测试歌曲（准备下载）',status:'preparing',receivedBytes:0,totalBytes:0,percent:0});
      updateMediaDownloadTask({id:'runtime-quark-external',name:'高清歌曲（等待夸克下载）',status:'external',receivedBytes:0,totalBytes:0,percent:0});
      const musicDownloadStates={
        active:document.querySelector('#mediaDownloadBubble').classList.contains('active'),
        names:[...document.querySelectorAll('#mediaDownloadTaskList .media-download-task-name')].map(item=>item.textContent.trim()),
        statuses:[...document.querySelectorAll('#mediaDownloadTaskList .media-download-task-status')].map(item=>item.textContent.trim()),
        summary:document.querySelector('#mediaDownloadSummary').textContent.trim(),
      };
      state.media.downloadTasks=state.media.downloadTasks.filter(task=>!['runtime-music-preparing','runtime-quark-external'].includes(task.id));
      renderMediaDownloadBubble();
      updateMediaDownloadTask({id:'runtime-interrupted',name:'等待重试.mp4',status:'interrupted',receivedBytes:1024,totalBytes:4096,percent:25});
      const interruptedTask={
        status:document.querySelector('[data-download-task-id="runtime-interrupted"] .media-download-task-status')?.textContent.trim(),
        hasDelete:!!document.querySelector('[data-download-task-id="runtime-interrupted"] [data-download-task-delete]'),
      };
      await deleteMediaDownloadTask('runtime-interrupted');
      interruptedTask.removed=!mediaDownloadTaskById('runtime-interrupted');
      for(let index=0;index<12;index+=1){
        updateMediaDownloadTask({
          id:'runtime-completed-'+index,
          name:'completed-'+index+'.mp4',
          status:'completed',
          path:'C:/Downloads/completed-'+index+'.mp4',
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
        deleteButtons:document.querySelectorAll('#mediaDownloadTaskList [data-download-task-delete]').length,
        summary:document.querySelector('#mediaDownloadSummary').textContent.trim(),
      };
      const completedRow=document.querySelector('[data-download-task-id="runtime-completed-11"]');
      completedRow.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
      completedRow.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      const deleteHistoryPromise=deleteMediaDownloadTask('runtime-completed-11');
      await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector('#confirmModal').click();
      await deleteHistoryPromise;
      const completedHistoryActions={
        opened:[...openedDownloadHistory],
        contextMenus:[...downloadHistoryContextMenus],
        deleted:[...deletedDownloadHistory],
        stillPresent:!!mediaDownloadTaskById('runtime-completed-11'),
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
      const verificationPromise=offerMediaManualPortal('audio','human-verification','https://www.gequbao.com/');
      await new Promise(resolve=>setTimeout(resolve,20));
      const verificationPrompt={
        title:document.querySelector('#modalBox .modal-header h3').textContent.trim(),
        message:document.querySelector('#modalBox .modal-message').textContent.trim(),
        confirmText:document.querySelector('#confirmModal').textContent.trim(),
      };
      document.querySelector('#confirmModal').click();
      await verificationPromise;
      const verificationFlow={
        ...verificationPrompt,
        resumeCalls:verificationResumeCalls,
        browserVisible:state.media.browserVisible,
      };
      clearMediaManualPortal('audio');
      state.media.downloadTasks=[];
      state.media.downloadsExpanded=false;
      renderMediaDownloadBubble();
      localStorage.removeItem(MEDIA_PORTAL_HEALTH_KEY);
      const douyinRoutes=mediaPortalRoutes(douyinProvider);
      recordMediaPortalFailure(douyinRoutes[0],'provider-rejected','https://v.douyin.com/content-one');
      const contentFailureKeepsSite=nextHealthyMediaPortalIndex(douyinProvider,0)===0;
      recordMediaPortalFailure(douyinRoutes[0],'parse-timeout','https://v.douyin.com/content-one');
      const oneTimeoutKeepsSite=nextHealthyMediaPortalIndex(douyinProvider,0)===0;
      recordMediaPortalFailure(douyinRoutes[0],'parse-timeout','https://v.douyin.com/content-two');
      const twoSourcesTripSite=nextHealthyMediaPortalIndex(douyinProvider,0)===-1;
      const failureClassification={contentFailureKeepsSite,oneTimeoutKeepsSite,twoSourcesTripSite};
      localStorage.removeItem(MEDIA_PORTAL_HEALTH_KEY);
      markMediaPortalUnavailable(douyinRoutes[0],'quota-or-ad-required');
      const dailyFallbackIndex=nextHealthyMediaPortalIndex(douyinProvider,0);
      const dailyFallback={index:dailyFallbackIndex,route:douyinRoutes[dailyFallbackIndex]||null,health:readMediaPortalHealth()};
      localStorage.removeItem(MEDIA_PORTAL_HEALTH_KEY);
      localStorage.removeItem(MEDIA_FAVORITE_ORDER_KEY);
      return {
        openedPortals,portalTargets,portalInputs,externalUrls,copiedText,copiedFiles,draggedFiles,contextMenus,favoriteCollections,movedFavorites,deletedFavorites,
        downloadedVideos,downloadedVideoQualities,downloadedSongs,previewedSongs,highQualityRequests,openedDownloadHistory,downloadHistoryContextMenus,deletedDownloadHistory,cancelledDownloadTasks,pausedDownloadTasks,createdMediaCollections,localPlaybackRequests,nativeMediaBridgeAvailableBeforeStub,videoUi,videoProgressUi,favoritePreviewModal,videoButtonHitTargets,pickerCreateVisible,createdCollectionChoice,musicUi,backgroundPortal,browserTogglePersistence,downloadedMusicControls,manualPortalInitiallyVisible,
        providerRouting:{douyinProvider,tiktokProvider,dailyFallback,failureClassification},
        verificationFlow,musicDownloadStates,pausedTask,interruptedTask,
        activeView:document.querySelector('.view.active')?.id||'',
        activeNav:document.querySelector('.nav-btn.active')?.dataset.view||'',
        rows:document.querySelectorAll('#mediaDownloadsList [data-media-row]').length,
        typeOptions:[...document.querySelectorAll('#mediaKindTabs [data-media-kind]')].map(button=>button.textContent.trim()),
        audioPortalSelected,videoDownloadModeSelected,downloadKindLabel,kindMenuOpened,kindDropdownKeepsFavorites,kindHomeOpensPortal,favoriteOrder,videoProviderHiddenOnAudio,matchingSearchRows,missingSearchRows,
        allDownloadedCount,initialVirtualRows,maxVirtualRows,reachedLastDownload,
        mediaRowsDraggable:[first.draggable,favoriteRow.draggable],
        hasDownloadTab:!!document.querySelector('#mediaTabs [data-media-tab="portal"]'),
        hasDownloadCollections:!!document.querySelector('#mediaDownloadCollections'),
        hasMediaCacheClear:!!document.querySelector('#clearMediaCache'),
        hasInlinePaths:!!document.querySelector('#mediaDownloadPath, #mediaFavoritePath'),
        hasAllFilter:!!document.querySelector('[data-media-filters] [data-media-type="all"]'),
        copyActions:document.querySelectorAll('#mediaDownloadsList [data-media-action="copy"]').length,
        deleteActions:document.querySelectorAll('#mediaDownloadsList [data-media-action="delete"]').length,
        downloadBubble,completedHistory,completedHistoryActions,bubbleVisibility,mediaLayout,
        bubblePanel:document.querySelector('#mediaDownloadBubble').closest('[data-media-panel]')?.dataset.mediaPanel||'',
        provider:document.querySelector('#mediaVideoProvider').textContent.trim(),
      };
    })()
  `, true);
  console.log(`media library runtime metrics ${JSON.stringify(mediaLibraryMetrics)}`);
  assert.deepStrictEqual(mediaLibraryMetrics.openedPortals, ['https://www.seekin.ai/zh/downloader/','https://www.seekin.ai/zh/downloader/','https://www.gequbao.com/s/%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2%20%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%89%8B']);
  assert.deepStrictEqual(mediaLibraryMetrics.portalTargets, ['download','download','download']);
  assert.deepStrictEqual(mediaLibraryMetrics.portalInputs.map((item) => item.autoSubmit), [true,true,false]);
  assert.deepStrictEqual(mediaLibraryMetrics.portalInputs.map((item) => item.collection), ['', '', '']);
  assert.deepStrictEqual(mediaLibraryMetrics.portalInputs.map((item) => item.qualityPreference || ''), ['highest','highest','']);
  assert.deepStrictEqual(mediaLibraryMetrics.portalInputs.map((item) => item.automationMode || ''), ['video-parse','video-parse','music-search']);
  assert.deepStrictEqual(mediaLibraryMetrics.externalUrls, []);
  assert.deepStrictEqual(mediaLibraryMetrics.copiedText, []);
  assert.deepStrictEqual(mediaLibraryMetrics.highQualityRequests, ['测试歌曲（现场版） - 现场歌手']);
  assert.deepStrictEqual(mediaLibraryMetrics.downloadedVideos, [{target:'download',collection:''},{target:'favorite',collection:'项目收藏'}]);
  assert.deepStrictEqual(mediaLibraryMetrics.downloadedVideoQualities, [1,1], 'selected video quality must reach both download actions');
  assert.deepStrictEqual(mediaLibraryMetrics.videoButtonHitTargets, [true,true,true,true,true], 'the full visible video download button must be clickable');
  assert.strictEqual(mediaLibraryMetrics.favoritePreviewModal.requests[0]?.visible, false, 'embedded preview must hide before the favorite picker opens');
  assert.strictEqual(mediaLibraryMetrics.pickerCreateVisible, true);
  assert.strictEqual(mediaLibraryMetrics.createdCollectionChoice, '新建视频分类');
  assert.deepStrictEqual(mediaLibraryMetrics.createdMediaCollections, [{location:'favorites',kind:'video',name:'新建视频分类'}]);
  assert.deepStrictEqual(mediaLibraryMetrics.downloadedSongs, [{url:'https://www.gequbao.com/music/101',target:'download',collection:'',preferredName:'测试歌曲 - 测试歌手'}]);
  assert.strictEqual(mediaLibraryMetrics.nativeMediaBridgeAvailableBeforeStub, true);
  assert.deepStrictEqual(mediaLibraryMetrics.videoUi, {previewSrc:'https://cdn.example.com/runtime.mp4',actions:['下载视频','下载并收藏'],topActions:false,fallbackHidden:true,qualityChoiceHidden:false,qualityOptions:['1080P · 80 MB','720P · 40 MB'],selectedQualityIndex:1,exhaustedFallbackHidden:true});
  assert.deepStrictEqual(mediaLibraryMetrics.videoProgressUi, {controls:true,controlsAttribute:true,customProgressPresent:false,sourceDurationEndsWith:true,longDurationFormat:'02:00:00'});
  assert.deepStrictEqual(mediaLibraryMetrics.musicUi, {rows:2,actions:['下载','下载并收藏','下载','下载并收藏'],formatChoices:['普通音质','高清音质'],previewButtons:2,activeAudioControls:true,topFormatControls:false});
  assert.deepStrictEqual(mediaLibraryMetrics.previewedSongs, ['https://www.gequbao.com/music/102','https://www.gequbao.com/music/101']);
  assert.deepStrictEqual(mediaLibraryMetrics.backgroundPortal, {browserHidden:true,directVisible:true});
  assert.strictEqual(mediaLibraryMetrics.manualPortalInitiallyVisible, true, 'manual-site controls must remain visible at the right edge before and after automatic routes run');
  assert.strictEqual(mediaLibraryMetrics.verificationFlow.title, '需要真人验证');
  assert(mediaLibraryMetrics.verificationFlow.message.includes('完成验证后会自动返回音乐结果页面'));
  assert.strictEqual(mediaLibraryMetrics.verificationFlow.confirmText, '去验证');
  assert.strictEqual(mediaLibraryMetrics.verificationFlow.resumeCalls, 1);
  assert.strictEqual(mediaLibraryMetrics.verificationFlow.browserVisible, true);
  assert.deepStrictEqual(mediaLibraryMetrics.browserTogglePersistence, {available:true,browserVisible:true});
  assert.deepStrictEqual(mediaLibraryMetrics.localPlaybackRequests, []);
  assert.deepStrictEqual(mediaLibraryMetrics.downloadedMusicControls, {rowPlayButtons:0,localPlayerVisible:false,musicProviderLabel:'歌曲宝',musicManualPortalAvailable:true});
  assert.strictEqual(mediaLibraryMetrics.providerRouting.douyinProvider.id, 'douyin');
  assert.strictEqual(mediaLibraryMetrics.providerRouting.douyinProvider.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(mediaLibraryMetrics.providerRouting.douyinProvider.autoDownloadQuality, 'highest');
  assert.deepStrictEqual(mediaLibraryMetrics.providerRouting.douyinProvider.portals, [{url:'https://www.seekin.ai/zh/downloader/',label:'Seekin'}]);
  assert.strictEqual(mediaLibraryMetrics.providerRouting.dailyFallback.index, -1);
  assert.strictEqual(mediaLibraryMetrics.providerRouting.dailyFallback.route, null);
  assert.strictEqual(Object.keys(mediaLibraryMetrics.providerRouting.dailyFallback.health.unavailable).length, 1);
  assert.deepStrictEqual(mediaLibraryMetrics.providerRouting.failureClassification, {contentFailureKeepsSite:true,oneTimeoutKeepsSite:true,twoSourcesTripSite:true});
  assert.strictEqual(mediaLibraryMetrics.providerRouting.tiktokProvider.id, 'tiktok');
  assert.strictEqual(mediaLibraryMetrics.providerRouting.tiktokProvider.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(mediaLibraryMetrics.providerRouting.tiktokProvider.label, 'TikTok');
  assert.deepStrictEqual(mediaLibraryMetrics.copiedFiles, ['C:/Downloads/demo.mp4']);
  assert.deepStrictEqual(mediaLibraryMetrics.draggedFiles, ['C:/Downloads/demo.mp4','C:/Favorites/favorite.mp4']);
  assert.deepStrictEqual(mediaLibraryMetrics.mediaRowsDraggable, [true,true]);
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
  assert.strictEqual(mediaLibraryMetrics.videoDownloadModeSelected, true);
  assert.strictEqual(mediaLibraryMetrics.downloadKindLabel, '视频');
  assert.strictEqual(mediaLibraryMetrics.kindMenuOpened, true);
  assert.deepStrictEqual(mediaLibraryMetrics.kindDropdownKeepsFavorites, {kind:'audio',tab:'favorites',label:'音乐',menuHidden:true});
  assert.deepStrictEqual(mediaLibraryMetrics.kindHomeOpensPortal, {kind:'video',tab:'portal'});
  assert.deepStrictEqual(mediaLibraryMetrics.favoriteOrder, {changed:true,names:['second.mp4','first.mp4'],persisted:['second.mp4','first.mp4']});
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
  assert.deepStrictEqual(mediaLibraryMetrics.downloadBubble, {active:true,open:true,ring:'50 100',tasks:1,toggleSize:[40,40],ringSize:[40,40],ringAligned:true});
  assert.strictEqual(mediaLibraryMetrics.musicDownloadStates.active, true);
  assert(mediaLibraryMetrics.musicDownloadStates.names.includes('测试歌曲（准备下载）'));
  assert(mediaLibraryMetrics.musicDownloadStates.names.includes('高清歌曲（等待夸克下载）'));
  assert(mediaLibraryMetrics.musicDownloadStates.statuses.includes('正在准备音乐文件'));
  assert(mediaLibraryMetrics.musicDownloadStates.statuses.includes('等待云盘客户端下载'));
  assert(mediaLibraryMetrics.musicDownloadStates.summary.includes('3 项进行中'));
  assert.deepStrictEqual(mediaLibraryMetrics.pausedTask, {status:'paused',hasResume:true,hasDelete:true,removed:true});
  assert.deepStrictEqual(mediaLibraryMetrics.pausedDownloadTasks, [{taskId:'runtime-pause-delete',paused:true}]);
  assert.deepStrictEqual(mediaLibraryMetrics.interruptedTask, {status:'等待重试 · 4.00 KB',hasDelete:true,removed:true});
  assert.deepStrictEqual(mediaLibraryMetrics.cancelledDownloadTasks, ['runtime-pause-delete','runtime-interrupted']);
  assert.strictEqual(mediaLibraryMetrics.completedHistory.count, 10);
  assert.strictEqual(mediaLibraryMetrics.completedHistory.rendered, 11, 'active task plus ten completed records should be visible');
  assert.strictEqual(mediaLibraryMetrics.completedHistory.deleteButtons, 10, 'every completed download record with a file must expose a delete button');
  assert.strictEqual(mediaLibraryMetrics.completedHistory.names.includes('completed-0.mp4'), false);
  assert.strictEqual(mediaLibraryMetrics.completedHistory.names.includes('completed-1.mp4'), false);
  assert(mediaLibraryMetrics.completedHistory.summary.includes('1 项进行中'));
  assert.deepStrictEqual(mediaLibraryMetrics.completedHistoryActions, {
    opened:['C:/Downloads/completed-11.mp4'],
    contextMenus:['C:/Downloads/completed-11.mp4'],
    deleted:['runtime-completed-11'],
    stillPresent:false,
  });
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
  window.setSize(560, 560);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const compactMediaLayout = await window.webContents.executeJavaScript(`
    (async()=>{
      await switchView('media',{skipCoach:true});
      setMediaKind('video',{showPortal:true});
      state.media.browserVisible=false;
      state.media.videoParse={
        status:'ready',sourceUrl:'https://v.douyin.com/compact',previewUrl:'',title:'小窗口布局测试',qualityLabel:'1080P',downloadReady:true,error:'',embeddedPreview:false,
        qualityOptions:[{label:'1080P',href:'https://cdn.example.com/compact-1080.mp4'},{label:'720P',href:'https://cdn.example.com/compact-720.mp4'}],selectedQualityIndex:0
      };
      renderMediaPortalWorkspace();
      renderMediaBrowserState();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const shell=document.querySelector('#mediaDirectShell').getBoundingClientRect();
      const result=document.querySelector('#mediaVideoResult').getBoundingClientRect();
      const frame=document.querySelector('.media-video-frame').getBoundingClientRect();
      const meta=document.querySelector('.media-video-meta').getBoundingClientRect();
      const actions=document.querySelector('.media-video-actions').getBoundingClientRect();
      return {
        viewport:{width:innerWidth,height:innerHeight},
        shellVisible:shell.width>0&&shell.height>0&&shell.bottom<=innerHeight+1,
        frameVisible:frame.width>0&&frame.height>=70,
        actionsVisible:actions.width>0&&actions.height>0&&actions.bottom<=shell.bottom+1&&actions.bottom<=innerHeight+1,
        ordered:frame.bottom<=meta.top+1&&meta.bottom<=actions.top+1,
        widthContained:frame.left>=result.left-1&&frame.right<=result.right+1&&actions.left>=result.left-1&&actions.right<=result.right+1,
      };
    })()
  `, true);
  console.log(`compact media layout metrics ${JSON.stringify(compactMediaLayout)}`);
  if (process.env.XUANNIAN_RUNTIME_SCREENSHOT) {
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const compactImage = await window.webContents.capturePage();
    const compactPath = path.resolve(process.env.XUANNIAN_RUNTIME_SCREENSHOT).replace(/(\.png)?$/i, '-media-video-compact.png');
    fs.writeFileSync(compactPath, compactImage.toPNG());
    window.hide();
  }
  window.setSize(1280, 820);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(compactMediaLayout.viewport.width <= 560 && compactMediaLayout.viewport.width >= 500);
  assert(compactMediaLayout.viewport.height <= 560 && compactMediaLayout.viewport.height >= 480);
  assert.deepStrictEqual({
    shellVisible:compactMediaLayout.shellVisible,
    frameVisible:compactMediaLayout.frameVisible,
    actionsVisible:compactMediaLayout.actionsVisible,
    ordered:compactMediaLayout.ordered,
    widthContained:compactMediaLayout.widthContained,
  }, {
    shellVisible:true,
    frameVisible:true,
    actionsVisible:true,
    ordered:true,
    widthContained:true,
  });
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
        setMediaKind('audio',{showPortal:true});
        state.media.musicSearch={status:'ready',requestId:0,query:'唯一 邓紫棋',error:'',results:[
          {url:'https://www.gequbao.com/music/101',title:'唯一',artist:'G.E.M. 邓紫棋',label:'唯一 - G.E.M. 邓紫棋'},
          {url:'https://www.gequbao.com/music/102',title:'唯一（现场版）',artist:'G.E.M. 邓紫棋',label:'唯一（现场版） - G.E.M. 邓紫棋'},
          {url:'https://www.gequbao.com/music/103',title:'唯一（伴奏）',artist:'纯音乐',label:'唯一（伴奏） - 纯音乐'}
        ]};
        state.media.musicPreview={status:'ready',requestId:0,index:0,resultUrl:'https://www.gequbao.com/music/101',previewUrl:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',error:''};
        state.media.musicFormatChoice=null;
        renderMediaPortalWorkspace();
        renderMediaBrowserState();
      })()
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const mediaMusicImage = await window.webContents.capturePage();
    fs.writeFileSync(screenshotPath.replace(/(\.png)?$/i, '-media-music.png'), mediaMusicImage.toPNG());
    await window.webContents.executeJavaScript("setMediaTab('downloads')", true);
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
