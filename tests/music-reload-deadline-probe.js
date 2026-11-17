const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BaseWindow, session, webContents } = require('electron');

app.setName('XuanNianMusicReloadProbe');
app.setPath('appData', fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-music-reload-')));
app.disableHardwareAcceleration();
process.env.XUANNIAN_DEBUG_LOG = '1';
require('../src/main');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(80);
  }
  throw Error(`Timed out: ${label}`);
}

async function run() {
  await app.whenReady();
  const main = await until(() => BaseWindow.getAllWindows().find(window => window.webContents && /index\.html/.test(window.webContents.getURL())), 'main window');
  if (main.webContents.isLoading()) await new Promise(resolve => main.webContents.once('did-finish-load', resolve));
  const providerSession = session.fromPartition('persist:xuannian-media-portals');
  let reloads = 0;
  providerSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (!/^(www\.)?gequbao\.com$/.test(url.hostname)) return new Response('', { status: 404 });
    const query = decodeURIComponent(url.pathname.replace(/^\/s\//, ''));
    const looping = query.includes('循环');
    if (looping) reloads += 1;
    return new Response(looping
      ? '<title>Just a moment...</title><body>Performing security verification<div id="challenge-running"></div><script>setTimeout(()=>location.reload(),1200)</script></body>'
      : `<title>搜索结果</title><a href="/music/94001" style="display:inline-block;width:180px;height:24px">${query}</a>`,
    { status: looping ? 403 : 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  await main.webContents.executeJavaScript(`(async()=>{
    localStorage.setItem('xuannian.onboarding.first-run.v1','seen');
    if(typeof closeModal==='function')closeModal();
    await switchView('media',{skipCoach:true});setMediaKind('audio');
  })()`);
  const search = query => main.webContents.executeJavaScript(`(async()=>{document.getElementById('mediaMusicInput').value=${JSON.stringify(query)};await searchMediaMusic();})()`);
  const current = () => main.webContents.executeJavaScript('({status:state.media.musicSearch.status,error:state.media.musicSearch.error,query:state.media.musicSearch.query,count:state.media.musicSearch.results.length,progress:state.media.portalProgress.status})');
  const provider = () => webContents.getAllWebContents().find(contents => !contents.isDestroyed() && /gequbao\.com/.test(contents.getURL()));
  await search('切换前循环');
  await wait(3000);
  await search('切换成功');
  await until(async () => { const state = await current(); return state.status === 'ready' && state.query === '切换成功' && state.count; }, 'changed query after interrupted page Promise');
  await search('持续循环');
  const startedAt = Date.now();
  let maximumStopListeners = 0;
  const monitor = setInterval(() => {
    const contents = provider();
    if (contents) maximumStopListeners = Math.max(maximumStopListeners, contents.listenerCount('did-stop-loading'));
  }, 80);
  let failure;
  try {
    failure = await until(async () => {
      const state = await current();
      if (state.status !== 'error') return false;
      assert(Date.now() - startedAt >= 44000, 'A superseded query must not expire the current request.');
      return state;
    }, 'wall-clock deadline despite document reloads', 47500);
  } finally { clearInterval(monitor); }
  assert.equal(failure.error, 'security-check-timeout');
  assert.equal(failure.progress, 'error');
  assert(reloads >= 15, `Probe must exercise repeated document replacement, observed ${reloads}`);
  assert(maximumStopListeners <= 4, `did-stop-loading listeners accumulated: ${maximumStopListeners}`);
  await main.webContents.executeJavaScript("if(typeof closeModal==='function')closeModal()");
  await search('超时后恢复');
  await until(async () => { const state = await current(); return state.status === 'ready' && state.query === '超时后恢复' && state.count; }, 'new request after total deadline');
  console.log(`Music reload deadline probe passed ${JSON.stringify({ reloads, timeoutMs: Date.now() - startedAt, maximumStopListeners, queryCancellation: true, recovery: true })}`);
  app.quit();
}

const timeout = setTimeout(() => { console.error('Music reload deadline probe exceeded its limit.'); app.exit(1); }, 65000);
run().catch(error => { console.error(error); app.exit(1); }).finally(() => clearTimeout(timeout));
