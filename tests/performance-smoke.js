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
  assert.strictEqual(typeof exposedApi.openMediaCollection, 'function', 'preload must expose opening a media collection folder');
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
  assert(mainSource.includes('classifyMediaPortalPopup(url, view.webContents.getURL())') && mainSource.includes('popupBlocked: true') && mainSource.includes("return { action: 'deny' }"), 'unexpected third-party popups must be denied without replacing the active parser page');
  assert(mainSource.includes('expectMediaPortalPopupDownload(view.webContents') && mainSource.includes('expectedDownload && isHttpUrl(url)'), 'an explicitly clicked result must capture extensionless CDN download popups without allowing unrelated popups');
  assert(mainSource.includes('MEDIA_PORTAL_WORKER_WIDTH = 1280') && mainSource.includes('MEDIA_PORTAL_WORKER_HEIGHT = 900') && mainSource.includes('x: Math.max(0, width - 2)') && mainSource.includes('y: Math.max(0, height - 2)'), 'hidden media workers need a full layout viewport with a clipped compositor edge so delayed results keep rendering without opening the eye control');
  assert(mainSource.includes('MEDIA_PORTAL_VIDEO_WAKE_MAX = 4') && mainSource.includes("const videoResult = state?.automationMode === 'video-parse' && state?.phase === 'result'") && mainSource.includes("const wakeKind = musicSearch ? 'music search' : 'video result'"), 'video result pages must receive staged background visibility wakes just like delayed music pages');
  assert(mainSource.includes("ipcMain.handle('file:showContextMenu'"), 'local file rows need a native open/reveal context menu');
  assert(mainSource.includes("ipcMain.handle('file:startDrag'") && mainSource.includes('event.sender.startDrag({ file: value'), 'local search and media rows need a native OS file drag bridge');
  assert(!mainSource.includes("ipcMain.handle('media:clearCache'"), 'media temporary files must not expose a destructive bulk cleanup action');
  assert(mainSource.includes('MEDIA_PORTAL_IDLE_DESTROY_MS = 3 * 60 * 1000'), 'idle media websites must release their renderer process');
  assert(mainSource.includes('MEDIA_PORTAL_HISTORY_LIMIT = 20'), 'embedded media navigation history must remain bounded');
  assert(mainSource.includes('MEDIA_PORTAL_CACHE_LIMIT_BYTES = 128 * 1024 * 1024'), 'embedded website HTTP cache must remain bounded');
  assert(mainSource.includes("MEDIA_DOWNLOAD_HISTORY_FILE = 'xuannian-media-download-history.json'"), 'completed download history must be stored outside the main favorites data');
  assert(mainSource.includes('function sanitizeMediaDownloadHistory(') && mainSource.includes('.slice(0, 10);'), 'completed download history must retain only the latest ten records');
  assert(mainSource.includes('rememberCompletedMediaDownload(completedTask);'), 'completed downloads must be persisted before the renderer is notified');
  assert(mainSource.includes('showMediaDownloadNotification({ status: \'completed\'') && mainSource.includes("new Notification({ title, body, silent: false })"), 'completed downloads must trigger a native XuanNian notification from the real download completion event');
  assert(mainSource.includes("mode: 'video-download'") && mainSource.includes('downloadParsedMediaVideo'), 'video automation must parse before an explicit highest-quality download action');
  assert(mainSource.includes('reloadParsedVideoDownloadPage') && mainSource.includes("automationStage: 'video-download-reparse'"), 'a stale or preview-consumed result page must be reparsed before download fallback candidates are tried');
  assert(mainSource.includes('promoteMediaPreviewToLibrary') && mainSource.includes('parsed.capturedLocalPath'), 'a completed temporary preview must become the tracked download fallback when higher qualities fail');
  assert(mainSource.includes('media portal reused cached preview for repeated source'), 'repeated video links should reuse the valid preview cache instead of re-triggering a rate-limited parse');
  assert(mainSource.includes('streamMediaPortalUrlToFile') && mainSource.includes('webContents.session.fetch'), 'captured CDN responses must have a session-aware streaming path when Electron downloadURL does not emit will-download');
  assert(mainSource.includes('streamNodeMediaPortalUrlToFile') && mainSource.includes('retrying with Node HTTP'), 'Chromium-blocked signed CDN URLs must retry through a streaming Node HTTP transport');
  assert(mainSource.includes('const navigationState = mediaPortalInputState;') && mainSource.includes("action === 'ignore-stale'") && mainSource.includes("action === 'wait-for-navigation'"), 'portal navigation failures must stay bound to their original request and must not fail a newer parse');
  assert(mainSource.includes('continueMediaPortalVideoResultWait') && mainSource.includes('shouldExtendMediaPortalVideoResultWait') && mainSource.includes('recoverMediaPortalVideoAutomation') && mainSource.includes('shouldRetryMediaPortalVideoAutomation'), 'long video parses must continue reading the existing result page before a destructive reload recovery');
  assert(mainSource.includes("xhscdn\\.com$/i.test(parsed.hostname)) return 'https://www.xiaohongshu.com/'"), 'XHS CDN downloads must use a Xiaohongshu referer instead of the Seekin page referer rejected by the CDN');
  assert(/let reader = null;\s*const referer = mediaDownloadReferer\(url, options\.referer\);\s*const userAgent = [\s\S]*?\s*try \{/.test(mainSource), 'the XHS Node HTTP fallback must retain referer and user-agent values outside the Electron fetch try block');
  assert(mainSource.includes('douyinvod\\.com|bytev\\.com|douyinpic\\.com') && mainSource.includes("return 'https://www.douyin.com/'"), 'Douyin CDN downloads must use a Douyin referer instead of the Seekin page referer');
  assert(mainSource.includes('startDirectMediaPortalPreview') && mainSource.includes('startDirectTrackedMediaDownload'), 'direct CDN streaming must support both temporary previews and tracked final downloads');
  assert(mainSource.includes('falling back to header-free Electron downloadURL') && mainSource.includes('webContents.downloadURL(url);'), 'CDN fallback must avoid custom Referer headers that Chromium blocks for XHS signed media URLs');
  assert(mainSource.includes("mode === 'music-search'") && mainSource.includes('sanitizeMusicResults') && mainSource.includes('downloadMediaMusicResult'), 'music automation must return multiple results before downloading the selected version');
  assert(mainSource.includes('media:portalProgress') && mainSource.includes('waitForMediaPortalDownload'), 'media parsing and delayed music downloads must expose real progress states');
  assert(mainSource.includes('findInstalledMusicClient') && mainSource.includes('openHighQualityMusic'), 'high-quality music must prefer an installed cloud-drive client');
  assert(mainSource.includes('resumeMediaPortalAfterVerification') && mainSource.includes('verificationPending: true'), 'music human verification must resume the interrupted task after the user completes the challenge');
  assert(mainSource.includes('preferredName') && mainSource.includes('displayName') && mainSource.includes('receivedFilename'), 'music downloads must use the selected page title instead of provider-generated code filenames');
  assert(mainSource.includes('activeMediaPortalDownloads') && mainSource.includes('backgroundThrottling: false'), 'hidden media workers must remain responsive while active and release after completion');
  assert(mainSource.includes('function destroyMediaPortalView('), 'embedded media browser must have an explicit destruction path');
  assert(mainSource.includes("kind === 'note-category'") && mainSource.includes("action('rename', '修改')") && mainSource.includes("action('delete', '删除'"), 'favorite category names need native rename and delete context-menu actions');
  assert(mainSource.includes("ipcMain.on('ui:setNativeTheme'") && mainSource.includes('nativeTheme.themeSource'), 'native context menus must follow the app color mode');
  assert(mainSource.includes("kind === 'note-category-empty'") && mainSource.includes("action('create', '新建分类')"), 'favorite category blank space needs a native create menu');
  assert(mainSource.includes('history.removeEntryAtIndex(removeIndex)'), 'embedded media history must prune old entries');
  assert(mainSource.includes('await portalSession.clearCache()'), 'oversized embedded website cache must be cleared');
  assert(mainSource.includes("action('batch-delete'"), 'clipboard native context menus need a batch-delete entry');
  assert(mainSource.includes("ipcMain.handle('media:deleteLocalBatch'") && mainSource.includes("status: 'batch-deleted'"), 'media batch deletion must use one native operation and one refresh notification');
  assert(/kind === 'media'[\s\S]*?action\('batch-delete', '批量删除'\)/.test(mainSource), 'media native context menus need a batch-delete entry');
  assert(mainSource.includes("ipcMain.handle('media:openCollection'") && /kind === 'media-folder'[\s\S]*?action\('open-folder', '打开文件夹'\)/.test(mainSource), 'media collection context menus must open their managed folder');
  assert(mediaLibrarySource.includes('async function scanMediaDirectory'), 'local media files must be derived from the selected folders');
  assert(mediaLibrarySource.includes('async function listManagedMediaFiles'), 'media scanning must enumerate only supported media files');
  assert(mediaLibrarySource.includes('async function deleteMediaCollection'), 'media collections need a file-preserving delete path');
  assert(mediaLibrarySource.includes('movePathAcrossVolumes') && mediaLibrarySource.includes('preserved, folders, otherFiles'), 'deleting a media collection must preserve nested folders and non-media files');
  assert(!mediaLibrarySource.includes('收藏夹中包含子文件夹或非媒体文件'), 'complex collection contents must no longer block collection deletion');
  assert(mediaLibrarySource.includes("portalUrl: SEEKIN_UNIVERSAL_PORTAL") && mediaLibrarySource.includes("autoDownloadQuality: 'highest'"), 'all supported video providers must start with Seekin while retaining highest-quality automation');
  assert(mediaLibrarySource.includes("id: 'tiktok'") && mediaLibrarySource.includes('portals: SEEKIN_ONLY_PORTALS'), 'every video provider must use the shared Seekin-only route');
  assert(!mediaLibrarySource.includes("label: 'DLPanda'") && !mediaLibrarySource.includes('finalFallback: true'), 'video providers must not configure automatic backup sites');
  assert(mediaLibrarySource.includes('function scoreMediaDownloadQualityLabel('), 'highest-quality download selection must use a deterministic quality scorer');
  assert(!mediaLibrarySource.includes('fetch('), 'media library must not call third-party private download APIs');

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const quickSource = fs.readFileSync(path.join(__dirname, '..', 'quick.html'), 'utf8');
  const stickySource = fs.readFileSync(path.join(__dirname, '..', 'sticky.html'), 'utf8');
  const wheelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'wheel-scroll.js'), 'utf8');
  const mediaStyleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-library.css'), 'utf8');
  assert(indexSource.includes('id="mediaBrowserSurface"'), 'media download sites must have an embedded browser surface');
  assert(indexSource.includes('id="mediaDirectShell"') && /id="mediaBrowserShell" hidden/.test(indexSource), 'download websites must be hidden behind the background task status by default');
  assert(indexSource.includes('id="mediaVideoPreview"') && indexSource.includes('id="mediaDownloadVideo"') && indexSource.includes('id="mediaDownloadFavoriteVideo"'), 'parsed videos need an inline preview with download actions below it');
  assert(/id="mediaVideoPreview"[^>]*\bcontrols\b/.test(indexSource) && !indexSource.includes('id="mediaVideoSeek"') && !mediaStyleSource.includes('.media-video-progress'), 'video previews must use the native media control bar without a duplicate custom control');
  assert(indexSource.includes('id="mediaVideoSourceDuration"') && indexSource.includes('下载站实际返回文件的总时长'), 'video previews must identify the actual duration supplied by the download provider');
  assert(indexSource.includes('controlslist="nodownload noremoteplayback"'), 'native preview downloads must not bypass XuanNian download tracking');
  assert(mainSource.includes('video.controls = true;') && mainSource.includes("video.setAttribute('aria-label', '预览视频')") && !mainSource.includes("const progress = document.createElement('div')"), 'embedded previews must use the browser-native video controls');
  assert(mainSource.includes("view.webContents.on('enter-html-full-screen'") && mainSource.includes('mediaPortalHtmlFullscreen'), 'embedded native fullscreen must expand the media view to the full application window');
  assert(mainSource.includes("permission === 'fullscreen'") && mainSource.includes('setPermissionCheckHandler') && mainSource.includes("mediaPortalPresentationMode === 'preview'"), 'native fullscreen permission must be granted only to the main app and active embedded preview');
  assert(mediaStyleSource.includes('.media-portal-stage{position:relative;flex:1;min-height:0') && mediaStyleSource.includes('.media-video-frame{flex:1 1 0;min-height:96px') && mediaStyleSource.includes('@media (max-height:650px)'), 'video preview and lower actions must shrink into the available small-window height');
  assert(mainSource.includes("directUrl.startsWith('blob:')") && mainSource.includes("electronSession.on('will-download', onDownload)"), 'parsed blob videos must start through the tracked Electron download session');
  assert(indexSource.includes('id="mediaVideoQualitySelect"') && indexSource.includes('selectedQualityIndex') && indexSource.includes("downloadParsedMediaVideo(favorite?'favorite':'download',collection,selectedQualityIndex)"), 'parsed video quality choices must be visible and reach the native download bridge');
  assert(mainSource.includes('resolveBilibiliProgressiveOptions') && mainSource.includes('bilibiliProgressiveOptions') && mainSource.includes('selectedQualityIndex'), 'Bilibili downloads must expose only actually returned qualities and honor the selected option');
  assert(mainSource.includes('bilibiliPlaybackAccess') && mainSource.includes("cookies.get({ url: 'https://www.bilibili.com/' })") && mainSource.includes('bilibili-login-required'), 'Bilibili member videos must use the persistent authenticated session and reject preview-only responses');
  assert(mainSource.includes("ipcMain.handle('media:bilibiliSessionStatus'") && indexSource.includes('startBilibiliLoginMonitor') && indexSource.includes('已自动返回并重新解析'), 'Bilibili login completion must automatically return to the operation page and retry the original link');
  assert(mainSource.includes('redirect_url') && mainSource.includes('Bilibili BV maps to episode'), 'Bilibili BV links that redirect to bangumi episodes must use the episode playback endpoint');
  assert(mainSource.includes("ipcMain.handle('media:deleteDownloadHistoryItem'"), 'completed download records must support deleting their local files');
  assert(mainSource.includes("ipcMain.handle('media:setDownloadTaskPaused'") && indexSource.includes('data-download-task-pause'), 'active downloads must expose pause/resume before deletion');
  assert(!indexSource.includes('id="mediaMusicFormats"') && indexSource.includes('id="mediaMusicResults"'), 'music formats must be selected per result instead of globally');
  assert(indexSource.includes('data-music-action="download"') && indexSource.includes('data-music-action="favorite"') && indexSource.includes('data-music-format-choice="mp3"') && indexSource.includes('data-music-format-choice="wav"'), 'each music result must expose download and favorite-download actions with ordinary/high-quality choices');
  assert(indexSource.includes('data-music-preview=') && indexSource.includes('data-music-preview-audio') && indexSource.includes('previewMediaMusicVersion'), 'each music result must support inline playback with a seekable native audio control');
  assert(indexSource.includes('MEDIA_PORTAL_HEALTH_KEY') && indexSource.includes('recordMediaPortalFailure') && indexSource.includes('MEDIA_PORTAL_IMMEDIATE_DAILY_FAILURES') && indexSource.includes('nextHealthyMediaPortalIndex'), 'verified site failures must be skipped for the rest of the local day without treating one content failure as a site outage');
  assert(indexSource.includes('普通音质') && indexSource.includes('高清音质') && indexSource.includes("api.openHighQualityMusic(displayName,favorite?'favorite':'download',collection)"), 'music quality choices must use user-facing labels and pass the selected library destination to the native high-quality client bridge');
  assert(mainSource.includes('startMediaExternalAudioTracker') && mainSource.includes('providerLabel') && mainSource.includes('importExternalAudioTracker'), 'external cloud-drive audio downloads must be tracked and imported without recursive disk scanning');
  assert(mainSource.includes("taskId: `music-${Date.now()}") && mainSource.includes("status = 'preparing'") && mainSource.includes('claimMediaPortalTaskId'), 'ordinary music downloads must use one visible task from preparation through the real file transfer');
  assert(mainSource.includes("providerLabel = '云盘客户端'") && mainSource.includes('等待${tracker.providerLabel}下载'), 'cloud-drive music tasks must identify the launched provider while waiting for a local file');
  assert(indexSource.includes('id="mediaVideoManualPortal"') && indexSource.includes('id="mediaMusicManualPortal"') && indexSource.includes('offerMediaManualPortal'), 'media pages must expose a conditional original-site control after automatic handling fails');
  assert(indexSource.includes("const nextIndex=currentIndex+1<routes.length?currentIndex+1:-1") && indexSource.includes("let portalIndex=Number.isInteger(routeSelection)?routeSelection:0"), 'each video request must actually try the primary route and every configured fallback before manual handling');
  assert(mediaStyleSource.includes('.media-manual-portal{width:28px;height:28px;margin-left:auto') && indexSource.includes("video.hidden=false") && indexSource.includes("music.hidden=false"), 'manual-site controls must remain visible at the right edge without changing automatic fallback behavior');
  assert(indexSource.includes('id="mediaAutomationProgress"') && indexSource.includes('onMediaPortalProgress'), 'native media pages must display parser and countdown progress');
  assert(indexSource.includes('id="mediaClearVideoInput"') && indexSource.includes('id="mediaClearMusicInput"') && indexSource.includes('clearMediaLaunchInput') && mediaStyleSource.includes('.media-launch-clear'), 'video and music inputs must expose in-field clear actions that reset stale results');
  assert(indexSource.includes('id="noteSidebarResizeHandle"') && indexSource.includes('bindNoteSidebarResize') && indexSource.includes('NOTE_SIDEBAR_WIDTH_KEY'), 'the favorite-category divider must resize horizontally and persist its width');
  assert(/id="mediaDirectShell"[\s\S]*?id="mediaAutomationProgress"/.test(indexSource) && indexSource.includes("const visible=progress.status==='running'"), 'media progress must stay in the content area and disappear immediately after success or failure');
  assert(indexSource.includes('id="mediaDownloadBubble"'), 'download progress must remain visible in the main window');
  assert(!indexSource.includes('data-media-filters="downloads"'), 'media lists must use only the shared video/music selector');
  assert(indexSource.includes('id="mediaKindHome"') && indexSource.includes('id="mediaKindToggle"') && indexSource.includes('id="mediaKindMenu"') && indexSource.includes('data-media-kind="video"') && indexSource.includes('data-media-kind="audio"'), 'media type control must split the current download-page entry from the dropdown selector');
  assert(/class="media-nav-left"[\s\S]*?id="mediaTabs"[\s\S]*?data-media-tab="downloads"[\s\S]*?data-media-tab="favorites"/.test(indexSource), 'downloaded media and favorites must form a left-side group in that order');
  assert(/data-media-tab="downloads"[\s\S]*?<svg[\s\S]*?<span>已下载<\/span>/.test(indexSource) && /data-media-tab="favorites"[\s\S]*?<svg[\s\S]*?<span>收藏<\/span>/.test(indexSource), 'downloaded and favorite tabs must include distinguishing icons');
  assert(indexSource.includes('data-download-task-delete') && indexSource.includes('handleMediaDownloadTaskDoubleClick') && indexSource.includes('handleMediaDownloadTaskContextMenu'), 'download history must support delete, double-click open, and file context actions');
  assert(!indexSource.includes('data-media-action="play"') && !indexSource.includes('const playAction='), 'downloaded media rows must not render the nonfunctional play-button column');
  assert(indexSource.includes("['paused','interrupted'].includes(task.status)") && indexSource.includes('api.cancelMediaDownloadTask(task.id)') && indexSource.includes('knownSize'), 'paused and interrupted downloads must show file size and expose a removable task action');
  assert(indexSource.includes('bindReliableMediaButton') && mainSource.includes('!parsed.embeddedPreview') && mediaStyleSource.includes('display:inline-flex;align-items:center;justify-content:center'), 'video actions must hide the native browser layer and use their full visible button bounds');
  assert(indexSource.includes('id="createMediaCollectionFromPicker"') && indexSource.includes("api.createMediaCollection('favorites',kind,name)"), 'the favorite collection picker must support creating and selecting a new category');
  assert(indexSource.includes("api.setMediaBrowserBounds({},false,'browser')") && indexSource.includes('collection=await showMediaCollectionPicker'), 'embedded video must yield to the favorite collection picker');
  assert(/class="media-nav-right"[\s\S]*?id="mediaDownloadBubble"/.test(indexSource), 'the download record bubble must remain in the right-side navigation group');
  assert(!indexSource.includes('data-media-tab="portal"'), 'the redundant media download tab must be removed');
  assert(indexSource.includes('id="mediaDownloadsSearch"') && indexSource.includes('id="mediaFavoritesSearch"'), 'downloaded and favorite media lists need search fields');
  assert(indexSource.includes('class="media-search-row"'), 'media file counts must share the search row');
  assert(indexSource.includes('function normalizeMediaDownloadHistory('), 'renderer must restore persisted completed-download history');
  assert(indexSource.includes("api.showItemContextMenu('note-category'"), 'right-clicking a favorite category must open its management menu');
  assert(indexSource.includes("api.showItemContextMenu('note-category-empty')"), 'right-clicking favorite category blank space must open its create menu');
  assert(indexSource.includes('api.setNativeTheme(actual)'), 'theme changes must be forwarded to native context menus');
  assert(indexSource.includes('async function deleteNoteCategory('), 'favorite category deletion must reuse a guarded data operation');
  assert(indexSource.includes('id="settingMediaDownloadPath"') && indexSource.includes('id="settingMediaFavoritePath"'), 'media paths must live in settings');
  assert(!indexSource.includes('id="clearMediaCache"') && !indexSource.includes('function clearMediaCache('), 'media temporary storage must not expose bulk cache deletion');
  assert(!indexSource.includes('id="mediaDownloadCollections"'), 'downloaded media must not be split into categories');
  assert(indexSource.includes('function showMediaCollectionPicker('), 'favoriting media must ask for a target category');
  assert(indexSource.includes("const MEDIA_LIBRARY_OVERSCAN=10"), 'media lists must render a bounded viewport buffer');
  assert(indexSource.includes('class="media-virtual-spacer"'), 'media lists must use virtual top and bottom spacers');
  assert(indexSource.includes("addEventListener('drop',handleMediaFavoriteDrop)") && indexSource.includes("addEventListener('drop',handleMediaFavoriteListDrop)"), 'favorite media must support drag-and-drop categorization and ordering');
  assert(indexSource.includes('MEDIA_FAVORITE_ORDER_KEY') && indexSource.includes('updateMediaFavoriteOrder('), 'favorite media order must persist across view changes and restarts');
  assert(indexSource.includes('getFileThumbnail: (filePath,size)=> nativeApi.getFileThumbnail'), 'unified renderer API must forward native thumbnail requests');
  assert(indexSource.includes('<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 5 5"></path></svg>'), 'full-disk search navigation must use a plain magnifying-glass icon');
  assert(!indexSource.includes('<path d="M4 4h5"></path><path d="M4 4v5"></path>'), 'full-disk search navigation must not include the old corner mark');
  assert(indexSource.includes('id="mediaView"'), 'main window must expose the media library view');
  assert(mainSource.includes('keepMediaPortalWorkerVisible') && mainSource.includes('visibilityRetryCount'), 'hidden media automation must emulate a visible page and retry delayed music results without a manual toggle');
  assert(mainSource.includes('mediaPortalPreviewCapture'), 'video parsing must capture same-session previews from provider download actions');
  assert(mainSource.includes('scheduleMediaPortalVisibilityNudge') && mainSource.includes('MEDIA_PORTAL_MUSIC_WAKE_MAX = 3') && mainSource.includes('view.webContents.capturePage'), 'first music search must visibly paint and wake the provider up to three times without user interaction');
  assert(mainSource.includes('music verification visibility retry') && mainSource.includes('visibleMsOverride: 6500') && mainSource.includes('rerunAfterWake: true'), 'first-use Cloudflare verification must remain visible long enough to complete before retrying automatically');
  assert(mainSource.includes('Number(state.visibilityRetryCount || 0) < 2'), 'music search must retry result extraction twice after the staged visibility wakeups');
  assert(indexSource.includes("addEventListener('dblclick',event=>") && indexSource.includes('.media-music-result[data-music-index]'), 'music search rows must support double-click preview playback');
  assert(mainSource.includes('MEDIA_PREVIEW_MAX_AGE_MS') && mainSource.includes('mediaPreviewCachePath') && mainSource.includes('setMediaPortalPresentationMode'), 'captured previews must use a one-day managed cache and render inside the media stage');
  assert(indexSource.includes("state.fileSearch.clickTimer=setTimeout(()=>performFileSearchAction('copy',index),220)"), 'single-clicking a full-disk result must copy the local file');
  assert(indexSource.includes("api.showFileContextMenu(item.path)"), 'full-disk results must expose the local file context menu');
  assert(indexSource.includes('data-file-index="${index}" draggable="true"'), 'full-disk result rows must be draggable');
  assert(indexSource.includes("handleMediaFileDragStart(event,'downloads')") && indexSource.includes("handleMediaFileDragStart(event,'favorites')"), 'downloaded and favorite media rows must both start native file drags');
  assert(indexSource.includes('function beginNativeFileDrag(') && indexSource.includes('api.startFileDrag?.(filePath)'), 'renderer file drags must cross the preload bridge');
  assert(indexSource.includes('id="startClipboardBatchDelete"') && indexSource.includes('id="selectAllClipboardBatchDelete"') && indexSource.includes('id="confirmClipboardBatchDelete"') && indexSource.includes('id="cancelClipboardBatchDelete"'), 'clipboard toolbar must expose select-all, enter, confirm, and cancel batch-delete controls');
  assert(indexSource.includes('clipboardBatchDelete: {active:false,selectedIds:new Set(),revision:0,busy:false}'), 'clipboard batch selection must use persistent in-memory state');
  assert(indexSource.includes('function toggleClipboardBatchSelectAll()') && indexSource.includes('const visibleIds=filteredRecords().map'), 'clipboard select-all must operate on the current filtered result set');
  assert(indexSource.includes("else if(action==='batch-delete') startClipboardBatchDelete(record?.id)"), 'right-click batch delete must enter selection mode with the clicked record selected');
  assert(indexSource.includes('state.records=await api.saveRecords(state.records.filter(item=>!selectedSet.has(item.id)))'), 'batch deletion must persist all removals in one write');
  assert(indexSource.includes('data-media-batch-select-all="downloads"') && indexSource.includes('data-media-batch-select-all="favorites"'), 'downloaded and favorite media panels must expose select-all controls');
  assert(indexSource.includes('function confirmMediaBatchDelete(tab)') && indexSource.includes('api.deleteLocalMediaBatch('), 'media batch deletion must persist through the native bulk API');
  assert(indexSource.includes('batchDelete:{') && indexSource.includes('selectedPaths:new Set()'), 'media batch selection must persist independently of virtual rows');
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
