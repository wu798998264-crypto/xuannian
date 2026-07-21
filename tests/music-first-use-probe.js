const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, webContents } = require('electron');

const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-first-music-'));
let probeSucceeded = false;
app.setName('XuanNianFirstMusicProbe');
app.setPath('appData', tempAppData);
process.env.XUANNIAN_DEBUG_LOG = '1';

require('../src/main');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMainWindow(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .sort((left, right) => {
        const leftBounds = left.getBounds();
        const rightBounds = right.getBounds();
        return rightBounds.width * rightBounds.height - leftBounds.width * leftBounds.height;
      })[0];
    if (candidate && candidate.getBounds().width >= 700) return candidate;
    await wait(200);
  }
  throw new Error('main-window-not-created');
}

async function run() {
  await app.whenReady();
  const window = await findMainWindow();
  if (window.webContents.isLoading()) {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  }
  await window.webContents.executeJavaScript(`localStorage.setItem('xuannian.onboarding.first-run.v1','seen')`, true);
  const startedAt = Date.now();
  await window.webContents.executeJavaScript(`(async () => {
    await switchView('media', { skipCoach: true });
    setMediaKind('audio', { showPortal: true });
    const input = document.querySelector('#mediaMusicInput');
    input.value = '唯一 邓紫棋';
    await searchMediaMusic();
    return true;
  })()`, true);

  let snapshot = null;
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    snapshot = await window.webContents.executeJavaScript(`(() => ({
      status: state.media.musicSearch.status,
      count: state.media.musicSearch.results.length,
      error: state.media.musicSearch.error || '',
      progress: document.querySelector('#mediaAutomationProgressText')?.textContent || '',
    }))()`, true);
    if (snapshot.status === 'ready' && snapshot.count > 0) break;
    if (snapshot.status === 'error') break;
    await wait(500);
  }

  const elapsedMs = Date.now() - startedAt;
  const logFile = path.join(tempAppData, '玄念', 'xuannian-runtime.log');
  const runtimeLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const wakeCount = (runtimeLog.match(/music search visibility wake/g) || []).length;
  console.log(`first music search probe ${JSON.stringify({ ...snapshot, elapsedMs, wakeCount })}`);
  if (snapshot?.status !== 'ready') {
    const portal = webContents.getAllWebContents().find((contents) => /gequbao\.com/i.test(contents.getURL()));
    if (portal && !portal.isDestroyed()) {
      const page = await portal.executeJavaScript(`(() => ({
        url: location.href,
        title: document.title,
        body: String(document.body?.innerText || '').slice(0, 5000),
        controls: [...document.querySelectorAll('button,a,input,[role="button"]')].map(element => ({
          text: String(element.innerText || element.value || element.getAttribute('aria-label') || '').trim().slice(0, 180),
          type: element.type || '',
        })).filter(item => item.text).slice(0, 80),
      }))()`, true);
      const screenshotPath = path.join(tempAppData, 'first-music-provider.png');
      const image = await portal.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
      console.log(`first music provider debug ${JSON.stringify({ ...page, screenshotPath })}`);
    }
  }
  assert.strictEqual(snapshot?.status, 'ready', `first music search failed: ${JSON.stringify(snapshot)}`);
  assert(snapshot.count > 0, 'first music search returned no versions');
  assert(wakeCount <= 3, `visibility wake count exceeded limit: ${wakeCount}`);
  probeSucceeded = true;
  app.quit();
}

app.once('quit', () => {
  if (!probeSucceeded) return;
  try {
    fs.rmSync(tempAppData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {}
});

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
