const { app, BaseWindow, BrowserWindow, WebContentsView } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { buildPortalScript, classifyMediaPortalPopup, isMediaUrl } = require('../src/media-portal-automation');
const { bilibiliProgressiveApiUrl, detectVideoProvider, musicSearchUrl, scoreMediaDownloadQualityLabel } = require('../src/media-library');

const CASES = [
  {
    id: 'youtube',
    source: 'https://www.youtube.com/watch?v=na6NGPw4XWM',
  },
  {
    id: 'tiktok',
    source: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  },
  {
    id: 'instagram',
    source: 'https://www.instagram.com/reel/DA6o7HlpdXu/',
  },
  {
    id: 'twitter',
    source: 'https://x.com/CartelWatchNet/status/2026820063643447737',
  },
  {
    id: 'facebook',
    source: 'https://www.facebook.com/NASA/videos/nasa-2025-to-the-moon-mars-and-beyond/587352057218646/',
  },
  {
    id: 'douyin',
    source: '7.10 J@i.ca 10/01 srR:/ :4pm 《万物生》第01集 https://v.douyin.com/RSoqNxKyWQE/ 复制此链接，打开Dou音搜索，直接观看视频！',
  },
  {
    id: 'bilibili',
    source: '【凡人修仙传：第183话 慕兰之战07】 https://www.bilibili.com/bangumi/play/ep3854807/?share_source=copy_web',
  },
  {
    id: 'xiaohongshu',
    source: '34 【codex制作个人作品集网站 - 小羊同学 | 小红书】 https://www.xiaohongshu.com/discovery/item/6a4a67270000000006036794?source=webshare&xhsshare=pc_web&xsec_token=ABd96YY0cj_jBH0BmqTwPmcWsbYfoKVVjliEMnBZOiXgk=&xsec_source=pc_share',
  },
  {
    id: 'kuaishou',
    source: 'https://www.kuaishou.com/f/X-1NCQbuUPVIY1dm',
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = 25000) {
  let timer;
  try {
    await Promise.race([
      webContents.loadURL(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { webContents.stop(); } catch {}
          reject(new Error('page-load-timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runPortalAttemptWithTimeout(webContents, action, timeoutMs = 90000) {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          try { webContents.stop(); } catch {}
          resolve({ parsed: { ok: false, reason: 'portal-attempt-timeout' }, download: { ok: false, reason: 'portal-attempt-timeout' } });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeRemoteMedia(webContents, value) {
  const url = String(value || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'missing-direct-url' };
  const parsedUrl = new URL(url);
  const referer = /(?:^|\.)xhscdn\.com$/i.test(parsedUrl.hostname)
    ? 'https://www.xiaohongshu.com/'
    : (/(?:^|\.)(?:douyinvod\.com|bytev\.com|douyinpic\.com)$/i.test(parsedUrl.hostname)
      ? 'https://www.douyin.com/'
      : (/\/upgcxcode\//i.test(parsedUrl.pathname) ? 'https://www.bilibili.com/' : webContents.getURL()));
  try {
    const response = await webContents.session.fetch(url, {
      headers: {
        Range: 'bytes=0-65535',
        Referer: referer,
      },
    });
    const reader = response.body?.getReader();
    const chunk = reader ? await reader.read() : { value: null };
    try { await reader?.cancel(); } catch {}
    const contentType = response.headers.get('content-type') || '';
    const mediaResponse = /^(?:video|audio)\//i.test(contentType)
      || /application\/(?:octet-stream|force-download)/i.test(contentType)
      || isMediaUrl(response.url || url);
    return {
      ok: response.ok && mediaResponse && Number(chunk?.value?.byteLength || 0) > 0,
      status: response.status,
      contentType,
      bytes: Number(chunk?.value?.byteLength || 0),
    };
  } catch (error) {
    return new Promise((resolve) => {
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const request = client.get(url, {
        headers: {
          Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
          ...(process.env.REAL_MEDIA_DUMP_FULL === '1' ? {} : { Range: 'bytes=0-65535' }),
          Referer: referer,
          'User-Agent': webContents.getUserAgent(),
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          const contentType = String(response.headers['content-type'] || '');
          const bytes = chunks.reduce((total, chunk) => total + chunk.length, 0);
          let probePath = '';
          if (process.env.REAL_MEDIA_DUMP_PROBE === '1' && bytes > 0) {
            probePath = path.join(app.getPath('temp'), `xuannian-media-probe-${Date.now()}.m4s`);
            fs.writeFileSync(probePath, Buffer.concat(chunks));
          }
          const mediaResponse = /^(?:video|audio)\//i.test(contentType)
            || /application\/(?:octet-stream|force-download)/i.test(contentType)
            || isMediaUrl(url);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300 && mediaResponse && bytes > 0,
            status: response.statusCode,
            contentType,
            bytes,
            probePath,
            transport: 'node-http',
            sessionReason: String(error?.message || error),
          });
        });
        response.once('error', (nodeError) => resolve({ ok: false, reason: String(nodeError?.message || nodeError) }));
      });
      request.setTimeout(30000, () => request.destroy(new Error('node-probe-timeout')));
      request.once('error', (nodeError) => resolve({ ok: false, reason: String(nodeError?.message || nodeError) }));
    });
  }
}

async function resolvePlayablePopupUrl(webContents, popupUrl, sourceUrl) {
  const apiUrl = /\.m4s(?:[?#]|$)/i.test(String(popupUrl || ''))
    ? bilibiliProgressiveApiUrl(sourceUrl)
    : '';
  if (!apiUrl) return popupUrl;
  const response = await webContents.session.fetch(apiUrl, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.bilibili.com/',
      'User-Agent': webContents.getUserAgent(),
    },
  });
  if (!response.ok) return popupUrl;
  const payload = await response.json();
  return String(payload?.result?.durl?.find((item) => /^https?:\/\//i.test(String(item?.url || '')))?.url || popupUrl);
}

async function waitForTriggeredDownload(webContents, action, timeoutMs = 15000, sourceUrl = '') {
  return new Promise(async (resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.session.removeListener('will-download', onDownload);
      webContents.removeListener('xuannian-test-popup-download', onPopupDownload);
      resolve(value);
    };
    const onPopupDownload = async (url) => {
      const resolvedUrl = await resolvePlayablePopupUrl(webContents, url, sourceUrl);
      const probe = await probeRemoteMedia(webContents, resolvedUrl);
      finish({ ...probe, url: resolvedUrl, originalUrl: url, progressiveFallback: resolvedUrl !== url, transport: 'session-fetch' });
    };
    const onDownload = (_event, item, sourceWebContents) => {
      if (sourceWebContents !== webContents) return;
      const filename = String(item.getFilename() || '');
      const mimeType = String(item.getMimeType() || '');
      const url = String(item.getURL() || '');
      const videoDownload = /\.(?:mp4|m4s|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|ts|m2ts)(?:[?#]|$)/i.test(filename)
        || /\.(?:mp4|m4s|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|ts|m2ts)(?:[?#]|$)/i.test(url)
        || /^video\//i.test(mimeType);
      const result = { ok: videoDownload, filename, mimeType, url, reason: videoDownload ? '' : 'non-video-download' };
      if (!videoDownload) {
        item.cancel();
        finish(result);
        return;
      }
      if (process.env.REAL_MEDIA_SAVE_DOWNLOAD === '1') {
        const destination = path.join(app.getPath('temp'), `xuannian-real-media-${Date.now()}.mp4`);
        item.setSavePath(destination);
        item.once('done', (_doneEvent, state) => {
          const bytes = fs.existsSync(destination) ? fs.statSync(destination).size : 0;
          try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
          finish({ ...result, ok: state === 'completed' && bytes > 0, state, bytes });
        });
      } else {
        item.cancel();
        finish(result);
      }
    };
    const effectiveTimeoutMs = process.env.REAL_MEDIA_SAVE_DOWNLOAD === '1' ? Math.max(90000, timeoutMs) : timeoutMs;
    const timer = setTimeout(() => finish({ ok: false, reason: 'download-not-triggered' }), effectiveTimeoutMs);
    webContents.session.on('will-download', onDownload);
    webContents.once('xuannian-test-popup-download', onPopupDownload);
    try {
      const result = await action();
      if (result?.href) {
        const probe = await probeRemoteMedia(webContents, result.href);
        finish({ ...probe, href: result.href });
      } else if (!result?.ok) {
        finish({ ok: false, reason: result?.reason || 'download-action-failed' });
      }
    } catch (error) {
      finish({ ok: false, reason: String(error?.message || error) });
    }
  });
}

async function parseOnce(webContents, provider) {
  await loadUrlWithTimeout(webContents, provider.portalUrl);
  let inputResult;
  try {
    inputResult = await webContents.executeJavaScript(buildPortalScript({
      mode: 'video-parse',
      phase: 'input',
      value: provider.sourceUrl,
      timeoutMs: 30000,
      nativeSubmit: true,
    }, scoreMediaDownloadQualityLabel), true);
  } catch {
    inputResult = { ok: true, continueAutomation: true, nextPhase: 'result' };
  }
  if (!inputResult?.continueAutomation) return { parsed: inputResult, download: { ok: false, reason: 'input-stage-failed' } };
  if (inputResult.nativeSubmitRequired) {
    const point = inputResult.actionPoint || {};
    const x = Math.max(1, Math.min(1279, Math.round(Number(point.x || 0))));
    const y = Math.max(1, Math.min(899, Math.round(Number(point.y || 0))));
    webContents.focus();
    webContents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }
  if (process.env.REAL_MEDIA_DEBUG === 'input') {
    const debug = await webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[placeholder*="链接"],input[type="text"],textarea');
      return {
        input: input?.outerHTML || '',
        value: input?.value || '',
        parent: input?.parentElement?.outerHTML?.slice(0, 5000) || '',
        form: input?.closest('form')?.outerHTML?.slice(0, 8000) || '',
      };
    })()`, true);
    console.log('real media input debug ' + JSON.stringify({ inputResult, debug }));
    return { parsed: { ok: false, reason: 'debug-input-only' }, download: { ok: false, reason: 'debug-input-only' } };
  }
  await wait(1000);
  const parsed = await webContents.executeJavaScript(buildPortalScript({
    mode: 'video-parse',
    phase: 'result',
    value: provider.sourceUrl,
    timeoutMs: 45000,
  }, scoreMediaDownloadQualityLabel), true);
  if (!parsed?.ok) {
    if (process.env.REAL_MEDIA_DEBUG === '1') {
      const debug = await webContents.executeJavaScript(`(() => ({
        url: location.href,
        title: document.title,
        body: String(document.body?.innerText || '').slice(0, 5000),
        inputs: [...document.querySelectorAll('input,textarea')].map((element) => ({ type: element.type, value: element.value, placeholder: element.placeholder })),
        buttons: [...document.querySelectorAll('button,a,[role="button"]')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 20 && rect.height > 10;
        }).slice(0, 80).map((element) => String(element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 240)),
        downloadActions: [...document.querySelectorAll('button,a,[role="button"]')]
          .filter((element) => /download|下载/i.test(String(element.innerText || element.textContent || '')))
          .map((element) => ({
            tag: element.tagName,
            text: String(element.innerText || element.textContent || '').trim().slice(0, 300),
            outerHTML: element.outerHTML.slice(0, 1600),
            ancestors: Array.from({ length: 8 }, (_, index) => {
              let current = element;
              for (let depth = 0; current && depth <= index; depth += 1) current = current.parentElement;
              return current ? {
                tag: current.tagName,
                className: String(current.className || '').slice(0, 300),
                text: String(current.innerText || current.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 1000),
              } : null;
            }).filter(Boolean),
          })).slice(0, 12),
      }))()`, true);
      console.log('real media debug ' + JSON.stringify(debug));
    }
    return { parsed, download: { ok: false, reason: parsed?.reason || 'parse-failed' } };
  }
  const candidateCount = Math.max(1, Math.min(8, Number(parsed.candidateCount || 1)));
  const directUrl = parsed.qualityHref && isMediaUrl(parsed.qualityHref)
    ? parsed.qualityHref
    : parsed.previewUrl;
  let preview = { ok: false, reason: 'preview-not-triggered' };
  if (directUrl) {
    const directProbe = await probeRemoteMedia(webContents, directUrl);
    preview = directProbe;
    if (!parsed.downloadActionReady) return { parsed, preview, download: directProbe };
  }
  if (!parsed.downloadActionReady) return { parsed, preview, download: { ok: false, reason: 'no-download-source' } };
  if (process.env.REAL_MEDIA_DEBUG === 'download') {
    const debug = await webContents.executeJavaScript(`(() => [...document.querySelectorAll('button,a,[role="button"]')]
      .filter((element) => /download|下载/i.test(String(element.innerText || element.textContent || '')))
      .map((element) => ({
        tag: element.tagName,
        text: String(element.innerText || element.textContent || '').trim().slice(0, 500),
        href: element.href || element.getAttribute('href') || '',
        download: element.getAttribute('download') || '',
        outerHTML: element.outerHTML.slice(0, 1200),
        ancestors: Array.from({ length: 7 }, (_, depth) => {
          let current = element;
          for (let index = 0; current && index <= depth; index += 1) current = current.parentElement;
          return current ? {
            tag: current.tagName,
            className: String(current.className || '').slice(0, 240),
            text: String(current.innerText || current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
          } : null;
        }).filter(Boolean),
      })).slice(0, 20))()`, true);
    console.log('real media download debug ' + JSON.stringify(debug));
  }
  if (!preview.ok) {
    preview = await waitForTriggeredDownload(webContents, () => webContents.executeJavaScript(buildPortalScript({
      mode: 'video-download',
      value: provider.sourceUrl,
      timeoutMs: 20000,
      candidateIndex: candidateCount - 1,
    }, scoreMediaDownloadQualityLabel), true), 15000, provider.sourceUrl);
    preview.candidateIndex = candidateCount - 1;
  }
  if (!preview.ok) return { parsed, preview, download: { ok: false, reason: 'preview-download-failed' } };
  if (candidateCount === 1) return { parsed, preview, download: preview };
  let download = { ok: false, reason: 'download-not-triggered' };
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    download = await waitForTriggeredDownload(webContents, () => webContents.executeJavaScript(buildPortalScript({
      mode: 'video-download',
      value: provider.sourceUrl,
      timeoutMs: 20000,
      candidateIndex,
    }, scoreMediaDownloadQualityLabel), true), 15000, provider.sourceUrl);
    download.candidateIndex = candidateIndex;
    if (download.ok) break;
  }
  return { parsed, preview, download };
}

async function run() {
  await app.whenReady();
  const webPreferences = {
    partition: 'persist:xuannian-media-real-sites',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  };
  let window;
  if (process.env.REAL_MEDIA_WORKER_HOST === '1') {
    const host = new BaseWindow({
      show: false,
      x: -12000,
      y: -12000,
      width: 1280,
      height: 900,
      frame: false,
      focusable: false,
      skipTaskbar: true,
    });
    const view = new WebContentsView({ webPreferences });
    host.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
    view.setVisible(true);
    host.showInactive();
    window = {
      webContents: view.webContents,
      destroy() {
        try { host.contentView.removeChildView(view); } catch {}
        try { view.webContents.close(); } catch {}
        try { host.destroy(); } catch {}
      },
    };
  } else {
    window = new BrowserWindow({
      show: process.env.REAL_MEDIA_SHOW === '1',
      ...(process.env.REAL_MEDIA_OFFSCREEN === '1' ? { x: -12000, y: -12000 } : {}),
      width: 1280,
      height: 900,
      webPreferences,
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (process.env.REAL_MEDIA_DEBUG === 'download') console.log('real media popup ' + String(url || '').slice(0, 2000));
    if (classifyMediaPortalPopup(url, window.webContents.getURL()) === 'download') {
      setImmediate(() => window.webContents.emit('xuannian-test-popup-download', url));
    }
    return { action: 'deny' };
  });
  const results = [];
  const caseFilter = String(process.env.REAL_MEDIA_FILTER || '').trim().toLowerCase();
  const caseFilters = new Set(caseFilter.split(',').map((value) => value.trim()).filter(Boolean));
  const sourceOverride = String(process.env.REAL_MEDIA_SOURCE || '').trim();
  const activeCases = caseFilters.has('music') && caseFilters.size === 1 ? [] : CASES
    .filter((testCase) => !caseFilters.size || caseFilters.has(testCase.id))
    .map((testCase) => sourceOverride ? { ...testCase, source: sourceOverride } : testCase);
  for (const testCase of activeCases) {
    const provider = detectVideoProvider(testCase.source);
    if (!provider) {
      results.push({ id: testCase.id, attempt: 0, parsed: { ok: false, reason: 'provider-not-detected' } });
      continue;
    }
    const attemptLimit = Math.max(1, Math.min(3, Number(process.env.REAL_MEDIA_ATTEMPTS || 1)));
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      let result;
      let usedPortal = '';
      const routeResults = [];
      try {
        let routes = Array.isArray(provider.portals) && provider.portals.length
          ? provider.portals
          : [{ url: provider.portalUrl, label: 'primary' }, ...(provider.fallbackUrl ? [{ url: provider.fallbackUrl, label: 'fallback' }] : [])];
        const portalFilter = String(process.env.REAL_MEDIA_PORTAL || '').trim().toLowerCase();
        if (portalFilter) routes = routes.filter((route) => `${route.label || ''} ${route.url || ''}`.toLowerCase().includes(portalFilter));
        if (!routes.length) throw new Error(`portal-filter-not-found:${portalFilter}`);
        for (const route of routes) {
          usedPortal = route.label || route.url;
          result = await runPortalAttemptWithTimeout(window.webContents, () => parseOnce(window.webContents, { ...provider, portalUrl: route.url }));
          routeResults.push({
            label: usedPortal,
            parsed: !!result.parsed?.ok,
            reason: result.parsed?.reason || '',
            preview: !!result.preview?.ok,
            previewReason: result.preview?.reason || '',
            download: !!result.download?.ok,
            downloadReason: result.download?.reason || '',
          });
          if (result.parsed?.ok && result.preview?.ok && result.download?.ok) break;
        }
      } catch (error) {
        result = { parsed: { ok: false, reason: String(error?.message || error) }, download: { ok: false } };
      }
      results.push({
        id: testCase.id,
        attempt,
        usedPortal,
        routeResults,
        parsed: {
          ok: !!result.parsed?.ok,
          reason: result.parsed?.reason || '',
          title: String(result.parsed?.title || '').slice(0, 240),
          preview: !!result.parsed?.previewUrl,
          previewUrl: String(result.parsed?.previewUrl || '').slice(0, 500),
          quality: result.parsed?.qualityLabel || '',
          qualityHref: String(result.parsed?.qualityHref || '').slice(0, 500),
          action: !!result.parsed?.downloadActionReady,
          candidateCount: Number(result.parsed?.candidateCount || 0),
          qualityOptions: Array.isArray(result.parsed?.qualityOptions) ? result.parsed.qualityOptions.map((item) => String(item?.label || '').slice(0, 180)) : [],
        },
        previewDownload: result.preview,
        download: result.download,
      });
      console.log('real media probe ' + JSON.stringify(results[results.length - 1]));
      if (result.parsed?.ok && result.preview?.ok && result.download?.ok && process.env.REAL_MEDIA_REPEAT_SUCCESS !== '1') break;
    }
  }
  const skipMusic = caseFilters.size > 0 && !caseFilters.has('music');
  let music = skipMusic
    ? { skipped: true, search: { ok: true, reason: 'filtered' }, download: { ok: true, reason: 'filtered' } }
    : { search: { ok: false, reason: 'not-run' }, download: { ok: false, reason: 'not-run' } };
  if (!skipMusic) try {
    await loadUrlWithTimeout(window.webContents, musicSearchUrl('唯一 邓紫棋'));
    const search = await window.webContents.executeJavaScript(buildPortalScript({
      mode: 'music-search',
      value: '唯一 邓紫棋',
      timeoutMs: 30000,
    }, scoreMediaDownloadQualityLabel), true);
    music = { search, download: { ok: false, reason: 'no-result' } };
    if (search?.ok && search.results?.length) {
      const selected = search.results[0];
      await loadUrlWithTimeout(window.webContents, selected.url);
      const preview = await window.webContents.executeJavaScript(buildPortalScript({
        mode: 'music-preview',
        timeoutMs: 30000,
      }, scoreMediaDownloadQualityLabel), true);
      const download = await waitForTriggeredDownload(window.webContents, () => window.webContents.executeJavaScript(buildPortalScript({
        mode: 'music-download',
        timeoutMs: 55000,
      }, scoreMediaDownloadQualityLabel), true), 65000);
      music = {
        search: {
          ok: true,
          count: search.results.length,
          first: selected.label,
          preview: !!preview?.ok,
          previewReason: preview?.reason || '',
        },
        download,
      };
    }
  } catch (error) {
    music = { search: { ok: false, reason: String(error?.message || error) }, download: { ok: false } };
  }
  console.log('real music probe ' + JSON.stringify(music));
  window.destroy();
  const failed = results.filter((item) => !item.parsed?.ok || !item.previewDownload?.ok || !item.download?.ok);
  const musicFailed = !music.skipped && (!music.search?.ok || !music.download?.ok);
  console.log('real media probe summary ' + JSON.stringify({ total: results.length, failed: failed.length, musicFailed }));
  app.exit(failed.length || musicFailed ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
