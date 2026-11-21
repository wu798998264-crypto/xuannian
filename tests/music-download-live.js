// node tests/music-download-live.js [query] [song ID] [--interactive|--detail|--fixture|--slow-fixture|--two-click-fixture|--verification-fixture]
// Success requires a completed production download and a readable audio stream on disk.
const assert = require('node:assert/strict');
const child = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const keepSession = process.argv.includes('--keep-session');
  const profile = keepSession ? path.join(os.tmpdir(), 'xuannian-music-live-qa-profile')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-download-test-'));
  if (keepSession) fs.mkdirSync(profile, {recursive:true});
  try {
    const childRun = child.spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
      stdio:'inherit', env:{ ...process.env, XUANNIAN_TEST_DIRECTORY:profile },
    });
    if (childRun.error) throw childRun.error;
    process.exitCode = childRun.status ?? 1;
  } finally {
    if (!keepSession) fs.rmSync(profile, {recursive:true,force:true,maxRetries:15,retryDelay:100});
  }
  return;
}
const { app, BaseWindow, clipboard, globalShortcut, nativeImage, session, webContents } = require('electron');
const profile = process.env.XUANNIAN_TEST_DIRECTORY;
assert(profile, 'Launch the probe with node to clean up after Electron closes');
const downloads = path.join(profile, 'downloads');
const bundle = process.env.XUANNIAN_TEST_BUNDLE || path.join(__dirname, '..');
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const query = args[0] || '譬如我';
const songId = args[1] || '';
const slowFixture = process.argv.includes('--slow-fixture');
const verificationFixture = process.argv.includes('--verification-fixture');
const twoClickFixture = verificationFixture || process.argv.includes('--two-click-fixture');
const fixture = twoClickFixture || slowFixture || process.argv.includes('--fixture');
const detailOnly = process.argv.includes('--detail');
const interactive = process.argv.includes('--interactive');
const keepWindow = process.argv.includes('--keep-window');
assert(!keepWindow || interactive, 'Keeping the window open requires a live interactive test');
const hiddenFixture = process.argv.includes('--hidden-fixture');
assert(!hiddenFixture || fixture, 'Hidden mode is only for isolated fixtures');
assert(!interactive || (!fixture && !detailOnly), 'Interactive acceptance requires a real search and live provider download');
const verificationBudget = 10 * 60 * 1000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function mediaBinary(name) {
  const override = process.env['SHENSI_' + name.toUpperCase() + '_PATH'];
  const local = path.join(__dirname, '..', 'build', 'media-resources', 'ffmpeg', name + (process.platform === 'win32' ? '.exe' : ''));
  return override && fs.existsSync(override) ? override : fs.existsSync(local) ? local : name;
}

app.setName('XuanNianDownloadProbe');
for (const key of ['appData', 'sessionData', 'downloads', 'documents']) {
  const folder = path.join(profile, key);
  fs.mkdirSync(folder, {recursive:true});
  app.setPath(key, folder);
}
app.setAppPath(bundle);
app.setLoginItemSettings = () => {};
globalShortcut.register = () => false;
clipboard.availableFormats = () => [];
clipboard.readText = clipboard.readHTML = () => '';
clipboard.readImage = () => nativeImage.createEmpty();

// The application also probes the installed StoragePath (even when appData is
// redirected) and starts native clipboard/file-index services. Isolate those
// host integrations while leaving the production Electron download path intact.
const nativeExec = child.execFileSync;
const excludedTool = binary => /^(?:reg|powershell|XuanNianClipboardHelper)\.exe$/i.test(path.basename(binary));
for (const name of ['execFile', 'execFileSync', 'spawn']) {
  const original = child[name];
  child[name] = (binary, ...args) => {
    if (!excludedTool(binary)) return original(binary, ...args);
    if (name === 'execFileSync') return '';
    if (name === 'spawn') throw Error('Host helper disabled in isolated download probe');
    const callback = args.at(-1);
    if (typeof callback === 'function') queueMicrotask(() => callback(null, '', ''));
  };
}
require(path.join(bundle, 'src/file-search')).FileSearchService.prototype.prewarm = async () => {};
if (hiddenFixture) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  const windows = require(path.join(bundle, 'src/application-window'));
  const createWindow = windows.createApplicationWindow;
  windows.createApplicationWindow = options => createWindow({ ...options, show: false,
    ...(verificationFixture ? { opacity: 0, focusable: false, skipTaskbar: true,
      webPreferences: { ...options.webPreferences, backgroundThrottling: false } } : {}) });
  const { Notification } = require('electron');
  Notification.isSupported = () => false;
}
require(path.join(bundle, 'src/main'));

