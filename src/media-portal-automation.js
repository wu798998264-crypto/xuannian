function safeJson(value) {
  return JSON.stringify(value == null ? '' : value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isMediaUrl(value) {
  return isHttpUrl(value) && /\.(?:mp4|m4v|mov|webm|mkv|mp3|m4a|wav|flac|aac|ogg)(?:[?#]|$)/i.test(String(value || ''));
}

function normalizedHost(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function classifyMediaPortalPopup(value, currentUrl = '') {
  if (!isHttpUrl(value)) return 'block';
  if (isMediaUrl(value)) return 'download';
  const targetHost = normalizedHost(value);
  const currentHost = normalizedHost(currentUrl);
  if (targetHost && currentHost && (targetHost === currentHost || targetHost.endsWith(`.${currentHost}`) || currentHost.endsWith(`.${targetHost}`))) {
    return 'same-site';
  }
  return 'block';
}

function buildPortalScript({ mode, value = '', phase = '', timeoutMs = 30000 } = {}, qualityScorer = () => -1) {
  const normalizedMode = String(mode || '');
  const normalizedPhase = String(phase || '');
  const deadlineMs = Math.max(1000, Math.min(60000, Number(timeoutMs) || 30000));
  const qualityScorerSource = typeof qualityScorer === 'function' ? qualityScorer.toString() : '(() => -1)';
  return `(() => new Promise((resolve) => {
    const mode = ${safeJson(normalizedMode)};
    const phase = ${safeJson(normalizedPhase)};
    const sourceValue = ${safeJson(String(value || ''))};
    const qualityScore = ${qualityScorerSource};
    const deadline = Date.now() + ${deadlineMs};
    const previewFallbackWaitMs = 2500;
    let previewFirstSeenAt = 0;
    const pause = (fn, delay = 220) => setTimeout(fn, delay);
    const text = (element) => String(element?.innerText || element?.textContent || element?.value || element?.getAttribute?.('aria-label') || '').trim();
    const visible = (element) => {
      if (!element || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 36 && rect.height > 16 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const absoluteUrl = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      try { return new URL(raw, location.href).href; } catch { return ''; }
    };
    const httpUrl = (value) => {
      const url = absoluteUrl(value);
      return /^https?:\\/\\//i.test(url) ? url : '';
    };
    const sameDocumentUrl = (value) => {
      try {
        const candidate = new URL(String(value || ''), location.href);
        const current = new URL(location.href);
        return candidate.origin === current.origin
          && candidate.pathname === current.pathname
          && candidate.search === current.search;
      } catch {
        return false;
      }
    };
    const portalToolNavigation = (value) => {
      try {
        const candidate = new URL(String(value || ''), location.href);
        const current = new URL(location.href);
        return candidate.hostname === current.hostname
          && candidate.pathname !== current.pathname
          && /(?:downloader|download-[a-z0-9-]+|[a-z0-9-]+-download)/i.test(candidate.pathname);
      } catch {
        return false;
      }
    };
    const platformFor = (value) => {
      const normalized = String(value || '').toLowerCase();
      if (/(?:douyin|iesdouyin)/.test(normalized)) return 'douyin';
      if (/(?:bilibili|b23\.tv)/.test(normalized)) return 'bilibili';
      if (/(?:xiaohongshu|xhslink|rednote)/.test(normalized)) return 'xiaohongshu';
      if (/(?:kuaishou|gifshow|kwai)/.test(normalized)) return 'kuaishou';
      if (/tiktok/.test(normalized)) return 'tiktok';
      if (/instagram/.test(normalized)) return 'instagram';
      if (/youtube|youtu\.be/.test(normalized)) return 'youtube';
      if (/facebook/.test(normalized)) return 'facebook';
      if (/twitter|x\.com/.test(normalized)) return 'twitter';
      return '';
    };
    const sourcePlatform = platformFor(sourceValue);
    const mediaUrl = (value) => {
      const url = httpUrl(value);
      return /\\.(?:mp4|m4v|mov|webm|mkv|mp3|m4a|wav|flac|aac|ogg)(?:[?#]|$)/i.test(url) ? url : '';
    };
    const installPopupGuards = () => {
      try { window.alert = () => undefined; } catch {}
      try { window.confirm = () => false; } catch {}
      try { window.prompt = () => null; } catch {}
    };
    installPopupGuards();
    const humanVerificationRequired = () => {
      const value = String(document.body?.innerText || '').slice(0, 5000);
      return /安全验证|验证您是真人|请验证您是真人|verify you are human|security verification|captcha|cloudflare/i.test(value);
    };
    const providerFailureReason = () => {
      const value = [...document.querySelectorAll('[role="alert"],[role="dialog"],.error,.alert,.toast,.modal,[class*="error-"],[class*="-error"],[class*="modal"],[class*="popup"]')]
        .filter(visible)
        .map(text)
        .join(' ')
        .slice(0, 3000);
      if (/(?:扫码|扫描).{0,18}(?:继续|下载|领取|验证)|(?:二维码|qr\\s*code).{0,18}(?:下载|继续|领取|验证)|scan.{0,18}(?:qr|code)/i.test(value)) return 'qr-code-required';
      if (/观看.{0,12}广告|广告.{0,12}(?:免费|次数|额度)|免费次数.{0,12}(?:用完|不足)|watch.{0,12}ad|free.{0,12}(?:quota|limit)/i.test(value)) return 'quota-or-ad-required';
      if (/受版权保护|私密内容|private content|copyright protected/i.test(value)) return 'protected-or-private';
      if (/链接无效|视频不存在|不支持.*链接|无法解析|解析失败|invalid link|not supported|failed to parse/i.test(value)) return 'provider-rejected';
      return '';
    };
    const scoreInput = (input) => {
      const hint = [input.placeholder, input.name, input.id, input.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
      let score = input.type === 'url' ? 12 : input.type === 'search' ? 6 : 2;
      if (/link|url|链接|粘贴|视频|地址|歌曲|歌手|搜索/.test(hint)) score += 20;
      if (/mail|phone|账号|password|密码/.test(hint)) score -= 40;
      return score;
    };
    const setInputValue = (input) => {
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(input, sourceValue); else input.value = sourceValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    };
    const findAction = (input) => {
      const scope = input?.closest('form') || input?.parentElement?.parentElement || document;
      const matcher = /下载|解析|获取|提取|开始|搜索|download|parse|extract|start|search/i;
      const local = [...scope.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
      return local.find((element) => matcher.test(text(element)))
        || [...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible).find((element) => matcher.test(text(element)));
    };
    const videoCandidates = () => [...document.querySelectorAll('button,[role="button"],a')]
      .filter(visible)
      .map((element, index) => {
        const label = text(element);
        const href = httpUrl(element.href || element.getAttribute('href'));
        const quality = qualityScore(label);
        const parserAction = element.getAttribute('data-xuannian-parser-action') === 'true';
        const inertSamePageLink = element.tagName === 'A' && !!href && sameDocumentUrl(href);
        const toolNavigationLink = element.tagName === 'A' && !!href && portalToolNavigation(href);
        const candidatePlatform = platformFor(label + ' ' + href);
        const mismatchedPlatformLink = element.tagName === 'A' && !!candidatePlatform && !!sourcePlatform && candidatePlatform !== sourcePlatform;
        const nearbyInput = element.closest('form')?.querySelector('input,textarea')
          || element.parentElement?.querySelector?.('input,textarea');
        const repeatsSourceInput = !!sourceValue && String(nearbyInput?.value || '').trim() === sourceValue.trim();
        const resultRoot = element.closest('[class*="result"],[class*="quality"],[class*="resolution"],[class*="download-item"],article,li,tr');
        const resultText = text(resultRoot);
        const hasResultEvidence = !!mediaUrl(href)
          || element.hasAttribute('download')
          || !!resultRoot?.querySelector?.('video,audio,img,source')
          || /(?:\d+(?:\.\d+)?\s*(?:gb|mb|kb)|\b(?:2160|1440|1080|720|480)\s*p?\b|原画|超清|高清|original|best|uhd|fhd|\bhd\b)/i.test(resultText);
        const hasDownloadAction = /(?:下载|保存|download|save)/i.test(label);
        const disallowed = parserAction
          || inertSamePageLink
          || toolNavigationLink
          || mismatchedPlatformLink
          || repeatsSourceInput
          || /(?:为什么|无法下载|下载失败|帮助|教程|常见问题|faq|how\s+to|support)/i.test(label)
          || /[?？]\s*$/.test(label);
        let score = quality >= 0 && (hasResultEvidence || hasDownloadAction) ? 100000 + quality : -1;
        if (disallowed) score = -1;
        if (!disallowed && hasResultEvidence && score < 0 && !/(?:复制|copy|解析|parse|搜索|search|应用|app)/i.test(label) && /(?:下载|download|保存|save)/i.test(label)) score = 20;
        if (!disallowed && score < 0 && (element.hasAttribute('download') || mediaUrl(href))) score = 10;
        return { element, index, label, href, score };
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const previewUrl = () => {
      const video = [...document.querySelectorAll('video')].find(visible) || document.querySelector('video');
      const sources = [
        { value: video?.currentSrc, trusted: Number(video?.readyState || 0) >= 1 },
        { value: video?.src, trusted: Number(video?.readyState || 0) >= 1 },
        { value: video?.querySelector?.('source')?.src, trusted: Number(video?.readyState || 0) >= 1 },
        { value: document.querySelector('meta[property="og:video:url"]')?.content, trusted: false },
        { value: document.querySelector('meta[property="og:video"]')?.content, trusted: false },
        { value: document.querySelector('meta[name="twitter:player:stream"]')?.content, trusted: false },
      ];
      for (const candidate of sources) {
        const url = httpUrl(candidate.value);
        if (url && !sameDocumentUrl(url) && (candidate.trusted || !!mediaUrl(url))) return url;
      }
      return videoCandidates().map((candidate) => mediaUrl(candidate.href)).find(Boolean) || '';
    };
    const videoTitle = () => {
      const heading = [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(text).find((value) => value.length > 1 && value.length < 160);
      return heading || String(document.title || '').trim().slice(0, 160);
    };
    const parseMusicResults = () => {
      const unique = new Map();
      for (const link of document.querySelectorAll('a[href*="/music/"]')) {
        if (!visible(link)) continue;
        const url = httpUrl(link.href || link.getAttribute('href'));
        if (!/^https?:\\/\\/(?:www\\.)?gequbao\\.com\\/music\\/\\d+(?:[/?#]|$)/i.test(url)) continue;
        const ownLabel = text(link).replace(/(?:播放\\s*&?\\s*下载|播放|下载)$/i, '').trim();
        const rowLabel = text(link.closest('tr,li,article,.row,.item') || link.parentElement).replace(/(?:播放\\s*&?\\s*下载|播放|下载)/gi, ' ').replace(/\\s+/g, ' ').trim();
        const label = ownLabel.length > 1 ? ownLabel : rowLabel;
        if (!label || /^(?:播放|下载|播放\\s*&?\\s*下载)$/i.test(label)) continue;
        const previous = unique.get(url);
        if (!previous || label.length > previous.label.length) unique.set(url, { url, label: label.slice(0, 180) });
      }
      return [...unique.values()].slice(0, 60).map((item, index) => {
        const parts = item.label.split(/\\s+-\\s+/);
        return { id: String(index + 1), url: item.url, title: (parts.shift() || item.label).trim(), artist: parts.join(' - ').trim(), label: item.label };
      });
    };
    const musicDownloadCandidates = () => [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(visible)
      .map((element, index) => {
        const label = text(element);
        const href = httpUrl(element.href || element.getAttribute('href'));
        const finalAction = /(?:下载)?(?:低品质|低音质|普通音质)\\s*mp3|备用线路/i.test(label);
        const score = finalAction ? 100 : (/下载歌曲|继续下载|download\\s*song|continue\\s*download/i.test(label) ? 20 : 10);
        return { element, index, label, href, finalAction, score };
      })
      .filter((candidate) => /(?:下载歌曲|继续下载|立即下载|普通下载|下载(?:低品质|低音质|普通音质)\\s*mp3|备用线路|download\\s*song|continue\\s*download)/i.test(candidate.label) && !/(?:歌词|lyric|无损|高清|高品质|推荐|网盘|夸克|阿里)/i.test(candidate.label))
      .sort((left, right) => {
        const directDifference = Number(!!mediaUrl(right.href)) - Number(!!mediaUrl(left.href));
        return directDifference || right.score - left.score || left.index - right.index;
      });
    const directAudioUrl = () => {
      const audio = document.querySelector('audio');
      const embedded = [audio?.currentSrc, audio?.src, audio?.querySelector?.('source')?.src]
        .map(httpUrl)
        .find(Boolean);
      if (embedded) return embedded;
      return [...document.querySelectorAll('a[href]')]
        .map((element) => mediaUrl(element.href))
        .find((url) => /\.(?:mp3|m4a|wav|flac|aac|ogg)(?:[?#]|$)/i.test(url)) || '';
    };

    const attemptVideoInput = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'input', reason: 'human-verification' }); return; }
      const inputs = [...document.querySelectorAll('input:not([type]),input[type="text"],input[type="url"],input[type="search"],textarea')]
        .filter((input) => !input.disabled && !input.readOnly && visible(input))
        .sort((left, right) => scoreInput(right) - scoreInput(left));
      const input = inputs[0];
      if (!input) {
        if (Date.now() < deadline) pause(attemptVideoInput); else resolve({ ok: false, stage: 'input', reason: 'input-missing' });
        return;
      }
      setInputValue(input);
      const action = findAction(input);
      if (!action) {
        if (Date.now() < deadline) pause(attemptVideoInput); else resolve({ ok: false, stage: 'input', reason: 'parse-action-missing' });
        return;
      }
      action.setAttribute('data-xuannian-parser-action', 'true');
      action.click();
      resolve({ ok: true, stage: 'input', filled: true, submitted: true, continueAutomation: true, nextPhase: 'result' });
    };
    const attemptVideoResult = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'result', reason: 'human-verification' }); return; }
      const providerFailure = providerFailureReason();
      if (providerFailure) { resolve({ ok: false, stage: 'result', reason: providerFailure }); return; }
      const candidates = videoCandidates();
      const preview = previewUrl();
      if (candidates.length) {
        const best = candidates[0];
        resolve({ ok: true, stage: 'result', previewUrl: preview, title: videoTitle(), downloadReady: true, downloadActionReady: true, qualityLabel: String(best.label || ''), qualityHref: String(best.href || '') });
        return;
      }
      if (preview) {
        if (!previewFirstSeenAt) previewFirstSeenAt = Date.now();
        if (Date.now() - previewFirstSeenAt >= previewFallbackWaitMs || Date.now() >= deadline) {
          resolve({ ok: true, stage: 'result', previewUrl: preview, title: videoTitle(), downloadReady: true, downloadActionReady: false, qualityLabel: '可直接下载当前预览', qualityHref: '' });
          return;
        }
      }
      if (Date.now() < deadline) pause(attemptVideoResult, 260); else resolve({ ok: false, stage: 'result', reason: 'parse-timeout' });
    };
    const attemptMusicSearch = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'results', reason: 'human-verification', results: [] }); return; }
      const results = parseMusicResults();
      if (results.length) { resolve({ ok: true, stage: 'results', results }); return; }
      if (Date.now() < deadline) pause(attemptMusicSearch, 240); else resolve({ ok: false, stage: 'results', reason: 'search-timeout', results: [] });
    };
    const attemptMusicPreview = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'preview', reason: 'human-verification' }); return; }
      const providerFailure = providerFailureReason();
      if (providerFailure) { resolve({ ok: false, stage: 'preview', reason: providerFailure }); return; }
      const direct = directAudioUrl();
      if (direct) { resolve({ ok: true, stage: 'preview', previewUrl: direct }); return; }
      const play = [...document.querySelectorAll('button,a,[role="button"]')]
        .filter(visible)
        .find((element) => /^(?:试听|播放|play)$/i.test(text(element)) && !element.hasAttribute('data-xuannian-preview-clicked'));
      if (play) {
        play.setAttribute('data-xuannian-preview-clicked', 'true');
        play.click();
      }
      if (Date.now() < deadline) pause(attemptMusicPreview, 240); else resolve({ ok: false, stage: 'preview', reason: 'preview-unavailable' });
    };
    const attemptVideoDownload = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'download', reason: 'human-verification' }); return; }
      const candidate = videoCandidates()[0];
      if (candidate) {
        if (mediaUrl(candidate.href)) resolve({ ok: true, stage: 'download', href: candidate.href, label: candidate.label, clicked: false });
        else { candidate.element.click(); resolve({ ok: true, stage: 'download', href: '', label: candidate.label, clicked: true }); }
        return;
      }
      if (Date.now() < deadline) pause(attemptVideoDownload, 240); else resolve({ ok: false, stage: 'download', reason: 'download-action-missing' });
    };
    const attemptMusicDownload = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'download', reason: 'human-verification' }); return; }
      const direct = directAudioUrl();
      if (direct) { resolve({ ok: true, stage: 'download', href: direct, label: '普通音质', clicked: false }); return; }
      const clicked = new WeakSet();
      let actionStarted = false;
      const waitForDownload = () => {
        if (humanVerificationRequired()) { resolve({ ok: false, stage: 'download', reason: 'human-verification' }); return; }
        const readyUrl = directAudioUrl();
        if (readyUrl) { resolve({ ok: true, stage: 'download', href: readyUrl, label: '普通音质', clicked: actionStarted }); return; }
        const candidate = musicDownloadCandidates().find((item) => !clicked.has(item.element));
        if (candidate) {
          const directHref = mediaUrl(candidate.href);
          if (directHref) { resolve({ ok: true, stage: 'download', href: directHref, label: candidate.label, clicked: actionStarted }); return; }
          clicked.add(candidate.element);
          actionStarted = true;
          candidate.element.click();
          if (candidate.finalAction) {
            resolve({ ok: true, stage: 'download', href: '', label: candidate.label, clicked: true, pending: true });
            return;
          }
        }
        if (Date.now() < deadline) pause(waitForDownload, 240);
        else if (actionStarted) resolve({ ok: true, stage: 'download', href: '', label: '普通音质', clicked: true, pending: true });
        else resolve({ ok: false, stage: 'download', reason: 'download-action-missing' });
      };
      waitForDownload();
    };

    if (mode === 'video-parse') {
      if (phase === 'result') attemptVideoResult(); else attemptVideoInput();
    } else if (mode === 'video-download') attemptVideoDownload();
    else if (mode === 'music-search') attemptMusicSearch();
    else if (mode === 'music-preview') attemptMusicPreview();
    else if (mode === 'music-download') attemptMusicDownload();
    else resolve({ ok: false, reason: 'unsupported-mode' });
  }))()`;
}

module.exports = {
  buildPortalScript,
  classifyMediaPortalPopup,
  isHttpUrl,
  isMediaUrl,
};
