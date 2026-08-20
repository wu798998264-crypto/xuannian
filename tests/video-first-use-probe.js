const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, webContents } = require('electron');

const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-first-video-'));
let probeSucceeded = false;
app.setName('XuanNianFirstVideoProbe');
app.setPath('appData', tempAppData);
const probeDownloads = path.join(tempAppData, 'Downloads');
const probeDocuments = path.join(tempAppData, 'Documents');
fs.mkdirSync(probeDownloads, { recursive: true });
fs.mkdirSync(probeDocuments, { recursive: true });
app.setPath('downloads', probeDownloads);
app.setPath('documents', probeDocuments);
process.env.XUANNIAN_DEBUG_LOG = '1';

require('../src/main');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    setMediaKind('video', { showPortal: true });
    const input = document.querySelector('#mediaVideoInput');
    input.value = 'https://v.douyin.com/RSoqNxKyWQE/';
    await parseMediaVideo();
    return true;
  })()`, true);

  let snapshot = null;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    snapshot = await window.webContents.executeJavaScript(`(() => ({
      status: state.media.videoParse.status,
      title: state.media.videoParse.title || '',
      downloadReady: !!state.media.videoParse.downloadReady,
      previewReady: !!(state.media.videoParse.previewUrl || state.media.videoParse.embeddedPreview),
      previewCached: !!state.media.videoParse.previewCached,
      qualityCount: state.media.videoParse.qualityOptions.length,
      mediaActions: (state.media.videoParse.mediaActions || []).map(action => ({label:action.label,href:action.href||'',candidateIndex:Number(action.candidateIndex??-1)})),
      error: state.media.videoParse.error || '',
      progress: document.querySelector('#mediaAutomationProgressText')?.textContent || '',
    }))()`, true);
    if (snapshot.status === 'ready' || snapshot.status === 'error') break;
    await wait(500);
  }

  // The download controls are published as soon as parsing succeeds. The optional
  // temporary preview is allowed to finish in the background afterwards.
  if (snapshot?.status === 'ready' && !snapshot.previewReady) {
    const previewDeadline = Date.now() + 90000;
    while (Date.now() < previewDeadline) {
      await wait(500);
      snapshot = await window.webContents.executeJavaScript(`(() => ({
        status: state.media.videoParse.status,
        title: state.media.videoParse.title || '',
        downloadReady: !!state.media.videoParse.downloadReady,
        previewReady: !!(state.media.videoParse.previewUrl || state.media.videoParse.embeddedPreview),
        previewCached: !!state.media.videoParse.previewCached,
        qualityCount: state.media.videoParse.qualityOptions.length,
        mediaActions: (state.media.videoParse.mediaActions || []).map(action => ({label:action.label,href:action.href||'',candidateIndex:Number(action.candidateIndex??-1)})),
        error: state.media.videoParse.error || '',
        progress: document.querySelector('#mediaAutomationProgressText')?.textContent || '',
      }))()`, true);
      if (snapshot.previewReady) break;
    }
  }

  if (snapshot?.status === 'ready' && !snapshot.previewCached) {
    const cacheDeadline = Date.now() + 90000;
    while (Date.now() < cacheDeadline) {
      await wait(500);
      const cached = await window.webContents.executeJavaScript('!!state.media.videoParse.previewCached', true);
      if (cached) {
        snapshot.previewCached = true;
        break;
      }
    }
  }

  const coverResult = snapshot?.status === 'ready'
    ? await window.webContents.executeJavaScript(`window.nativeAPI.downloadParsedMediaVideo('download','','image')`, true)
    : null;

  const elapsedMs = Date.now() - startedAt;
  const logFile = path.join(tempAppData, '玄念', 'xuannian-runtime.log');
  const runtimeLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const wakeCount = (runtimeLog.match(/video result visibility wake/g) || []).length;
  const recoveryCount = (runtimeLog.match(/media portal video recovery/g) || []).length;
  console.log(`first video parse probe ${JSON.stringify({ ...snapshot, coverResult, elapsedMs, wakeCount, recoveryCount })}`);
  if (snapshot?.status !== 'ready') {
    const portal = webContents.getAllWebContents().find((contents) => /(?:dlpanda\.com|seekin\.ai)/i.test(contents.getURL()));
    if (portal && !portal.isDestroyed()) {
      const page = await portal.executeJavaScript(`(() => ({
        url: location.href,
        title: document.title,
        visibility: document.visibilityState,
        body: String(document.body?.innerText || '').slice(0, 6000),
        controls: [...document.querySelectorAll('button,a,input,[role="button"]')].map(element => ({
          text: String(element.innerText || element.value || element.getAttribute('aria-label') || '').trim().slice(0, 180),
          type: element.type || '',
        })).filter(item => item.text).slice(0, 100),
      }))()`, true);
      const screenshotPath = path.join(tempAppData, 'first-video-provider.png');
      const image = await portal.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
      console.log(`first video provider debug ${JSON.stringify({ ...page, screenshotPath })}`);
    }
  }
  assert.strictEqual(snapshot?.status, 'ready', `first video parse failed: ${JSON.stringify(snapshot)}`);
  assert.strictEqual(snapshot.downloadReady, true, 'first video parse did not expose a download');
  assert.deepStrictEqual(snapshot.mediaActions.map(action => action.label), ['视频', '备用下载', '音频', '封面图片']);
  for (const action of snapshot.mediaActions.filter(item => !['备用下载', '封面图片'].includes(item.label))) {
    assert(action.href || action.candidateIndex >= 0, `${action.label} action is not downloadable: ${JSON.stringify(action)}`);
  }
  const coverAction = snapshot.mediaActions.find(action => action.label === '封面图片');
  const videoFallbackAvailable = snapshot.previewCached || snapshot.mediaActions.some(action => action.label === '备用下载' && !!action.href);
  assert(coverAction.href || coverAction.candidateIndex >= 0 || videoFallbackAvailable, `cover action has no source: ${JSON.stringify(snapshot)}`);
  assert(!/dlpanda\.com\/images\/logo/i.test(coverAction.href), 'the DLPanda logo must not be exposed as the video cover');
  assert.strictEqual(coverResult?.ok, true, `cover generation failed: ${JSON.stringify(coverResult)}`);
  assert.strictEqual(path.extname(String(coverResult.path || '')).toLowerCase(), '.png');
  assert.strictEqual(fs.existsSync(coverResult.path), true, 'generated cover file is missing');
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
