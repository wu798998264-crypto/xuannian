const { app, BrowserWindow } = require('electron');
const { buildPortalScript, classifyMediaPortalPopup, isMediaUrl } = require('../src/media-portal-automation');
const { detectVideoProvider, musicSearchUrl, scoreMediaDownloadQualityLabel } = require('../src/media-library');

const CASES = [
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
    source: 'https://www.kuaishou.com/f/X-2Yx2wKCy7jxLZb',
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
  try {
    const response = await webContents.session.fetch(url, {
      headers: {
        Range: 'bytes=0-65535',
        Referer: webContents.getURL(),
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
    return { ok: false, reason: String(error?.message || error) };
  }
}

async function waitForTriggeredDownload(webContents, action, timeoutMs = 15000) {
  return new Promise(async (resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.session.removeListener('will-download', onDownload);
      resolve(value);
    };
    const onDownload = (_event, item, sourceWebContents) => {
      if (sourceWebContents !== webContents) return;
      const result = { ok: true, filename: item.getFilename(), url: item.getURL() };
      item.cancel();
      finish(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'download-not-triggered' }), timeoutMs);
    webContents.session.on('will-download', onDownload);
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
    }, scoreMediaDownloadQualityLabel), true);
  } catch {
    inputResult = { ok: true, continueAutomation: true, nextPhase: 'result' };
  }
  if (!inputResult?.continueAutomation) return { parsed: inputResult, download: { ok: false, reason: 'input-stage-failed' } };
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
      }))()`, true);
      console.log('real media debug ' + JSON.stringify(debug));
    }
    return { parsed, download: { ok: false, reason: parsed?.reason || 'parse-failed' } };
  }
  const directUrl = parsed.qualityHref && isMediaUrl(parsed.qualityHref)
    ? parsed.qualityHref
    : parsed.previewUrl;
  if (directUrl) {
    const directProbe = await probeRemoteMedia(webContents, directUrl);
    if (directProbe.ok || !parsed.downloadActionReady) return { parsed, download: directProbe };
  }
  if (!parsed.downloadActionReady) return { parsed, download: { ok: false, reason: 'no-download-source' } };
  if (process.env.REAL_MEDIA_DEBUG === 'download') {
    const debug = await webContents.executeJavaScript(`(() => [...document.querySelectorAll('button,a,[role="button"]')]
      .filter((element) => /download|下载/i.test(String(element.innerText || element.textContent || '')))
      .map((element) => ({
        tag: element.tagName,
        text: String(element.innerText || element.textContent || '').trim().slice(0, 500),
        href: element.href || element.getAttribute('href') || '',
        download: element.getAttribute('download') || '',
        outerHTML: element.outerHTML.slice(0, 1200),
      })).slice(0, 20))()`, true);
    console.log('real media download debug ' + JSON.stringify(debug));
  }
  let download = { ok: false, reason: 'download-not-triggered' };
  const candidateCount = Math.max(1, Math.min(8, Number(parsed.candidateCount || 1)));
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    download = await waitForTriggeredDownload(webContents, () => webContents.executeJavaScript(buildPortalScript({
      mode: 'video-download',
      value: provider.sourceUrl,
      timeoutMs: 20000,
      candidateIndex,
    }, scoreMediaDownloadQualityLabel), true));
    download.candidateIndex = candidateIndex;
    if (download.ok) break;
  }
  return { parsed, download };
}

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: 'persist:xuannian-media-real-sites',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (process.env.REAL_MEDIA_DEBUG === 'download') console.log('real media popup ' + String(url || '').slice(0, 2000));
    if (classifyMediaPortalPopup(url, window.webContents.getURL()) === 'download') {
      setImmediate(() => window.webContents.downloadURL(url));
    }
    return { action: 'deny' };
  });
  const results = [];
  const caseFilter = String(process.env.REAL_MEDIA_FILTER || '').trim().toLowerCase();
  const sourceOverride = String(process.env.REAL_MEDIA_SOURCE || '').trim();
  const activeCases = caseFilter === 'music' ? [] : CASES
    .filter((testCase) => !caseFilter || testCase.id === caseFilter)
    .map((testCase) => sourceOverride ? { ...testCase, source: sourceOverride } : testCase);
  for (const testCase of activeCases) {
    const provider = detectVideoProvider(testCase.source);
    if (!provider) {
      results.push({ id: testCase.id, attempt: 0, parsed: { ok: false, reason: 'provider-not-detected' } });
      continue;
    }
    const attemptLimit = Math.max(1, Math.min(3, Number(process.env.REAL_MEDIA_ATTEMPTS || 2)));
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
            download: !!result.download?.ok,
            downloadReason: result.download?.reason || '',
          });
          if (result.parsed?.ok && result.download?.ok) break;
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
          preview: !!result.parsed?.previewUrl,
          previewUrl: String(result.parsed?.previewUrl || '').slice(0, 500),
          quality: result.parsed?.qualityLabel || '',
          qualityHref: String(result.parsed?.qualityHref || '').slice(0, 500),
          action: !!result.parsed?.downloadActionReady,
          candidateCount: Number(result.parsed?.candidateCount || 0),
        },
        download: result.download,
      });
      console.log('real media probe ' + JSON.stringify(results[results.length - 1]));
    }
  }
  const skipMusic = !!caseFilter && caseFilter !== 'music';
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
  const failed = results.filter((item) => !item.parsed?.ok || !item.download?.ok);
  const musicFailed = !music.skipped && (!music.search?.ok || !music.download?.ok);
  console.log('real media probe summary ' + JSON.stringify({ total: results.length, failed: failed.length, musicFailed }));
  app.exit(failed.length || musicFailed ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
