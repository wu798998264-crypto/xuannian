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
      try { return new URL(String(value || ''), location.href).href; } catch { return ''; }
    };
    const httpUrl = (value) => {
      const url = absoluteUrl(value);
      return /^https?:\\/\\//i.test(url) ? url : '';
    };
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
      const matcher = /下载|解析|开始|搜索|download|parse|start|search/i;
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
        const disallowed = /(?:为什么|无法下载|下载失败|帮助|教程|常见问题|faq|how\s+to|support)/i.test(label) || /[?？]\s*$/.test(label);
        let score = quality >= 0 ? 100000 + quality : -1;
        if (disallowed) score = -1;
        if (!disallowed && score < 0 && !/(?:复制|copy|解析|parse|搜索|search|应用|app)/i.test(label) && /(?:下载|download|保存|save)/i.test(label)) score = 20;
        if (!disallowed && score < 0 && (element.hasAttribute('download') || mediaUrl(href))) score = 10;
        return { element, index, label, href, score };
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const previewUrl = () => {
      const video = [...document.querySelectorAll('video')].find(visible) || document.querySelector('video');
      const sources = [
        video?.currentSrc,
        video?.src,
        video?.querySelector?.('source')?.src,
        document.querySelector('meta[property="og:video:url"]')?.content,
        document.querySelector('meta[property="og:video"]')?.content,
        document.querySelector('meta[name="twitter:player:stream"]')?.content,
      ];
      for (const candidate of sources) {
        const url = httpUrl(candidate);
        if (url) return url;
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
    const findMusicDownload = () => [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(visible)
      .map((element) => ({ element, label: text(element), href: httpUrl(element.href || element.getAttribute('href')) }))
      .find((candidate) => /(?:下载歌曲|download\\s*song)/i.test(candidate.label) && !/(?:歌词|lyric)/i.test(candidate.label));

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
      action.click();
      resolve({ ok: true, stage: 'input', filled: true, submitted: true, continueAutomation: true, nextPhase: 'result' });
    };
    const attemptVideoResult = () => {
      if (humanVerificationRequired()) { resolve({ ok: false, stage: 'result', reason: 'human-verification' }); return; }
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
      const candidate = findMusicDownload();
      if (candidate) {
        if (mediaUrl(candidate.href)) resolve({ ok: true, stage: 'download', href: candidate.href, label: candidate.label, clicked: false });
        else { candidate.element.click(); resolve({ ok: true, stage: 'download', href: '', label: candidate.label, clicked: true }); }
        return;
      }
      if (Date.now() < deadline) pause(attemptMusicDownload, 240); else resolve({ ok: false, stage: 'download', reason: 'download-action-missing' });
    };

    if (mode === 'video-parse') {
      if (phase === 'result') attemptVideoResult(); else attemptVideoInput();
    } else if (mode === 'video-download') attemptVideoDownload();
    else if (mode === 'music-search') attemptMusicSearch();
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