async function until(read, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await wait(250);
  }
  throw Error('Timed out waiting for ' + label);
}

const buttonEvents = [];
const fixtureRequests = [];
const fixtureGates = new Map();

// Observe automatic presentation. The test never opens verification or operates a provider challenge.
function observePortal(main, ui) {
  let firstPresentationFailure;
  const shown = new Set();
  const windows = new Set(BaseWindow.getAllWindows().map(w => w.id));
  async function check(stage) {
    if (!interactive && !verificationFixture) return;
    const gate = await ui(`({ id:state.media.musicVerification?.requestId,
      showing:!!state.media.musicVerification?.showing, visible:state.media.browserVisible,
      manualKind:state.media.manualPortal?.kind })`);
    const views = main.contentView.children;
    const appLayer = views.findIndex(child => child.webContents === main.webContents);
    const portalLayer = views.findIndex(child => /^https:\/\/(?:www\.)?gequbao\.com\//.test(child.webContents?.getURL()));
    assert(appLayer >= 0, 'App content must stay attached to its native window');
    assert(BaseWindow.getAllWindows().every(w => windows.has(w.id) || !w.isVisible()), 'An unexpected native window opened');
    if (portalLayer > appLayer && views[portalLayer].getVisible()) {
      if (!gate.showing || !gate.visible) {
        const surface = views[portalLayer];
        const diagnostics = {stage, gate, appLayer, portalLayer, bounds:surface.getBounds(), request:surface.webContents.musicVerificationDocumentId,
          title:surface.webContents.getTitle(), page:new URL(surface.webContents.getURL()).pathname, managed:surface.webContents.musicManagedChallenge};
        if (!firstPresentationFailure) {
          firstPresentationFailure = Error('Ordinary provider content must stay behind the application. ' + JSON.stringify(diagnostics));
          console.error(firstPresentationFailure.message);
        }
        if (!interactive) throw firstPresentationFailure;
      }
      if (verificationFixture) {
        assert(views[portalLayer].webContents.musicManagedChallenge, 'A normal song page must be hidden before verification finishes');
      }
      if (!shown.has(stage)) console.log(JSON.stringify({stage, requestId:gate.id, message:'验证页已显示在玄念内'}));
      shown.add(stage);
    }
  }
  return {check, shown, assertPresentation() { if (firstPresentationFailure) throw firstPresentationFailure; }};
}

function twoClickDetail(id, url) {
  const failing = id === '67234389';
  return `<button id="start">下载歌曲</button>
    <section id="dialog" role="dialog" hidden>
      <a id="quality" class="download-option-card default-link" data-normal-download="1" href="#" download="歌曲.mp3" target="_blank">
        下载低品质MP3 <span role="status"></span>
      </a>
    </section>
    <script>
      const stage = action => fetch('/click/${id}/' + action);
      start.onclick = async () => {
        start.disabled = true;
        await stage('queue');
        setTimeout(() => { dialog.hidden = false; }, ${failing ? 100 : 30000});
      };
      quality.onclick = async event => {
        if (quality.getAttribute('href') !== '#') {
          // Same origin and path as the granted URL, but unrelated to this selection.
          const unrelated = new URL(quality.href);
          unrelated.searchParams.set('signature', 'unrelated');
          window.open(unrelated.href, '_blank');
          await stage('confirm');
          return;
        }
        // The real card's initial href="#" also downloads the current HTML while its handler prepares the audio.
        if (${failing}) event.preventDefault();
        if (quality.getAttribute('aria-busy') === 'true') return;
        quality.setAttribute('aria-disabled', 'true');
        quality.setAttribute('aria-busy', 'true');
        const message = quality.querySelector('[role=status]');
        message.textContent = '正在准备下载，请稍候…';
        await stage('quality');
        setTimeout(() => {
          if (${failing}) {
            dialog.innerHTML = '<p role="alert">受版权保护，禁止下载</p>';
          } else {
            quality.removeAttribute('aria-disabled');
            quality.removeAttribute('aria-busy');
            quality.href = ${JSON.stringify(url)};
            message.textContent = '链接已就绪，再次点击即可下载';
          }
        }, 650);
      };
    </script>`;
}

function fixtureTls(portalSession) {
  const certFile = path.join(profile, 'fixture.pem');
  const keyFile = path.join(profile, 'fixture.key');
  const gitOpenSSL = path.join(process.env.ProgramFiles || '', 'Git', 'usr', 'bin', 'openssl.exe');
  const openssl = process.platform === 'win32' && fs.existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl';
  nativeExec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyFile, '-out', certFile], {stdio:'ignore'});
  const cert = fs.readFileSync(certFile);
  const fingerprint = new crypto.X509Certificate(cert).fingerprint256;
  portalSession.setCertificateVerifyProc(({hostname, certificate}, callback) => {
    const fixtureCert = hostname === '127.0.0.1' && new crypto.X509Certificate(certificate.data).fingerprint256 === fingerprint;
    callback(fixtureCert ? 0 : -3);
  });
  return {cert, key:fs.readFileSync(keyFile)};
}

