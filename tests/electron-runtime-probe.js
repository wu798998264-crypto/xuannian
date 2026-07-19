const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

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

async function run() {
  await app.whenReady();
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

  const metrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;
      await switchView('notes',{skipCoach:true});
      const list=document.querySelector('#noteList');
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
  assert(metrics.finalDomNodes < 1700, `renderer DOM should stay bounded, received ${metrics.finalDomNodes} nodes`);
  assert.strictEqual(rendererErrors.length, 0, `renderer errors: ${rendererErrors.join(' | ')}`);
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
  assert.strictEqual(rendererErrors.length, 0, `renderer errors: ${rendererErrors.join(' | ')}`);
  if (process.env.XUANNIAN_RUNTIME_SCREENSHOT) {
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const image = await window.webContents.capturePage();
    const screenshotPath = path.resolve(process.env.XUANNIAN_RUNTIME_SCREENSHOT);
    fs.writeFileSync(screenshotPath, image.toPNG());
    window.setSize(620, 760);
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
