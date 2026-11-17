const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BaseWindow, session, webContents } = require('electron');
const { buildMusicPageSnapshotScript, isMusicSearchDocument } = require('../src/music-page');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-embedded-music-'));
app.setName('XuanNianEmbeddedMusicProbe');
app.setPath('appData', temporary);
app.disableHardwareAcceleration();
process.env.XUANNIAN_DEBUG_LOG = '1';
require('../src/main');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(60);
  }
  throw Error(`Timed out: ${label}`);
}

function fixture(query) {
  const rows = (name, id) => `<a style="display:inline-block;width:28px;height:20px" href="/music/${id}">${name}</a><footer>Protected by Cloudflare · captcha help</footer>`;
  if (query === '真人测试') return `<!doctype html><title>Security verification</title><body><p>请勾选完成安全验证，确认您是真人</p><input id="verify" type="checkbox" style="width:28px;height:28px"><script>
    verify.onchange = () => { document.title = '歌曲结果'; document.body.innerHTML = ${JSON.stringify(rows('验证后歌曲', 93003))}; window.__resultsReadyAt = Date.now(); };
  </script></body>`;
  if (query === '自动检查') return `<!doctype html><title>Just a moment...</title><body><p>Performing security verification</p><div id="challenge-running"></div><script>
    setTimeout(() => { document.title = '歌曲结果'; document.body.innerHTML = ${JSON.stringify(rows('自动检查后歌曲', 93002))}; window.__resultsReadyAt = Date.now(); }, 900);
  </script></body>`;
  return `<!doctype html><title>歌曲结果</title><body><article><a id="song" style="display:inline-block;width:28px;height:20px">${query}</a></article><footer>Protected by Cloudflare · captcha help</footer><script>
    setTimeout(() => { song.setAttribute('href','/music/${query === '下一首' ? 93004 : 93001}'); window.__resultsReadyAt = Date.now(); }, 900);
  </script></body>`;
}