async function installFixture() {
  const audio = nativeExec(mediaBinary('ffmpeg'), [
    '-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-f','mp3','pipe:1',
  ]);
  const portalSession = session.fromPartition('persist:xuannian-media-portals');
  await portalSession.setProxy({ mode:'direct' });
  const expiry = Math.floor(Date.now() / 1000) + 300;
  const resource = '/delivery/67234390?expires=' + expiry;
  const signature = crypto.createHmac('sha256', crypto.randomBytes(32)).update(resource).digest('hex');
  const target = twoClickFixture ? resource + '&signature=' + signature : '/song.mp3';
  function serveAudio(req, res) {
    if (req.url === '/health') { res.writeHead(204).end(); return; }
    const granted = req.url === target && Date.now() < expiry * 1000;
    fixtureRequests.push({ method:req.method, granted, tls:!!req.socket.encrypted, at:Date.now() });
    if (!granted) { res.writeHead(403).end(); return; }
    const mediaHeaders = twoClickFixture
      ? { 'Content-Type':'application/octet-stream', 'Content-Disposition':"attachment; filename*=UTF-8''%E6%AD%8C%E6%9B%B2.mp3" }
      : { 'Content-Type':'audio/mpeg' };
    res.writeHead(200, { ...mediaHeaders, 'Content-Length':audio.length }).end(audio);
  }
  const server = twoClickFixture ? require('node:https').createServer(fixtureTls(portalSession), serveAudio)
    : require('node:http').createServer(serveAudio);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = (twoClickFixture ? 'https' : 'http') + '://127.0.0.1:' + server.address().port;
  const url = origin + target;
  const detail = '<button id="download">下载歌曲</button><button id="standard" disabled>请等待</button><script>'
    + 'download.onclick=()=>{setTimeout(()=>{standard.disabled=false;standard.textContent="普通音质"},' + (slowFixture ? 24500 : 600) + ')};'
    + 'standard.onclick=()=>setTimeout(()=>window.open(' + JSON.stringify(url) + '),300);</script>';
  let serveManagedPage = slowFixture;
  portalSession.protocol.handle('https', req => {
    const u = new URL(req.url);
    if (u.origin === origin) return portalSession.fetch(req.url, {bypassCustomProtocolHandlers:true});
    if (u.hostname !== 'www.gequbao.com') return new Response('', {status:404});
    if (twoClickFixture && u.pathname.startsWith('/click/')) {
      const [, , id, stage] = u.pathname.split('/');
      buttonEvents.push({id, stage, at:Date.now()});
      console.log('Provider button:', id, stage);
      return new Response('ok');
    }
    if (verificationFixture && (u.pathname.startsWith('/s/') || u.pathname === '/music/67234390')) {
      const delay = u.pathname.startsWith('/s/') ? 47000 : 70000;
      if (!fixtureGates.has(u.pathname)) fixtureGates.set(u.pathname, Date.now());
      const remaining = delay - (Date.now() - fixtureGates.get(u.pathname));
      if (remaining > 0) {
        return new Response('<meta charset="utf-8"><title>Just a moment...</title><p>本地等待测试</p>' +
          '<script>setTimeout(()=>location.reload(),' + remaining + ')</script>', {
          status:403, headers:{'Content-Type':'text/html', 'cf-mitigated':'challenge'},
        });
      }
    }
    if (serveManagedPage && u.pathname === '/music/67234390') {
      serveManagedPage = false;
      return new Response('<title>Just a moment...</title><script>setTimeout(()=>location.reload(),43000)</script>', {
        status:403, headers:{'Content-Type':'text/html', 'cf-mitigated':'challenge'},
      });
    }
    const search = '<h1>测试搜索结果</h1>' + (twoClickFixture ? '<a href="/music/67234389">不可用版本</a><br>' : '')
      + '<a href="/music/67234390">测试音频</a>';
    const html = u.pathname.startsWith('/s/') ? search
      : twoClickFixture && /^\/music\/672343(?:89|90)$/.test(u.pathname) ? twoClickDetail(u.pathname.split('/').pop(), url)
      : u.pathname === '/music/67234390' ? detail : '';
    return new Response(html, {status:html ? 200 : 404, headers:{'Content-Type':'text/html; charset=utf-8'}});
  });
  if (twoClickFixture) assert.equal((await portalSession.fetch(origin + '/health')).status, 204, 'Local TLS fixture server must be reachable');
  return audio;
}

