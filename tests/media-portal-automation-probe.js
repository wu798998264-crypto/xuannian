const assert = require('assert');
const { app, BrowserWindow } = require('electron');
const { buildPortalScript, classifyMediaPortalPopup } = require('../src/media-portal-automation');
const { scoreMediaDownloadQualityLabel } = require('../src/media-library');

function fixtureUrl(body, script = '') {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body>${body}<script>${script}</script></body></html>`)}`;
}

function reportScriptError(script) {
  return `(${script}).catch((error) => ({ __error: String(error && (error.stack || error.message) || error) }))`;
}

async function loadFixture(win, body, script = '') {
  await win.loadURL(fixtureUrl(body, script));
  await win.webContents.executeJavaScript('document.readyState');
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const flowPopupDecisions = [];
  win.webContents.setWindowOpenHandler(({ url }) => {
    flowPopupDecisions.push(classifyMediaPortalPopup(url, 'https://www.hellotik.app/zh/douyin'));
    return { action: 'deny' };
  });

  await loadFixture(win, `
    <input id="source" type="url" placeholder="请粘贴视频链接进行解析" style="width:500px;height:42px">
    <button id="parse" style="width:120px;height:42px">解析视频</button>
    <div id="result"></div>
  `, `
    document.querySelector('#parse').addEventListener('click', () => {
      alert('unexpected');
      window.open('https://ads.example.com/popup');
      setTimeout(() => {
        document.querySelector('#result').innerHTML = '<video src="https://cdn.example.com/preview.mp4" style="width:480px;height:270px"></video><a href="https://cdn.example.com/video-720.mp4" style="display:inline-block;width:120px;height:32px">720P 下载</a><a href="https://cdn.example.com/video-1080.mp4" style="display:inline-block;width:160px;height:32px">1080P 无水印下载</a>';
      }, 350);
    });
  `);
  console.log('probe: video input');
  const inputResult = await win.webContents.executeJavaScript(reportScriptError(buildPortalScript({
    mode: 'video-parse', phase: 'input', value: 'https://v.douyin.com/test', timeoutMs: 3000,
  }, scoreMediaDownloadQualityLabel)), true);
  if (inputResult.__error) throw new Error(inputResult.__error);
  assert.strictEqual(inputResult.ok, true);
  assert.strictEqual(inputResult.nextPhase, 'result');
  console.log('probe: delayed video result');
  const parsed = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 5000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.previewUrl, 'https://cdn.example.com/preview.mp4');
  assert.strictEqual(parsed.downloadReady, true);
  assert.strictEqual(parsed.downloadActionReady, true);
  assert(parsed.qualityLabel.includes('1080P'));
  assert.strictEqual(parsed.candidateCount, 2);
  assert.deepStrictEqual(flowPopupDecisions, ['block']);
  console.log('probe: highest-quality download selection');
  const videoDownload = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'video-download', timeoutMs: 2000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(videoDownload.href, 'https://cdn.example.com/video-1080.mp4');
  const previewDownload = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'video-download', timeoutMs: 2000, candidateIndex: 1 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(previewDownload.href, 'https://cdn.example.com/video-720.mp4');

  await loadFixture(win, '<article class="result-card"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div>Tweet image JPG</div><a href="https://cdn.example.com/poster.jpg" style="display:block;width:160px;height:32px">JPG Download</a></article><article class="result-card"><video src="https://cdn.example.com/x-preview.mp4" style="width:320px;height:180px"></video><div>Video MP4</div><a href="https://cdn.example.com/x-video.mp4" style="display:block;width:160px;height:32px">MP4 Download</a></article>');
  console.log('probe: exclude image downloads from mixed social results');
  const mixedSocialResult = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://x.com/example/status/1', timeoutMs: 2000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(mixedSocialResult.ok, true);
  assert.strictEqual(mixedSocialResult.candidateCount, 1);
  assert(mixedSocialResult.qualityLabel.includes('MP4'));
  const mixedSocialDownload = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-download', value: 'https://x.com/example/status/1', timeoutMs: 2000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(mixedSocialDownload.href, 'https://cdn.example.com/x-video.mp4');

  await loadFixture(win, '<article class="result-card"><div>1080p Audio M4A</div><a href="https://cdn.example.com/track.m4a" style="display:block;width:160px;height:32px">1080p M4A Download</a></article><article class="result-card"><div>Video 360p MP4</div><a href="https://cdn.example.com/video-360.mp4" style="display:block;width:160px;height:32px">360p MP4 Download</a></article>');
  console.log('probe: exclude audio downloads from video candidates');
  const mixedMediaResult = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://www.youtube.com/watch?v=example', timeoutMs: 2000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(mixedMediaResult.ok, true);
  assert.strictEqual(mixedMediaResult.candidateCount, 1);
  const mixedMediaDownload = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-download', value: 'https://www.youtube.com/watch?v=example', timeoutMs: 2000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(mixedMediaDownload.href, 'https://cdn.example.com/video-360.mp4');

  await loadFixture(win, '<article class="result-card"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div>Photo post JPG</div><a href="https://cdn.example.com/photo.jpg" style="display:block;width:160px;height:32px">JPG Download</a></article>');
  console.log('probe: report image-only social result');
  const imageOnlySocialResult = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://x.com/example/status/2', timeoutMs: 2200,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(imageOnlySocialResult.ok, false);
  assert.strictEqual(imageOnlySocialResult.reason, 'content-not-video');

  await loadFixture(win, '<video src="https://cdn.example.com/preview-only.mp4" style="width:480px;height:270px"></video><a href="/help" style="display:block;width:180px;height:32px">为什么无法下载视频？</a><a href="/sound-help" style="display:block;width:180px;height:32px">下载的视频有声音吗？</a>');
  console.log('probe: preview-only direct-download fallback');
  const previewFallback = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 4000,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(previewFallback.ok, true);
  assert.strictEqual(previewFallback.downloadReady, true);
  assert.strictEqual(previewFallback.downloadActionReady, false);
  assert.strictEqual(previewFallback.previewUrl, 'https://cdn.example.com/preview-only.mp4');
  assert(!previewFallback.qualityLabel.includes('为什么'));

  await loadFixture(win, '<a href="/about" style="display:block;width:500px;height:80px">方便使用，只需要视频链接，就能解析出原生纯正的无水印视频</a>');
  console.log('probe: reject marketing copy as a quality result');
  const marketingCopy = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(marketingCopy.ok, false);
  assert.strictEqual(marketingCopy.reason, 'parse-timeout');

  await loadFixture(win, '<section><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><h2>多平台视频去水印免费下载</h2><p>高画质、极速、无水印，只需粘贴链接即可保存</p><button style="display:block;width:160px;height:32px">立即下载</button></section>');
  console.log('probe: reject generic marketing hero');
  const marketingHero = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(marketingHero.ok, false);
  assert.strictEqual(marketingHero.reason, 'parse-timeout');

  await loadFixture(win, '<article class="result-card"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><h2>立即下载 B站 视频/音频</h2><p>粘贴 B站视频链接，即可选择 MP4 视频或 MP3 音频下载，由 Seekin 提供。</p><button style="display:block;width:160px;height:32px">立即下载</button></article>');
  console.log('probe: reject provider landing card');
  const providerLanding = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(providerLanding.ok, false);
  assert.strictEqual(providerLanding.reason, 'parse-timeout');

  await loadFixture(win, '<article class="result-card"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><h2>Bilibili Video Download</h2><p>Free Bilibili video downloader, Without Watermark, Lossless Video Quality. Require bilibili sessdata to download 1080p.</p><button style="display:block;width:160px;height:32px">Download</button></article>');
  console.log('probe: reject VPN provider landing card');
  const vpnProviderLanding = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(vpnProviderLanding.ok, false);
  assert.strictEqual(vpnProviderLanding.reason, 'parse-timeout');

  await loadFixture(win, '<article class="download-item"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><h2>一键保存精彩 Reels</h2><p>使用 Seekin 免费下载 Instagram Reels，高清无水印，无需注册，快速便捷，立即开始吧！</p><button style="display:block;width:160px;height:32px">下载</button></article>');
  console.log('probe: reject specialized provider marketing card');
  const specializedProviderLanding = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(specializedProviderLanding.ok, false);
  assert.strictEqual(specializedProviderLanding.reason, 'parse-timeout');

  await loadFixture(win, `
    <a href="https://www.seekin.ai/zh/download-instagram-reels/" style="display:block;width:220px;height:32px">Instagram Reels下载</a>
    <button style="display:block;width:160px;height:32px">立即下载</button>
  `);
  console.log('probe: reject unrelated portal navigation');
  const unrelatedPortal = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://www.bilibili.com/bangumi/play/ep3854807/', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(unrelatedPortal.ok, false);
  assert.strictEqual(unrelatedPortal.reason, 'parse-timeout');

  await loadFixture(win, '<article class="result-card"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:80px;height:80px"><button id="generic-download" style="width:160px;height:32px">立即下载</button></article>');
  console.log('probe: accept evidenced generic download');
  const evidencedDownload = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://www.kuaishou.com/f/example', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(evidencedDownload.ok, true);
  assert.strictEqual(evidencedDownload.downloadActionReady, true);

  await loadFixture(win, '<div class="download-results"><div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:160px;height:90px"><h3>快手视频</h3><div>144p</div><button id="seekin-low" style="width:120px;height:34px">Download</button></div></div>');
  console.log('probe: accept Seekin 144p result');
  const seekinLowResult = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://www.kuaishou.com/f/example', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(seekinLowResult.ok, true);
  assert.strictEqual(seekinLowResult.candidateCount, 1);
  assert(seekinLowResult.qualityLabel.includes('144p'));

  await loadFixture(win, '<div><div><div><div><div><div><div><div><div><h3>Bilibili 视频</h3><span>Video (.MP4)</span><button id="seekin-bili" style="width:120px;height:34px">Download</button></div></div></div></div></div></div></div></div></div>');
  console.log('probe: accept deeply nested Seekin Bilibili result');
  const seekinBilibiliResult = await win.webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse', phase: 'result', value: 'https://www.bilibili.com/video/example', timeoutMs: 1100,
  }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(seekinBilibiliResult.ok, true);
  assert.strictEqual(seekinBilibiliResult.candidateCount, 1);
  assert(seekinBilibiliResult.qualityLabel.includes('Video (.MP4)'));

  await loadFixture(win, '<div id="results"></div>', `
    setTimeout(() => {
      document.querySelector('#results').innerHTML = '<a href="https://www.gequbao.com/music/101" style="display:block;width:320px;height:28px">测试歌曲 - 歌手甲</a><a href="https://www.gequbao.com/music/102" style="display:block;width:320px;height:28px">测试歌曲（现场版） - 歌手乙</a>';
    }, 300);
  `);
  console.log('probe: delayed music results');
  const musicResults = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'music-search', timeoutMs: 4000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(musicResults.ok, true);
  assert.strictEqual(musicResults.results.length, 2);
  assert.deepStrictEqual(musicResults.results.map((item) => item.title), ['测试歌曲', '测试歌曲（现场版）']);

  await loadFixture(win, '<audio src="https://cdn.example.com/test-song.mp3" style="width:320px;height:40px" controls></audio>');
  console.log('probe: music preview source');
  const musicPreview = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'music-preview', timeoutMs: 2000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(musicPreview.ok, true);
  assert.strictEqual(musicPreview.previewUrl, 'https://cdn.example.com/test-song.mp3');

  await loadFixture(win, '<div id="slot"></div>', `
    window.musicDownloaded = false;
    setTimeout(() => {
      document.querySelector('#slot').innerHTML = '<button id="download" style="width:120px;height:32px">下载歌曲</button>';
      document.querySelector('#download').addEventListener('click', () => {
        setTimeout(() => {
          document.querySelector('#slot').insertAdjacentHTML('beforeend', '<button id="low-quality" style="width:180px;height:42px">#2 下载低品质MP3</button>');
          document.querySelector('#low-quality').addEventListener('click', () => { window.musicDownloaded = true; });
        }, 240);
      });
    }, 280);
  `);
  console.log('probe: delayed music download quality dialog');
  const musicDownload = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'music-download', timeoutMs: 4000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(musicDownload.ok, true);
  assert.strictEqual(musicDownload.clicked, true);
  assert.strictEqual(await win.webContents.executeJavaScript('window.musicDownloaded'), true);

  await loadFixture(win, '<div style="width:200px;height:40px">no result</div>');
  console.log('probe: bounded parse timeout');
  const timeout = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 1100 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(timeout.ok, false);
  assert.strictEqual(timeout.reason, 'parse-timeout');

  console.log('probe: human-verification detection');
  await loadFixture(win, '<main><h1>正在进行安全验证</h1><button>请验证您是真人</button></main>');
  const verificationStartedAt = Date.now();
  const verification = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'music-search', timeoutMs: 4000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(verification.ok, false);
  assert.strictEqual(verification.reason, 'human-verification');
  assert(Date.now() - verificationStartedAt < 1000, 'human verification must stop polling immediately');

  console.log('probe: QR gate detection');
  await loadFixture(win, '<div role="dialog" style="display:block;width:360px;height:180px">请扫描二维码领取下载次数后继续下载</div>');
  const qrGateStartedAt = Date.now();
  const qrGate = await win.webContents.executeJavaScript(buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 4000 }, scoreMediaDownloadQualityLabel), true);
  assert.strictEqual(qrGate.ok, false);
  assert.strictEqual(qrGate.reason, 'qr-code-required');
  assert(Date.now() - qrGateStartedAt < 1000, 'QR gate must stop polling immediately');

  const popupWin = new BrowserWindow({ show: false, width: 600, height: 400 });
  const popupDecisions = [];
  popupWin.webContents.setWindowOpenHandler(({ url }) => {
    popupDecisions.push(classifyMediaPortalPopup(url, 'https://www.hellotik.app/zh/douyin'));
    return { action: 'deny' };
  });
  await popupWin.loadURL(fixtureUrl('<button id="popup">popup</button>', `document.querySelector('#popup').onclick=()=>window.open('https://ads.example.com/surprise')`));
  console.log('probe: popup blocking');
  await popupWin.webContents.executeJavaScript("document.querySelector('#popup').click()");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepStrictEqual(popupDecisions, ['block']);

  popupWin.destroy();
  win.destroy();
  console.log('media portal delayed-result, popup, preview, music-result and download probes passed');
  app.quit();
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