async function run() {
  await app.whenReady();
  const main = await until(() => BaseWindow.getAllWindows().find(window => window.getTitle() === `玄念${app.getVersion()}`), 'production main window');
  if (main.webContents.isLoading()) await new Promise(resolve => main.webContents.once('did-finish-load', resolve));
  await main.webContents.executeJavaScript("localStorage.setItem('xuannian.onboarding.first-run.v1','seen')");
  const originalContents = main.webContents;
  assert.equal(require('electron').BrowserWindow.fromWebContents(originalContents), main, 'Native webContents owner must remain the production main window.');
  const layoutChecks = [];
  for (const width of [620, 1180]) {
    main.setContentSize(width, 740);
    await until(async () => {
      const [contentWidth, contentHeight] = main.getContentSize();
      const bounds = main.applicationView.getBounds();
      const inner = await main.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})');
      return bounds.x === 0 && bounds.y === 0 && bounds.width === contentWidth && bounds.height === contentHeight
        && inner.width === contentWidth && inner.height === contentHeight;
    }, `main application view resized to ${width}`);
    layoutChecks.push({ content: main.getContentSize(), bounds: main.applicationView.getBounds() });
    assert.equal(main.webContents, originalContents);
  }
  const portalSession = session.fromPartition('persist:xuannian-media-portals');
  portalSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (!/^(www\.)?gequbao\.com$/.test(url.hostname)) return new Response('', { status: 404 });
    const query = decodeURIComponent(url.pathname.replace(/^\/s\//, ''));
    if (query === '下一首') await wait(1000);
    return new Response(fixture(query), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  await main.webContents.executeJavaScript(`(async () => {
    await switchView('media', { skipCoach: true });
    setMediaKind('audio');
    window.__probeMusicEvents = [];
    window.__probeMusicResults = [];
    nativeAPI.onMediaBrowserState(event => window.__probeMusicEvents.push(event));
    nativeAPI.onMediaMusicResults(event => window.__probeMusicResults.push({ query: event.query, at: Date.now(), ok: event.ok }));
  })()`);
  const nativeSetAlwaysOnTop = main.setAlwaysOnTop.bind(main);
  main.setAlwaysOnTop = (...args) => {
    const result = nativeSetAlwaysOnTop(...args);
    console.log(`pin native call ${JSON.stringify({ args, pinned: main.isAlwaysOnTop(), focused: main.isFocused(), visible: main.isVisible(), id: main.id, handle: main.getNativeWindowHandle().toString('hex') })}`);
    return result;
  };
  main.show();
  main.focus();
  main.webContents.focus();
  await until(() => main.isFocused(), 'main foreground before native controls');
  console.log(`pin initial response ${JSON.stringify({ response: await main.webContents.executeJavaScript('nativeAPI.setAlwaysOnTop(true)'), pinned: main.isAlwaysOnTop(), visible: main.isVisible(), id: main.id })}`);
  await until(() => main.isAlwaysOnTop(), 'initial main pin IPC');
  await main.webContents.executeJavaScript('nativeAPI.setAlwaysOnTop(false)');
  await wait(300);
  const windowsBefore = new Set(BaseWindow.getAllWindows().map(window => window.id));
  const search = async query => {
    await main.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('mediaMusicInput');
      input.value = ${JSON.stringify(query)};
      await searchMediaMusic();
    })()`);
  };
  const snapshot = () => main.webContents.executeJavaScript(`({
    status: state.media.musicSearch.status,
    count: state.media.musicSearch.results.length,
    query: state.media.musicSearch.query,
    labels: state.media.musicSearch.results.map(result => result.label),
    events: window.__probeMusicEvents,
  })`);
  const portal = () => webContents.getAllWebContents().find(contents => !contents.isDestroyed() && /gequbao\.com/.test(contents.getURL()));
  const synchronizationDelays = [];
  const recordSynchronization = async query => {
    const resultAt = await portal().executeJavaScript('window.__resultsReadyAt');
    const receivedAt = await main.webContents.executeJavaScript(`window.__probeMusicResults.findLast(event => event.ok && event.query === ${JSON.stringify(query)})?.at`);
    const delay = receivedAt - resultAt;
    assert(Number.isFinite(delay) && delay >= 0 && delay <= 1000, `Result DOM to application synchronization exceeded 1 second for ${query}: ${delay}ms`);
    synchronizationDelays.push({ query, milliseconds: delay });
  };
  const assertHost = expectedLayer => {
    const provider = portal();
    const children = main.contentView.children;
    const portalIndex = children.findIndex(child => child.webContents === provider);
    const appIndex = children.findIndex(child => child.webContents === main.webContents);
    assert(portalIndex >= 0 && appIndex >= 0, `Provider must be attached inside the main application: ${JSON.stringify({ provider: provider?.id, children: children.map(child => ({ id: child.webContents?.id, url: child.webContents?.getURL?.() })) })}`);
    assert.equal(portalIndex < appIndex, expectedLayer === 'background', 'Provider layer must match explicit embedded visibility.');
    assert.deepEqual(BaseWindow.getAllWindows().map(window => window.id).filter(id => !windowsBefore.has(id)), [], 'Search must not create a native browser window.');
  };

  await search('唯一');
  const first = await until(async () => { const current = await snapshot(); return current.status === 'ready' && current.count > 0 && current; }, 'short title and late href attribute result');
  assert(first.labels.some(label => label.includes('唯一')));
  assert.equal(first.events.some(event => event.verificationRequired), false, 'Cloudflare footer must not trigger manual verification.');
  assertHost('background');
  await recordSynchronization('唯一');
  const provider = portal();
  const page = await provider.executeJavaScript(buildMusicPageSnapshotScript({ observe: true }));
  assert.equal(page.results.length, 1);
  assert.equal(page.requiresHuman, false);
  assert(isMusicSearchDocument(page.url, 'https://www.gequbao.com/s/唯一'));

  await search('下一首');
  await wait(450);
  const duringNavigation = await snapshot();
  assert(!duringNavigation.labels.some(label => label.includes('唯一')), 'New search must not consume the previous document results.');
  const next = await until(async () => { const current = await snapshot(); return current.status === 'ready' && current.labels.some(label => label.includes('下一首')) && current; }, 'new document results');
  assertHost('background');
  await recordSynchronization('下一首');

  await search('自动检查');
  const automatic = await until(async () => { const current = await snapshot(); return current.status === 'ready' && current.labels.some(label => label.includes('自动检查')) && current; }, 'automatic security check completion');
  assert.equal(automatic.events.some(event => event.verificationRequired), false, 'Automatic security checks must stay behind the app.');
  assertHost('background');
  await recordSynchronization('自动检查');

  await search('真人测试');
  await until(async () => (await snapshot()).events.some(event => event.verificationRequired && event.automationMode === 'music-search'), 'explicit manual verification event');
  await until(() => {
    try { assertHost('foreground'); return true; } catch { return false; }
  }, 'verification page embedded above the application');
  const checkbox = await portal().executeJavaScript(`(() => { const b = document.getElementById('verify').getBoundingClientRect(); return {x: Math.round(b.x+b.width/2), y: Math.round(b.y+b.height/2)}; })()`);
  // This is our local test checkbox, never a real provider CAPTCHA.
  portal().sendInputEvent({ type: 'mouseDown', ...checkbox, button: 'left', clickCount: 1 });
  portal().sendInputEvent({ type: 'mouseUp', ...checkbox, button: 'left', clickCount: 1 });
  const verified = await until(async () => { const current = await snapshot(); return current.status === 'ready' && current.labels.some(label => label.includes('验证后')) && current; }, 'automatic result synchronization after user verification');
  await until(() => { try { assertHost('background'); return true; } catch { return false; } }, 'verification page returned behind application');
  assert(verified.events.some(event => event.verificationCompleted && event.automationMode === 'music-search'));
  await recordSynchronization('真人测试');
  assert.equal(await main.webContents.executeJavaScript('nativeAPI.setAlwaysOnTop(true)'), true);
  await until(() => main.isAlwaysOnTop(), 'main pin IPC');
  await main.webContents.executeJavaScript('nativeAPI.setAlwaysOnTop(false)');
  await until(() => !main.isAlwaysOnTop(), 'main unpin IPC');
  await main.webContents.executeJavaScript('nativeAPI.minimizeWindow()');
  await until(() => main.isMinimized(), 'main minimize IPC');
  main.restore();
  main.show();
  await until(() => !main.isMinimized(), 'main restore');
  if (main.isMaximized()) main.unmaximize();
  main.setContentSize(900, 650);
  await until(() => !main.isMaximized(), 'normal-size window before maximize');
  await main.webContents.executeJavaScript('nativeAPI.toggleMaximizeWindow()');
  await until(() => main.isMaximized(), 'main maximize IPC');
  await main.webContents.executeJavaScript('nativeAPI.toggleMaximizeWindow()');
  await until(() => !main.isMaximized(), 'main unmaximize IPC');
  await main.webContents.executeJavaScript('nativeAPI.closeWindow()');
  await until(() => !main.isVisible(), 'main hidden to tray');
  // Use the application's real reopen handler rather than directly focusing
  // the view, so the test detects a missing child-WebContents focus handoff.
  app.emit('second-instance', {}, [], process.cwd());
  await until(() => main.isVisible() && main.isFocused(), 'main reopened from tray');
  await main.webContents.executeJavaScript("document.getElementById('mediaMusicInput').value = ''; document.getElementById('mediaMusicInput').focus()");
  assert.equal(main.webContents.isFocused(), true, 'Reopened main window must focus its application WebContents.');
  for (const keyCode of 'focus') main.webContents.sendInputEvent({ type: 'char', keyCode });
  await until(async () => await main.webContents.executeJavaScript("document.getElementById('mediaMusicInput').value") === 'focus', 'keyboard input after tray restoration');
  console.log(`Embedded music search probe passed ${JSON.stringify({ platform: process.platform, shortTitle: first.count, changedQuery: next.count, automaticCheck: automatic.count, verified: verified.count, extraWindows: 0, synchronizationDelays, layoutChecks, windowControls: true })}`);
  app.quit();
}

const timeout = setTimeout(() => { console.error('Embedded music search probe timed out.'); app.exit(1); }, 55000);
run().catch(async error => {
  const main = BaseWindow.getAllWindows().find(window => window.webContents && /index\.html/.test(window.webContents.getURL()));
  if (main) {
    console.log(`music production failure snapshot ${JSON.stringify({
      mainId: main.id,
      nativeHandle: main.getNativeWindowHandle().toString('hex'),
      children: main.contentView.children.map(child => ({ id: child.webContents?.id, url: child.webContents?.getURL?.(), visible: child.getVisible?.(), bounds: child.getBounds() })),
      ui: await main.webContents.executeJavaScript('({search:state.media.musicSearch,browser:state.media.browser,musicOperation:state.media.musicOperation,events:window.__probeMusicEvents})').catch(() => null),
    })}`);
  }
  console.error(error);
  app.exit(1);
}).finally(() => clearTimeout(timeout));
