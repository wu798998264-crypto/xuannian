// This function is serialized into the isolated provider page. Keep its DOM
// reads self-contained so search extraction and verification use identical rules.
function readMusicPage() {
  const text = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.closest?.('[hidden],[aria-hidden="true"]')) return false;
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rectangle.width > 0 && rectangle.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const unique = new Map();
  for (const element of document.querySelectorAll('a[href*="/music/"],[data-href*="/music/"],[data-url*="/music/"]')) {
    if (element.closest('#guess-section,#guess-musics-list,.guess-music-section,.guess-song-card')) continue;
    if (!visible(element)) continue;
    const raw = element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url');
    let url;
    try { url = new URL(String(raw || ''), location.href); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?gequbao\.com$/i.test(url.hostname)
      || !/^\/music\/\d+(?:\/|$)/i.test(url.pathname) || url.username || url.password) continue;
    const row = element.closest('tr,li,article,.row,.item,[class*="song"],[class*="music"],[class*="result"]') || element.parentElement;
    const clean = label => label.replace(/(?:播放\s*&?\s*下载|播放|下载)/gi, ' ').replace(/\s+/g, ' ').trim();
    const titleLabel = clean(String(element.getAttribute('title') || ''));
    const ownLabel = clean(text(element));
    const label = (titleLabel || ownLabel || clean(text(row))).slice(0, 180);
    if (!label) continue;
    const prior = unique.get(url.href);
    if (!prior || prior.label.length < label.length) unique.set(url.href, { url: url.href, label });
  }
  const results = [...unique.values()].slice(0, 60).map((item, index) => {
    const parts = item.label.split(/\s+-\s+/);
    return { ...item, id: String(index + 1), title: (parts.shift() || item.label).trim(), artist: parts.join(' - ').trim() };
  });
  const body = text(document.body).slice(0, 12000);
  const instruction = /请(?:点击|勾选|完成|通过|进行).{0,24}(?:验证|验证码)|验证(?:您|你)是(?:真人|人类)|确认(?:您|你)是(?:真人|人类)|verify (?:that )?you (?:are|’re|'re) human|complete (?:the )?(?:captcha|security check)|select all (?:images|squares)/i.test(body);
  const interactive = [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="turnstile"],iframe[src*="challenges.cloudflare.com"],input[name*="captcha"],input[id*="captcha"],input[type="checkbox"],.g-recaptcha,.h-captcha')].some(visible);
  const blockingTitle = /just a moment|attention required|security (?:check|verification)|安全验证|人机验证|请稍候/i.test(String(document.title || ''));
  const automaticText = /正在(?:进行)?(?:安全)?验证|正在检查|checking (?:your )?browser|performing security verification|enable javascript and cookies|verifying (?:you|your browser)/i.test(body);
  const challengeScript = !!document.querySelector('script[src*="/cdn-cgi/challenge-platform/"],#challenge-running,#challenge-form,#cf-challenge-running');
  // A site footer mentioning Cloudflare or an inactive CAPTCHA container is
  // neither a blocking page nor a request for the user to solve a challenge.
  const requiresHuman = instruction && (interactive || blockingTitle || !results.length)
    || !results.length && blockingTitle && interactive;
  const challenge = requiresHuman || (!results.length && (blockingTitle || automaticText && challengeScript));
  return { url: location.href, readyState: document.readyState, results, challenge, requiresHuman, automaticCheck: challenge && !requiresHuman };
}

function buildMusicPageSnapshotScript({ observe = false } = {}) {
  return `(() => {
    const read = (${readMusicPage.toString()});
    const key = '__xuannianMusicPageV3';
    if (${observe ? 'true' : 'false'} && !window[key]) {
      let queued = false;
      const publish = () => { queued = false; window[key].snapshot = read(); window.__xuannianLastMusicMutationAt = Date.now(); };
      const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(publish);
      });
      window[key] = { observer, snapshot: null };
      observer.observe(document.documentElement || document, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'data-href', 'data-url', 'class', 'style', 'hidden', 'aria-hidden'],
      });
      window.addEventListener('pageshow', publish, { passive: true });
      window.addEventListener('popstate', publish, { passive: true });
    }
    const snapshot = read();
    if (window[key]) window[key].snapshot = snapshot;
    return snapshot;
  })()`;
}

function isMusicSearchDocument(actual, expected) {
  try {
    const normalize = value => {
      const url = new URL(value);
      return [url.hostname.toLowerCase().replace(/^www\./, ''), decodeURIComponent(url.pathname).replace(/\/+$/, ''), url.search].join('|');
    };
    return normalize(actual) === normalize(expected);
  } catch { return false; }
}

module.exports = { readMusicPage, buildMusicPageSnapshotScript, isMusicSearchDocument };