async function searchAndClick(ui, checkPortal) {
  const started = Date.now();
  await ui(`(async () => {
    document.getElementById('mediaMusicInput').value = ${JSON.stringify(query)};
    document.getElementById('mediaSearchMusic').click();
  })()`);
  let lastSearch = '';
  let retried = false;
  const results = await until(async () => {
    await checkPortal('search');
    const state = await ui('({ status:state.media.musicSearch.status, results:state.media.musicSearch.results, error:state.media.musicSearch.error, verificationShown:state.media.browserVisible })');
    const portal = webContents.getAllWebContents().find(w => /gequbao\.com/.test(w.getURL()));
    const phase = [state.status, state.verificationShown, portal?.getTitle()].join('|');
    if (phase !== lastSearch) console.log(JSON.stringify({ searchMs:Date.now()-started, phase }));
    lastSearch = phase;
    if (state.status === 'error' && state.error !== 'human-verification') {
      if (!retried && state.error === 'security-check-timeout' && process.argv.includes('--retry-search')) {
        await until(() => portal && !portal.isDestroyed() && !portal.musicManagedChallenge && !portal.isLoading()
          && !/请稍候|just a moment/i.test(portal.getTitle()), 'site to finish its own embedded verification', 165000);
        console.log('Retrying the same UI search after the site completed verification');
        retried = true;
        await ui('searchMediaMusic()');
        return false;
      }
      throw Error('Search failed: ' + state.error);
    }
    return state.status === 'ready' && state.results.length && state.results;
  }, 'search results', interactive ? verificationBudget + 60000 : (process.argv.includes('--retry-search') ? 265000 : 60000));
  const requestedId = songId || (twoClickFixture ? '67234390' : '');
  const index = requestedId ? results.findIndex(r => new URL(r.url).pathname === '/music/' + requestedId) : 0;
  assert(index >= 0, 'Requested track absent from real search results');
  const selected = results[index];
  console.log(JSON.stringify({ searchMs:Date.now()-started, count:results.length, selected }));
  const clicked = Date.now();
  if (twoClickFixture) {
    assert.equal(results[index].url.split('/').pop(), '67234390', 'The second search result must provide the file');
    const rejectedIndex = results.findIndex(r => r.url.endsWith('/67234389'));
    assert(rejectedIndex >= 0, 'Fixture must include the unavailable version');
    await ui(`window.downloadCheck = [];
      nativeAPI.onMediaDownloadProgress(e => downloadCheck.push({ at:Date.now(), id:e.id, name:e.name, status:e.status }));
      nativeAPI.onMediaBrowserState(e => {
        if (e.autoDownloadStarted) downloadCheck.push({ at:Date.now(), status:'announced-start' });
        if (e.popupBlocked) downloadCheck.push({ at:Date.now(), status:'popup-blocked' });
      });
      nativeAPI.onMediaPortalProgress(e => { if (e.operation==='download' && e.status==='success') downloadCheck.push({ at:Date.now(), status:'announced-success' }); });
      document.querySelector('[data-music-action="download"][data-music-index="${rejectedIndex}"]').click();`);
  }
  await ui(`document.querySelector('[data-music-action="download"][data-music-index="${index}"]').click()`);
  return {url:selected.url, label:selected.label, clicked};
}

