const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-media-endurance-'));
app.setPath('userData', tempDirectory);

function durationFromEnvironment() {
  const seconds = Number(process.env.XUANNIAN_ENDURANCE_SECONDS || 0);
  if (seconds > 0) return Math.max(5, seconds) * 1000;
  if (process.argv.includes('--smoke')) return 8000;
  const hours = Number(process.env.XUANNIAN_ENDURANCE_HOURS || 2);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

async function rendererHeap(window) {
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    const usage = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    return Number(usage.usedSize || 0);
  } finally {
    window.webContents.debugger.detach();
  }
}

async function run() {
  const durationMs = durationFromEnvironment();
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: { backgroundThrottling: false },
  });
  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  await window.webContents.executeJavaScript(`localStorage.setItem('xuannian.onboarding.first-run.v1','seen')`);
  const prepared = await window.webContents.executeJavaScript(`
    (()=>{
      const now=Date.now();
      const downloads=Array.from({length:12000},(_,index)=>({
        path:'C:/Downloads/endurance-'+index+(index%4===0?'.mp3':'.mp4'),
        directory:'C:/Downloads',
        name:'endurance-'+index+(index%4===0?'.mp3':'.mp4'),
        kind:index%4===0?'audio':'video',
        size:1024+index,
        modifiedAt:now-index,
        favorite:false,
        location:'downloads',
        collection:index%3===0?'旧下载目录':'',
      }));
      const favorites=Array.from({length:6000},(_,index)=>({
        path:'C:/Favorites/favorite-'+index+(index%3===0?'.flac':'.mp4'),
        directory:'C:/Favorites',
        name:'favorite-'+index+(index%3===0?'.flac':'.mp4'),
        kind:index%3===0?'audio':'video',
        size:2048+index,
        modifiedAt:now-index,
        favorite:true,
        location:'favorites',
        collection:index%5===0?'工作':'',
      }));
      const payload={
        ok:true,
        downloadPath:'C:/Downloads',
        favoritePath:'C:/Favorites',
        items:[...downloads,...favorites],
        collections:{downloads:{video:['旧下载目录'],audio:[]},favorites:{video:['工作'],audio:['工作']}},
      };
      api.listLocalMedia=async()=>payload;
      api.setMediaBrowserBounds=()=>true;
      state.media.items=payload.items;
      state.media.collections=payload.collections;
      state.media.renderVersion+=1;
      switchView('media',{skipCoach:true});
      setMediaKind('video');
      setMediaTab('downloads');
      renderMediaLists({force:true});
      return {items:payload.items.length};
    })()
  `, true);
  assert.strictEqual(prepared.items, 18000);

  for (let index = 0; index < 80; index += 1) {
    await window.webContents.executeJavaScript(`
      (()=>{
        const tab=${index % 2 === 0 ? "'downloads'" : "'favorites'"};
        const kind=${index % 3 === 0 ? "'audio'" : "'video'"};
        setMediaKind(kind);
        setMediaTab(tab);
        const list=document.querySelector(tab==='downloads'?'#mediaDownloadsList':'#mediaFavoritesList');
        list.scrollTop=(list.scrollHeight-list.clientHeight)*((${index}%20)/19);
        renderMediaList(tab,{force:true});
      })()
    `, true);
  }
  const initialHeap = await rendererHeap(window);
  const metrics = await window.webContents.executeJavaScript(`
    (async()=>{
      const deadline=performance.now()+${durationMs};
      let iterations=0;
      let maxRows=0;
      let maxDomNodes=0;
      while(performance.now()<deadline){
        const tab=iterations%2===0?'downloads':'favorites';
        const kind=iterations%3===0?'audio':'video';
        setMediaKind(kind);
        setMediaTab(tab);
        const search=document.querySelector(tab==='downloads'?'#mediaDownloadsSearch':'#mediaFavoritesSearch');
        search.value=iterations%5===0?'endurance-'+(iterations%900):'';
        resetMediaListViewport(tab);
        renderMediaList(tab,{force:true});
        const list=document.querySelector(tab==='downloads'?'#mediaDownloadsList':'#mediaFavoritesList');
        if(!search.value){
          const ratio=(iterations%101)/100;
          list.scrollTop=Math.max(0,(list.scrollHeight-list.clientHeight)*ratio);
          renderMediaList(tab,{force:true});
        }
        updateMediaDownloadTask({
          id:'endurance-download-'+(iterations%8),
          name:'media-'+iterations+'.mp4',
          status:'downloading',
          receivedBytes:(iterations%100)+1,
          totalBytes:100,
          percent:(iterations%100)+1,
        });
        if(iterations%7===0){
          updateMediaDownloadTask({
            id:'endurance-completed-'+iterations,
            name:'completed-'+iterations+'.mp4',
            status:'completed',
            receivedBytes:100,
            totalBytes:100,
            percent:100,
            updatedAt:Date.now()+iterations,
          });
        }
        maxRows=Math.max(maxRows,document.querySelectorAll('#mediaDownloadsList [data-media-row],#mediaFavoritesList [data-media-row]').length);
        maxDomNodes=Math.max(maxDomNodes,document.querySelectorAll('*').length);
        iterations+=1;
        if(iterations%12===0) await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      return {
        iterations,maxRows,maxDomNodes,
        downloadTasks:state.media.downloadTasks.length,
        completedTasks:state.media.downloadTasks.filter(task=>task.status==='completed').length,
      };
    })()
  `, true);
  const finalHeap = await rendererHeap(window);
  const heapGrowth = finalHeap - initialHeap;
  console.log(`media endurance metrics ${JSON.stringify({ durationMs, initialHeap, finalHeap, heapGrowth, ...metrics })}`);
  const minimumIterations = Math.max(50, Math.floor(durationMs / 100));
  assert(metrics.iterations >= minimumIterations, `endurance loop completed too few iterations: ${metrics.iterations} < ${minimumIterations}`);
  assert(metrics.maxRows <= 96, `media virtual DOM exceeded 96 total rows: ${metrics.maxRows}`);
  assert(metrics.maxDomNodes < 3200, `media endurance DOM grew without bound: ${metrics.maxDomNodes}`);
  assert(metrics.completedTasks <= 10, `completed download history exceeded ten records: ${metrics.completedTasks}`);
  assert(metrics.downloadTasks <= 18, `download task state grew without bound: ${metrics.downloadTasks}`);
  assert(heapGrowth < 96 * 1024 * 1024, `renderer heap grew by ${heapGrowth} bytes`);
  window.destroy();
}

async function finish(code) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    const resolved = path.resolve(tempDirectory);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('xuannian-media-endurance-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  } catch {}
  app.exit(code);
}

run().then(() => finish(0)).catch((error) => {
  console.error(error);
  finish(1);
});
