const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const listeners = new Map();
const pendingLoads = [];
let exposedApi = null;

const ipcRenderer = {
  invoke(channel) {
    if (channel === 'data:load') {
      return new Promise((resolve) => pendingLoads.push(resolve));
    }
    if (channel === 'sticky:getPinnedIds') return Promise.resolve([]);
    return Promise.resolve(null);
  },
  on(channel, callback) {
    listeners.set(channel, callback);
  },
  once(channel, callback) {
    listeners.set(channel, callback);
  },
  send() {},
};

const electronMock = {
  contextBridge: {
    exposeInMainWorld(_name, api) {
      exposedApi = api;
    },
  },
  ipcRenderer,
  clipboard: { readText: () => '' },
  webUtils: { getPathForFile: () => '' },
};

const originalModuleLoad = Module._load;
Module._load = function mockModuleLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalModuleLoad.call(this, request, parent, isMain);
};

function snapshot(recordId) {
  return {
    records: [{ id: recordId }],
    noteProjects: [{ id: 'project-1' }],
    notes: [{ id: 'note-1' }],
    stickyProjects: [],
    stickyNotes: [],
    inspirationCategories: [],
    inspirations: [],
    settings: { theme: 'light' },
  };
}

async function nextMicrotask() {
  await Promise.resolve();
}