async function run() {
  await app.whenReady();
  if (!fixture && process.env.XUANNIAN_MUSIC_INSPECT === '1') {
    app.on('web-contents-created', (_event, contents) => {
      contents.on('console-message', ({level, message, sourceId, lineNumber}) => {
        if (level !== 'error' || !/^https:\/\/(?:www\.)?gequbao\.com\/music\//.test(contents.getURL())) return;
        console.log(JSON.stringify({ pageError:String(message).replace(/https?:\S+/g, '[URL]').slice(0,220),
          file:URL.parse(sourceId)?.pathname.split('/').pop(), lineNumber }));
      });
    });
    session.fromPartition('persist:xuannian-media-portals').prependListener('will-download', (_event, item) => {
      const url = URL.parse(item.getURL());
      console.log(JSON.stringify({ downloadHost:url?.host, sameSongPage:/^\/music\/\d+\/?$/.test(url?.pathname || ''),
        mime:item.getMimeType(), filename:item.getFilename(), bytes:item.getTotalBytes() }));
    });
  }
  const htmlDownloads = [];
  if (twoClickFixture) {
    session.fromPartition('persist:xuannian-media-portals').prependListener('will-download', (_event, item) => {
      if (new URL(item.getURL()).pathname === '/music/67234390' && /^text\/html\b/i.test(item.getMimeType())) {
        const observed = { at:Date.now(), state:'' };
        htmlDownloads.push(observed);
        item.once('done', (_doneEvent, state) => { observed.state = state; });
      }
    });
  }
  const audio = fixture ? await installFixture() : null;
  const main = await until(() => BaseWindow.getAllWindows().find(w =>
    w.webContents && /index\.html/.test(w.webContents.getURL()) && !w.webContents.isLoading()
  ), 'application window', 20000);
  if (hiddenFixture) assert(!main.isVisible(), 'Fixture must start without showing a native window');
  if (hiddenFixture && verificationFixture) {
    main.setIgnoreMouseEvents(true);
    main.showInactive();
  }
  const ui = script => main.webContents.executeJavaScript(script);
  if (!fixture) {
    if (interactive) {
      main.center();
      main.setSkipTaskbar(false);
      const title = '玄念 · 歌曲宝验证测试';
      main.setTitle(title);
      main.webContents.on('page-title-updated', () => main.setTitle(title));
      if (keepWindow) main.once('close', () => app.exit(process.exitCode || 0));
    }
    main.show();
    main.focus();
    main.webContents.focus();
    if (keepWindow) console.log(JSON.stringify({window:main.getTitle(),visible:main.isVisible(),minimized:main.isMinimized(),bounds:main.getBounds()}));
  }
  await ui(`(async () => {
    localStorage.setItem('xuannian.onboarding.first-run.v1','seen');
    await switchView('media', {skipCoach:true});
    setMediaKind('audio');
  })()`);
  const portalState = observePortal(main, ui);
  let selected;
  if (detailOnly) {
    assert(/^\d+$/.test(songId), 'Direct detail diagnostic requires a numeric song ID');
    selected = {url:'https://www.gequbao.com/music/' + songId, clicked:Date.now()};
    console.log('Direct detail diagnostic: ' + selected.url);
    await ui(`nativeAPI.downloadMediaMusicResult(${JSON.stringify(selected.url)}, 'download', '', ${JSON.stringify(query)})`);
  } else {
    selected = await searchAndClick(ui, portalState.check);
  }
  const clicked = selected.clicked;
  let lastState = '';
  let lastDetail = '';
  let lastRead = 0;
  const task = await until(async () => {
    if (hiddenFixture) assert(BaseWindow.getAllWindows().every(w => !w.isVisible() || w === main && w.getOpacity() === 0 && !w.isFocused()), 'Fixture window became visible or focused');
    await portalState.check('download');
    const status = await ui(`({ task:state.media.downloadTasks.find(t=>t.sourceUrl===${JSON.stringify(selected.url)}), failure:state.media.browser.failureReason, verification:state.media.browser.verificationRequired })`);
    const portal = webContents.getAllWebContents().find(w => w.getURL().split(/[?#]/)[0] === selected.url);
    const phase = [status.task?.status, status.failure, status.verification, portal?.getTitle()].join('|');
    if (phase !== lastState) {
      console.log(JSON.stringify({ afterClickMs:Date.now()-clicked, phase }));
      lastState = phase;
    }
    if (process.env.XUANNIAN_MUSIC_INSPECT === '1' && Date.now() - lastRead >= 1200) {
      lastRead = Date.now();
      if (portal && !portal.isLoading() && !portal.musicManagedChallenge && !status.verification) {
        const detail = await portal.executeJavaScript(`(() => {
          if (!window.__qaOrdinaryCardChanges) {
            const history = window.__qaOrdinaryCardChanges = [];
            new MutationObserver(records => {
              const card = document.querySelector('a[data-normal-download]');
              if (!card || !records.some(r => r.target === card || card.contains(r.target))) return;
              const snapshot = [card.getAttribute('href') === '#' ? '#' : new URL(card.href).protocol, card.getAttribute('aria-busy'), card.innerText.trim().slice(-90)];
              if (JSON.stringify(history.at(-1)?.slice(1)) !== JSON.stringify(snapshot) && history.length < 50) history.push([Date.now(), ...snapshot]);
            }).observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true });
          }
          return {
          changes:window.__qaOrdinaryCardChanges,
          title: document.title,
          action: [...document.querySelectorAll('#btn-download-mp3')].map(x=>({
            element:x.tagName, classes:x.className, disabledAncestor:x.closest('.disabled,[inert],[aria-disabled="true"]')?.className || '',
            visibility:getComputedStyle(x).visibility, pointerEvents:getComputedStyle(x).pointerEvents,
            target:x.target||'', href:x.origin===location.origin?x.pathname:'', parents:[x.parentElement?.className,x.parentElement?.parentElement?.className],
          })),
          controls: [...document.querySelectorAll('button,a,input[type=button], [role=button]')].filter(x=>x.getClientRects().length && /下载|播放|试听|普通|品质|音质|线路|秒/.test(x.innerText || x.value) && !/网友刚刚/.test(x.innerText)).map(x=>[x.id,(x.innerText||x.value).trim().slice(0,70),!!x.disabled,x.hostname||'']).slice(0,18),
          normalCards: [...document.querySelectorAll('a[data-normal-download],[data-normal-download]')].filter(x=>x.getClientRects().length).map(x=>({
            tag:x.tagName,text:(x.innerText||x.textContent||'').trim().slice(0,120),link:x.getAttribute('href')==='#'?'#':URL.parse(x.href)?.origin,download:x.getAttribute('download')||'',
            ariaDisabled:x.getAttribute('aria-disabled')||'',ariaBusy:x.getAttribute('aria-busy')||'',
            className:String(x.className||'').slice(0,160),
          })),
          dialog: [...document.querySelectorAll('.modal, [role=dialog], dialog')].filter(x=>x.getClientRects().length).map(x=>x.innerText.trim().slice(0,180)),
          audio: [...document.querySelectorAll('audio')].map(x=>[x.readyState, x.currentSrc ? new URL(x.currentSrc).hostname : '']),
        }})()`).catch(() => null);
        const serialized = JSON.stringify(detail);
        if (serialized !== lastDetail) console.log(serialized);
        lastDetail = serialized;
      }
    }
    if (['error', 'cancelled', 'interrupted'].includes(status.task?.status)) {
      throw Error('Download failed: ' + phase);
    }
    return status.task?.status === 'completed' && status.task;
  }, 'completed download', interactive ? verificationBudget + 120000 : 120000);
  const relative = path.relative(downloads, task.path);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'File must be inside isolated downloads');
  const saved = fs.statSync(task.path);
  assert(saved.mtimeMs >= clicked - 1000, 'The selected download must be a newly saved file');
  const bytes = saved.size;
  assert(bytes > 0 && (!task.totalBytes || bytes === task.totalBytes), 'Incomplete audio file');
  if (audio) assert(audio.equals(fs.readFileSync(task.path)), 'Saved file must match every supplied fixture byte');
  if (twoClickFixture) {
    assert.deepEqual(buttonEvents.map(e => [e.id, e.stage]), [
      ['67234389', 'queue'], ['67234389', 'quality'],
      ['67234390', 'queue'], ['67234390', 'quality'], ['67234390', 'confirm'],
    ]);
    const [queued, quality, confirm] = buttonEvents.slice(-3);
    assert.equal(htmlDownloads.length, 1, 'The first ordinary click must trigger the detail HTML download');
    assert(htmlDownloads[0].state === 'cancelled' && htmlDownloads[0].at < confirm.at,
      'The app must reject the HTML download and still reach confirmation for the same song');
    assert(quality.at - queued.at >= 30000, 'The provider must finish the entire 30s countdown');
    const changes = await ui('downloadCheck');
    assert(changes.some(e => e.status === 'popup-blocked'), 'The popup with a different signature must be blocked');
    assert(fixtureRequests.every(r => r.granted), 'An unrelated link must never reach the download server');
    assert(fixtureRequests.some(r => r.tls && r.method === 'GET' && r.at >= confirm.at), 'The confirmed link must request audio over HTTPS');
    assert(changes.some(e => e.name === '不可用版本' && e.status === 'error'), 'First song must fail after the first quality click');
    const started = changes.filter(e => ['downloading', 'completed', 'announced-start', 'announced-success'].includes(e.status));
    assert(started.some(e => e.id === task.id && e.status === 'downloading'), 'Actual file transfer must report its start');
    assert(started.every(e => e.at >= confirm.at), 'Clicking the quality button alone must not mark a transfer as started');
    assert.equal(changes.filter(e => e.status === 'completed').length, 1);
    console.log(`Confirmed both post-queue steps. Queue ${quality.at - queued.at} ms; quality → confirmation ${confirm.at - quality.at} ms.`);
  }
  if (slowFixture) assert(Date.now() - clicked > 65000, 'Exercise the old shared verification and file deadline');
  if (verificationFixture) {
    assert(portalState.shown.has('search'), 'A persistent managed search check should open automatically inside the same window');
    assert(portalState.shown.has('download'), 'A persistent managed download check should open automatically inside the same window');
    assert(buttonEvents.find(e => e.id === '67234390' && e.stage === 'queue').at - fixtureGates.get('/music/67234390') >= 70000,
      'Music queue countdown must start after the entire site verification wait');
    assert.equal(await ui('state.media.browserVisible'), false, 'Finishing verification must return to the app for ordinary download');
  }
  const metadata = JSON.parse(nativeExec(mediaBinary('ffprobe'),
    ['-v','error','-select_streams','a:0','-show_entries','stream=codec_name:format=duration','-of','json',task.path], { encoding:'utf8' }));
  assert(metadata.streams[0]?.codec_name && Number(metadata.format.duration) > 0, 'No readable audio stream');
  nativeExec(mediaBinary('ffmpeg'), ['-v','error','-xerror','-i',task.path,'-map','0:a:0','-f','null','-']);
  portalState.assertPresentation();
  let evidence;
  if (interactive) {
    const artifacts = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(artifacts, {recursive:true});
    const runDirectory = fs.mkdtempSync(path.join(artifacts, 'music-live-'));
    evidence = path.join(runDirectory, path.basename(task.path));
    fs.copyFileSync(task.path, evidence, fs.constants.COPYFILE_EXCL);
  }
  console.log(JSON.stringify({ completedMs:Date.now()-clicked, source:selected.url, song:selected.label, name:task.name, bytes, evidence, ...metadata }));
}

const timeout = setTimeout(() => { console.error('Live download probe deadline'); app.exit(2); }, interactive ? verificationBudget * 2 + 210000 : 410000);
run().then(() => { if (!keepWindow) app.exit(0); }, error => {
  console.error(error);
  process.exitCode = 1;
  if (!keepWindow) app.exit(1);
}).finally(() => clearTimeout(timeout));
