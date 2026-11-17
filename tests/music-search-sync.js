const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  readMusicPage,
  buildMusicPageSnapshotScript,
  isMusicSearchDocument,
} = require('../src/music-page');
const { buildPortalScript } = require('../src/media-portal-automation');

// Small DOM fixtures model the observable parts of a normal search page. The
// observer delivers only mutations requested by the production observe options.
function createPage({ url = 'https://www.gequbao.com/s/唯一', title = '唯一 - 搜索结果', body = '' } = {}) {
  const nodes = [];
  const observers = [];
  const microtasks = [];
  const timers = [];
  const events = new Map();
  let now = 1000;
  const location = new URL(url);
  const documentElement = {};

  function matchesOne(node, selector) {
    if (selector.startsWith('#')) return node.getAttribute('id') === selector.slice(1);
    if (selector.startsWith('.')) return String(node.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1));
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/g)) {
      const actual = node.getAttribute(match[1]);
      if (actual === null || (match[2] === '=' && actual !== match[3]) || (match[2] === '*=' && !actual.includes(match[3]))) return false;
    }
    return !!tag || selector.startsWith('[');
  }

  function matches(node, selectors) {
    return selectors.split(',').some(selector => matchesOne(node, selector.trim()));
  }

  function notifyMutation(target, attributeName) {
    for (const observer of observers) {
      const options = observer.options;
      if (!options || !options.attributes) continue;
      if (options.attributeFilter && !options.attributeFilter.includes(attributeName)) continue;
      observer.callback([{ type: 'attributes', target, attributeName }], observer);
    }
  }

  function element({ tag = 'a', text = '', attributes = {}, width = 28, height = 20, style = {}, parent = null } = {}) {
    const attrs = { ...attributes };
    const node = {
      tagName: tag.toUpperCase(),
      innerText: text,
      textContent: text,
      parentElement: parent,
      style: { display: 'inline', visibility: 'visible', opacity: '1', ...style },
      getAttribute(name) { return Object.hasOwn(attrs, name) ? String(attrs[name]) : null; },
      setAttribute(name, value) { attrs[name] = String(value); notifyMutation(node, name); },
      getBoundingClientRect() { return { x: 0, y: 0, width, height }; },
      closest(selectors) {
        let current = node;
        while (current) {
          if (matches(current, selectors)) return current;
          current = current.parentElement;
        }
        return null;
      },
    };
    nodes.push(node);
    return node;
  }

  const document = {
    title,
    readyState: 'complete',
    documentElement,
    body: { innerText: body, textContent: body },
    querySelectorAll(selector) { return nodes.filter(node => matches(node, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  const window = {
    addEventListener(name, handler) { events.set(name, [...(events.get(name) || []), handler]); },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
  }
  class ClockDate extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    document,
    window,
    location,
    URL,
    Date: ClockDate,
    MutationObserver,
    getComputedStyle: node => node.style,
    queueMicrotask: callback => microtasks.push(callback),
    setTimeout: (callback, delay = 0) => { timers.push({ callback, delay }); return timers.length; },
  });
  return {
    element, document, window, location, observers, timers, events,
    evaluate(script) { return vm.runInContext(script, context); },
    read() { return this.evaluate(`(${readMusicPage.toString()})()`); },
    flushMicrotasks() { while (microtasks.length) microtasks.shift()(); },
    runNextTimer() {
      assert(timers.length > 0, 'Expected the search to keep waiting.');
      const timer = timers.shift();
      now += timer.delay;
      timer.callback();
    },
    addResult({ href = '/music/35660', label = '唯一', ...options } = {}) {
      return element({ text: label, attributes: { href }, ...options });
    },
  };
}

function assertSingleResult(snapshot, title = '唯一') {
  assert.equal(snapshot.results.length, 1);
  assert.equal(snapshot.results[0].title, title);
  assert.equal(snapshot.results[0].url, 'https://www.gequbao.com/music/35660');
}

async function run() {
  const shortSong = createPage({ body: '搜索结果 共20首 Powered by Cloudflare' });
  shortSong.addResult({ width: 28 });
  const shortSnapshot = shortSong.read();
  assertSingleResult(shortSnapshot);
  assert.equal(shortSnapshot.requiresHuman, false);
  assert.equal(shortSnapshot.challenge, false);
  const shortSearch = await shortSong.evaluate(buildPortalScript({ mode: 'music-search', timeoutMs: 1000 }));
  assert.equal(shortSearch.ok, true);
  assertSingleResult(shortSearch);

  // Real provider markup: recommendation cards use the same /music/ URLs as
  // search rows, including duplicates with a numbered label.
  const recommendations = createPage({ body: '唯一 邓紫棋 搜索结果 共7首 猜你想找' });
  const searchBody = recommendations.element({ tag: 'div', attributes: { class: 'card-body' } });
  const searchRows = recommendations.element({ tag: 'div', attributes: { class: 'card-text' }, parent: searchBody });
  for (let index = 0; index < 7; index += 1) {
    const row = recommendations.element({ tag: 'div', text: `歌曲${index} - 歌手${index} 播放&下载 额外行信息`, attributes: { class: 'row no-gutters py-2d5 border-top align-items-center' }, parent: searchRows });
    const attributes = { href: `/music/${35660 + index}`, title: `歌曲${index} - 歌手${index}` };
    recommendations.element({ text: `歌曲${index}\n-\n歌手${index}`, attributes: { ...attributes, class: 'hover-zoom d-block text-decoration-none' }, parent: row });
    recommendations.element({ text: '播放&下载', attributes, parent: row });
  }
  const guessSection = recommendations.element({ tag: 'div', attributes: { id: 'guess-section', class: 'card mb-3 guess-music-section is-visible' } });
  const guessBody = recommendations.element({ tag: 'div', attributes: { class: 'card-body' }, parent: guessSection });
  const guessList = recommendations.element({ tag: 'div', attributes: { id: 'guess-musics-list', class: 'guess-song-grid' }, parent: guessBody });
  for (let index = 0; index < 5; index += 1) {
    recommendations.element({ text: `0${index + 1} 推荐歌曲 推荐歌手`, attributes: { href: `/music/${35662 + index * 10}`, class: 'guess-song-card' }, parent: guessList });
  }
  const mainResults = recommendations.read().results;
  assert.equal(mainResults.length, 7, 'Recommendations must neither add rows nor replace an existing result label.');
  assert.deepEqual(Array.from(mainResults, result => [result.title, result.artist]), Array.from({ length: 7 }, (_, index) => [`歌曲${index}`, `歌手${index}`]));
  const recommendationOnly = createPage({ body: '猜你想找' });
  const recommendationRoot = recommendationOnly.element({ tag: 'div', attributes: { id: 'guess-section' } });
  recommendationOnly.addResult({ label: '01 唯一 G.E.M. 邓紫棋', parent: recommendationRoot });
  assert.equal(recommendationOnly.read().results.length, 0, 'A recommendation-only page must not complete an empty search.');

  const hiddenCaptcha = createPage({ body: '搜索结果 Cloudflare captcha' });
  hiddenCaptcha.addResult();
  const hiddenParent = hiddenCaptcha.element({ tag: 'div', attributes: { hidden: '' } });
  hiddenCaptcha.element({ tag: 'iframe', attributes: { src: 'https://challenges.cloudflare.com/captcha' }, parent: hiddenParent, width: 320, height: 160 });
  hiddenCaptcha.element({ tag: 'input', attributes: { type: 'checkbox' }, style: { display: 'none' } });
  hiddenCaptcha.element({ tag: 'div', attributes: { class: 'g-recaptcha', 'aria-hidden': 'true' }, width: 320, height: 160 });
  assert.equal(hiddenCaptcha.read().requiresHuman, false, 'Inactive challenge containers must not request human verification.');
  assert.equal(hiddenCaptcha.read().challenge, false);
  assert.equal((await hiddenCaptcha.evaluate(buildPortalScript({ mode: 'music-search', timeoutMs: 1000 }))).ok, true);

  const automatic = createPage({ title: 'Just a moment...', body: '正在进行安全验证，Checking your browser' });
  automatic.element({ tag: 'script', attributes: { src: '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1' } });
  const automaticSnapshot = automatic.read();
  assert.equal(automaticSnapshot.challenge, true);
  assert.equal(automaticSnapshot.automaticCheck, true);
  assert.equal(automaticSnapshot.requiresHuman, false, 'Managed browser checking must not be classified as an instruction to solve a CAPTCHA.');
  const pendingSearch = automatic.evaluate(buildPortalScript({ mode: 'music-search', timeoutMs: 1000 }));
  assert.equal(automatic.timers.length, 1, 'Automatic checking should leave the search pending.');
  automatic.document.title = '唯一 - 搜索结果';
  automatic.document.body.innerText = '搜索结果 Cloudflare';
  automatic.addResult();
  automatic.runNextTimer();
  const resumedSearch = await pendingSearch;
  assert.equal(resumedSearch.ok, true);
  assertSingleResult(resumedSearch);

  const human = createPage({ title: 'Security verification', body: '请勾选复选框以验证您是真人' });
  human.element({ tag: 'input', attributes: { type: 'checkbox' }, width: 18, height: 18 });
  const humanSnapshot = human.read();
  assert.equal(humanSnapshot.requiresHuman, true);
  assert.equal(humanSnapshot.challenge, true);
  assert.equal(humanSnapshot.automaticCheck, false);
  const pausedSearch = await human.evaluate(buildPortalScript({ mode: 'music-search', timeoutMs: 1000 }));
  assert.equal(pausedSearch.ok, false);
  assert.equal(pausedSearch.reason, 'human-verification');
  assert.equal(human.timers.length, 0, 'Interactive verification must stop automatic search attempts.');

  const deferredLink = createPage();
  const pendingLink = deferredLink.element({ text: '唯一', attributes: {} });
  const snapshotScript = buildMusicPageSnapshotScript({ observe: true });
  assert.equal(deferredLink.evaluate(snapshotScript).results.length, 0);
  assert.equal(deferredLink.observers.length, 1);
  const observation = deferredLink.observers[0];
  assert.equal(observation.target, deferredLink.document.documentElement);
  assert.equal(observation.options.attributes, true);
  assert.equal(observation.options.subtree, true);
  for (const attribute of ['href', 'data-href', 'data-url', 'class', 'style', 'hidden', 'aria-hidden']) {
    assert(observation.options.attributeFilter.includes(attribute), `Observer must notice ${attribute} changes.`);
  }
  pendingLink.setAttribute('href', '/music/35660');
  deferredLink.flushMicrotasks();
  assertSingleResult(deferredLink.window.__xuannianMusicPageV3.snapshot);
  pendingLink.setAttribute('hidden', '');
  deferredLink.flushMicrotasks();
  assert.equal(deferredLink.window.__xuannianMusicPageV3.snapshot.results.length, 0, 'Snapshot must drop a row that became hidden.');
  deferredLink.evaluate(snapshotScript);
  assert.equal(deferredLink.observers.length, 1, 'Polling snapshots must not install duplicate observers.');
  assert.equal(deferredLink.events.get('pageshow').length, 1);
  assert.equal(deferredLink.events.get('popstate').length, 1);

  const current = 'https://www.gequbao.com/s/%E5%94%AF%E4%B8%80';
  assert.equal(isMusicSearchDocument('https://gequbao.com/s/唯一/', current), true, 'www, URL encoding, and trailing slash should describe the same search.');
  assert.equal(isMusicSearchDocument('https://www.gequbao.com/s/%e5%94%af%e4%b8%80', current), true);
  assert.equal(isMusicSearchDocument('https://www.gequbao.com/s/唯一#results', current), true, 'Page fragments do not select another search.');
  assert.equal(isMusicSearchDocument('https://www.gequbao.com/s/晴天', current), false, 'A prior search result must not complete the current query.');
  assert.equal(isMusicSearchDocument(`${current}?page=2`, current), false, 'Different query parameters must not reuse a stale snapshot.');
  assert.equal(isMusicSearchDocument('https://www.gequbao.com/music/35660', current), false, 'Music detail recommendations are not search results.');
  assert.equal(isMusicSearchDocument('https://other.example/s/唯一', current), false);
  assert.equal(isMusicSearchDocument('not a URL', current), false);
  assert.equal(isMusicSearchDocument('https://www.gequbao.com/s/%ZZ', current), false);

  console.log('music search sync tests passed: main results exclude recommendations, short results, challenge distinction, attribute updates, and stale document rejection');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