async function run() {
  require('../src/preload.js');
  Module._load = originalModuleLoad;
  assert(exposedApi, 'preload API was not exposed');
  exposedApi.onQuickRefresh(() => {});

  const initial = Promise.all([
    exposedApi.getRecords(),
    exposedApi.getNoteProjects(),
    exposedApi.getNotes(),
    exposedApi.getSettings(),
  ]);
  await nextMicrotask();
  assert.strictEqual(pendingLoads.length, 1, 'concurrent getters must share one data load');
  pendingLoads[0](snapshot('initial'));
  const [records, projects, notes, settings] = await initial;
  assert.strictEqual(records[0].id, 'initial');
  assert.strictEqual(projects[0].id, 'project-1');
  assert.strictEqual(notes[0].id, 'note-1');
  assert.strictEqual(settings.theme, 'light');

  listeners.get('quick:refresh')({});
  const staleRequest = exposedApi.getRecords();
  await nextMicrotask();
  listeners.get('quick:refresh')({});
  const freshRequest = exposedApi.getRecords();
  await nextMicrotask();
  assert.strictEqual(pendingLoads.length, 3, 'each invalidation should create at most one replacement load');
  pendingLoads[1](snapshot('stale'));
  await nextMicrotask();
  pendingLoads[2](snapshot('fresh'));
  assert.strictEqual((await staleRequest)[0].id, 'fresh', 'stale data must not replace a newer request');
  assert.strictEqual((await freshRequest)[0].id, 'fresh');

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const mediaLibrarySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-library.js'), 'utf8');
  const videoThumbnailSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-thumbnail.html'), 'utf8');
  assert(/function createQuickWindow\(\)[\s\S]*?backgroundThrottling:\s*true/.test(mainSource), 'hidden quick window must allow Chromium background throttling');
  const warmRefreshStart = mainSource.indexOf('function scheduleQuickWindowWarmRefresh');
  const warmRefreshEnd = mainSource.indexOf('\nfunction stopClipboardWatcher', warmRefreshStart);
  const warmRefreshSource = mainSource.slice(warmRefreshStart, warmRefreshEnd);
  assert(warmRefreshStart >= 0 && warmRefreshEnd > warmRefreshStart, 'quick-window refresh policy was not found');
  assert(!warmRefreshSource.includes('setTimeout('), 'hidden quick-window data refresh must not schedule background renderer work');
  assert(!warmRefreshSource.includes(".once('did-finish-load'"), 'loading quick window must not accumulate refresh listeners');
  assert(warmRefreshSource.includes('quickWindowDataDirty = true'), 'hidden quick window must retain a dirty marker for next show');
  assert(mainSource.includes("if (fileType === 'video') return createVideoFrameThumbnail"), 'video thumbnails need an internal frame-decoding fallback');
  assert(mainSource.includes("if (fileType === 'image') return createImageFrameThumbnail"), 'images need an internal decoder when the system thumbnail service fails');
  assert(/fileThumbnailCache\.delete\(cacheKey\);\r?\n\s+return '';/.test(mainSource), 'failed native thumbnails must not be cached permanently');
  assert(!mainSource.includes('fileThumbnailCache.set(cacheKey, null)'), 'empty native thumbnails must remain retryable');
  assert(mainSource.includes('SYSTEM_THUMBNAIL_TIMEOUT_MS = 1200'), 'system thumbnail requests must have a bounded deadline');
  assert(mainSource.includes('function createSystemFileThumbnail('), 'system thumbnail timeout wrapper must be present');
  assert(videoThumbnailSource.includes('window.captureImageThumbnail'), 'media decoder page must expose its image fallback');
  assert(videoThumbnailSource.includes('window.captureVideoThumbnail'), 'video thumbnail decoder page must expose its capture function');
  assert(videoThumbnailSource.includes("canvas.toDataURL('image/jpeg', 0.82)"), 'video fallback must return a compressed still frame');
  assert(/function ensureMediaPortalView\([\s\S]*?new WebContentsView[\s\S]*?partition:\s*'persist:xuannian-media-portals'[\s\S]*?nodeIntegration:\s*false[\s\S]*?sandbox:\s*true/.test(mainSource), 'third-party media sites must run in an isolated sandboxed view');
  assert(/setWindowOpenHandler\([\s\S]*?loadURL\(url\)[\s\S]*?action:\s*'deny'/.test(mainSource), 'third-party links must stay in the embedded media view');
  assert(mainSource.includes("ipcMain.handle('file:showContextMenu'"), 'local file rows need a native open/reveal context menu');
  assert(!mainSource.includes("ipcMain.handle('media:clearCache'"), 'media temporary files must not expose a destructive bulk cleanup action');
  assert(mainSource.includes('MEDIA_PORTAL_IDLE_DESTROY_MS = 3 * 60 * 1000'), 'idle media websites must release their renderer process');
  assert(mainSource.includes('MEDIA_PORTAL_HISTORY_LIMIT = 20'), 'embedded media navigation history must remain bounded');
  assert(mainSource.includes('MEDIA_PORTAL_CACHE_LIMIT_BYTES = 128 * 1024 * 1024'), 'embedded website HTTP cache must remain bounded');
  assert(mainSource.includes("MEDIA_DOWNLOAD_HISTORY_FILE = 'xuannian-media-download-history.json'"), 'completed download history must be stored outside the main favorites data');
  assert(mainSource.includes('function sanitizeMediaDownloadHistory(') && mainSource.includes('.slice(0, 10);'), 'completed download history must retain only the latest ten records');
  assert(mainSource.includes('rememberCompletedMediaDownload(completedTask);'), 'completed downloads must be persisted before the renderer is notified');
  assert(mainSource.includes('function destroyMediaPortalView('), 'embedded media browser must have an explicit destruction path');
  assert(mainSource.includes('history.removeEntryAtIndex(removeIndex)'), 'embedded media history must prune old entries');
  assert(mainSource.includes('await portalSession.clearCache()'), 'oversized embedded website cache must be cleared');
  assert(mediaLibrarySource.includes('async function scanMediaDirectory'), 'local media files must be derived from the selected folders');
  assert(mediaLibrarySource.includes('async function listManagedMediaFiles'), 'media scanning must enumerate only supported media files');
  assert(mediaLibrarySource.includes('async function deleteMediaCollection'), 'media collections need a file-preserving delete path');
  assert(!mediaLibrarySource.includes('fetch('), 'media library must not call third-party private download APIs');

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const quickSource = fs.readFileSync(path.join(__dirname, '..', 'quick.html'), 'utf8');
  const stickySource = fs.readFileSync(path.join(__dirname, '..', 'sticky.html'), 'utf8');
  const wheelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'wheel-scroll.js'), 'utf8');
  const mediaStyleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-library.css'), 'utf8');
  assert(indexSource.includes('id="mediaBrowserSurface"'), 'media download sites must have an embedded browser surface');
  assert(indexSource.includes('id="mediaDownloadBubble"'), 'download progress must remain visible in the main window');
  assert(!indexSource.includes('data-media-filters="downloads"'), 'media lists must use only the shared video/music selector');
  assert(indexSource.includes('id="mediaKindTabs"'), 'video and music must use two direct buttons');
  assert(/class="media-nav-left"[\s\S]*?id="mediaTabs"[\s\S]*?data-media-tab="downloads"[\s\S]*?data-media-tab="favorites"/.test(indexSource), 'downloaded media and favorites must form a left-side group in that order');
  assert(/class="media-nav-right"[\s\S]*?id="mediaDownloadBubble"/.test(indexSource), 'the download record bubble must remain in the right-side navigation group');
  assert(!indexSource.includes('data-media-tab="portal"'), 'the redundant media download tab must be removed');
  assert(indexSource.includes('id="mediaDownloadsSearch"') && indexSource.includes('id="mediaFavoritesSearch"'), 'downloaded and favorite media lists need search fields');
  assert(indexSource.includes('class="media-search-row"'), 'media file counts must share the search row');
  assert(indexSource.includes('function normalizeMediaDownloadHistory('), 'renderer must restore persisted completed-download history');
  assert(indexSource.includes('id="settingMediaDownloadPath"') && indexSource.includes('id="settingMediaFavoritePath"'), 'media paths must live in settings');
  assert(!indexSource.includes('id="clearMediaCache"') && !indexSource.includes('function clearMediaCache('), 'media temporary storage must not expose bulk cache deletion');
  assert(!indexSource.includes('id="mediaDownloadCollections"'), 'downloaded media must not be split into categories');
  assert(indexSource.includes('function showMediaCollectionPicker('), 'favoriting media must ask for a target category');
  assert(indexSource.includes("const MEDIA_LIBRARY_OVERSCAN=10"), 'media lists must render a bounded viewport buffer');
  assert(indexSource.includes('class="media-virtual-spacer"'), 'media lists must use virtual top and bottom spacers');
  assert(indexSource.includes("addEventListener('drop',handleMediaFavoriteDrop)"), 'favorite media must support drag-and-drop categorization');
  assert(indexSource.includes('getFileThumbnail: (filePath,size)=> nativeApi.getFileThumbnail'), 'unified renderer API must forward native thumbnail requests');
  assert(indexSource.includes('<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 5 5"></path></svg>'), 'full-disk search navigation must use a plain magnifying-glass icon');
  assert(!indexSource.includes('<path d="M4 4h5"></path><path d="M4 4v5"></path>'), 'full-disk search navigation must not include the old corner mark');
  assert(indexSource.includes('id="mediaView"'), 'main window must expose the media library view');
  assert(indexSource.includes("state.fileSearch.clickTimer=setTimeout(()=>performFileSearchAction('copy',index),220)"), 'single-clicking a full-disk result must copy the local file');
  assert(indexSource.includes("api.showFileContextMenu(item.path)"), 'full-disk results must expose the local file context menu');
  assert(indexSource.includes("state.media.refreshTimer=setInterval"), 'local media deletion checks must run only while the local media view is active');
  assert(mediaStyleSource.includes('.media-row{height:64px'), 'media rows need stable dimensions');
  assert(indexSource.includes('const FILE_THUMBNAIL_PREFETCH_ROWS = 10'), 'file thumbnails must prefetch exactly ten rows below the viewport');
  assert(indexSource.includes('const FILE_THUMBNAIL_MAX_PENDING_REQUESTS = 9'), 'abandoned native thumbnail requests must remain bounded');
  assert(indexSource.includes('function fileThumbnailWindowRange('), 'file thumbnail loading must use a bounded result-index window');
  assert(indexSource.includes('scheduleVisibleFileThumbnails();'), 'thumbnail work must be deferred until after result rendering');
  const thumbnailQueueStart = indexSource.indexOf('function queueVisibleFileThumbnails()');
  const thumbnailQueueEnd = indexSource.indexOf('\nfunction scheduleVisibleFileThumbnails', thumbnailQueueStart);
  const thumbnailQueueSource = indexSource.slice(thumbnailQueueStart, thumbnailQueueEnd);
  assert(thumbnailQueueStart >= 0 && thumbnailQueueEnd > thumbnailQueueStart, 'file thumbnail queue implementation was not found');
  assert(!thumbnailQueueSource.includes('querySelectorAll'), 'thumbnail scheduling must not scan rendered DOM nodes');
  assert(thumbnailQueueSource.includes('fileThumbnailQueue.length=0'), 'scrolling must rebuild the queue around the latest viewport');
  assert(thumbnailQueueSource.includes('fileThumbnailActiveReleases.entries()'), 'active tasks outside the latest viewport must release their scheduling slots');
  assert(indexSource.includes('scheduleFileThumbnailRetry(task);'), 'visible thumbnail failures must automatically retry without user scrolling');
  assert(indexSource.includes('FILE_THUMBNAIL_RETRY_DELAYS_MS'), 'thumbnail retries must use bounded backoff');
  assert(indexSource.includes("marker.textContent='不可预览';"), 'failed media previews must show an explicit unavailable label');
  assert(indexSource.includes('fileThumbnailUnavailableKeys.delete(key);'), 'a later successful preview must clear its unavailable label');
  assert(indexSource.includes("if(!fileThumbnailDesiredKeys.has(task.key)) return;"), 'ignored thumbnail results must not enter cache');
  for (const [name, source] of [['main', indexSource], ['quick', quickSource], ['sticky', stickySource]]) {
    assert(source.includes('<script src="src/wheel-scroll.js"></script>'), `${name} window must load wheel scrolling support`);
    assert(source.includes('XuanNianWheelScroll?.bind'), `${name} window must bind wheel scrolling support`);
  }
  assert(wheelSource.includes('event.defaultPrevented'), 'wheel fallback must preserve handlers that already consumed the event');
  assert(wheelSource.includes('surface.scrollTop !== pending.before'), 'wheel fallback must not duplicate native browser scrolling');
  assert(!wheelSource.includes('event.preventDefault()'), 'wheel fallback must remain passive and preserve native smooth scrolling');

  console.log('performance smoke checks passed');
}

run().catch((error) => {
  Module._load = originalModuleLoad;
  console.error(error);
  process.exitCode = 1;
});
