const { app, BrowserWindow, ipcMain, dialog, globalShortcut, clipboard, desktopCapturer, screen, Menu, nativeImage, shell } = require('electron');
const { Notification, WebContentsView, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');
const { Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const {
  CoalescedAtomicJsonWriter,
  readJsonWithRecoverySync,
  writeJsonAtomicSync,
} = require('./data-persistence');
const { FileSearchService, fileTypeForPath } = require('./file-search');
const {
  copyMediaToFavorites,
  createMediaCollection,
  deleteMediaCollection,
  detectVideoProvider,
  isAllowedPortalUrl,
  listMediaCollections,
  listMediaFiles,
  mediaCollectionDirectory,
  mediaKindForPath,
  moveMediaToCollection,
  musicSearchUrl,
  renameMediaCollection,
  sanitizeMediaVideoTitle,
  scoreMediaDownloadQualityLabel,
} = require('./media-library');
const {
  buildPortalScript,
  classifyMediaPortalPopup,
  isHttpUrl,
  isMediaUrl,
} = require('./media-portal-automation');
const { findInstalledMusicClient } = require('./media-app-launcher');

let mainWindow;
let quickWindow;
let quickWindowEditorMode = false;
let quickWindowNormalBounds = null;
let dataRevision = 0;
let quickWindowRevision = -1;
let quickWindowWarmRefreshTimer = null;
let quickWindowPrewarmTimer = null;
let quickWindowDataDirty = false;
let quickOutsideCloseTimer = null;
let quickOutsideCloseChecking = false;
let quickWindowFocusedOnce = false;
let screenshotWindow;
const stickyWindows = new Set();
const stickyDraftWindows = new Set();
const stickyMoveSessions = new Map();
const stickyResizeSessions = new Map();
const stickyAspectRatios = new Map();
const stickyNoteWindows = new Map();
let prewarmedStickyDraftWindow = null;
let prewarmedStickyDraftRevision = -1;
let stickyDraftPrewarmTimer = null;
let startupDataProtectionComplete = false;
const STICKY_FREE_GRID_ITEM_SIZE = 112;
const STICKY_FREE_GRID_GAP = 8;
const STICKY_FREE_GRID_COLUMNS = 3;
const STICKY_FREE_GRID_HORIZONTAL_EXTRA = 44;
const STICKY_FREE_GRID_DEFAULT_WIDTH =
  STICKY_FREE_GRID_ITEM_SIZE * STICKY_FREE_GRID_COLUMNS
  + STICKY_FREE_GRID_GAP * (STICKY_FREE_GRID_COLUMNS - 1)
  + STICKY_FREE_GRID_HORIZONTAL_EXTRA;
const STICKY_FREE_GRID_DEFAULT_HEIGHT = 360;
let tray;
let isQuitting = false;
let updateCheckTimer = null;
let updateCheckInFlight = false;
let installedUpdaterInitialized = false;
let portableUpdateDownload = null;
let lastUpdateLogKey = '';
let lastUpdateBroadcastAt = 0;
let alwaysOnTop = false;
let quickHotkey = 'Ctrl+Alt+X';
let screenshotHotkey = 'Ctrl+Alt+D';
let quickStickyHotkey = 'Ctrl+Alt+S';
let fileSearchHotkey = 'Ctrl+Alt+A';
let fileSearchService = null;
let mediaExternalSearchService = null;
let mediaExternalAudioMonitorTimer = null;
let mediaExternalAudioMonitorBusy = false;
const mediaExternalAudioTrackers = new Map();
let lastQuickToggleAt = 0;
let lastPasteTargetHwnd = '';
let lastPasteTargetAt = 0;
let pendingCompositePaste = null;
let mouseHotkeyProcess;
let mouseHotkeyBuffer = '';
let keyboardHotkeyProcess;
let keyboardHotkeyBuffer = '';
let nativeHotkeyProcess;
let nativeHotkeyBuffer = '';
let lastStickyHotkeyAt = 0;
let clipboardTimer;
let fileClipboardTimer;
let imageClipboardTimer;
let clipboardWatcherProcess;
let clipboardWatcherBuffer = '';
let lastClipboardDigest = '';
let lastCapturedClipboardSequence = 0;
let suppressImageClipboardUntil = 0;
let suppressTextClipboardUntil = 0;
let suppressFileClipboardUntil = 0;
let fileClipboardPollCount = 0;
let imageClipboardPollCount = 0;
let fileClipboardReadInFlight = false;
let imageClipboardReadInFlight = false;
let mainWindowMoveSession = null;
let mainWindowResizeSession = null;
let quickWindowMoveSession = null;
let screenCapturerWarmup = null;
let screenCapturerWarmupImage = null;
let clipboardHelperRetryCount = 0;
let dataCache = null;
const dataWriter = new CoalescedAtomicJsonWriter({
  onError: (error) => runtimeLog(`data persistence failed: ${error?.stack || error}`),
});
const recordsWriter = new CoalescedAtomicJsonWriter({
  onError: (error) => runtimeLog(`clipboard journal persistence failed: ${error?.stack || error}`),
});
let lastPreparedDataWrite = null;
let lastPreparedRecordsWrite = null;
let quitAfterDataFlush = false;
let quitFlushInProgress = false;
const fileIconCache = new Map();
const fileThumbnailCache = new Map();
let videoThumbnailWindow = null;
let videoThumbnailWindowReady = null;
let videoThumbnailIdleTimer = null;
let videoThumbnailActive = 0;
let mediaPortalView = null;
let mediaPortalInputTimer = null;
let mediaPortalVisibilityNudgeTimer = null;
let mediaPortalVisibilityRestoreTimer = null;
let mediaPortalIdleTimer = null;
let mediaPortalCacheCheckAt = 0;
let mediaPortalCacheCheckPromise = null;
let mediaPortalRequestId = 0;
let mediaPortalInputState = null;
let mediaPortalParsedVideo = null;
let mediaPortalProgressTimer = null;
let mediaPortalPendingDownload = null;
let mediaPortalPreviewCapture = null;
let mediaPortalVerificationResume = null;
let mediaPortalVerificationTimer = null;
let activeMediaPortalDownloads = 0;
const configuredMediaDownloadSessions = new WeakSet();
const mediaPortalDownloadTargets = new WeakMap();
const mediaPortalExpectedPopupDownloads = new WeakMap();
const mediaPortalDownloadStartCounts = new WeakMap();
const activeMediaDownloadNotifications = new Set();
const recentClipboardDigests = new Map();
const recentClipboardSequences = new Map();
const pendingClipboardSequences = new Set();
const selfClipboardDigests = new Map();
const selfClipboardSequences = new Map();
const compositeTextSuppressions = new Map();
const MAX_CLIPBOARD_RECORDS = 500;
const MAX_LOCALIZED_BINARY_BYTES = 64 * 1024 * 1024;
const SELF_IMAGE_SUPPRESS_MS = 2500;
const DEFAULT_RECORD_RETENTION_DAYS = 30;
const MAIN_WINDOW_MIN_WIDTH = 560;
const MAIN_WINDOW_MIN_HEIGHT = 560;
const RECENT_CACHE_LIMIT = 512;
const SELF_CACHE_LIMIT = 256;
const FILE_ICON_CACHE_LIMIT = 256;
const FILE_THUMBNAIL_CACHE_LIMIT = 192;
const SYSTEM_THUMBNAIL_TIMEOUT_MS = 1200;
const VIDEO_THUMBNAIL_TIMEOUT_MS = 2800;
const VIDEO_THUMBNAIL_IDLE_MS = 15000;
const MEDIA_PORTAL_IDLE_DESTROY_MS = 3 * 60 * 1000;
const MEDIA_PORTAL_HISTORY_LIMIT = 20;
const MEDIA_PORTAL_CACHE_LIMIT_BYTES = 128 * 1024 * 1024;
const MEDIA_PORTAL_CACHE_CHECK_INTERVAL_MS = 60 * 1000;
const MEDIA_PORTAL_WORKER_WIDTH = 1280;
const MEDIA_PORTAL_WORKER_HEIGHT = 900;
const MEDIA_PORTAL_MUSIC_WAKE_MAX = 3;
const MEDIA_PORTAL_MUSIC_WAKE_DELAY_MS = 3000;
const MEDIA_PORTAL_MUSIC_WAKE_VISIBLE_MS = 700;
const MEDIA_PREVIEW_CACHE_DIRECTORY = 'media-preview-cache';
const MEDIA_PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MEDIA_PREVIEW_DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000;
const MEDIA_DOWNLOAD_HISTORY_FILE = 'xuannian-media-download-history.json';
const MEDIA_EXTERNAL_AUDIO_TIMEOUT_MS = 15 * 60 * 1000;
const STARTUP_MIGRATION_STATE_FILE = 'xuannian-migration-state.json';
const RECORDS_JOURNAL_FILE = 'xuannian-records.json';
const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
const STABLE_USER_DATA_DIR_NAME = '玄念';
const UPDATE_OWNER = 'wu798998264-crypto';
const UPDATE_REPO = 'xuannian';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: '',
  percent: 0,
  message: '',
  releaseNotes: '',
  portable: process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_FILE,
  manualInstall: false,
  platform: process.platform,
  supported: ['win32', 'darwin'].includes(process.platform),
  downloadedFile: '',
};

function configureStableUserDataPath() {
  try {
    const stableUserDataPath = path.join(app.getPath('appData'), STABLE_USER_DATA_DIR_NAME);
    app.setPath('userData', stableUserDataPath);
  } catch {}
}

configureStableUserDataPath();
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

function userDataFile() {
  return path.join(app.getPath('userData'), 'xuannian-data.json');
}

function appIconPath() {
  const ico = path.join(__dirname, 'xuannian-logo.ico');
  if (fs.existsSync(ico)) return ico;
  const png = path.join(__dirname, 'xuannian-logo-256.png');
  return fs.existsSync(png) ? png : undefined;
}

function trayIconPath() {
  const ico = path.join(__dirname, 'xuannian-tray.ico');
  if (fs.existsSync(ico)) return ico;
  const png = path.join(__dirname, 'xuannian-tray.png');
  if (fs.existsSync(png)) return png;
  return appIconPath();
}

function startupExecutablePath() {
  const portableExecutable = String(process.env.PORTABLE_EXECUTABLE_FILE || '').trim();
  if (portableExecutable && fs.existsSync(portableExecutable)) return portableExecutable;
  return process.execPath;
}

function appHtmlPath(fileName) {
  const candidates = [
    path.join(__dirname, '..', fileName),
    path.join(app.getAppPath(), fileName),
    path.join(process.resourcesPath || '', 'app', fileName),
  ];
  return candidates.find((filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }) || candidates[0];
}

function loadAppHtml(win, fileName, options = {}) {
  const target = appHtmlPath(fileName);
  runtimeLog(`load ${fileName}: ${target}`);
  return win.loadFile(target, options).catch((error) => {
    runtimeLog(`load ${fileName} failed: ${error?.message || error}`);
    const fallback = path.join(app.getAppPath(), fileName);
    if (fallback !== target) {
      runtimeLog(`retry ${fileName}: ${fallback}`);
      return win.loadFile(fallback, options).catch((retryError) => {
        runtimeLog(`retry ${fileName} failed: ${retryError?.message || retryError}`);
      });
    }
  });
}

function attachPageDiagnostics(win, label) {
  if (!win || win.isDestroyed()) return;
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    runtimeLog(`${label} did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    runtimeLog(`${label} render-process-gone ${JSON.stringify(details || {})}`);
  });
  if (process.env.XUANNIAN_DEBUG_LOG !== '1') return;
  win.webContents.on('dom-ready', () => {
    runtimeLog(`${label} dom-ready ${win.webContents.getURL()}`);
  });
  win.webContents.on('did-finish-load', () => {
    runtimeLog(`${label} did-finish-load ${win.webContents.getURL()}`);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    runtimeLog(`${label} console ${level} ${sourceId}:${line} ${message}`);
  });
}

function clipboardHelperPath() {
  if (app.isPackaged) {
    const stableDir = path.join(app.getPath('userData'), 'native');
    const stableHelper = path.join(stableDir, 'XuanNianClipboardHelper.exe');
    const sources = [
      path.join(process.resourcesPath, 'native', 'XuanNianClipboardHelper.exe'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'native', 'XuanNianClipboardHelper.exe'),
    ];
    const source = sources.find((filePath) => fs.existsSync(filePath));
    if (source) {
      try {
        fs.mkdirSync(stableDir, { recursive: true });
        const sourceStat = fs.statSync(source);
        const stableStat = fs.existsSync(stableHelper) ? fs.statSync(stableHelper) : null;
        if (!stableStat || stableStat.size !== sourceStat.size || stableStat.mtimeMs < sourceStat.mtimeMs) {
          fs.copyFileSync(source, stableHelper);
        }
      } catch {}
    }
    if (fs.existsSync(stableHelper)) return stableHelper;
    return source || stableHelper;
  }
  const candidates = [
    path.join(__dirname, 'native', 'XuanNianClipboardHelper.exe'),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || candidates[0];
}

function runtimeLog(message) {
  if (!app.isPackaged && process.env.XUANNIAN_DEBUG_LOG !== '1') return;
  try {
    const file = path.join(app.getPath('userData'), 'xuannian-runtime.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
      fs.renameSync(file, path.join(app.getPath('userData'), 'xuannian-runtime.old.log'));
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function publicUpdateState() {
  return { ...updateState };
}

function setUpdateState(patch = {}) {
  const previousStatus = updateState.status;
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() };
  const progressBucket = updateState.status === 'downloading' ? Math.floor(Number(updateState.percent || 0) / 10) : '';
  const logKey = `${updateState.status}:${progressBucket}:${updateState.version || ''}:${updateState.status === 'error' ? updateState.message : ''}`;
  if (logKey !== lastUpdateLogKey) {
    lastUpdateLogKey = logKey;
    runtimeLog(`update state ${updateState.status} current=${updateState.currentVersion} next=${updateState.version || '-'} ${updateState.message || ''}`);
  }
  const now = Date.now();
  if (updateState.status === 'downloading' && previousStatus === 'downloading' && Number(updateState.percent || 0) < 100 && now - lastUpdateBroadcastAt < 120) {
    return publicUpdateState();
  }
  lastUpdateBroadcastAt = now;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('update:state', publicUpdateState());
  }
  return publicUpdateState();
}

function normalizeReleaseNotes(notes) {
  if (Array.isArray(notes)) return notes.map((item) => item?.note || item?.version || '').filter(Boolean).join('\n');
  return String(notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '').replace(/^v/i, '').split('-')[0].split('.').map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function requestJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `XuanNian/${app.getVersion()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400 && redirects < 6) {
        response.resume();
        requestJson(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub 返回 ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('更新信息格式无效'));
        }
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('检查更新超时')));
    request.on('error', reject);
  });
}

function downloadFile(url, destination, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': `XuanNian/${app.getVersion()}` },
    }, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400 && redirects < 8) {
        response.resume();
        downloadFile(new URL(location, url).toString(), destination, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`下载更新失败（${response.statusCode}）`));
        return;
      }
      const temporary = `${destination}.download`;
      const total = Number(response.headers['content-length'] || 0);
      let received = 0;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const output = fs.createWriteStream(temporary);
      response.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) onProgress?.(Math.min(100, (received / total) * 100));
      });
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          try {
            if (fs.existsSync(destination)) fs.unlinkSync(destination);
            fs.renameSync(temporary, destination);
            resolve(destination);
          } catch (error) {
            reject(error);
          }
        });
      });
      output.on('error', (error) => {
        response.destroy();
        try { fs.unlinkSync(temporary); } catch {}
        reject(error);
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error('下载更新超时')));
    request.on('error', reject);
  });
}

function hasTrustedMacSignature() {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  try {
    const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], { encoding: 'utf8' });
    const details = `${result.stdout || ''}\n${result.stderr || ''}`;
    return /Authority=Developer ID Application/i.test(details) && !/Signature=adhoc/i.test(details);
  } catch {
    return false;
  }
}

async function checkManualPackageUpdate() {
  const release = await requestJson(`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`);
  const version = String(release?.tag_name || release?.name || '').replace(/^v/i, '').trim();
  if (!version || compareVersions(version, app.getVersion()) <= 0) {
    portableUpdateDownload = null;
    return setUpdateState({ status: 'current', version: '', percent: 0, message: '当前已是最新版本', releaseNotes: '', downloadedFile: '' });
  }
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const expectedMacArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const asset = process.platform === 'darwin'
    ? assets.find((item) => new RegExp(`^XuanNian-\\d+\\.\\d+\\.\\d+-${expectedMacArch}\\.dmg$`, 'i').test(String(item?.name || '')))
    : (assets.find((item) => /^XuanNian-\d+\.\d+\.\d+-Portable\.exe$/i.test(String(item?.name || '')))
      || assets.find((item) => /便携版\.exe$/i.test(String(item?.name || ''))));
  if (!asset?.browser_download_url) {
    throw new Error(process.platform === 'darwin' ? `发布页中没有找到 ${expectedMacArch} 版 macOS 安装包` : '发布页中没有找到 Windows 便携版更新包');
  }
  portableUpdateDownload = { version, name: asset.name, url: asset.browser_download_url };
  return setUpdateState({
    status: 'available',
    version,
    percent: 0,
    message: `发现新版本 ${version}`,
    releaseNotes: normalizeReleaseNotes(release.body),
    downloadedFile: '',
  });
}

function initializeInstalledUpdater() {
  if (installedUpdaterInitialized) return;
  installedUpdaterInitialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message) => runtimeLog(`updater ${message}`),
    warn: (message) => runtimeLog(`updater warning ${message}`),
    error: (message) => runtimeLog(`updater error ${message}`),
    debug: (message) => runtimeLog(`updater debug ${message}`),
  };
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', message: '正在检查更新…', percent: 0 }));
  autoUpdater.on('update-available', (info) => setUpdateState({
    status: 'available',
    version: info?.version || '',
    message: `发现新版本 ${info?.version || ''}`.trim(),
    releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
    percent: 0,
    downloadedFile: '',
  }));
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current', version: '', message: '当前已是最新版本', releaseNotes: '', percent: 0, downloadedFile: '' }));
  autoUpdater.on('download-progress', (progress) => setUpdateState({
    status: 'downloading',
    percent: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
    message: '正在下载更新…',
  }));
  autoUpdater.on('update-downloaded', (info) => setUpdateState({
    status: 'downloaded',
    version: info?.version || updateState.version,
    percent: 100,
    message: '更新已下载，重启后即可完成安装',
  }));
  autoUpdater.on('error', (error) => {
    updateCheckInFlight = false;
    setUpdateState({ status: 'error', message: error?.message || '更新失败，请稍后重试' });
  });
}

async function checkForAppUpdates() {
  if (!app.isPackaged || !updateState.supported) {
    return setUpdateState({ status: 'current', message: app.isPackaged ? '当前系统暂不支持自动更新' : '开发预览版不检查更新' });
  }
  if (updateCheckInFlight || updateState.status === 'downloading') return publicUpdateState();
  updateCheckInFlight = true;
  setUpdateState({ status: 'checking', message: '正在检查更新…', percent: 0 });
  try {
    if (updateState.manualInstall) {
      return await checkManualPackageUpdate();
    }
    initializeInstalledUpdater();
    await autoUpdater.checkForUpdates();
    return publicUpdateState();
  } catch (error) {
    return setUpdateState({ status: 'error', message: error?.message || '检查更新失败，请稍后重试' });
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAppUpdate() {
  if (updateState.status === 'downloaded') return publicUpdateState();
  if (updateState.status !== 'available') return checkForAppUpdates();
  try {
    setUpdateState({ status: 'downloading', message: '正在下载更新…', percent: 0 });
    if (updateState.manualInstall) {
      if (!portableUpdateDownload?.url) throw new Error('更新地址已失效，请重新检查更新');
      const destination = path.join(app.getPath('downloads'), portableUpdateDownload.name);
      await downloadFile(portableUpdateDownload.url, destination, (percent) => {
        setUpdateState({ status: 'downloading', percent, message: process.platform === 'darwin' ? '正在下载 macOS 更新…' : '正在下载 Windows 便携版更新…' });
      });
      return setUpdateState({
        status: 'downloaded',
        percent: 100,
        downloadedFile: destination,
        message: process.platform === 'darwin' ? 'macOS 更新已下载，可以打开安装包' : '便携版更新已下载，请关闭当前版本后运行新文件',
      });
    }
    initializeInstalledUpdater();
    await autoUpdater.downloadUpdate();
    return publicUpdateState();
  } catch (error) {
    return setUpdateState({ status: 'error', message: error?.message || '下载更新失败，请稍后重试' });
  }
}

function installAppUpdate() {
  if (updateState.status !== 'downloaded') return false;
  if (updateState.manualInstall) {
    if (updateState.downloadedFile && fs.existsSync(updateState.downloadedFile)) {
      if (process.platform === 'darwin') shell.openPath(updateState.downloadedFile);
      else shell.showItemInFolder(updateState.downloadedFile);
      return true;
    }
    return false;
  }
  backupStartupData(storageFileForData(loadData()));
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function initializeAutoUpdater() {
  const portable = process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_FILE;
  const manualInstall = portable || (process.platform === 'darwin' && !hasTrustedMacSignature());
  updateState = { ...updateState, currentVersion: app.getVersion(), portable, manualInstall };
  if (app.isPackaged && updateState.supported && !manualInstall) initializeInstalledUpdater();
  setTimeout(() => checkForAppUpdates(), 12000);
  updateCheckTimer = setInterval(() => checkForAppUpdates(), UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref?.();
}

process.on('uncaughtException', (error) => {
  runtimeLog(`uncaughtException ${error?.stack || error?.message || error}`);
});

process.on('unhandledRejection', (reason) => {
  runtimeLog(`unhandledRejection ${reason?.stack || reason?.message || reason}`);
});

function normalizeExistingFilePaths(filePaths) {
  const seen = new Set();
  const files = [];
  for (const value of Array.isArray(filePaths) ? filePaths : [filePaths]) {
    const input = String(value || '').trim();
    if (!input || !path.isAbsolute(input) || !fs.existsSync(input)) continue;
    let normalized = path.normalize(input);
    try {
      normalized = fs.realpathSync.native(normalized);
    } catch {}
    const key = normalized.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(normalized);
  }
  return files;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('native-data-refresh');
  }
}

function showSettingsWindow() {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => mainWindow.webContents.send('main:navigate', 'settings');
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function showFileSearchWindow() {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => {
    mainWindow.webContents.send('main:navigate', 'search');
    mainWindow.webContents.send('search:focus');
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function getFileSearchService() {
  if (!fileSearchService) {
    fileSearchService = new FileSearchService({
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
    });
  }
  return fileSearchService;
}

function getMediaExternalSearchService() {
  if (!mediaExternalSearchService) {
    mediaExternalSearchService = new FileSearchService({
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
    });
  }
  return mediaExternalSearchService;
}

function normalizedExternalAudioName(value = '') {
  return path.basename(String(value || ''), path.extname(String(value || '')))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function externalAudioSearchQuery(displayName = '') {
  const title = String(displayName || '').split(/\s+-\s+/)[0] || String(displayName || '');
  const tokens = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  return tokens.join(' ') || 'dm:today';
}

function externalAudioNameScore(filePath, displayName = '') {
  const candidate = normalizedExternalAudioName(filePath);
  const full = normalizedExternalAudioName(displayName);
  const title = normalizedExternalAudioName(String(displayName || '').split(/\s+-\s+/)[0]);
  if (!candidate) return 0;
  if (full.length >= 2 && (candidate.includes(full) || full.includes(candidate))) return 200 + Math.min(candidate.length, full.length);
  if (title.length >= 2 && (candidate.includes(title) || title.includes(candidate))) return 100 + Math.min(candidate.length, title.length);
  return 0;
}

async function searchExternalAudioCandidates(tracker) {
  if (!['win32', 'darwin'].includes(process.platform)) return [];
  const result = await getMediaExternalSearchService().search(tracker.query, {
    type: 'audio',
    sort: 'modified',
    direction: 'desc',
    limit: 120,
  });
  if (!result?.ready || !Array.isArray(result.results)) return [];
  return result.results
    .filter((item) => item?.path && mediaKindForPath(item.path) === 'audio' && fs.existsSync(item.path))
    .map((item) => ({ ...item, matchScore: externalAudioNameScore(item.path, tracker.displayName) }))
    .filter((item) => item.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore || Number(right.modifiedAt || 0) - Number(left.modifiedAt || 0));
}

function stopMediaExternalAudioMonitorIfIdle() {
  if (mediaExternalAudioTrackers.size || !mediaExternalAudioMonitorTimer) return;
  clearInterval(mediaExternalAudioMonitorTimer);
  mediaExternalAudioMonitorTimer = null;
}

async function importExternalAudioTracker(tracker, sourcePath) {
  const directories = mediaDirectories();
  const root = tracker.location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  const managedSource = path.resolve(sourcePath) === path.resolve(root) || isPathInside(sourcePath, root);
  let destination = sourcePath;
  if (!managedSource) {
    const targetDirectory = mediaCollectionDirectory(root, 'audio', tracker.collection || '');
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    destination = uniqueMediaDownloadPath(targetDirectory, sanitizeDownloadFilename(path.basename(sourcePath)));
    await fs.promises.copyFile(sourcePath, destination);
  }
  const stat = await fs.promises.stat(destination);
  const completedTask = {
    id: tracker.id,
    name: path.basename(destination),
    path: destination,
    location: tracker.location,
    status: 'completed',
    receivedBytes: Number(stat.size || 0),
    totalBytes: Number(stat.size || 0),
    percent: 100,
    updatedAt: Date.now(),
  };
  rememberCompletedMediaDownload(completedTask);
  notifyMediaDownloadProgress(completedTask);
  notifyMediaDownloadsChanged({ status: 'completed', path: destination });
  showMediaDownloadNotification({
    status: 'completed',
    name: completedTask.name,
    filePath: destination,
    favorite: tracker.location === 'favorites',
  });
}

async function pollMediaExternalAudioTrackers() {
  if (mediaExternalAudioMonitorBusy || !mediaExternalAudioTrackers.size || isQuitting) return;
  mediaExternalAudioMonitorBusy = true;
  try {
    for (const tracker of [...mediaExternalAudioTrackers.values()]) {
      if (Date.now() - tracker.startedAt >= MEDIA_EXTERNAL_AUDIO_TIMEOUT_MS) {
        mediaExternalAudioTrackers.delete(tracker.id);
        notifyMediaDownloadProgress({ ...tracker.task, status: 'error', updatedAt: Date.now() });
        showMediaDownloadNotification({ status: 'error', name: tracker.task.name });
        continue;
      }
      let candidates = [];
      try { candidates = await searchExternalAudioCandidates(tracker); } catch (error) {
        runtimeLog(`external audio detection failed: ${error?.message || error}`);
      }
      for (const candidate of candidates) {
        const key = path.resolve(candidate.path).toLowerCase();
        if (tracker.baseline.has(key) || Number(candidate.modifiedAt || 0) < tracker.startedAt - 5000) continue;
        let stat;
        try { stat = await fs.promises.stat(candidate.path); } catch { continue; }
        if (!stat.isFile() || stat.size <= 0) continue;
        const previous = tracker.candidates.get(key);
        const stableCount = previous?.size === stat.size ? Number(previous.stableCount || 0) + 1 : 0;
        tracker.candidates.set(key, { size: stat.size, stableCount });
        if (stableCount < 1) continue;
        try {
          await importExternalAudioTracker(tracker, candidate.path);
          mediaExternalAudioTrackers.delete(tracker.id);
        } catch (error) {
          runtimeLog(`external audio import failed: ${error?.message || error}`);
          notifyMediaDownloadProgress({ ...tracker.task, status: 'error', updatedAt: Date.now() });
          mediaExternalAudioTrackers.delete(tracker.id);
        }
        break;
      }
    }
  } finally {
    mediaExternalAudioMonitorBusy = false;
    stopMediaExternalAudioMonitorIfIdle();
  }
}

async function startMediaExternalAudioTracker(displayName, downloadTarget = 'download', collection = '') {
  if (!['win32', 'darwin'].includes(process.platform)) return null;
  const id = `external-media-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tracker = {
    id,
    displayName: String(displayName || '').trim(),
    query: externalAudioSearchQuery(displayName),
    location: downloadTarget === 'favorite' ? 'favorites' : 'downloads',
    collection: String(collection || '').trim(),
    startedAt: Date.now(),
    baseline: new Set(),
    candidates: new Map(),
  };
  try {
    const baseline = await searchExternalAudioCandidates(tracker);
    tracker.baseline = new Set(baseline.map((item) => path.resolve(item.path).toLowerCase()));
  } catch (error) {
    runtimeLog(`external audio baseline failed: ${error?.message || error}`);
  }
  tracker.task = {
    id,
    name: `${tracker.displayName || '高清音质'}（等待云盘客户端下载）`,
    path: '',
    location: tracker.location,
    status: 'external',
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
    updatedAt: Date.now(),
  };
  mediaExternalAudioTrackers.set(id, tracker);
  notifyMediaDownloadProgress(tracker.task);
  if (!mediaExternalAudioMonitorTimer) {
    mediaExternalAudioMonitorTimer = setInterval(pollMediaExternalAudioTrackers, 2500);
    mediaExternalAudioMonitorTimer.unref?.();
  }
  return tracker;
}

function notifyMainSuspend() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('main:suspend');
}

function notifyStickyWindowsDataRefresh() {
  for (const win of [...stickyWindows]) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      stickyWindows.delete(win);
      continue;
    }
    win.webContents.send('native-data-refresh');
    if (win === prewarmedStickyDraftWindow) prewarmedStickyDraftRevision = dataRevision;
  }
}

function notifySettingsChanged(settings = {}) {
  const cleanSettings = { ...defaultData().settings, ...sanitizeSettings(settings) };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('settings:changed', cleanSettings);
  }
  sendQuickWindow('settings:changed', cleanSettings);
  for (const win of [...stickyWindows]) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      stickyWindows.delete(win);
      continue;
    }
    win.webContents.send('settings:changed', cleanSettings);
  }
}

function pinnedStickyNoteIds() {
  const ids = [];
  for (const [noteId, win] of stickyNoteWindows) {
    if (!win || win.isDestroyed()) {
      stickyNoteWindows.delete(noteId);
      continue;
    }
    ids.push(noteId);
  }
  return ids;
}

function notifyStickyPinState() {
  const ids = pinnedStickyNoteIds();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('native-sticky-pin-state', ids);
  }
  sendQuickWindow('native-sticky-pin-state', ids);
}

function hideMainToTray() {
  notifyMainSuspend();
  hideQuickWindow();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  createTray();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readForegroundWindowHandleAsync() {
  return new Promise((resolve) => {
    const helper = clipboardHelperPath();
    if (process.platform === 'win32' && fs.existsSync(helper)) {
      execFile(helper, ['foreground'], {
        windowsHide: true,
        timeout: 700,
        maxBuffer: 1024,
      }, (_error, stdout) => {
        const value = String(stdout || '').trim();
        resolve(/^\d+$/.test(value) && value !== '0' ? value : '');
      });
      return;
    }
    const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class XuanNianForegroundAsync { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }\'',
      '[Console]::Out.Write([XuanNianForegroundAsync]::GetForegroundWindow().ToInt64())',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: 1200,
      maxBuffer: 1024,
    }, (_error, stdout) => {
      const value = String(stdout || '').trim();
      resolve(/^\d+$/.test(value) && value !== '0' ? value : '');
    });
  });
}

function readForegroundWindowHandleSync() {
  const helper = clipboardHelperPath();
  if (process.platform === 'win32' && fs.existsSync(helper)) {
    try {
      const value = String(execFileSync(helper, ['foreground'], {
        windowsHide: true,
        timeout: 450,
        maxBuffer: 1024,
      }) || '').trim();
      return /^\d+$/.test(value) && value !== '0' ? value : '';
    } catch (_error) {
      return '';
    }
  }
  return '';
}

function normalizeWindowHandle(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return BigInt(text).toString();
  } catch (_error) {
    return text.replace(/^0+/, '') || '0';
  }
}

function nativeWindowHandleString(win) {
  if (!win || win.isDestroyed()) return '';
  try {
    const handle = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(handle) || !handle.length) return '';
    if (process.platform === 'win32') {
      return normalizeWindowHandle(handle.readBigUInt64LE(0).toString());
    }
    return normalizeWindowHandle(handle.readUInt32LE(0).toString());
  } catch (_error) {
    return '';
  }
}

function rememberPasteTarget(hwnd) {
  const normalized = normalizeWindowHandle(hwnd);
  if (!normalized) return false;
  const quickHwnd = nativeWindowHandleString(quickWindow);
  const mainHwnd = nativeWindowHandleString(mainWindow);
  if (normalized === quickHwnd || normalized === mainHwnd) return false;
  lastPasteTargetHwnd = normalized;
  lastPasteTargetAt = Date.now();
  return true;
}

function isQuickWindowUsable() {
  return !!(quickWindow && !quickWindow.isDestroyed() && !quickWindow.webContents.isDestroyed());
}

function sendQuickWindow(channel, ...args) {
  if (!isQuickWindowUsable()) return false;
  try {
    quickWindow.webContents.send(channel, ...args);
    return true;
  } catch (_error) {
    return false;
  }
}

function activateWindowHandle(hwnd) {
  return new Promise((resolve) => {
    if (!hwnd) {
      resolve(false);
      return;
    }
    const helper = clipboardHelperPath();
    if (process.platform === 'win32' && fs.existsSync(helper)) {
      execFile(helper, ['activate', String(hwnd)], {
        windowsHide: true,
        timeout: 900,
        maxBuffer: 1024,
      }, (error, stdout) => {
        resolve(!error && /true/i.test(String(stdout || '')));
      });
      return;
    }
    const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class XuanNianPasteTarget { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\'',
      '$hwnd = [IntPtr][Int64]$env:XUANNIAN_TARGET_HWND',
      'if ([XuanNianPasteTarget]::IsIconic($hwnd)) { [XuanNianPasteTarget]::ShowWindowAsync($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 80 }',
      '[XuanNianPasteTarget]::BringWindowToTop($hwnd) | Out-Null',
      'Start-Sleep -Milliseconds 30',
      '[Console]::Out.Write([XuanNianPasteTarget]::SetForegroundWindow($hwnd))',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: 1600,
      env: { ...process.env, XUANNIAN_TARGET_HWND: String(hwnd) },
    }, (error, stdout) => {
      resolve(!error && /true/i.test(String(stdout || '')));
    });
  });
}

function sendPasteShortcut() {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class XuanNianPasteKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }\'',
      '$KEYUP = 2',
      'Start-Sleep -Milliseconds 20',
      '[XuanNianPasteKeys]::keybd_event(0x11, 0, 0, 0)',
      'Start-Sleep -Milliseconds 8',
      '[XuanNianPasteKeys]::keybd_event(0x56, 0, 0, 0)',
      'Start-Sleep -Milliseconds 8',
      '[XuanNianPasteKeys]::keybd_event(0x56, 0, $KEYUP, 0)',
      'Start-Sleep -Milliseconds 8',
      '[XuanNianPasteKeys]::keybd_event(0x11, 0, $KEYUP, 0)',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

function activateWindowAndPaste(hwnd) {
  return new Promise((resolve) => {
    const helper = clipboardHelperPath();
    if (process.platform === 'win32' && fs.existsSync(helper)) {
      execFile(helper, ['paste', String(hwnd || '')], {
        windowsHide: true,
        timeout: 900,
        maxBuffer: 1024,
      }, (error) => {
        resolve(!error);
      });
      return;
    }
    const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class XuanNianPasteFast { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }\'',
      '$KEYUP = 2',
      '$raw = $env:XUANNIAN_TARGET_HWND',
      'if ($raw -and $raw -ne "0") {',
      '  $hwnd = [IntPtr][Int64]$raw',
      '  if ([XuanNianPasteFast]::IsIconic($hwnd)) { [XuanNianPasteFast]::ShowWindowAsync($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 35 }',
      '  [XuanNianPasteFast]::BringWindowToTop($hwnd) | Out-Null',
      '  [XuanNianPasteFast]::SetForegroundWindow($hwnd) | Out-Null',
      '  Start-Sleep -Milliseconds 35',
      '} else { Start-Sleep -Milliseconds 15 }',
      '[XuanNianPasteFast]::keybd_event(0x11, 0, 0, 0)',
      'Start-Sleep -Milliseconds 6',
      '[XuanNianPasteFast]::keybd_event(0x56, 0, 0, 0)',
      'Start-Sleep -Milliseconds 6',
      '[XuanNianPasteFast]::keybd_event(0x56, 0, $KEYUP, 0)',
      'Start-Sleep -Milliseconds 6',
      '[XuanNianPasteFast]::keybd_event(0x11, 0, $KEYUP, 0)',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 1600,
      env: { ...process.env, XUANNIAN_TARGET_HWND: String(hwnd || '') },
    }, (error) => {
      resolve(!error);
    });
  });
}

async function activateWindowAndPasteWithRetry(hwnd, retries = 1) {
  if (!hwnd) return false;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ok = await activateWindowAndPaste(hwnd);
    if (ok) return true;
    await sleep(90 + attempt * 60);
  }
  return false;
}

async function pasteClipboardToActiveTarget() {
  hideQuickWindow();
  await sleep(35);
  const targetFresh = lastPasteTargetHwnd && (!lastPasteTargetAt || Date.now() - lastPasteTargetAt < 120000);
  if (pendingCompositePaste?.text && pendingCompositePaste.files?.length) {
    const pending = pendingCompositePaste;
    pendingCompositePaste = null;
    const hwnd = lastPasteTargetHwnd;
    if (!hwnd || !targetFresh) return false;
    if (process.platform === 'win32') {
      return pasteCompositeToTarget(hwnd, pending);
    }
  }
  if (process.platform === 'win32') {
    if (!lastPasteTargetHwnd || !targetFresh) return false;
    return activateWindowAndPasteWithRetry(lastPasteTargetHwnd, 1);
  }
  if (lastPasteTargetHwnd) {
    await activateWindowHandle(lastPasteTargetHwnd);
    await sleep(55);
  }
  return sendPasteShortcut();
}

async function setTextClipboardForPaste(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  const digest = `text:${crypto.createHash('sha256').update(value.trim()).digest('hex')}`;
  rememberSelfClipboardDigest(digest, 4000);
  suppressTextClipboardUntil = Date.now() + 2500;
  clipboard.writeText(value);
  const sequence = await readClipboardSequence().catch(() => 0);
  if (sequence) {
    rememberSelfClipboardSequence(sequence, 30000);
    rememberClipboardSequence(sequence);
    lastCapturedClipboardSequence = sequence;
    lastClipboardDigest = `${digest}:seq:${sequence}`;
  } else {
    lastClipboardDigest = digest;
  }
  return true;
}

async function pasteCompositeToTarget(hwnd, pending) {
  const files = normalizeExistingFilePaths(pending?.files || []);
  const text = String(pending?.text || '').trim();
  if (!hwnd || !files.length) return false;
  if (text) {
    await setTextClipboardForPaste(text);
    await activateWindowAndPasteWithRetry(hwnd, 1);
    await sleep(90);
    await copyFileToClipboard(files, pending.action || 'copy', '', { stagePaste: false });
    const pastedFiles = await activateWindowAndPasteWithRetry(hwnd, 1);
    setTimeout(() => {
      copyFileToClipboard(files, pending.action || 'copy', text, { stagePaste: false }).catch(() => {});
    }, 160);
    return pastedFiles;
  }
  return activateWindowAndPasteWithRetry(hwnd, 1);
}

function createTray() {
  if (tray) return tray;
  const iconPath = trayIconPath();
  const trayImage = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(trayImage.isEmpty() ? nativeImage.createEmpty() : trayImage);
  tray.setToolTip(`玄念${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `打开玄念${app.getVersion()}`, click: showMainWindow },
    { label: '打开快捷面板', click: showQuickWindow },
    { label: '全盘查找', click: showFileSearchWindow },
    { label: '设置', click: showSettingsWindow },
    { type: 'separator' },
    {
      label: `退出玄念${app.getVersion()}`,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readDataJson(file, fallback) {
  return readJsonWithRecoverySync(file, fallback, {
    onRecover: ({ backupFile }) => runtimeLog(`restored data file from backup: ${backupFile}`),
  });
}

function writeJson(file, data, serialized = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialized || JSON.stringify(data), 'utf8');
}

function startupMigrationStateFile() {
  return path.join(app.getPath('userData'), STARTUP_MIGRATION_STATE_FILE);
}

function startupMigrationFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return '';
  }
}

function cloneDataSnapshot(data) {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function dataContentWeight(data = {}) {
  return ['records', 'notes', 'stickyNotes', 'inspirations'].reduce((sum, key) => (
    sum + (Array.isArray(data[key]) ? data[key].length : 0)
  ), 0);
}

function recordMergeKey(item = {}) {
  if (item.id) return `id:${item.id}`;
  if (item.clipboardDigest) return `digest:${item.clipboardDigest}`;
  const files = Array.isArray(item.files) ? item.files.join('|') : '';
  return `record:${item.type || ''}:${String(item.content || '').trim()}:${files}`;
}

function noteMergeKey(item = {}) {
  if (item.id) return `id:${item.id}`;
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.map((attachment) => attachment?.path || attachment?.preview || attachment?.name || '').join('|')
    : '';
  return `note:${String(item.title || '').trim()}:${String(item.content || '').trim()}:${attachments}`;
}

function projectMergeKey(item = {}) {
  return item.id ? `id:${item.id}` : `name:${String(item.name || '').trim()}`;
}

function mergeArrayByKey(current = [], incoming = [], keyFn, preferLatest = false) {
  const map = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!item) continue;
    const key = keyFn(item);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    if (preferLatest) {
      const existingAt = Number(existing.updatedAt || existing.createdAt || 0);
      const itemAt = Number(item.updatedAt || item.createdAt || 0);
      if (itemAt > existingAt) map.set(key, { ...existing, ...item });
    }
  }
  return [...map.values()];
}

function mergeDataSnapshots(base = defaultData(), incoming = null) {
  if (!incoming || typeof incoming !== 'object') return base;
  const baseHasContent = dataContentWeight(base) > 0;
  const next = {
    ...base,
    settings: baseHasContent
      ? { ...defaultData().settings, ...sanitizeSettings(base.settings) }
      : { ...defaultData().settings, ...sanitizeSettings(incoming.settings), ...sanitizeSettings(base.settings) },
  };
  next.records = mergeArrayByKey(next.records, incoming.records, recordMergeKey, true)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  next.noteProjects = mergeArrayByKey(next.noteProjects, incoming.noteProjects, projectMergeKey, false);
  next.notes = mergeArrayByKey(next.notes, incoming.notes, noteMergeKey, true)
    .sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)));
  next.stickyProjects = mergeArrayByKey(next.stickyProjects, incoming.stickyProjects, projectMergeKey, false);
  next.stickyNotes = mergeArrayByKey(next.stickyNotes, incoming.stickyNotes, noteMergeKey, true)
    .sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)));
  next.inspirationCategories = mergeArrayByKey(next.inspirationCategories, incoming.inspirationCategories, projectMergeKey, false);
  next.inspirations = mergeArrayByKey(next.inspirations, incoming.inspirations, noteMergeKey, true)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return next;
}

function registryStoragePaths() {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync('reg.exe', ['QUERY', 'HKCU\\Software\\XuanNian2.0', '/v', 'StoragePath'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1200,
    });
    const match = String(output || '').match(/StoragePath\s+REG_SZ\s+(.+)/i);
    const value = match ? match[1].trim() : '';
    return value && path.isAbsolute(value) ? [value] : [];
  } catch {
    return [];
  }
}

function candidateUserDataFiles() {
  const appData = app.getPath('appData');
  const names = new Set([
    'xuannian',
    'XuanNian',
    'XuanNian2.0',
    'XuanNian3.0',
    'XuanNian4.0',
    'XuanNian5.0',
    'XuanNian6.0',
    'XuanNian6.0.1',
    'XuanNian6.0.2',
    '玄念',
    '玄念2.0',
    '玄念3.0',
    '玄念4.0',
    '玄念5.0',
    '玄念6.0',
    '玄念6.0.1',
    '玄念6.0.2',
    'app.xuannian.desktop',
    app.getName(),
  ].filter(Boolean));
  const dirs = new Set([app.getPath('userData')]);
  for (const name of names) dirs.add(path.join(appData, name));
  for (const registryPath of registryStoragePaths()) dirs.add(registryPath);
  const primary = readDataJson(userDataFile(), null);
  const primaryStorage = primary?.settings?.storagePath;
  if (primaryStorage && path.isAbsolute(primaryStorage)) dirs.add(primaryStorage);
  for (const dir of [...dirs]) {
    const data = readDataJson(path.join(dir, 'xuannian-data.json'), null);
    const storagePath = data?.settings?.storagePath;
    if (storagePath && path.isAbsolute(storagePath)) dirs.add(storagePath);
  }
  return [...dirs].map((dir) => path.join(dir, 'xuannian-data.json'));
}

function backupStartupData(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const backup = path.join(dir, `xuannian-data.startup-backup-${stamp}.json`);
    if (!fs.existsSync(backup)) fs.copyFileSync(filePath, backup);
  } catch {}
}

function protectUserDataOnStartup() {
  if (startupDataProtectionComplete) return;
  startupDataProtectionComplete = true;
  const primaryFile = userDataFile();
  const primaryResolved = path.resolve(primaryFile).toLocaleLowerCase('en-US');
  const candidates = [...new Set(candidateUserDataFiles().map((file) => path.resolve(file)))];
  const currentRaw = readDataJson(primaryFile, null);
  const migrationState = readJson(startupMigrationStateFile(), { version: 1, files: {} });
  const migratedFiles = migrationState && typeof migrationState.files === 'object' ? migrationState.files : {};
  const pendingCandidates = [];
  for (const file of candidates) {
    const key = file.toLocaleLowerCase('en-US');
    if (key === primaryResolved) continue;
    const fingerprint = startupMigrationFingerprint(file);
    if (!fingerprint || migratedFiles[key] === fingerprint) continue;
    const incoming = readDataJson(file, null);
    if (!incoming || typeof incoming !== 'object') continue;
    pendingCandidates.push({ file, key, fingerprint, incoming });
  }
  if (!currentRaw || pendingCandidates.length) backupStartupData(primaryFile);
  let merged = currentRaw && typeof currentRaw === 'object' ? currentRaw : defaultData();
  let changed = false;
  for (const { file, key, fingerprint, incoming } of pendingCandidates) {
    backupStartupData(file);
    const beforeSerialized = JSON.stringify(merged);
    merged = mergeDataSnapshots(merged, incoming);
    if (JSON.stringify(merged) !== beforeSerialized) changed = true;
    migratedFiles[key] = fingerprint;
  }
  if (!currentRaw || changed) {
    merged = applyRecordsJournal(merged);
    saveData(merged, { skipLocalizeAssets: true, sync: true, clone: false });
  }
  if (pendingCandidates.length) {
    writeJson(startupMigrationStateFile(), { version: 1, files: migratedFiles });
  }
}

function normalizeAccelerator(hotkey) {
  return String(hotkey || 'Ctrl+Alt+X').replace(/\bCtrl\b/g, 'CommandOrControl');
}

function isMouseHotkey(hotkey) {
  return /(?:^|\+)(MouseLeft|MouseRight|MouseMiddle)$/i.test(String(hotkey || ''));
}

function isKeyboardHotkey(hotkey) {
  const value = String(hotkey || '').trim();
  return !!value && !isMouseHotkey(value) && !/(?:^|\+)Wheel$/i.test(value);
}

function stopMouseHotkeyHook() {
  const process = mouseHotkeyProcess;
  mouseHotkeyProcess = null;
  mouseHotkeyBuffer = '';
  if (process && !process.killed) process.kill();
}

function stopKeyboardHotkeyHook() {
  const process = keyboardHotkeyProcess;
  keyboardHotkeyProcess = null;
  keyboardHotkeyBuffer = '';
  if (process && !process.killed) process.kill();
}

function stopNativeHotkeyHook() {
  const process = nativeHotkeyProcess;
  nativeHotkeyProcess = null;
  nativeHotkeyBuffer = '';
  if (process && !process.killed) process.kill();
}

function pointInBounds(point, bounds, padding = 0) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.width + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.height + padding;
}

function handleGlobalMouseClick(hwnd, x, y) {
  if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) return;
  if (Date.now() - lastQuickToggleAt < 220) return;
  const point = { x: Number(x), y: Number(y) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  if (pointInBounds(point, quickWindow.getBounds(), 1)) return;
  hideQuickWindow();
}

async function triggerScreenshotHotkey() {
  const data = loadData();
  const result = await captureScreenshotToClipboard({
    forceInternal: true,
    hideWindow: !!data.settings?.hideWindowOnScreenshot,
  }, mainWindow);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('native-screenshot-captured', result);
  }
}

function triggerQuickStickyHotkey() {
  if (Date.now() - lastStickyHotkeyAt < 350) return;
  lastStickyHotkeyAt = Date.now();
  showStickyNoteWindow({ editNew: true, source: 'sticky' });
}

function startKeyboardHotkeyHook(settings = {}) {
  stopKeyboardHotkeyHook();
  if (process.platform !== 'win32') return true;
  const quickKey = isKeyboardHotkey(settings.quickMenuHotkey) ? normalizeAccelerator(settings.quickMenuHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  const screenshotKey = isKeyboardHotkey(settings.screenshotHotkey) ? normalizeAccelerator(settings.screenshotHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  const stickyKey = isKeyboardHotkey(settings.quickStickyHotkey) ? normalizeAccelerator(settings.quickStickyHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  if (!quickKey && !screenshotKey && !stickyKey) return true;

  const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class XuanNianKeyboardHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int VK_CONTROL = 0x11;
  private const int VK_MENU = 0x12;
  private const int VK_SHIFT = 0x10;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
  private static readonly LowLevelKeyboardProc Proc = HookCallback;
  private static IntPtr HookId = IntPtr.Zero;
  private static string Quick = "";
  private static string Screenshot = "";
  private static string Sticky = "";
  private static string LastAction = "";
  private static int LastTick = 0;

  [StructLayout(LayoutKind.Sequential)]
  private struct KeyboardEvent {
    public int VkCode;
    public int ScanCode;
    public int Flags;
    public int Time;
    public IntPtr ExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Point {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Message {
    public IntPtr HWnd;
    public uint Value;
    public UIntPtr WParam;
    public IntPtr LParam;
    public uint Time;
    public Point Position;
    public uint Private;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  private static bool Down(int key) {
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  }

  private static string KeyName(int vk) {
    if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
    if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
    if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x6F).ToString();
    switch (vk) {
      case 0x08: return "Backspace";
      case 0x09: return "Tab";
      case 0x0D: return "Enter";
      case 0x1B: return "Escape";
      case 0x20: return "Space";
      case 0x21: return "PageUp";
      case 0x22: return "PageDown";
      case 0x23: return "End";
      case 0x24: return "Home";
      case 0x25: return "ArrowLeft";
      case 0x26: return "ArrowUp";
      case 0x27: return "ArrowRight";
      case 0x28: return "ArrowDown";
      case 0x2D: return "Insert";
      case 0x2E: return "Delete";
      default: return "";
    }
  }

  private static string Current(int vk) {
    string key = KeyName(vk);
    if (String.IsNullOrEmpty(key)) return "";
    var parts = new List<string>();
    if (Down(VK_CONTROL)) parts.Add("Ctrl");
    if (Down(VK_LWIN) || Down(VK_RWIN)) parts.Add("Meta");
    if (Down(VK_MENU)) parts.Add("Alt");
    if (Down(VK_SHIFT)) parts.Add("Shift");
    parts.Add(key);
    return string.Join("+", parts);
  }

  private static bool Emit(string action) {
    int now = Environment.TickCount;
    if (action == LastAction && Math.Abs(now - LastTick) < 260) return true;
    LastAction = action;
    LastTick = now;
    Console.WriteLine(action + "\t" + GetForegroundWindow().ToInt64().ToString());
    Console.Out.Flush();
    return true;
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    int message = wParam.ToInt32();
    if (nCode >= 0 && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)) {
      KeyboardEvent evt = (KeyboardEvent)Marshal.PtrToStructure(lParam, typeof(KeyboardEvent));
      string combo = Current(evt.VkCode);
      if (!String.IsNullOrEmpty(combo)) {
        if (!String.IsNullOrEmpty(Quick) && combo == Quick) { Emit("QUICK"); return (IntPtr)1; }
        if (!String.IsNullOrEmpty(Screenshot) && combo == Screenshot) { Emit("SCREENSHOT"); return (IntPtr)1; }
        if (!String.IsNullOrEmpty(Sticky) && combo == Sticky) { Emit("STICKY"); return (IntPtr)1; }
      }
    }
    return CallNextHookEx(HookId, nCode, wParam, lParam);
  }

  public static void Run(string quick, string screenshot, string sticky) {
    Quick = quick ?? "";
    Screenshot = screenshot ?? "";
    Sticky = sticky ?? "";
    using (Process process = Process.GetCurrentProcess())
    using (ProcessModule module = process.MainModule) {
      HookId = SetWindowsHookEx(WH_KEYBOARD_LL, Proc, GetModuleHandle(module.ModuleName), 0);
    }
    if (HookId == IntPtr.Zero) Environment.Exit(2);
    Console.WriteLine("READY");
    Console.Out.Flush();
    Message message;
    while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref message);
      DispatchMessage(ref message);
    }
    UnhookWindowsHookEx(HookId);
  }
}
"@
[XuanNianKeyboardHook]::Run($env:XUANNIAN_KEY_QUICK, $env:XUANNIAN_KEY_SCREENSHOT, $env:XUANNIAN_KEY_STICKY)
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      XUANNIAN_KEY_QUICK: quickKey,
      XUANNIAN_KEY_SCREENSHOT: screenshotKey,
      XUANNIAN_KEY_STICKY: stickyKey,
    },
  });
  keyboardHotkeyProcess = child;
  keyboardHotkeyBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    keyboardHotkeyBuffer += chunk;
    const lines = keyboardHotkeyBuffer.split(/\r?\n/);
    keyboardHotkeyBuffer = lines.pop() || '';
    for (const line of lines) {
      const [action, hwnd] = line.trim().split(/\t+/);
      if (!action || action === 'READY') continue;
      if (action === 'QUICK') showQuickWindow(hwnd);
      if (action === 'SCREENSHOT') triggerScreenshotHotkey().catch(() => {});
      if (action === 'STICKY') triggerQuickStickyHotkey();
    }
  });
  child.on('exit', () => {
    if (keyboardHotkeyProcess === child) keyboardHotkeyProcess = null;
  });
  return true;
}

function startMouseHotkeyHook(settings = {}) {
  stopMouseHotkeyHook();
  const quickMouse = isMouseHotkey(settings.quickMenuHotkey) ? settings.quickMenuHotkey : '';
  const screenshotMouse = isMouseHotkey(settings.screenshotHotkey) ? settings.screenshotHotkey : '';
  const stickyMouse = isMouseHotkey(settings.quickStickyHotkey) ? settings.quickStickyHotkey : '';
  if (!quickMouse && !screenshotMouse && !stickyMouse) return true;

  const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class XuanNianMouseHook {
  private const int WH_MOUSE_LL = 14;
  private const int WM_LBUTTONDOWN = 0x0201;
  private const int WM_LBUTTONUP = 0x0202;
  private const int WM_RBUTTONDOWN = 0x0204;
  private const int WM_RBUTTONUP = 0x0205;
  private const int WM_MBUTTONDOWN = 0x0207;
  private const int WM_MBUTTONUP = 0x0208;
  private const int VK_CONTROL = 0x11;
  private const int VK_MENU = 0x12;
  private const int VK_SHIFT = 0x10;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;

  private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
  private static readonly LowLevelMouseProc Proc = HookCallback;
  private static IntPtr HookId = IntPtr.Zero;
  private static string Quick = "";
  private static string Screenshot = "";
  private static string Sticky = "";
  private static bool SuppressLeft = false;
  private static bool SuppressRight = false;
  private static bool SuppressMiddle = false;

  [StructLayout(LayoutKind.Sequential)]
  private struct Point {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Message {
    public IntPtr HWnd;
    public uint Value;
    public UIntPtr WParam;
    public IntPtr LParam;
    public uint Time;
    public Point Position;
    public uint Private;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  private static bool Down(int key) {
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  }

  private static string Current(string mouse) {
    var parts = new List<string>();
    if (Down(VK_CONTROL)) parts.Add("Ctrl");
    if (Down(VK_LWIN) || Down(VK_RWIN)) parts.Add("Meta");
    if (Down(VK_MENU)) parts.Add("Alt");
    if (Down(VK_SHIFT)) parts.Add("Shift");
    parts.Add(mouse);
    return string.Join("+", parts);
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    int message = wParam.ToInt32();
    if (nCode >= 0) {
      if (message == WM_LBUTTONUP && SuppressLeft) {
        SuppressLeft = false;
        return (IntPtr)1;
      }
      if (message == WM_RBUTTONUP && SuppressRight) {
        SuppressRight = false;
        return (IntPtr)1;
      }
      if (message == WM_MBUTTONUP && SuppressMiddle) {
        SuppressMiddle = false;
        return (IntPtr)1;
      }
      if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN) {
        string mouse = message == WM_LBUTTONDOWN ? "MouseLeft" : (message == WM_RBUTTONDOWN ? "MouseRight" : "MouseMiddle");
        string combo = Current(mouse);
        if (!String.IsNullOrEmpty(Quick) && combo == Quick) {
          if (mouse == "MouseLeft") SuppressLeft = true; else if (mouse == "MouseRight") SuppressRight = true; else SuppressMiddle = true;
          Console.WriteLine("QUICK\t" + GetForegroundWindow().ToInt64().ToString());
          Console.Out.Flush();
          return (IntPtr)1;
        }
        if (!String.IsNullOrEmpty(Screenshot) && combo == Screenshot) {
          if (mouse == "MouseLeft") SuppressLeft = true; else if (mouse == "MouseRight") SuppressRight = true; else SuppressMiddle = true;
          Console.WriteLine("SCREENSHOT\t" + GetForegroundWindow().ToInt64().ToString());
          Console.Out.Flush();
          return (IntPtr)1;
        }
        if (!String.IsNullOrEmpty(Sticky) && combo == Sticky) {
          if (mouse == "MouseLeft") SuppressLeft = true; else if (mouse == "MouseRight") SuppressRight = true; else SuppressMiddle = true;
          Console.WriteLine("STICKY\t" + GetForegroundWindow().ToInt64().ToString());
          Console.Out.Flush();
          return (IntPtr)1;
        }
      }
    }
    return CallNextHookEx(HookId, nCode, wParam, lParam);
  }

  public static void Run(string quick, string screenshot, string sticky) {
    Quick = quick ?? "";
    Screenshot = screenshot ?? "";
    Sticky = sticky ?? "";
    using (Process process = Process.GetCurrentProcess())
    using (ProcessModule module = process.MainModule) {
      HookId = SetWindowsHookEx(WH_MOUSE_LL, Proc, GetModuleHandle(module.ModuleName), 0);
    }
    if (HookId == IntPtr.Zero) Environment.Exit(2);
    Message message;
    while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref message);
      DispatchMessage(ref message);
    }
    UnhookWindowsHookEx(HookId);
  }
}
"@
[XuanNianMouseHook]::Run($env:XUANNIAN_MOUSE_QUICK, $env:XUANNIAN_MOUSE_SCREENSHOT, $env:XUANNIAN_MOUSE_STICKY)
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      XUANNIAN_MOUSE_QUICK: quickMouse,
      XUANNIAN_MOUSE_SCREENSHOT: screenshotMouse,
      XUANNIAN_MOUSE_STICKY: stickyMouse,
    },
  });
  mouseHotkeyProcess = child;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    mouseHotkeyBuffer += chunk;
    const lines = mouseHotkeyBuffer.split(/\r?\n/);
    mouseHotkeyBuffer = lines.pop() || '';
    for (const line of lines) {
      const [action, hwnd] = line.trim().split(/\t+/);
      if (action === 'QUICK') showQuickWindow(hwnd);
      if (action === 'SCREENSHOT') triggerScreenshotHotkey().catch(() => {});
      if (action === 'STICKY') triggerQuickStickyHotkey();
    }
  });
  child.on('exit', () => {
    if (mouseHotkeyProcess === child) mouseHotkeyProcess = null;
  });
  return true;
}

function startNativeHotkeyHook(settings = {}) {
  stopNativeHotkeyHook();
  if (process.platform !== 'win32') return false;
  const helper = clipboardHelperPath();
  if (!helper || !fs.existsSync(helper)) return false;
  const quickKey = isKeyboardHotkey(settings.quickMenuHotkey) ? normalizeAccelerator(settings.quickMenuHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  const screenshotKey = isKeyboardHotkey(settings.screenshotHotkey) ? normalizeAccelerator(settings.screenshotHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  const stickyKey = isKeyboardHotkey(settings.quickStickyHotkey) ? normalizeAccelerator(settings.quickStickyHotkey).replace(/\bCommandOrControl\b/g, 'Ctrl') : '';
  const quickMouse = isMouseHotkey(settings.quickMenuHotkey) ? settings.quickMenuHotkey : '';
  const screenshotMouse = isMouseHotkey(settings.screenshotHotkey) ? settings.screenshotHotkey : '';
  const stickyMouse = isMouseHotkey(settings.quickStickyHotkey) ? settings.quickStickyHotkey : '';
  const child = spawn(helper, ['hotkeys', quickKey, screenshotKey, stickyKey, quickMouse, screenshotMouse, stickyMouse], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  nativeHotkeyProcess = child;
  nativeHotkeyBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    nativeHotkeyBuffer += chunk;
    const lines = nativeHotkeyBuffer.split(/\r?\n/);
    nativeHotkeyBuffer = lines.pop() || '';
    for (const rawLine of lines) {
      const parts = rawLine.trim().split(/\t+/);
      const action = parts[0];
      if (!action || action === 'READY') continue;
      if (action === 'QUICK') showQuickWindow(parts[1]);
      else if (action === 'SCREENSHOT') triggerScreenshotHotkey().catch(() => {});
      else if (action === 'STICKY') triggerQuickStickyHotkey();
      else if (action === 'CLICK') handleGlobalMouseClick(parts[1], parts[2], parts[3]);
    }
  });
  child.on('exit', () => {
    if (nativeHotkeyProcess === child) nativeHotkeyProcess = null;
  });
  return true;
}

function registerAppHotkeys(settings = {}) {
  globalShortcut.unregisterAll();
  stopKeyboardHotkeyHook();
  stopMouseHotkeyHook();
  stopNativeHotkeyHook();
  quickHotkey = settings.quickMenuHotkey || quickHotkey || 'Ctrl+Alt+X';
  screenshotHotkey = settings.screenshotHotkey || screenshotHotkey || 'Ctrl+Alt+D';
  quickStickyHotkey = settings.quickStickyHotkey || quickStickyHotkey || 'Ctrl+Alt+S';
  fileSearchHotkey = settings.fileSearchHotkey || fileSearchHotkey || 'Ctrl+Alt+A';
  const quickOk = isMouseHotkey(quickHotkey) || globalShortcut.register(normalizeAccelerator(quickHotkey), () => {
    showQuickWindow();
  });
  let screenshotOk = true;
  if (screenshotHotkey && screenshotHotkey !== quickHotkey) {
    screenshotOk = isMouseHotkey(screenshotHotkey) || globalShortcut.register(normalizeAccelerator(screenshotHotkey), () => {
      triggerScreenshotHotkey().catch(() => {});
    });
  } else {
    screenshotOk = false;
  }
  let stickyOk = true;
  if (quickStickyHotkey && quickStickyHotkey !== quickHotkey && quickStickyHotkey !== screenshotHotkey) {
    stickyOk = isMouseHotkey(quickStickyHotkey) || globalShortcut.register(normalizeAccelerator(quickStickyHotkey), triggerQuickStickyHotkey);
  } else {
    stickyOk = false;
  }
  let searchOk = true;
  if (fileSearchHotkey && !isMouseHotkey(fileSearchHotkey) && ![quickHotkey, screenshotHotkey, quickStickyHotkey].includes(fileSearchHotkey)) {
    searchOk = globalShortcut.register(normalizeAccelerator(fileSearchHotkey), showFileSearchWindow);
  } else {
    searchOk = false;
  }
  const nativeOk = startNativeHotkeyHook({ quickMenuHotkey: quickHotkey, screenshotHotkey, quickStickyHotkey });
  if (!nativeOk) {
    const keyboardOk = startKeyboardHotkeyHook({ quickMenuHotkey: quickHotkey, screenshotHotkey, quickStickyHotkey });
    const mouseOk = startMouseHotkeyHook({ quickMenuHotkey: quickHotkey, screenshotHotkey, quickStickyHotkey });
    if (!keyboardOk) return { quickOk: false, screenshotOk: false, stickyOk: false, searchOk: false };
    if (!mouseOk) return { quickOk: false, screenshotOk: false, stickyOk: false, searchOk: false };
  }
  return { quickOk, screenshotOk, stickyOk, searchOk };
}

function hotkeyParts(hotkey) {
  return String(hotkey || quickHotkey || 'Ctrl+Alt+X').split('+').map((part) => part.trim()).filter(Boolean);
}

function stopQuickOutsideCloseWatcher() {
  if (quickOutsideCloseTimer) clearInterval(quickOutsideCloseTimer);
  quickOutsideCloseTimer = null;
  quickOutsideCloseChecking = false;
}

function scheduleQuickWindowPrewarm(delay = 80) {
  if (quickWindowPrewarmTimer) clearTimeout(quickWindowPrewarmTimer);
  quickWindowPrewarmTimer = setTimeout(() => {
    quickWindowPrewarmTimer = null;
    if (isQuitting) return;
    if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  }, delay);
}

function hideQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed()) return false;
  stopQuickOutsideCloseWatcher();
  setQuickEditorMode(false);
  quickWindowFocusedOnce = false;
  quickWindowMoveSession = null;
  try {
    if (quickWindow.isVisible()) quickWindow.hide();
  } catch (_error) {
    return false;
  }
  return true;
}

function startQuickOutsideCloseWatcher() {
  stopQuickOutsideCloseWatcher();
  // Global mouse clicks are handled by the native hotkey helper. Keeping the
  // old foreground polling here would continuously spawn helper processes and
  // is one of the long-running performance drains.
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: 460,
    height: 560,
    minWidth: 460,
    minHeight: 560,
    maxWidth: 760,
    maxHeight: 760,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: appIconPath(),
    title: `玄念${app.getVersion()}快捷面板`,
    transparent: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  quickWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachPageDiagnostics(quickWindow, 'quick');
  quickWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  quickWindow.on('focus', () => {
    quickWindowFocusedOnce = true;
    setTimeout(startQuickOutsideCloseWatcher, 280);
  });
  quickWindow.on('blur', () => {
    setTimeout(() => {
      if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) return;
      if (!quickWindowFocusedOnce || Date.now() - lastQuickToggleAt < 260) return;
      if (!quickWindow.isFocused()) hideQuickWindow();
    }, 80);
  });
  quickWindow.on('hide', stopQuickOutsideCloseWatcher);
  quickWindow.on('closed', () => {
    stopQuickOutsideCloseWatcher();
    quickWindowMoveSession = null;
    if (quickWindowWarmRefreshTimer) clearTimeout(quickWindowWarmRefreshTimer);
    quickWindowWarmRefreshTimer = null;
    quickWindowFocusedOnce = false;
    quickWindow = null;
    scheduleQuickWindowPrewarm(240);
  });
  loadAppHtml(quickWindow, 'quick.html').then(() => {
    quickWindowRevision = dataRevision;
  });
}

function setQuickEditorMode(enabled) {
  if (!quickWindow || quickWindow.isDestroyed()) return false;
  const nextEnabled = !!enabled;
  if (nextEnabled === quickWindowEditorMode) return true;
  quickWindowEditorMode = nextEnabled;

  if (!nextEnabled) {
    if (quickWindowNormalBounds) quickWindow.setBounds(quickWindowNormalBounds);
    quickWindowNormalBounds = null;
    return true;
  }

  quickWindowNormalBounds = quickWindow.getBounds();
  const display = screen.getDisplayMatching(quickWindowNormalBounds);
  const area = display.workArea;
  const width = Math.min(700, area.width - 24);
  const height = Math.min(720, area.height - 24);
  const centerX = quickWindowNormalBounds.x + Math.round(quickWindowNormalBounds.width / 2);
  const centerY = quickWindowNormalBounds.y + Math.round(quickWindowNormalBounds.height / 2);
  const x = Math.min(Math.max(centerX - Math.round(width / 2), area.x + 12), area.x + area.width - width - 12);
  const y = Math.min(Math.max(centerY - Math.round(height / 2), area.y + 12), area.y + area.height - height - 12);
  quickWindow.setBounds({ x, y, width, height });
  return true;
}

function showQuickWindow(targetHwnd = '') {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  if (!quickWindow) return;
  const width = 460;
  const height = 560;
  quickWindowEditorMode = false;
  quickWindowNormalBounds = null;
  quickWindowFocusedOnce = false;
  lastQuickToggleAt = Date.now();
  const explicitTarget = rememberPasteTarget(targetHwnd);
  if (!explicitTarget) {
    readForegroundWindowHandleAsync()
      .then((hwnd) => rememberPasteTarget(hwnd))
      .catch(() => {});
  }
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const bounds = display.workArea;
  const x = Math.min(Math.max(point.x - Math.round(width / 2), bounds.x + 8), bounds.x + bounds.width - width - 8);
  const y = Math.min(Math.max(point.y - 80, bounds.y + 8), bounds.y + bounds.height - height - 8);
  quickWindow.setBounds({ x, y, width, height });
  if (!quickWindow.isVisible()) quickWindow.show();
  else quickWindow.show();
  quickWindow.focus();
  sendQuickWindow('quick:hotkey', hotkeyParts());
  if (quickWindow.webContents.isLoading()) {
    quickWindow.webContents.once('did-finish-load', () => {
      sendQuickWindow('quick:hotkey', hotkeyParts());
      sendQuickWindow('quick:refresh');
      quickWindowRevision = dataRevision;
      quickWindowDataDirty = false;
    });
  } else if (quickWindowDataDirty || quickWindowRevision !== dataRevision) {
    sendQuickWindow('quick:refresh');
    quickWindowRevision = dataRevision;
    quickWindowDataDirty = false;
  }
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) {
    quickWindow.focus();
    setTimeout(startQuickOutsideCloseWatcher, 360);
  }
}

function stickyImageAttachment(note) {
  const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
  if (attachments.length !== 1) return null;
  return attachments
    .find((item) => item?.kind === 'image' && (item.path || item.preview || item.dataUrl));
}

function stickySingleMediaAttachment(note) {
  const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
  if (attachments.length !== 1) return null;
  const item = attachments[0];
  if (item?.kind === 'image' && (item.path || item.preview || item.dataUrl)) return item;
  if (item?.kind === 'video' && (item.path || item.preview || item.dataUrl)) return item;
  if (item?.path || item?.preview || item?.dataUrl || item?.files?.length) return item;
  return null;
}

function stickyRenderableAttachments(note) {
  const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
  const rank = (item) => {
    if (item?.kind === 'image') return 0;
    if (item?.kind === 'video') return 1;
    if (item?.kind === 'audio') return 2;
    if (item?.kind === 'folder') return 3;
    return 4;
  };
  return [...attachments].sort((a, b) => rank(a) - rank(b));
}

function isMediaOnlyStickyAttachmentSet(attachments = []) {
  return attachments.length > 0 && attachments.every((item) => item?.kind === 'image' || item?.kind === 'video');
}

function shouldUseFreeStickyAttachmentGrid(note) {
  const attachments = stickyRenderableAttachments(note);
  return attachments.length > 6 && !isMediaOnlyStickyAttachmentSet(attachments);
}

function stickyAttachmentLayoutRatio(item) {
  if (item?.kind === 'image') {
    const imageSize = imageSizeFromAttachment(item);
    if (imageSize?.width > 0 && imageSize?.height > 0) {
      return Math.max(0.28, Math.min(4.2, imageSize.width / imageSize.height));
    }
  }
  if (item?.kind === 'video') return 16 / 9;
  return 1;
}

function stickyAttachmentGridRatio(note) {
  const attachments = stickyRenderableAttachments(note);
  if (attachments.length < 2) return 0;
  if (shouldUseFreeStickyAttachmentGrid(note)) return 0;
  const visualCount = attachments.filter((item) => item?.kind === 'image' || item?.kind === 'video').length;
  if (attachments.length > 18 && visualCount === 0) return 1;
  const rows = [];
  for (let i = 0; i < attachments.length; i += 2) {
    rows.push(attachments.slice(i, i + 2));
  }
  const rowRatios = rows.map((row) => row.reduce((sum, item) => sum + stickyAttachmentLayoutRatio(item), 0));
  const maxRowRatio = Math.max(1, ...rowRatios);
  return maxRowRatio / rows.length;
}

function singleStickyMediaRatio(item) {
  if (!item) return 0;
  if (item.kind === 'video') return 16 / 9;
  if (item.kind !== 'image') return 1;
  const size = imageSizeFromAttachment(item);
  if (size?.width > 0 && size?.height > 0) return Math.max(0.2, Math.min(6, size.width / size.height));
  return 0;
}

function imageSizeFromAttachment(item) {
  if (!item) return null;
  if (item.kind && item.kind !== 'image') return null;
  const sourceName = String(item.path || item.preview || item.name || '');
  if (sourceName && !isImageFile(sourceName) && !String(item.dataUrl || item.preview || '').startsWith('data:image/')) return null;
  try {
    let image = null;
    if (item.path && path.isAbsolute(String(item.path)) && fs.existsSync(item.path)) {
      image = nativeImage.createFromPath(item.path);
    } else if (String(item.preview || '').startsWith('file://')) {
      const filePath = parseFileUrl(item.preview);
      if (filePath && fs.existsSync(filePath)) image = nativeImage.createFromPath(filePath);
    } else if (String(item.dataUrl || item.preview || '').startsWith('data:image/')) {
      image = nativeImage.createFromDataURL(item.dataUrl || item.preview);
    }
    const size = image && !image.isEmpty() ? image.getSize() : null;
    if (size?.width > 0 && size?.height > 0) return size;
  } catch {}
  return null;
}

function estimateStickyTextHeight(text, contentWidth) {
  const value = String(text || '').trim();
  if (!value) return 0;
  const charsPerLine = Math.max(10, Math.floor(Math.max(180, contentWidth) / 8.2));
  const lines = value.split(/\r?\n/).reduce((sum, line) => (
    sum + Math.max(1, Math.ceil(Array.from(line || ' ').length / charsPerLine))
  ), 0);
  return Math.min(220, Math.max(42, lines * 24));
}

function isLongStickyText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const lineCount = value.split(/\r?\n/).length;
  return Array.from(value).length > 160 || lineCount > 5;
}

function visibleStickyTextHeight(text, contentWidth) {
  const estimated = estimateStickyTextHeight(text, contentWidth);
  return isLongStickyText(text) ? Math.min(112, estimated) : estimated;
}

function clampBoundsToArea(bounds, area) {
  const width = Math.min(Math.max(Math.round(bounds.width), 180), Math.max(180, area.width - 24));
  const height = Math.min(Math.max(Math.round(bounds.height), 140), Math.max(140, area.height - 24));
  const x = Math.min(Math.max(Math.round(bounds.x), area.x + 12), area.x + area.width - width - 12);
  const y = Math.min(Math.max(Math.round(bounds.y), area.y + 12), area.y + area.height - height - 12);
  return { x, y, width, height };
}

function stickyWindowLayoutForNote(note, area) {
  if (shouldUseFreeStickyAttachmentGrid(note)) {
    return { width: STICKY_FREE_GRID_DEFAULT_WIDTH, height: STICKY_FREE_GRID_DEFAULT_HEIGHT };
  }
  const gridRatio = stickyAttachmentGridRatio(note);
  if (gridRatio > 0) {
    const hasText = !!String(note?.content || '').trim();
    const horizontalExtra = 24;
    const baseExtra = 38 + 22;
    const maxWidth = Math.min(760, area.width - 48);
    const maxHeight = Math.min(area.height - 48, Math.round(area.height * 0.88));
    let contentWidth = Math.min(maxWidth - horizontalExtra, Math.max(300, Math.round(area.width * 0.36)));
    const heightFor = (width) => (
      baseExtra
      + visibleStickyTextHeight(note?.content, width)
      + (hasText ? 10 : 0)
      + Math.round(width / gridRatio)
    );
    let height = heightFor(contentWidth);
    if (height > maxHeight) {
      const fixed = baseExtra + visibleStickyTextHeight(note?.content, contentWidth) + (hasText ? 10 : 0);
      contentWidth = Math.max(180 - horizontalExtra, Math.floor((maxHeight - fixed) * gridRatio));
      height = heightFor(contentWidth);
    }
    return { width: Math.round(contentWidth + horizontalExtra), height: Math.round(height) };
  }
  const media = stickySingleMediaAttachment(note);
  const ratio = singleStickyMediaRatio(media);
  if (!(ratio > 0)) return { width: 360, height: 360 };
  if (isLongStickyText(note?.content)) return { width: 360, height: 360 };
  const hasText = !!String(note?.content || '').trim();
  const mediaCaptionHeight = media?.kind === 'video' ? 22 : 0;
  const maxWidth = Math.min(920, area.width - 48);
  const maxHeight = Math.min(area.height - 48, Math.round(area.height * 0.88));
  const horizontalExtra = 24;
  const baseExtra = 38 + 22;
  let contentWidth = Math.min(
    maxWidth - horizontalExtra,
    Math.max(280, isLongStickyText(note?.content) ? 360 - horizontalExtra : Math.round(area.width * 0.42)),
  );

  const heightFor = (width) => {
    const textHeight = visibleStickyTextHeight(note?.content, width);
    return baseExtra + textHeight + (hasText ? 10 : 0) + Math.round(width / ratio) + mediaCaptionHeight;
  };

  let height = heightFor(contentWidth);
  if (height > maxHeight) {
    const textHeight = visibleStickyTextHeight(note?.content, contentWidth);
    const fixed = baseExtra + textHeight + (hasText ? 10 : 0) + mediaCaptionHeight;
    contentWidth = Math.max(180 - horizontalExtra, Math.floor((maxHeight - fixed) * ratio));
    height = heightFor(contentWidth);
  }
  return {
    width: Math.round(contentWidth + horizontalExtra),
    height: Math.round(height),
  };
}

function initialStickyImageLayout(note, windowSize) {
  if (shouldUseFreeStickyAttachmentGrid(note)) return null;
  const gridRatio = stickyAttachmentGridRatio(note);
  if (gridRatio > 0 && windowSize?.width > 0 && windowSize?.height > 0) {
    const horizontalExtra = 24;
    const contentWidth = Math.max(80, windowSize.width - horizontalExtra);
    return {
      ratio: Math.max(0.2, Math.min(6, gridRatio)),
      horizontalExtra,
      extraHeight: Math.max(0, Math.round(windowSize.height - contentWidth / gridRatio)),
      textFlexible: isLongStickyText(note?.content),
    };
  }
  const ratio = singleStickyMediaRatio(stickySingleMediaAttachment(note));
  if (!(ratio > 0) || !(windowSize?.width > 0) || !(windowSize?.height > 0)) return null;
  const media = stickySingleMediaAttachment(note);
  const mediaCaptionHeight = media?.kind === 'video' ? 22 : 0;
  const horizontalExtra = 24;
  const contentWidth = Math.max(80, windowSize.width - horizontalExtra);
  return {
    ratio,
    horizontalExtra,
    extraHeight: Math.max(0, Math.round(windowSize.height - contentWidth / ratio)),
    textFlexible: isLongStickyText(note?.content),
  };
}

function normalizeStickyImageLayout(layout) {
  if (typeof layout === 'number') {
    const ratio = Number(layout) || 0;
    return ratio > 0 ? { ratio, extraHeight: 0, horizontalExtra: 0 } : null;
  }
  const ratio = Number(layout?.ratio) || 0;
  if (!(ratio > 0)) return null;
  return {
    ratio: Math.max(0.2, Math.min(6, ratio)),
    extraHeight: Math.max(0, Math.min(1000, Number(layout?.extraHeight) || 0)),
    horizontalExtra: Math.max(0, Math.min(200, Number(layout?.horizontalExtra) || 0)),
    textFlexible: !!layout?.textFlexible,
  };
}

function fitStickyWindowToImageLayout(win, layout) {
  if (!win || win.isDestroyed() || !layout?.ratio) return false;
  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  const horizontalExtra = layout.horizontalExtra || 0;
  const extraHeight = layout.extraHeight || 0;
  const minContentWidth = Math.max(80, 180 - horizontalExtra, (140 - extraHeight) * layout.ratio);
  const maxContentWidth = Math.max(minContentWidth, Math.min(
    area.width - 24 - horizontalExtra,
    (area.height - 24 - extraHeight) * layout.ratio,
  ));
  const contentWidth = Math.min(maxContentWidth, Math.max(minContentWidth, current.width - horizontalExtra));
  const width = Math.round(contentWidth + horizontalExtra);
  const height = Math.round(contentWidth / layout.ratio + extraHeight);
  const next = clampBoundsToArea({
    x: current.x + Math.round((current.width - width) / 2),
    y: current.y,
    width,
    height,
  }, area);
  win.setBounds(next, false);
  return true;
}

function stickyInitialBoundsForSize(size) {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  return clampBoundsToArea({
    width: size.width,
    height: size.height,
    x: point.x - Math.round(size.width / 2),
    y: point.y - 48,
  }, area);
}

function scheduleStickyDraftPrewarm(delay = 180) {
  if (stickyDraftPrewarmTimer) clearTimeout(stickyDraftPrewarmTimer);
  stickyDraftPrewarmTimer = setTimeout(() => {
    stickyDraftPrewarmTimer = null;
    if (isQuitting) return;
    if (prewarmedStickyDraftWindow && !prewarmedStickyDraftWindow.isDestroyed()) return;
    createStickyNoteWindow({ editNew: true, source: 'sticky', prewarm: true });
  }, delay);
}

function createStickyNoteWindow({ noteId = '', editNew = false, source = '', prewarm = false } = {}) {
  const existing = noteId ? stickyNoteWindows.get(noteId) : null;
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.setAlwaysOnTop(true);
    existing.moveTop();
    existing.focus();
    return existing;
  }
  if (editNew && !noteId && !prewarm && prewarmedStickyDraftWindow && !prewarmedStickyDraftWindow.isDestroyed()) {
    const win = prewarmedStickyDraftWindow;
    prewarmedStickyDraftWindow = null;
    const bounds = stickyInitialBoundsForSize({ width: 360, height: 360 });
    win.setBounds(bounds, false);
    const showDraft = () => {
      if (win.isDestroyed()) return;
      if (win.webContents.isLoading()) {
        win.once('ready-to-show', showDraft);
        return;
      }
      win.showInactive();
      win.moveTop();
      win.focus();
    };
    showDraft();
    scheduleStickyDraftPrewarm(20);
    return win;
  }
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const data = noteId ? loadData() : null;
  const sourceNote = noteId ? data?.notes?.find((item) => item.id === noteId) : null;
  const sourceSticky = noteId ? data?.stickyNotes?.find((item) => item.id === noteId) : null;
  const noteSource = source || (sourceNote ? 'note' : 'sticky');
  const note = noteSource === 'sticky' ? sourceSticky : (sourceNote || sourceSticky);
  const size = editNew ? { width: 360, height: 360 } : stickyWindowLayoutForNote(note, area);
  const initialBounds = prewarm
    ? { width: size.width, height: size.height, x: area.x - size.width - 80, y: area.y - size.height - 80 }
    : stickyInitialBoundsForSize(size);
  const win = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 180,
    minHeight: 140,
    x: initialBounds.x,
    y: initialBounds.y,
    show: false,
    frame: false,
    // Resizing is handled by the in-page handles so DPI scaling cannot bypass
    // the image aspect-ratio calculation through the native Windows border.
    resizable: false,
    thickFrame: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: appIconPath(),
    title: `玄念${app.getVersion()}便签`,
    transparent: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  const webContentsId = win.webContents.id;
  stickyWindows.add(win);
  const initialImageLayout = !editNew ? initialStickyImageLayout(note, size) : null;
  if (initialImageLayout) stickyAspectRatios.set(webContentsId, initialImageLayout);
  if (editNew) stickyDraftWindows.add(win);
  if (prewarm) {
    prewarmedStickyDraftWindow = win;
    prewarmedStickyDraftRevision = dataRevision;
  }
  if (noteId) stickyNoteWindows.set(noteId, win);
  notifyStickyPinState();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachPageDiagnostics(win, prewarm ? 'sticky-prewarm' : 'sticky');
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.on('closed', () => {
    if (prewarmedStickyDraftWindow === win) {
      prewarmedStickyDraftWindow = null;
      prewarmedStickyDraftRevision = -1;
    }
    stickyWindows.delete(win);
    stickyDraftWindows.delete(win);
    stickyMoveSessions.delete(webContentsId);
    stickyResizeSessions.delete(webContentsId);
    stickyAspectRatios.delete(webContentsId);
    for (const [id, stickyWindow] of stickyNoteWindows) {
      if (stickyWindow === win) stickyNoteWindows.delete(id);
    }
    notifyStickyPinState();
    scheduleStickyDraftPrewarm(120);
  });
  loadAppHtml(win, 'sticky.html', {
    query: { id: noteId || '', edit: editNew ? '1' : '0', source: editNew ? (source || 'sticky') : noteSource },
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (prewarm) return;
    win.show();
    win.moveTop();
    win.focus();
  });
  return win;
}

function showStickyNoteWindow(options = {}) {
  return createStickyNoteWindow(options);
}

function focusStickyWindowByWebContents(webContents) {
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.focus();
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    icon: appIconPath(),
    title: `玄念${app.getVersion()}`,
    frame: process.platform === 'darwin',
    resizable: true,
    thickFrame: true,
    maximizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#f4f4f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachPageDiagnostics(mainWindow, 'main');
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainToTray();
  });
  mainWindow.on('minimize', () => {
    notifyMainSuspend();
  });
  mainWindow.on('closed', () => {
    mainWindowResizeSession = null;
    destroyMediaPortalView({ notify: false });
  });
  loadAppHtml(mainWindow, 'index.html');
}

function mediaDirectories() {
  const settings = loadData({ clone: false }).settings || {};
  const configuredDownload = String(settings.mediaDownloadPath || '').trim();
  const configuredFavorite = String(settings.mediaFavoritePath || '').trim();
  const downloadPath = configuredDownload && path.isAbsolute(configuredDownload)
    ? configuredDownload
    : app.getPath('downloads');
  const favoritePath = configuredFavorite && path.isAbsolute(configuredFavorite)
    ? configuredFavorite
    : path.join(app.getPath('documents'), '玄念收藏', '媒体');
  fs.mkdirSync(downloadPath, { recursive: true });
  fs.mkdirSync(favoritePath, { recursive: true });
  return { downloadPath, favoritePath };
}

function sanitizeMediaDownloadHistory(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.id && item.status === 'completed')
    .map((item) => ({
      id: String(item.id).slice(0, 160),
      name: String(item.name || '下载任务').slice(0, 260),
      path: String(item.path || '').slice(0, 4096),
      location: item.location === 'favorites' ? 'favorites' : 'downloads',
      status: 'completed',
      receivedBytes: Math.max(0, Number(item.receivedBytes || 0)),
      totalBytes: Math.max(0, Number(item.totalBytes || 0)),
      percent: 100,
      updatedAt: Math.max(0, Number(item.updatedAt || 0)),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 10);
}

function mediaDownloadHistoryFile() {
  return path.join(app.getPath('userData'), MEDIA_DOWNLOAD_HISTORY_FILE);
}

function loadMediaDownloadHistory() {
  const payload = readJsonWithRecoverySync(mediaDownloadHistoryFile(), { version: 1, items: [] });
  return sanitizeMediaDownloadHistory(payload?.items);
}

function rememberCompletedMediaDownload(task) {
  try {
    const items = sanitizeMediaDownloadHistory([
      task,
      ...loadMediaDownloadHistory().filter((item) => item.id !== task.id),
    ]);
    writeJsonAtomicSync(mediaDownloadHistoryFile(), JSON.stringify({ version: 1, items }));
    return items;
  } catch (error) {
    runtimeLog(`media download history persistence failed: ${error?.stack || error}`);
    return [];
  }
}

function forgetCompletedMediaDownload(taskId) {
  const id = String(taskId || '').trim();
  if (!id) return [];
  try {
    const items = loadMediaDownloadHistory().filter((item) => item.id !== id);
    writeJsonAtomicSync(mediaDownloadHistoryFile(), JSON.stringify({ version: 1, items }));
    return items;
  } catch (error) {
    runtimeLog(`media download history removal failed: ${error?.stack || error}`);
    return null;
  }
}

function notifyMediaDownloadsChanged(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('media:downloadsChanged', payload || {});
}

function notifyMediaDownloadProgress(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('media:downloadProgress', payload || {});
}

async function runMediaFileOperation(label, operation) {
  try {
    return await operation();
  } catch (error) {
    runtimeLog(`${label} failed: ${error?.stack || error}`);
    return { ok: false, reason: '文件操作失败，请检查目录权限或文件是否正被占用' };
  }
}

function sanitizeDownloadFilename(value, mimeType = '') {
  let filename = path.basename(String(value || '').trim())
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  if (!filename) filename = `media-${Date.now()}`;
  if (!mediaKindForPath(filename)) {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('video/mp4')) filename += '.mp4';
    else if (mime.includes('video/webm')) filename += '.webm';
    else if (mime.includes('audio/mpeg')) filename += '.mp3';
    else if (mime.includes('audio/mp4')) filename += '.m4a';
    else if (mime.includes('audio/flac')) filename += '.flac';
    else if (mime.includes('audio/ogg')) filename += '.ogg';
  }
  return filename;
}

function uniqueMediaDownloadPath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  return candidate;
}

function showMediaDownloadNotification({ status, name, filePath = '', favorite = false } = {}) {
  if (!Notification.isSupported()) return false;
  const completed = status === 'completed';
  const title = completed ? '玄念下载完成' : '玄念下载未完成';
  const body = completed
    ? `${String(name || '媒体文件')} 已保存到${favorite ? '收藏' : '已下载'}`
    : `${String(name || '媒体文件')} 下载失败，请在下载网站中重试`;
  try {
    const notification = new Notification({ title, body, silent: false });
    activeMediaDownloadNotifications.add(notification);
    const release = () => activeMediaDownloadNotifications.delete(notification);
    notification.once('close', release);
    notification.once('failed', release);
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      if (completed && filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    });
    notification.show();
    const releaseTimer = setTimeout(release, 30 * 1000);
    releaseTimer.unref?.();
    return true;
  } catch (error) {
    runtimeLog(`media download notification failed: ${error?.message || error}`);
    return false;
  }
}

function mediaPreviewCacheDirectory() {
  return path.join(app.getPath('userData'), MEDIA_PREVIEW_CACHE_DIRECTORY);
}

function mediaPreviewCacheKey(sourceUrl) {
  return crypto.createHash('sha256').update(String(sourceUrl || '')).digest('hex').slice(0, 32);
}

function mediaPreviewCachePath(sourceUrl, extension = '.mp4') {
  const safeExtension = /^\.[a-z0-9]{2,5}$/i.test(String(extension || '')) ? String(extension).toLowerCase() : '.mp4';
  return path.join(mediaPreviewCacheDirectory(), `${mediaPreviewCacheKey(sourceUrl)}${safeExtension}`);
}

function cleanupMediaPreviewCache(now = Date.now()) {
  const directory = mediaPreviewCacheDirectory();
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs >= MEDIA_PREVIEW_MAX_AGE_MS) fs.unlinkSync(filePath);
    } catch {}
  }
}

function findMediaPreviewCache(sourceUrl) {
  cleanupMediaPreviewCache();
  const directory = mediaPreviewCacheDirectory();
  const prefix = mediaPreviewCacheKey(sourceUrl);
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size > 0 && Date.now() - stat.mtimeMs < MEDIA_PREVIEW_MAX_AGE_MS) {
        return { url: pathToFileURL(filePath).href, localPath: filePath, filename: entry.name, embedded: false, temporary: true, cached: true };
      }
    } catch {}
  }
  return null;
}

function mediaKindForDownloadUrl(value) {
  try {
    return mediaKindForPath(new URL(String(value || '')).pathname);
  } catch {
    return '';
  }
}

function mediaPortalDownloadStartCount(webContents) {
  return Math.max(0, Number(mediaPortalDownloadStartCounts.get(webContents) || 0));
}

function markMediaPortalTransferStarted(webContents) {
  mediaPortalDownloadStartCounts.set(webContents, mediaPortalDownloadStartCount(webContents) + 1);
  markMediaPortalDownloadStarted(webContents);
}

function streamNodeMediaPortalUrlToFile(url, destination, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const value = String(url || '');
    const client = /^https:/i.test(value) ? https : http;
    const temporary = `${destination}.nodepart-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
    let output = null;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      try { output?.destroy(); } catch {}
      if (error) {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
        reject(error);
      } else {
        resolve(result);
      }
    };
    const request = client.get(value, {
      headers: {
        Accept: 'video/mp4,video/*;q=0.9,audio/*;q=0.8,application/octet-stream;q=0.7,*/*;q=0.5',
        'User-Agent': `Mozilla/5.0 XuanNian/${app.getVersion()}`,
      },
    }, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400 && redirects < 8) {
        response.resume();
        streamNodeMediaPortalUrlToFile(new URL(location, value).toString(), destination, options, redirects + 1).then(resolve, reject);
        settled = true;
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const kind = mediaKindForDownloadUrl(value)
        || (/^video\//i.test(contentType) ? 'video' : (/^audio\//i.test(contentType) ? 'audio' : ''));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        finish(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      if (!kind) {
        response.resume();
        finish(new Error(`unexpected media response ${contentType || 'without content type'}`));
        return;
      }
      try {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        output = fs.createWriteStream(temporary, { flags: 'wx' });
      } catch (error) {
        response.destroy();
        finish(error);
        return;
      }
      const totalBytes = Math.max(0, Number(response.headers['content-length'] || 0));
      let receivedBytes = 0;
      options.onStarted?.({ contentType, kind, resolvedUrl: value, totalBytes });
      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        options.onProgress?.({ receivedBytes, totalBytes });
      });
      response.once('aborted', () => finish(new Error('media response aborted')));
      response.once('error', finish);
      output.once('error', (error) => {
        response.destroy();
        finish(error);
      });
      output.once('finish', () => {
        if (receivedBytes <= 0) {
          finish(new Error('empty media response'));
          return;
        }
        try {
          output.close(() => {
            try {
              output = null;
              if (fs.existsSync(destination)) fs.unlinkSync(destination);
              fs.renameSync(temporary, destination);
              finish(null, { ok: true, path: destination, contentType, kind, resolvedUrl: value, receivedBytes, totalBytes: totalBytes || receivedBytes, transport: 'node-http' });
            } catch (error) {
              finish(error);
            }
          });
        } catch (error) {
          finish(error);
        }
      });
      response.pipe(output);
    });
    request.setTimeout(30000, () => request.destroy(new Error('media response timeout')));
    request.once('error', finish);
  });
}

async function streamMediaPortalUrlToFile(webContents, url, destination, options = {}) {
  const temporary = `${destination}.part-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(30000, Number(options.timeoutMs || MEDIA_PREVIEW_DOWNLOAD_TIMEOUT_MS)));
  let responseTimeout = null;
  let output = null;
  let reader = null;
  try {
    const headers = {
      Accept: 'video/mp4,video/*;q=0.9,audio/*;q=0.8,application/octet-stream;q=0.7,*/*;q=0.5',
    };
    const referer = String(options.referer || '').trim();
    if (referer) headers.Referer = referer;
    const userAgent = String(webContents?.getUserAgent?.() || '').trim();
    if (userAgent) headers['User-Agent'] = userAgent;
    const response = await Promise.race([
      webContents.session.fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        responseTimeout = setTimeout(() => {
          controller.abort();
          reject(new Error('media response timeout'));
        }, 25000);
      }),
    ]);
    clearTimeout(responseTimeout);
    responseTimeout = null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const resolvedUrl = String(response.url || url);
    const kind = mediaKindForDownloadUrl(resolvedUrl)
      || mediaKindForDownloadUrl(url)
      || (/^video\//i.test(contentType) ? 'video' : (/^audio\//i.test(contentType) ? 'audio' : ''));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!kind || !response.body) throw new Error(`unexpected media response ${contentType || 'without content type'}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    output = fs.createWriteStream(temporary, { flags: 'wx' });
    reader = response.body.getReader();
    const totalBytes = Math.max(0, Number(response.headers.get('content-length') || 0));
    let receivedBytes = 0;
    options.onStarted?.({ contentType, kind, resolvedUrl, totalBytes });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buffer = Buffer.from(chunk.value);
      await new Promise((resolve, reject) => output.write(buffer, (error) => error ? reject(error) : resolve()));
      receivedBytes += buffer.length;
      options.onProgress?.({ receivedBytes, totalBytes });
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    output = null;
    if (receivedBytes <= 0) throw new Error('empty media response');
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.renameSync(temporary, destination);
    return { ok: true, path: destination, contentType, kind, resolvedUrl, receivedBytes, totalBytes: totalBytes || receivedBytes };
  } catch (error) {
    try { await reader?.cancel(); } catch {}
    try { output?.destroy(); } catch {}
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    runtimeLog(`Electron media stream failed, retrying with Node HTTP: ${error?.message || error}`);
    return streamNodeMediaPortalUrlToFile(url, destination, options);
  } finally {
    clearTimeout(responseTimeout);
    clearTimeout(timeout);
  }
}

async function startDirectMediaPortalPreview(webContents, url, referer) {
  const captureState = mediaPortalPreviewCapture;
  if (!captureState || captureState.webContents !== webContents) return { ok: false, started: false };
  let started = false;
  let destination = '';
  try {
    const urlExtension = path.extname(new URL(String(url)).pathname);
    const extension = mediaKindForPath(`preview${urlExtension}`) === 'video' ? urlExtension : '.mp4';
    destination = mediaPreviewCachePath(captureState.sourceUrl, extension);
    const result = await streamMediaPortalUrlToFile(webContents, url, destination, {
      referer,
      onStarted: ({ totalBytes }) => {
        started = true;
        runtimeLog(`direct media preview response started bytes=${totalBytes || 0}`);
      },
      onProgress: ({ receivedBytes, totalBytes }) => {
        const filePercent = totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0;
        captureState.state.previewDownloadPercent = filePercent;
        emitMediaPortalProgress(captureState.state, {
          percent: Math.min(99, 94 + Math.round(filePercent * 0.05)),
          message: totalBytes > 0 ? `正在下载临时预览 ${filePercent}%` : '正在下载临时预览',
        });
      },
    });
    if (mediaPortalPreviewCapture === captureState) {
      clearMediaPortalPreviewCapture({
        url: pathToFileURL(destination).href,
        localPath: destination,
        filename: path.basename(destination),
        mimeType: result.contentType,
        embedded: false,
        temporary: true,
      });
    }
    runtimeLog(`direct media preview completed bytes=${result.receivedBytes}`);
    return { ok: true, started: true };
  } catch (error) {
    runtimeLog(`direct media preview failed started=${started}: ${error?.message || error}`);
    if (started && mediaPortalPreviewCapture === captureState) clearMediaPortalPreviewCapture(null);
    return { ok: false, started };
  }
}

async function startDirectTrackedMediaDownload(webContents, url, referer) {
  const directories = mediaDirectories();
  const target = mediaPortalDownloadTargets.get(webContents) || {};
  const favoriteDownload = target.location === 'favorite';
  const rootPath = favoriteDownload ? directories.favoritePath : directories.downloadPath;
  let extension = '.mp4';
  let sourceName = 'video.mp4';
  try {
    const pathname = decodeURIComponent(new URL(String(url)).pathname);
    const candidateExtension = path.extname(pathname);
    if (mediaKindForPath(`media${candidateExtension}`)) extension = candidateExtension;
    sourceName = path.basename(pathname) || `video${extension}`;
  } catch {}
  const preferredName = String(target.preferredName || '').trim();
  const filename = sanitizeDownloadFilename(preferredName
    ? `${path.basename(preferredName, path.extname(preferredName))}${extension}`
    : (mediaKindForPath(sourceName) ? sourceName : `${path.basename(sourceName, path.extname(sourceName))}${extension}`));
  const kind = mediaKindForPath(filename) || 'video';
  const downloadPath = mediaCollectionDirectory(rootPath, kind, target.collection || '');
  const destination = uniqueMediaDownloadPath(downloadPath, filename);
  const taskId = `media-direct-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let started = false;
  let receivedBytes = 0;
  let totalBytes = 0;
  let lastProgressAt = 0;
  const progressPayload = (status) => ({
    id: taskId,
    name: filename,
    path: destination,
    location: favoriteDownload ? 'favorites' : 'downloads',
    status,
    receivedBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0,
    updatedAt: Date.now(),
  });
  try {
    const result = await streamMediaPortalUrlToFile(webContents, url, destination, {
      referer,
      onStarted: (details) => {
        started = true;
        totalBytes = Number(details.totalBytes || 0);
        activeMediaPortalDownloads += 1;
        cancelMediaPortalIdleDestroy();
        markMediaPortalTransferStarted(webContents);
        notifyMediaDownloadProgress(progressPayload('downloading'));
        runtimeLog(`direct tracked media response started bytes=${totalBytes}`);
      },
      onProgress: (progress) => {
        receivedBytes = Number(progress.receivedBytes || 0);
        totalBytes = Number(progress.totalBytes || totalBytes || 0);
        const now = Date.now();
        if (now - lastProgressAt < 120) return;
        lastProgressAt = now;
        notifyMediaDownloadProgress(progressPayload('downloading'));
      },
    });
    receivedBytes = Number(result.receivedBytes || receivedBytes || 0);
    totalBytes = Number(result.totalBytes || receivedBytes || 0);
    const completedTask = progressPayload('completed');
    rememberCompletedMediaDownload(completedTask);
    notifyMediaDownloadProgress(completedTask);
    notifyMediaDownloadsChanged({ status: 'completed', path: destination, favorite: favoriteDownload, message: favoriteDownload ? '媒体已下载到收藏目录' : '媒体已下载' });
    showMediaDownloadNotification({ status: 'completed', name: filename, filePath: destination, favorite: favoriteDownload });
    runtimeLog(`direct tracked media completed bytes=${receivedBytes} path=${destination}`);
    return { ok: true, started: true, path: destination };
  } catch (error) {
    runtimeLog(`direct tracked media failed started=${started}: ${error?.message || error}`);
    if (started) {
      notifyMediaDownloadProgress(progressPayload('error'));
      notifyMediaDownloadsChanged({ status: 'error', message: '下载连接中断，请重新尝试' });
      showMediaDownloadNotification({ status: 'error', name: filename });
    }
    return { ok: false, started };
  } finally {
    if (started) activeMediaPortalDownloads = Math.max(0, activeMediaPortalDownloads - 1);
    if (!activeMediaPortalDownloads && !mediaPortalInputState) scheduleMediaPortalIdleDestroy();
  }
}

function startCapturedMediaPortalDownload(webContents, url) {
  const referer = webContents.getURL();
  const previewCapture = mediaPortalPreviewCapture?.webContents === webContents;
  const acknowledgeVideoRequest = !previewCapture
    && !!mediaPortalParsedVideo?.downloadReady
    && mediaPortalInputState?.automationMode !== 'music-download';
  if (acknowledgeVideoRequest) markMediaPortalTransferStarted(webContents);
  const direct = previewCapture
    ? startDirectMediaPortalPreview(webContents, url, referer)
    : startDirectTrackedMediaDownload(webContents, url, referer);
  direct.then((result) => {
    if (result?.started || webContents.isDestroyed()) return;
    runtimeLog('direct media request did not start; falling back to header-free Electron downloadURL');
    try { webContents.downloadURL(url); } catch {}
    if (previewCapture) {
      setTimeout(() => {
        if (mediaPortalPreviewCapture?.webContents === webContents) clearMediaPortalPreviewCapture(null);
      }, 15000);
    }
  }).catch((error) => runtimeLog(`captured media download failed: ${error?.message || error}`));
}

function configureMediaDownloadSession(electronSession) {
  if (!electronSession || configuredMediaDownloadSessions.has(electronSession)) return;
  configuredMediaDownloadSessions.add(electronSession);
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  electronSession.on('will-download', (event, item, webContents) => {
    if (mediaPortalPreviewCapture?.webContents === webContents) {
      const captureState = mediaPortalPreviewCapture;
      const filename = sanitizeDownloadFilename(item.getFilename(), item.getMimeType());
      const mimeType = String(item.getMimeType() || '');
      const filenameKind = mediaKindForPath(filename);
      const urlKind = mediaKindForDownloadUrl(item.getURL());
      const kind = filenameKind || urlKind || (/^video\//i.test(mimeType) ? 'video' : '');
      if (kind !== 'video') {
        event.preventDefault();
        clearMediaPortalPreviewCapture(null);
        return;
      }
      const extension = filenameKind === 'video'
        ? path.extname(filename)
        : (urlKind === 'video' ? path.extname(new URL(item.getURL()).pathname) : '.mp4');
      const destination = mediaPreviewCachePath(captureState.sourceUrl, extension);
      try {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
        item.setSavePath(destination);
      } catch (error) {
        runtimeLog('media preview cache path failed: ' + (error?.message || error));
        event.preventDefault();
        clearMediaPortalPreviewCapture(null);
        return;
      }
      captureState.item = item;
      const updatePreviewProgress = () => {
        const receivedBytes = Math.max(0, Number(item.getReceivedBytes() || 0));
        const totalBytes = Math.max(0, Number(item.getTotalBytes() || 0));
        const filePercent = totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0;
        captureState.state.previewDownloadPercent = filePercent;
        emitMediaPortalProgress(captureState.state, {
          percent: Math.min(99, 94 + Math.round(filePercent * 0.05)),
          message: totalBytes > 0 ? `正在下载临时预览 ${filePercent}%` : '正在下载临时预览',
        });
      };
      item.on('updated', updatePreviewProgress);
      item.once('done', (_doneEvent, downloadState) => {
        if (downloadState === 'completed' && fs.existsSync(destination)) {
          clearMediaPortalPreviewCapture({
            url: pathToFileURL(destination).href,
            localPath: destination,
            filename,
            mimeType,
            embedded: false,
            temporary: true,
          });
        } else {
          try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch {}
          clearMediaPortalPreviewCapture(null);
        }
      });
      return;
    }
    markMediaPortalTransferStarted(webContents);
    const directories = mediaDirectories();
    const target = mediaPortalDownloadTargets.get(webContents) || {};
    const favoriteDownload = target.location === 'favorite';
    const rootPath = favoriteDownload ? directories.favoritePath : directories.downloadPath;
    const receivedFilename = sanitizeDownloadFilename(item.getFilename(), item.getMimeType());
    const mimeType = String(item.getMimeType() || '');
    const filenameKind = mediaKindForPath(receivedFilename);
    const urlKind = mediaKindForDownloadUrl(item.getURL());
    const kind = filenameKind || urlKind
      || (/^video\//i.test(mimeType) ? 'video' : (/^audio\//i.test(mimeType) ? 'audio' : ''));
    if (!kind) {
      item.cancel();
      notifyMediaDownloadsChanged({ status: 'blocked', message: '已拦截非音视频文件下载' });
      return;
    }
    let filename = receivedFilename;
    if (String(target.preferredName || '').trim()) {
      const extension = filenameKind === kind
        ? path.extname(receivedFilename)
        : (urlKind === kind ? path.extname(new URL(item.getURL()).pathname) : (kind === 'audio' ? '.mp3' : '.mp4'));
      const displayName = path.basename(String(target.preferredName).trim(), path.extname(String(target.preferredName).trim()));
      filename = sanitizeDownloadFilename(`${displayName}${extension}`, item.getMimeType());
    } else if (!filenameKind) {
      const extension = kind === 'audio' ? '.mp3' : '.mp4';
      filename = sanitizeDownloadFilename(path.basename(receivedFilename, path.extname(receivedFilename)) + extension, item.getMimeType());
    }
    const downloadPath = mediaCollectionDirectory(rootPath, kind, target.collection || '');
    fs.mkdirSync(downloadPath, { recursive: true });
    const destination = uniqueMediaDownloadPath(downloadPath, filename);
    item.setSavePath(destination);
    activeMediaPortalDownloads += 1;
    cancelMediaPortalIdleDestroy();
    const taskId = `media-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let lastProgressAt = 0;
    const progressPayload = (status) => {
      const receivedBytes = Math.max(0, Number(item.getReceivedBytes() || 0));
      const totalBytes = Math.max(0, Number(item.getTotalBytes() || 0));
      return {
        id: taskId,
        name: filename,
        path: destination,
        location: favoriteDownload ? 'favorites' : 'downloads',
        status,
        receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0,
        updatedAt: Date.now(),
      };
    };
    notifyMediaDownloadProgress(progressPayload('downloading'));
    item.on('updated', (_updatedEvent, state) => {
      const now = Date.now();
      if (now - lastProgressAt < 120 && state === 'progressing') return;
      lastProgressAt = now;
      notifyMediaDownloadProgress(progressPayload(state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'downloading')));
    });
    item.once('done', (_doneEvent, state) => {
      activeMediaPortalDownloads = Math.max(0, activeMediaPortalDownloads - 1);
      if (state === 'completed') {
        const completedTask = progressPayload('completed');
        rememberCompletedMediaDownload(completedTask);
        notifyMediaDownloadProgress(completedTask);
        notifyMediaDownloadsChanged({ status: 'completed', path: destination, favorite: favoriteDownload, message: favoriteDownload ? '媒体已下载到收藏目录' : '媒体已下载' });
        showMediaDownloadNotification({ status: 'completed', name: filename, filePath: destination, favorite: favoriteDownload });
      } else if (state !== 'cancelled') {
        notifyMediaDownloadProgress(progressPayload('error'));
        notifyMediaDownloadsChanged({ status: 'error', message: '下载未完成，请在网站中重试' });
        showMediaDownloadNotification({ status: 'error', name: filename });
      } else {
        notifyMediaDownloadProgress(progressPayload('cancelled'));
      }
      if (!activeMediaPortalDownloads && !mediaPortalInputState) {
        if (mediaPortalView && !mediaPortalView.webContents.isDestroyed()) mediaPortalView.setVisible(false);
        scheduleMediaPortalIdleDestroy();
      }
    });
  });
}

function cancelMediaPortalIdleDestroy() {
  clearTimeout(mediaPortalIdleTimer);
  mediaPortalIdleTimer = null;
}

function destroyMediaPortalView({ notify = true } = {}) {
  cancelMediaPortalIdleDestroy();
  clearMediaPortalInputTimer();
  clearMediaPortalProgressTimer();
  clearMediaPortalPendingDownload();
  clearMediaPortalPreviewCapture();
  clearMediaPortalVerificationMonitor();
  mediaPortalInputState = null;
  mediaPortalRequestId += 1;
  const view = mediaPortalView;
  mediaPortalView = null;
  if (view) {
    try { mainWindow?.contentView?.removeChildView(view); } catch {}
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {}
  }
  if (notify) notifyMediaBrowserState({ destroyed: true });
}

function scheduleMediaPortalIdleDestroy() {
  if (mediaPortalIdleTimer || !mediaPortalView || mediaPortalView.webContents.isDestroyed()) return;
  mediaPortalIdleTimer = setTimeout(() => {
    runtimeLog('destroying idle media portal view');
    destroyMediaPortalView();
  }, MEDIA_PORTAL_IDLE_DESTROY_MS);
}

function trimMediaPortalHistory(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    const history = webContents.navigationHistory;
    while (history.length() > MEDIA_PORTAL_HISTORY_LIMIT) {
      const activeIndex = history.getActiveIndex();
      const removeIndex = activeIndex > 0 ? 0 : history.length() - 1;
      if (removeIndex === activeIndex) break;
      history.removeEntryAtIndex(removeIndex);
    }
  } catch (error) {
    runtimeLog(`media portal history trim failed: ${error?.message || error}`);
  }
}

function enforceMediaPortalCacheLimit(webContents) {
  if (!webContents || webContents.isDestroyed() || mediaPortalCacheCheckPromise) return;
  const now = Date.now();
  if (now - mediaPortalCacheCheckAt < MEDIA_PORTAL_CACHE_CHECK_INTERVAL_MS) return;
  mediaPortalCacheCheckAt = now;
  const portalSession = webContents.session;
  mediaPortalCacheCheckPromise = (async () => {
    const cacheSize = await portalSession.getCacheSize();
    if (cacheSize <= MEDIA_PORTAL_CACHE_LIMIT_BYTES) return;
    await portalSession.clearCache();
    runtimeLog(`media portal HTTP cache cleared at ${cacheSize} bytes`);
  })().catch((error) => {
    runtimeLog(`media portal cache check failed: ${error?.message || error}`);
  }).finally(() => {
    mediaPortalCacheCheckPromise = null;
  });
}

function mediaBrowserState(extra = {}) {
  const webContents = mediaPortalView?.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return { ready: false, loading: false, url: '', title: '', canGoBack: false, canGoForward: false, ...extra };
  }
  const navigationHistory = webContents.navigationHistory;
  return {
    ready: true,
    loading: webContents.isLoading(),
    url: webContents.getURL(),
    title: webContents.getTitle(),
    canGoBack: navigationHistory.canGoBack(),
    canGoForward: navigationHistory.canGoForward(),
    ...extra,
  };
}

function notifyMediaBrowserState(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('media:browserState', mediaBrowserState(extra));
}

function clearMediaPortalInputTimer() {
  clearTimeout(mediaPortalInputTimer);
  mediaPortalInputTimer = null;
}

function clearMediaPortalVisibilityNudgeTimer() {
  clearTimeout(mediaPortalVisibilityNudgeTimer);
  mediaPortalVisibilityNudgeTimer = null;
  clearTimeout(mediaPortalVisibilityRestoreTimer);
  mediaPortalVisibilityRestoreTimer = null;
}

function scheduleMediaPortalVisibilityNudge(state, view, {
  delayMsOverride = null,
  visibleMsOverride = null,
  rerunAfterWake = false,
} = {}) {
  if (state?.automationMode !== 'music-search'
    || mediaPortalVisibilityNudgeTimer
    || mediaPortalVisibilityRestoreTimer
    || Number(state.visibilityNudgeCount || 0) >= MEDIA_PORTAL_MUSIC_WAKE_MAX) return;
  const delayMs = Number.isFinite(delayMsOverride)
    ? Math.max(0, Number(delayMsOverride))
    : (Number(state.visibilityNudgeCount || 0) > 0
      ? Math.max(1200, MEDIA_PORTAL_MUSIC_WAKE_DELAY_MS - MEDIA_PORTAL_MUSIC_WAKE_VISIBLE_MS)
      : MEDIA_PORTAL_MUSIC_WAKE_DELAY_MS);
  const visibleMs = Number.isFinite(visibleMsOverride)
    ? Math.max(MEDIA_PORTAL_MUSIC_WAKE_VISIBLE_MS, Number(visibleMsOverride))
    : MEDIA_PORTAL_MUSIC_WAKE_VISIBLE_MS;
  mediaPortalVisibilityNudgeTimer = setTimeout(async () => {
    mediaPortalVisibilityNudgeTimer = null;
    if (mediaPortalInputState !== state || state.requestId !== mediaPortalRequestId || !view || view.webContents.isDestroyed()) return;
    state.visibilityNudgeCount = Number(state.visibilityNudgeCount || 0) + 1;
    const content = mainWindow?.getContentBounds();
    const width = Math.max(320, Number(content?.width || MEDIA_PORTAL_WORKER_WIDTH));
    const height = Math.max(240, Number(content?.height || MEDIA_PORTAL_WORKER_HEIGHT));
    const x = width >= 640 ? 64 : 0;
    const y = height >= 480 ? 132 : 0;
    const wakeWidth = Math.max(120, width - x);
    const wakeHeight = Math.max(80, height - y);
    const restoreMainFocus = !!mainWindow?.isFocused?.();
    view.setBounds({
      x,
      y,
      width: wakeWidth,
      height: wakeHeight,
    });
    view.setVisible(true);
    view.webContents.setAudioMuted(true);
    try { view.webContents.focus(); } catch {}
    runtimeLog(`music search visibility wake ${state.visibilityNudgeCount}/${MEDIA_PORTAL_MUSIC_WAKE_MAX}`);
    emitMediaPortalProgress(state, {
      percent: Math.min(76, 68 + state.visibilityNudgeCount * 2),
      message: `正在激活音乐页面并读取结果（${state.visibilityNudgeCount}/${MEDIA_PORTAL_MUSIC_WAKE_MAX}）`,
    });
    const visibilityScript = [
      '(async () => {',
      'window.dispatchEvent(new Event("focus"));',
      'window.dispatchEvent(new Event("resize"));',
      'document.dispatchEvent(new Event("visibilitychange"));',
      'window.scrollBy(0, 1);',
      'window.scrollBy(0, -1);',
      'document.querySelector("main,body")?.getBoundingClientRect();',
      'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));',
      'return document.visibilityState;',
      '})()',
    ].join('\n');
    try {
      await view.webContents.executeJavaScript(visibilityScript, true);
    } catch {}
    try {
      await view.webContents.capturePage({
        x: 0,
        y: 0,
        width: Math.min(640, wakeWidth),
        height: Math.min(360, wakeHeight),
      });
    } catch {}
    mediaPortalVisibilityRestoreTimer = setTimeout(() => {
      mediaPortalVisibilityRestoreTimer = null;
      if (mediaPortalInputState !== state || state.requestId !== mediaPortalRequestId || view.webContents.isDestroyed()) return;
      keepMediaPortalWorkerVisible(view);
      if (restoreMainFocus && mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.focus(); } catch {}
      }
      if (rerunAfterWake) scheduleMediaPortalInput();
      else scheduleMediaPortalVisibilityNudge(state, view);
    }, visibleMs);
  }, delayMs);
}

function clearMediaPortalVerificationMonitor({ clearResume = true } = {}) {
  clearTimeout(mediaPortalVerificationTimer);
  mediaPortalVerificationTimer = null;
  if (clearResume) mediaPortalVerificationResume = null;
}

function rememberMediaPortalVerificationResume(state) {
  if (!String(state?.automationMode || '').startsWith('music-')) return;
  mediaPortalVerificationResume = {
    ...state,
    retryCount: 0,
    visibilityRetryCount: 0,
    verificationStartedAt: Date.now(),
  };
}

function resumeMediaPortalAfterVerification() {
  const resume = mediaPortalVerificationResume;
  const view = mediaPortalView;
  if (!resume || !view || view.webContents.isDestroyed() || resume.requestId !== mediaPortalRequestId) return false;
  clearMediaPortalVerificationMonitor({ clearResume: false });
  cancelMediaPortalIdleDestroy();
  const poll = async () => {
    if (!mediaPortalVerificationResume || !mediaPortalView || mediaPortalView.webContents.isDestroyed()) {
      clearMediaPortalVerificationMonitor();
      return;
    }
    if (Date.now() - Number(resume.verificationStartedAt || Date.now()) > 10 * 60 * 1000) {
      clearMediaPortalVerificationMonitor();
      notifyMediaBrowserState({ verificationPending: false, verificationTimedOut: true });
      return;
    }
    try {
      const verificationScript = [
        '(() => {',
        'const body = String(document.body?.innerText || "").slice(0, 12000);',
        'const challenge = /安全验证|验证您是真人|请验证您是真人|verify you are human|security verification|captcha|cloudflare/i.test(body)',
        '  || !!document.querySelector("iframe[src*=captcha],iframe[src*=challenge],iframe[src*=turnstile],[class*=captcha],[id*=captcha]");',
        'return { challenge, readyState: document.readyState };',
        '})()',
      ].join('\n');
      const status = await mediaPortalView.webContents.executeJavaScript(verificationScript, true);
      if (!status?.challenge && status?.readyState !== 'loading') {
        const next = mediaPortalVerificationResume;
        clearMediaPortalVerificationMonitor();
        mediaPortalInputState = {
          ...next,
          progressStartedAt: Date.now(),
          retryCount: 0,
          visibilityRetryCount: 0,
        };
        keepMediaPortalWorkerVisible(mediaPortalView);
        startMediaPortalProgress(mediaPortalInputState);
        notifyMediaBrowserState({ opening: true, verificationPending: false, verificationCompleted: true });
        scheduleMediaPortalInput();
        return;
      }
    } catch {}
    mediaPortalVerificationTimer = setTimeout(poll, 700);
  };
  notifyMediaBrowserState({ verificationPending: true, verificationCompleted: false });
  mediaPortalVerificationTimer = setTimeout(poll, 500);
  return true;
}

function sendMediaPortalEvent(channel, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function clearMediaPortalProgressTimer() {
  clearInterval(mediaPortalProgressTimer);
  mediaPortalProgressTimer = null;
}

function mediaPortalProgressPayload(state, extra = {}) {
  const mode = String(state?.automationMode || '');
  const elapsedMs = Math.max(0, Date.now() - Number(state?.progressStartedAt || Date.now()));
  let percent = 5;
  let message = '正在连接下载站';
  let operation = 'parse';
  let kind = 'video';
  if (mode === 'video-parse') {
    const resultPhase = state?.phase === 'result';
    const previewPercent = Number(state?.previewDownloadPercent || 0);
    percent = previewPercent > 0
      ? Math.min(99, 94 + Math.round(previewPercent * 0.05))
      : (resultPhase ? Math.min(94, 34 + Math.round((elapsedMs / 45000) * 60)) : Math.min(32, 6 + Math.round((elapsedMs / 7000) * 26)));
    message = previewPercent > 0 ? `正在下载临时预览 ${previewPercent}%` : (resultPhase ? '正在分析清晰度并生成预览' : '正在提交视频链接');
  } else if (mode === 'music-search') {
    kind = 'audio';
    operation = 'search';
    percent = Math.min(94, 6 + Math.round((elapsedMs / 30000) * 88));
    message = '正在读取歌曲名称、歌手和可下载版本';
  } else if (mode === 'music-preview') {
    kind = 'audio';
    operation = 'preview';
    percent = Math.min(94, 8 + Math.round((elapsedMs / 30000) * 86));
    message = '正在准备所选版本的试听音频';
  } else if (mode === 'music-download') {
    kind = 'audio';
    operation = 'download';
    percent = Math.min(97, 8 + Math.round((elapsedMs / 35000) * 89));
    const remainingSeconds = Math.max(0, Math.ceil((30000 - elapsedMs) / 1000));
    message = remainingSeconds > 0
      ? '下载站正在准备普通音质文件，预计还需 ' + remainingSeconds + ' 秒'
      : '下载站已响应，正在等待文件开始下载';
  }
  return {
    requestId: Number(state?.requestId || 0),
    kind,
    operation,
    status: 'running',
    percent,
    message,
    reason: '',
    ...extra,
  };
}

function emitMediaPortalProgress(state, extra = {}) {
  sendMediaPortalEvent('media:portalProgress', mediaPortalProgressPayload(state, extra));
}

function startMediaPortalProgress(state) {
  clearMediaPortalProgressTimer();
  state.progressStartedAt = Date.now();
  emitMediaPortalProgress(state);
  mediaPortalProgressTimer = setInterval(() => {
    if (state.requestId !== mediaPortalRequestId) {
      clearMediaPortalProgressTimer();
      return;
    }
    emitMediaPortalProgress(state);
  }, 500);
}

function finishMediaPortalProgress(state, ok, reason = '', message = '') {
  clearMediaPortalProgressTimer();
  const fallbackMessage = ok
    ? (state?.automationMode === 'video-parse'
      ? '视频解析完成'
      : (state?.automationMode === 'music-search'
        ? '音乐版本读取完成'
        : (state?.automationMode === 'music-preview' ? '试听已就绪' : '文件已开始下载')))
    : '自动处理未完成';
  emitMediaPortalProgress(state, {
    status: ok ? 'success' : 'error',
    percent: ok ? 100 : Math.min(99, mediaPortalProgressPayload(state).percent),
    message: String(message || fallbackMessage),
    reason: String(reason || ''),
  });
}

function clearMediaPortalPendingDownload() {
  if (mediaPortalPendingDownload?.timeout) clearTimeout(mediaPortalPendingDownload.timeout);
  mediaPortalPendingDownload = null;
}

function waitForMediaPortalDownload(state) {
  clearMediaPortalPendingDownload();
  mediaPortalPendingDownload = {
    requestId: state.requestId,
    webContents: mediaPortalView?.webContents || null,
    timeout: setTimeout(() => {
      if (!mediaPortalPendingDownload || mediaPortalPendingDownload.requestId !== state.requestId) return;
      clearMediaPortalPendingDownload();
      finishMediaPortalProgress(state, false, 'download-timeout', '下载站没有返回文件，请重新尝试该版本');
      notifyMediaBrowserState({ opening: false, autoActionMissing: true, automationStage: 'music-download', failureReason: 'download-timeout' });
    }, 30000),
  };
}

function markMediaPortalDownloadStarted(webContents) {
  const state = mediaPortalInputState;
  if (state?.automationMode === 'music-download' && state.requestId === mediaPortalRequestId) {
    state.downloadObserved = true;
    finishMediaPortalProgress(state, true, '', '普通音质文件已开始下载');
  }
  if (!mediaPortalPendingDownload || mediaPortalPendingDownload.webContents !== webContents) return;
  const pendingState = {
    requestId: mediaPortalPendingDownload.requestId,
    automationMode: 'music-download',
    progressStartedAt: Date.now(),
  };
  clearMediaPortalPendingDownload();
  finishMediaPortalProgress(pendingState, true, '', '普通音质文件已开始下载');
}

function clearMediaPortalPreviewCapture(result = null) {
  const capture = mediaPortalPreviewCapture;
  mediaPortalPreviewCapture = null;
  if (!capture) return;
  clearTimeout(capture.timeout);
  if (!result && capture.item && !capture.item.isDestroyed?.()) {
    try { capture.item.cancel(); } catch {}
  }
  capture.resolve(result);
}

function expectMediaPortalPopupDownload(webContents, timeoutMs = 15000) {
  if (!webContents || webContents.isDestroyed()) return;
  mediaPortalExpectedPopupDownloads.set(webContents, Date.now() + Math.max(1000, Number(timeoutMs) || 15000));
}

function consumeMediaPortalPopupDownload(webContents) {
  const deadline = Number(mediaPortalExpectedPopupDownloads.get(webContents) || 0);
  mediaPortalExpectedPopupDownloads.delete(webContents);
  return deadline >= Date.now();
}

async function prepareMediaPortalVideoPreview(state, parsed) {
  const view = mediaPortalView;
  if (!view || view.webContents.isDestroyed() || state.requestId !== mediaPortalRequestId) return null;
  const cached = findMediaPreviewCache(state.value);
  if (cached) return cached;
  clearMediaPortalPreviewCapture();
  const capturedDownload = new Promise((resolve) => {
    mediaPortalPreviewCapture = {
      requestId: state.requestId,
      webContents: view.webContents,
      sourceUrl: state.value,
      state,
      item: null,
      resolve,
      timeout: setTimeout(() => clearMediaPortalPreviewCapture(null), MEDIA_PREVIEW_DOWNLOAD_TIMEOUT_MS),
    };
  });
  try {
    if (!parsed.downloadActionReady) {
      const previewUrl = sanitizeRemoteMediaUrl(parsed.previewUrl);
      if (!previewUrl) {
        clearMediaPortalPreviewCapture();
        return null;
      }
      startCapturedMediaPortalDownload(view.webContents, previewUrl);
      const captured = await capturedDownload;
      if (captured) captured.label = String(parsed.qualityLabel || '临时预览');
      return captured;
    }
    const candidateIndex = Math.max(0, Number(parsed.candidateCount || 1) - 1);
    expectMediaPortalPopupDownload(view.webContents, 20000);
    const result = await view.webContents.executeJavaScript(buildPortalScript({
      mode: 'video-download',
      value: state.value,
      timeoutMs: 20000,
      candidateIndex,
    }, scoreMediaDownloadQualityLabel), true);
    if (state.requestId !== mediaPortalRequestId) {
      clearMediaPortalPreviewCapture();
      return null;
    }
    const href = sanitizeRemoteMediaUrl(result?.href);
    if (href && result?.ok) startCapturedMediaPortalDownload(view.webContents, href);
    if (!result?.ok) {
      clearMediaPortalPreviewCapture();
      return null;
    }
    const captured = await capturedDownload;
    if (captured) captured.label = String(result?.label || parsed.qualityLabel || '临时预览');
    return captured;
  } catch (error) {
    runtimeLog('media preview capture failed: ' + (error?.message || error));
    clearMediaPortalPreviewCapture();
    return null;
  }
}

async function prepareAlternateMediaPortalPreview(state) {
  const provider = detectVideoProvider(state.value);
  const routes = Array.isArray(provider?.portals) ? provider.portals : [];
  const alternatives = routes.filter((route) => route?.url && route.url !== state.portalUrl && !route.requiresVpn).slice(0, 2);
  for (const route of alternatives) {
    if (!isAllowedPortalUrl(route.url)) continue;
    const previewWindow = new BrowserWindow({
      show: false,
      width: 1100,
      height: 780,
      webPreferences: {
        partition: `xuannian-media-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    previewWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    previewWindow.webContents.session.on('will-download', (event, item) => {
      event.preventDefault();
      try { item.cancel(); } catch {}
    });
    try {
      let loadTimer;
      await Promise.race([
        previewWindow.loadURL(route.url),
        new Promise((_, reject) => {
          loadTimer = setTimeout(() => reject(new Error('alternate-preview-load-timeout')), 25000);
        }),
      ]).finally(() => clearTimeout(loadTimer));
      const inputResult = await previewWindow.webContents.executeJavaScript(buildPortalScript({
        mode: 'video-parse',
        phase: 'input',
        value: state.value,
        timeoutMs: 15000,
      }, scoreMediaDownloadQualityLabel), true);
      if (!inputResult?.continueAutomation) continue;
      await new Promise((resolve) => setTimeout(resolve, 800));
      const result = await previewWindow.webContents.executeJavaScript(buildPortalScript({
        mode: 'video-parse',
        phase: 'result',
        value: state.value,
        timeoutMs: 30000,
      }, scoreMediaDownloadQualityLabel), true);
      const previewUrl = sanitizeRemoteMediaUrl(result?.previewUrl);
      if (result?.ok && previewUrl) {
        runtimeLog(`alternate media preview resolved by ${String(route.label || route.url)}`);
        return { url: previewUrl, label: String(result.qualityLabel || route.label || '备用预览') };
      }
    } catch (error) {
      runtimeLog(`alternate media preview failed via ${String(route.label || route.url)}: ${error?.message || error}`);
    } finally {
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
    }
  }
  return null;
}

function setMediaPortalPresentationMode(mode = 'browser', previewUrl = '') {
  const view = mediaPortalView;
  if (!view || view.webContents.isDestroyed()) return;
  const normalizedMode = mode === 'preview' ? 'preview' : 'browser';
  const source = String(previewUrl || '');
  const script = [
    '(() => {',
    "const id = 'xuannian-media-preview-overlay';",
    'let overlay = document.getElementById(id);',
    'if (' + JSON.stringify(normalizedMode) + " === 'preview') {",
    'if (!overlay) {',
    "overlay = document.createElement('div');",
    'overlay.id = id;',
    "overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;display:grid;place-items:center;margin:0;padding:0;';",
    "const video = document.createElement('video');",
    'video.controls = true;',
    "video.controlsList.add('nodownload', 'noremoteplayback');",
    'video.disablePictureInPicture = true;',
    "video.addEventListener('contextmenu', (event) => event.preventDefault());",
    "video.preload = 'metadata';",
    "video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#111;';",
    'overlay.appendChild(video);',
    'document.body.appendChild(overlay);',
    '}',
    "const video = overlay.querySelector('video');",
    'const next = ' + JSON.stringify(source) + ';',
    'if (next && video.src !== next) { video.src = next; video.load(); }',
    "overlay.style.display = 'grid';",
    '} else if (overlay) {',
    "overlay.style.display = 'none';",
    "overlay.querySelector('video')?.pause();",
    '}',
    '})()',
  ].join('\n');
  view.webContents.executeJavaScript(script, true).catch(() => {});
}

function sanitizeRemoteMediaUrl(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 4096) return '';
  return url;
}

function sanitizeMusicResults(results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const sanitized = [];
  for (const item of results) {
    const url = sanitizeRemoteMediaUrl(item?.url);
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'gequbao.com' || !/^\/music\/\d+(?:[/?#]|$)/i.test(parsed.pathname) || seen.has(url)) continue;
    seen.add(url);
    sanitized.push({
      id: String(sanitized.length + 1),
      url,
      title: String(item?.title || item?.label || '未命名歌曲').trim().slice(0, 120),
      artist: String(item?.artist || '').trim().slice(0, 120),
      label: String(item?.label || '').trim().slice(0, 180),
    });
    if (sanitized.length >= 60) break;
  }
  return sanitized;
}

function publishMediaPortalVideo(state, parsed) {
  mediaPortalInputState = null;
  mediaPortalParsedVideo = parsed.ok && parsed.downloadReady ? parsed : null;
  const {
    capturedDownloadUrl: _capturedDownloadUrl,
    capturedFilename: _capturedFilename,
    capturedLocalPath: _capturedLocalPath,
    ...publicParsed
  } = parsed;
  sendMediaPortalEvent('media:videoParsed', publicParsed);
  finishMediaPortalProgress(state, parsed.ok && parsed.downloadReady, parsed.reason);
  notifyMediaBrowserState({
    opening: false,
    autoFilled: true,
    autoSubmitted: true,
    parsed: parsed.ok,
    autoActionMissing: !parsed.ok || !parsed.downloadReady,
    qualityLabel: parsed.qualityLabel,
  });
}

async function completeMediaPortalAutomation(state, result = {}) {
  if (state.requestId !== mediaPortalRequestId) return;
  clearMediaPortalVisibilityNudgeTimer();
  const view = mediaPortalView;
  const mode = state.automationMode;
  const humanVerification = String(result.reason || '') === 'human-verification'
    && String(mode || '').startsWith('music-');
  if (humanVerification && mode === 'music-search'
    && Number(state.verificationVisibilityRetryCount || 0) < MEDIA_PORTAL_MUSIC_WAKE_MAX
    && Number(state.visibilityNudgeCount || 0) < MEDIA_PORTAL_MUSIC_WAKE_MAX) {
    state.verificationVisibilityRetryCount = Number(state.verificationVisibilityRetryCount || 0) + 1;
    runtimeLog(`music verification visibility retry ${state.verificationVisibilityRetryCount}/${MEDIA_PORTAL_MUSIC_WAKE_MAX}`);
    emitMediaPortalProgress(state, {
      percent: Math.min(78, 68 + state.verificationVisibilityRetryCount * 3),
      message: `正在自动激活首次验证页面（${state.verificationVisibilityRetryCount}/${MEDIA_PORTAL_MUSIC_WAKE_MAX}）`,
    });
    scheduleMediaPortalVisibilityNudge(state, view, {
      delayMsOverride: 0,
      visibleMsOverride: 6500,
      rerunAfterWake: true,
    });
    return;
  }
  if (humanVerification) rememberMediaPortalVerificationResume(state);
  if (mode === 'video-parse') {
    const parsed = {
      requestId: state.requestId,
      ok: !!result.ok,
      sourceUrl: state.value,
      portalUrl: state.portalUrl,
      previewUrl: sanitizeRemoteMediaUrl(result.previewUrl),
      title: sanitizeMediaVideoTitle(result.title, state.value),
      downloadReady: !!result.downloadReady,
      downloadActionReady: !!result.downloadActionReady,
      qualityLabel: String(result.qualityLabel || '').trim().slice(0, 120),
      qualityHref: sanitizeRemoteMediaUrl(result.qualityHref),
      candidateCount: Math.max(0, Math.min(12, Number(result.candidateCount || 0))),
      qualityOptions: Array.isArray(result.qualityOptions) ? result.qualityOptions.slice(0, 8).map((option) => ({
        label: String(option?.label || '').trim().slice(0, 240),
        href: sanitizeRemoteMediaUrl(option?.href),
      })) : [],
      reason: String(result.reason || ''),
      embeddedPreview: false,
      capturedDownloadUrl: '',
      capturedFilename: '',
      capturedLocalPath: '',
    };
    if (parsed.ok && parsed.downloadReady) {
      emitMediaPortalProgress(state, {
        percent: 96,
        message: '正在准备视频预览',
      });
      const captured = await prepareMediaPortalVideoPreview(state, parsed);
      if (state.requestId !== mediaPortalRequestId) return;
      if (captured?.embedded && captured.url) {
        parsed.embeddedPreview = true;
        parsed.previewUrl = '';
        parsed.capturedDownloadUrl = captured.url;
        parsed.capturedFilename = String(captured.filename || '').slice(0, 220);
      } else if (captured?.url) {
        parsed.previewUrl = captured.temporary ? String(captured.url || '') : sanitizeRemoteMediaUrl(captured.url);
        parsed.capturedFilename = String(captured.filename || '').slice(0, 220);
        parsed.capturedLocalPath = captured.temporary ? String(captured.localPath || '') : '';
        parsed.qualityLabel = String(captured.label || parsed.qualityLabel || '');
      }
      if (!parsed.previewUrl && !parsed.embeddedPreview) {
        emitMediaPortalProgress(state, { percent: 98, message: '正在从备用渠道补充视频预览' });
        const alternate = await prepareAlternateMediaPortalPreview(state);
        if (state.requestId !== mediaPortalRequestId) return;
        if (alternate?.url) {
          parsed.previewUrl = alternate.url;
          parsed.qualityLabel = String(alternate.label || parsed.qualityLabel || '备用预览');
        }
      }
    }
    publishMediaPortalVideo(state, parsed);
  } else if (mode === 'music-search') {
    const results = sanitizeMusicResults(result.results);
    const searchSucceeded = !!result.ok && results.length > 0;
    if (!searchSucceeded && String(result.reason || '') === 'search-timeout' && Number(state.visibilityRetryCount || 0) < 2) {
      state.visibilityRetryCount = Number(state.visibilityRetryCount || 0) + 1;
      state.visibilityNudgeCount = 0;
      state.progressStartedAt = Date.now();
      runtimeLog(`music search extraction retry ${state.visibilityRetryCount}/2`);
      emitMediaPortalProgress(state, { percent: 72, message: '正在激活后台页面并重新读取音乐结果' });
      try {
        await mediaPortalView?.webContents.executeJavaScript(`(() => {
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('resize'));
          document.dispatchEvent(new Event('visibilitychange'));
          document.querySelector('main,body')?.getBoundingClientRect();
          return document.visibilityState;
        })()`, true);
      } catch {}
      scheduleMediaPortalInput();
      return;
    }
    mediaPortalInputState = null;
    sendMediaPortalEvent('media:musicResults', {
      requestId: state.requestId,
      ok: searchSucceeded,
      query: state.value,
      results,
      reason: String(result.reason || ''),
    });
    finishMediaPortalProgress(state, searchSucceeded, String(result.reason || ''));
    notifyMediaBrowserState({
      opening: false,
      musicResultsReady: results.length > 0,
      autoActionMissing: results.length === 0,
    });
  } else if (mode === 'music-preview') {
    mediaPortalInputState = null;
    const previewUrl = sanitizeRemoteMediaUrl(result.previewUrl);
    const previewSucceeded = !!result.ok && !!previewUrl;
    sendMediaPortalEvent('media:musicPreviewReady', {
      requestId: state.requestId,
      ok: previewSucceeded,
      resultUrl: state.portalUrl,
      previewUrl,
      reason: String(result.reason || (previewSucceeded ? '' : 'preview-unavailable')),
    });
    finishMediaPortalProgress(state, previewSucceeded, String(result.reason || ''));
    notifyMediaBrowserState({
      opening: false,
      musicPreviewReady: previewSucceeded,
      autoActionMissing: !previewSucceeded,
    });
  } else if (mode === 'music-download') {
    mediaPortalInputState = null;
    const href = sanitizeRemoteMediaUrl(result.href);
    if (!result.ok) {
      finishMediaPortalProgress(state, false, String(result.reason || 'download-action-missing'));
    } else if (state.downloadObserved) {
      finishMediaPortalProgress(state, true, '', '普通音质文件已开始下载');
    } else {
      waitForMediaPortalDownload(state);
      if (href && isMediaUrl(href) && view && !view.webContents.isDestroyed()) {
        view.webContents.downloadURL(href);
      }
    }
    notifyMediaBrowserState({
      opening: false,
      autoDownloadStarted: !!result.ok,
      autoActionMissing: !result.ok,
      automationStage: 'music-download',
      failureReason: result.ok ? '' : String(result.reason || 'download-action-missing'),
      qualityLabel: '普通音质',
    });
  }
  if (!activeMediaPortalDownloads && !mediaPortalInputState) {
    if (mediaPortalView && !mediaPortalView.webContents.isDestroyed()) mediaPortalView.setVisible(false);
    scheduleMediaPortalIdleDestroy();
  }
}

function scheduleMediaPortalInput() {
  clearMediaPortalInputTimer();
  const view = mediaPortalView;
  const state = mediaPortalInputState;
  if (!view || view.webContents.isDestroyed() || !state || state.requestId !== mediaPortalRequestId) return;
  mediaPortalInputTimer = setTimeout(async () => {
    if (!mediaPortalView || mediaPortalView.webContents.isDestroyed() || state.requestId !== mediaPortalRequestId) return;
    keepMediaPortalWorkerVisible(view);
    scheduleMediaPortalVisibilityNudge(state, view);
    const script = buildPortalScript({
      mode: state.automationMode,
      phase: state.phase || '',
      value: state.value || '',
      timeoutMs: state.automationMode === 'video-parse' && state.phase === 'result'
        ? 45000
        : (state.automationMode === 'music-download' ? 55000 : (state.automationMode === 'music-search' && state.visibilityRetryCount ? 15000 : 30000)),
    }, scoreMediaDownloadQualityLabel);
    try {
      const result = await view.webContents.executeJavaScript(script, true);
      if (state.requestId !== mediaPortalRequestId) return;
      if (result?.continueAutomation) {
        state.phase = String(result.nextPhase || 'result');
        notifyMediaBrowserState({ opening: true, automationStage: state.phase });
        scheduleMediaPortalInput();
        return;
      }
      await completeMediaPortalAutomation(state, result || {});
    } catch (error) {
      if (state.requestId !== mediaPortalRequestId) return;
      state.retryCount = Number(state.retryCount || 0) + 1;
      if (state.retryCount <= 3) {
        if (state.automationMode === 'video-parse' && state.phase !== 'result' && view.webContents.getURL() !== state.portalUrl) {
          state.phase = 'result';
        }
        scheduleMediaPortalInput();
        return;
      }
      runtimeLog(`media portal automation failed: ${error?.message || error}`);
      await completeMediaPortalAutomation(state, { ok: false, reason: 'automation-error' });
    }
  }, 320);
}

async function reloadParsedVideoDownloadPage(view, parsed) {
  if (!view || view.webContents.isDestroyed() || !parsed?.sourceUrl || !isAllowedPortalUrl(parsed.portalUrl)) {
    return { ok: false, reason: 'download-page-unavailable' };
  }
  const webContents = view.webContents;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        webContents.removeListener('did-finish-load', onLoaded);
        webContents.removeListener('did-fail-load', onFailed);
        if (error) reject(error); else resolve();
      };
      const onLoaded = () => finish();
      const onFailed = (_event, code, description, validatedUrl, isMainFrame) => {
        if (isMainFrame === false) return;
        finish(new Error(`${code}:${description}:${validatedUrl}`));
      };
      const timer = setTimeout(() => finish(new Error('download-page-load-timeout')), 25000);
      webContents.once('did-finish-load', onLoaded);
      webContents.on('did-fail-load', onFailed);
      try {
        if (webContents.getURL() === parsed.portalUrl) webContents.reloadIgnoringCache();
        else webContents.loadURL(parsed.portalUrl).catch(finish);
      } catch (error) {
        finish(error);
      }
    });
  } catch (error) {
    runtimeLog(`parsed video replay load failed: ${error?.message || error}`);
    return { ok: false, reason: 'load-error' };
  }
  try {
    const input = await webContents.executeJavaScript(buildPortalScript({
      mode: 'video-parse',
      phase: 'input',
      value: parsed.sourceUrl,
      timeoutMs: 20000,
    }, scoreMediaDownloadQualityLabel), true);
    if (!input?.continueAutomation) return { ok: false, reason: String(input?.reason || 'parse-action-missing') };
    const result = await webContents.executeJavaScript(buildPortalScript({
      mode: 'video-parse',
      phase: 'result',
      value: parsed.sourceUrl,
      timeoutMs: 45000,
    }, scoreMediaDownloadQualityLabel), true);
    if (!result?.ok || !result?.downloadReady) return { ok: false, reason: String(result?.reason || 'parse-timeout') };
    return {
      ok: true,
      candidateCount: Math.max(1, Math.min(8, Number(result.candidateCount || 1))),
      qualityLabel: String(result.qualityLabel || parsed.qualityLabel || ''),
      qualityHref: sanitizeRemoteMediaUrl(result.qualityHref),
      downloadActionReady: !!result.downloadActionReady,
    };
  } catch (error) {
    runtimeLog(`parsed video replay automation failed: ${error?.message || error}`);
    return { ok: false, reason: 'automation-error' };
  }
}

async function promoteMediaPreviewToLibrary(parsed, downloadTarget = 'download', collection = '') {
  const sourcePath = String(parsed?.capturedLocalPath || '');
  if (!sourcePath || !fs.existsSync(sourcePath)) return { ok: false, reason: 'preview-cache-missing' };
  try {
    const directories = mediaDirectories();
    const favoriteDownload = downloadTarget === 'favorite';
    const rootPath = favoriteDownload ? directories.favoritePath : directories.downloadPath;
    const receivedFilename = sanitizeDownloadFilename(
      parsed.capturedFilename || path.basename(sourcePath) || 'video.mp4',
      'video/mp4',
    );
    const extension = path.extname(receivedFilename) || path.extname(sourcePath) || '.mp4';
    const cleanTitle = sanitizeMediaVideoTitle(parsed.title, parsed.sourceUrl);
    const displayName = path.basename(String(cleanTitle || receivedFilename).trim(), path.extname(String(cleanTitle || receivedFilename).trim()));
    const filename = sanitizeDownloadFilename((displayName || 'video') + extension, 'video/mp4');
    const downloadPath = mediaCollectionDirectory(rootPath, 'video', String(collection || '').trim());
    fs.mkdirSync(downloadPath, { recursive: true });
    const destination = uniqueMediaDownloadPath(downloadPath, filename);
    const taskId = 'media-preview-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const sourceSize = Number(fs.statSync(sourcePath).size || 0);
    const progressTask = (percent, status = 'downloading') => ({
      id: taskId,
      name: filename,
      path: destination,
      location: favoriteDownload ? 'favorites' : 'downloads',
      status,
      receivedBytes: status === 'completed' ? sourceSize : Math.round(sourceSize * (percent / 100)),
      totalBytes: sourceSize,
      percent,
      updatedAt: Date.now(),
    });
    notifyMediaDownloadProgress(progressTask(8));
    await fs.promises.copyFile(sourcePath, destination);
    notifyMediaDownloadProgress(progressTask(92));
    await new Promise((resolve) => setTimeout(resolve, 240));
    const stat = fs.statSync(destination);
    const completedTask = {
      id: taskId,
      name: filename,
      path: destination,
      location: favoriteDownload ? 'favorites' : 'downloads',
      status: 'completed',
      receivedBytes: Number(stat.size || 0),
      totalBytes: Number(stat.size || 0),
      percent: 100,
      updatedAt: Date.now(),
    };
    rememberCompletedMediaDownload(completedTask);
    notifyMediaDownloadProgress(completedTask);
    notifyMediaDownloadsChanged({
      status: 'completed',
      path: destination,
      favorite: favoriteDownload,
      message: favoriteDownload ? '预览视频已保存到收藏目录' : '预览视频已保存到下载目录',
    });
    showMediaDownloadNotification({ status: 'completed', name: filename, filePath: destination, favorite: favoriteDownload });
    runtimeLog('promoted cached media preview to ' + destination);
    return { ok: true, path: destination, previewFallback: true, completed: true };
  } catch (error) {
    runtimeLog('promote media preview failed: ' + (error?.message || error));
    return { ok: false, reason: 'preview-promote-failed' };
  }
}

async function downloadParsedMediaVideo(downloadTarget = 'download', collection = '') {
  const parsed = mediaPortalParsedVideo;
  if (!parsed?.downloadReady) return { ok: false, code: 'parse-required', reason: '请先完成视频解析' };
  if (Number(parsed.candidateCount || 0) <= 1 && parsed.capturedLocalPath && fs.existsSync(parsed.capturedLocalPath)) {
    return promoteMediaPreviewToLibrary(parsed, downloadTarget, collection);
  }
  const view = ensureMediaPortalView();
  if (!view || view.webContents.isDestroyed()) return { ok: false, code: 'load-error', reason: '下载页面无法启动' };
  mediaPortalDownloadTargets.set(view.webContents, {
    location: downloadTarget === 'favorite' ? 'favorite' : 'download',
    collection: String(collection || '').trim(),
    preferredName: sanitizeMediaVideoTitle(parsed.title || parsed.capturedFilename, parsed.sourceUrl),
  });
  cancelMediaPortalIdleDestroy();
  keepMediaPortalWorkerVisible(view);
  notifyMediaBrowserState({ opening: true, automationStage: 'video-download', autoActionMissing: false });
  clearMediaPortalPreviewCapture();
  const waitForDownloadStart = (trigger, timeoutMs = 12000) => new Promise((resolve) => {
    const electronSession = view.webContents.session;
    const initialDirectStartCount = mediaPortalDownloadStartCount(view.webContents);
    let settled = false;
    let timer = null;
    let directStartTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(directStartTimer);
      electronSession.removeListener('will-download', onDownload);
      resolve(result);
    };
    const onDownload = (_event, item, sourceWebContents) => {
      if (sourceWebContents !== view.webContents) return;
      finish({ ok: true, filename: String(item.getFilename() || '') });
    };
    electronSession.on('will-download', onDownload);
    directStartTimer = setInterval(() => {
      if (mediaPortalDownloadStartCount(view.webContents) > initialDirectStartCount) finish({ ok: true, direct: true });
    }, 80);
    timer = setTimeout(() => finish({ ok: false, reason: '当前画质没有启动下载' }), timeoutMs);
    Promise.resolve()
      .then(trigger)
      .then((result) => {
        if (result?.ok === false) finish({ ok: false, reason: String(result.reason || '下载按钮暂时不可用') });
      })
      .catch((error) => finish({ ok: false, reason: String(error?.message || '下载按钮暂时不可用') }));
  });
  const directUrl = parsed.qualityHref && isMediaUrl(parsed.qualityHref)
    ? parsed.qualityHref
    : '';
  const previewFallbackUrl = String(parsed.capturedDownloadUrl || (!parsed.downloadActionReady ? parsed.previewUrl : ''));
  try {
    let started = { ok: false, reason: '下载站没有返回可用文件' };
    if (directUrl) {
      started = await waitForDownloadStart(async () => {
        runtimeLog(`parsed video direct download source=${directUrl.startsWith('blob:') ? 'captured-blob' : (directUrl === parsed.previewUrl ? 'preview' : 'quality-link')}`);
        if (directUrl.startsWith('blob:')) {
          const triggered = await view.webContents.executeJavaScript(`(() => {
            const anchor = document.createElement('a');
            anchor.href = ${JSON.stringify(directUrl)};
            anchor.download = ${JSON.stringify(String(parsed.capturedFilename || 'video.mp4'))};
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            return true;
          })()`, true);
          return triggered ? { ok: true } : { ok: false, reason: '预览视频下载入口暂时不可用' };
        }
        startCapturedMediaPortalDownload(view.webContents, directUrl);
        return { ok: true };
      });
    }
    const tryCandidates = async (candidateCount, firstPass = false) => {
      let candidateResult = { ok: false, reason: '下载站没有返回可用文件' };
      const limit = firstPass ? Math.min(1, candidateCount) : candidateCount;
      for (let candidateIndex = 0; candidateIndex < limit; candidateIndex += 1) {
        candidateResult = await waitForDownloadStart(async () => {
          expectMediaPortalPopupDownload(view.webContents, 15000);
          const result = await view.webContents.executeJavaScript(buildPortalScript({
            mode: 'video-download',
            value: parsed.sourceUrl,
            timeoutMs: 10000,
            candidateIndex,
          }, scoreMediaDownloadQualityLabel), true);
          const href = sanitizeRemoteMediaUrl(result?.href);
          runtimeLog(`parsed video candidate=${candidateIndex + 1}/${candidateCount} ok=${!!result?.ok} clicked=${!!result?.clicked} href=${href && isMediaUrl(href) ? 'media' : 'none'} label=${String(result?.label || '').slice(0, 160)}`);
          if (!result?.ok) return { ok: false, reason: String(result?.reason || '当前画质按钮暂时不可用') };
          if (href) {
            mediaPortalExpectedPopupDownloads.delete(view.webContents);
            startCapturedMediaPortalDownload(view.webContents, href);
          }
          return { ok: true };
        }, firstPass ? 8000 : (candidateIndex === 0 ? 12000 : 9000));
        if (candidateResult.ok) break;
      }
      return candidateResult;
    };
    if (!started.ok && parsed.downloadActionReady) {
      const candidateCount = Math.max(1, Math.min(8, Number(parsed.candidateCount || 3)));
      started = await tryCandidates(candidateCount, true);
    }
    if (!started.ok && parsed.portalUrl) {
      notifyMediaBrowserState({ opening: true, automationStage: 'video-download-reparse', autoActionMissing: false });
      const replay = await reloadParsedVideoDownloadPage(view, parsed);
      if (replay.ok) {
        mediaPortalParsedVideo = { ...parsed, ...replay, requestId: parsed.requestId };
        const replayDirectUrl = replay.qualityHref && isMediaUrl(replay.qualityHref) ? replay.qualityHref : '';
        if (replayDirectUrl) {
          started = await waitForDownloadStart(() => {
            startCapturedMediaPortalDownload(view.webContents, replayDirectUrl);
            return { ok: true };
          });
        }
        if (!started.ok && replay.downloadActionReady) started = await tryCandidates(replay.candidateCount, false);
      } else {
        started = { ok: false, code: replay.reason, reason: replay.reason };
      }
    }
    if (!started.ok && parsed.capturedLocalPath) {
      started = await promoteMediaPreviewToLibrary(parsed, downloadTarget, collection);
    }
    if (!started.ok && /^(?:https?:|blob:)/i.test(previewFallbackUrl)) {
      started = await waitForDownloadStart(async () => {
        runtimeLog('parsed video falling back to captured preview');
        if (previewFallbackUrl.startsWith('blob:')) {
          const script = '(() => { const anchor = document.createElement("a");'
            + 'anchor.href = ' + JSON.stringify(previewFallbackUrl) + ';'
            + 'anchor.download = ' + JSON.stringify(String(parsed.capturedFilename || 'video.mp4')) + ';'
            + 'anchor.style.display = "none"; document.body.appendChild(anchor);'
            + 'anchor.click(); anchor.remove(); return true; })()';
          const triggered = await view.webContents.executeJavaScript(script, true);
          return triggered ? { ok: true } : { ok: false, reason: '预览视频下载入口暂时不可用' };
        }
        startCapturedMediaPortalDownload(view.webContents, previewFallbackUrl);
        return { ok: true };
      });
    }
    if (!started.ok) {
      started.code = String(started.code || started.reason || 'download-timeout');
      started.reason = '最高、次高清和普通画质均未启动下载';
    }
    notifyMediaBrowserState({
      opening: false,
      autoDownloadStarted: !!started.ok,
      autoActionMissing: !started.ok,
      automationStage: 'video-download',
      failureReason: started.ok ? '' : String(started.code || 'download-timeout'),
      qualityLabel: String(parsed.qualityLabel || ''),
    });
    if (!started.ok) {
      view.setVisible(false);
      scheduleMediaPortalIdleDestroy();
    }
    return started.ok ? started : { ...started, ok: false };
  } catch (error) {
    runtimeLog(`parsed video download failed: ${error?.message || error}`);
    notifyMediaBrowserState({ opening: false, autoActionMissing: true });
    scheduleMediaPortalIdleDestroy();
    return { ok: false, code: 'automation-error', reason: '下载按钮暂时不可用' };
  }
}

function isGequbaoMusicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase().replace(/^www\./, '') === 'gequbao.com'
      && /^\/music\/\d+(?:[/?#]|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function downloadMediaMusicResult(url, downloadTarget = 'download', collection = '', preferredName = '') {
  const value = String(url || '').trim();
  if (!isGequbaoMusicUrl(value)) return false;
  const opened = openMediaPortal(value, downloadTarget, '', false, collection, '', 'music-download');
  if (opened && mediaPortalView && !mediaPortalView.webContents.isDestroyed()) {
    mediaPortalDownloadTargets.set(mediaPortalView.webContents, {
      location: downloadTarget === 'favorite' ? 'favorite' : 'download',
      collection: String(collection || '').trim(),
      preferredName: String(preferredName || '').trim().slice(0, 160),
    });
  }
  return opened;
}

function previewMediaMusicResult(url) {
  const value = String(url || '').trim();
  if (!isGequbaoMusicUrl(value)) return false;
  return openMediaPortal(value, 'download', '', false, '', '', 'music-preview');
}

async function openHighQualityMusic(query = '', downloadTarget = 'download', collection = '') {
  const value = String(query || '').trim().slice(0, 240);
  if (!value) return { ok: false, reason: '缺少歌曲名称' };
  const tracker = await startMediaExternalAudioTracker(value, downloadTarget, collection);
  const failTracker = () => {
    if (!tracker) return;
    mediaExternalAudioTrackers.delete(tracker.id);
    notifyMediaDownloadProgress({ ...tracker.task, status: 'error', updatedAt: Date.now() });
    stopMediaExternalAudioMonitorIfIdle();
  };
  clipboard.writeText(value);
  const client = process.platform === 'win32' ? findInstalledMusicClient() : null;
  if (client?.executablePath) {
    try {
      const args = client.id === 'quark' ? [client.url] : [];
      const child = spawn(client.executablePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return {
        ok: true,
        target: client.id,
        label: client.label,
        taskId: tracker?.id || '',
        message: '已复制歌曲名称并打开' + client.label + '；玄念会在后台检测下载完成并自动导入',
      };
    } catch (error) {
      runtimeLog('open high quality music client failed: ' + (error?.message || error));
    }
  }
  try {
    await shell.openExternal('https://www.alipan.com/');
    return {
      ok: true,
      target: 'web',
      label: '阿里云盘网页',
      taskId: tracker?.id || '',
      message: '未检测到阿里云盘或夸克客户端，已复制歌曲名称并打开网页；玄念会检测本地下载完成',
    };
  } catch {
    failTracker();
    return { ok: false, reason: '高清音质入口暂时无法打开' };
  }
}

function ensureMediaPortalView() {
  cancelMediaPortalIdleDestroy();
  if (mediaPortalView && !mediaPortalView.webContents.isDestroyed()) return mediaPortalView;
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:xuannian-media-portals',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  mediaPortalView = view;
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
  view.setVisible(false);
  mainWindow.contentView.addChildView(view);
  configureMediaDownloadSession(view.webContents.session);
  view.webContents.setWindowOpenHandler(({ url }) => {
    const disposition = classifyMediaPortalPopup(url, view.webContents.getURL());
    const expectedDownload = consumeMediaPortalPopupDownload(view.webContents);
    if (disposition === 'download' || (expectedDownload && isHttpUrl(url))) {
      runtimeLog('captured media portal download popup: ' + String(url || '').slice(0, 300));
      setImmediate(() => startCapturedMediaPortalDownload(view.webContents, url));
    } else if (disposition === 'same-site') {
      setImmediate(() => view.webContents.loadURL(url).catch(() => {}));
    } else {
      runtimeLog(`blocked media portal popup: ${String(url || '').slice(0, 300)}`);
      setImmediate(() => notifyMediaBrowserState({ popupBlocked: true }));
    }
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    const disposition = classifyMediaPortalPopup(url, view.webContents.getURL());
    const expectedDownload = consumeMediaPortalPopupDownload(view.webContents);
    if (disposition === 'download' || (expectedDownload && isHttpUrl(url))) {
      event.preventDefault();
      startCapturedMediaPortalDownload(view.webContents, url);
    } else if (disposition === 'block') {
      event.preventDefault();
      runtimeLog(`blocked media portal navigation: ${String(url || '').slice(0, 300)}`);
      notifyMediaBrowserState({ popupBlocked: true });
    }
  });
  view.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  view.webContents.on('did-start-loading', () => notifyMediaBrowserState());
  view.webContents.on('did-stop-loading', () => {
    trimMediaPortalHistory(view.webContents);
    enforceMediaPortalCacheLimit(view.webContents);
    notifyMediaBrowserState();
  });
  for (const eventName of ['did-navigate', 'did-navigate-in-page']) {
    view.webContents.on(eventName, () => {
      trimMediaPortalHistory(view.webContents);
      notifyMediaBrowserState();
    });
  }
  view.webContents.on('page-title-updated', () => notifyMediaBrowserState());
  view.webContents.on('did-finish-load', scheduleMediaPortalInput);
  view.webContents.on('render-process-gone', () => notifyMediaBrowserState({ crashed: true }));
  return view;
}

function keepMediaPortalWorkerVisible(view = mediaPortalView) {
  if (!view || view.webContents.isDestroyed()) return false;
  const content = mainWindow?.getContentBounds();
  const width = Math.max(1, Number(content?.width || 1));
  view.setBounds({
    x: width + 8,
    y: 0,
    width: MEDIA_PORTAL_WORKER_WIDTH,
    height: MEDIA_PORTAL_WORKER_HEIGHT,
  });
  view.setVisible(true);
  view.webContents.setAudioMuted(true);
  return true;
}

function setMediaPortalBounds(bounds = {}, visible = false, mode = 'browser') {
  const view = visible ? ensureMediaPortalView() : mediaPortalView;
  if (!view || view.webContents.isDestroyed()) return false;
  const content = mainWindow?.getContentBounds();
  const maxWidth = Math.max(0, Number(content?.width || 0));
  const maxHeight = Math.max(0, Number(content?.height || 0));
  const x = Math.max(0, Math.min(maxWidth, Math.round(Number(bounds.x || 0))));
  const y = Math.max(0, Math.min(maxHeight, Math.round(Number(bounds.y || 0))));
  const width = Math.max(0, Math.min(maxWidth - x, Math.round(Number(bounds.width || 0))));
  const height = Math.max(0, Math.min(maxHeight - y, Math.round(Number(bounds.height || 0))));
  const shouldShow = !!visible && width >= 120 && height >= 80;
  if (width >= 120 && height >= 80) view.setBounds({ x, y, width, height });
  const previewUrl = mediaPortalParsedVideo?.capturedDownloadUrl || mediaPortalParsedVideo?.previewUrl || '';
  setMediaPortalPresentationMode(shouldShow && mode === 'preview' ? 'preview' : 'browser', previewUrl);
  const keepWorkerActive = !shouldShow && (!!mediaPortalInputState || activeMediaPortalDownloads > 0);
  if (keepWorkerActive) keepMediaPortalWorkerVisible(view);
  else view.setVisible(shouldShow);
  view.webContents.setAudioMuted(!shouldShow);
  if (shouldShow) {
    cancelMediaPortalIdleDestroy();
    enforceMediaPortalCacheLimit(view.webContents);
  } else if (mediaPortalInputState || activeMediaPortalDownloads) {
    cancelMediaPortalIdleDestroy();
  } else {
    scheduleMediaPortalIdleDestroy();
  }
  return true;
}

function openMediaPortal(url, downloadTarget = 'download', sourceText = '', autoSubmit = false, collection = '', qualityPreference = '', automationMode = '') {
  const value = String(url || '').trim();
  if (!isAllowedPortalUrl(value)) return false;
  const view = ensureMediaPortalView();
  if (!view) return false;
  if (automationMode) clearMediaPortalVerificationMonitor();
  mediaPortalRequestId += 1;
  const normalizedQualityPreference = qualityPreference === 'highest' ? 'highest' : '';
  const normalizedAutomationMode = ['video-parse', 'music-search', 'music-preview', 'music-download'].includes(automationMode)
    ? automationMode
    : 'video-parse';
  const automationValue = String(sourceText || '').trim();
  const previousParsedVideo = normalizedAutomationMode === 'video-parse'
    && mediaPortalParsedVideo?.sourceUrl === automationValue
    ? mediaPortalParsedVideo
    : null;
  const cachedPreview = normalizedAutomationMode === 'video-parse' && automationValue
    ? findMediaPreviewCache(automationValue)
    : null;
  if (normalizedAutomationMode === 'video-parse') mediaPortalParsedVideo = null;
  mediaPortalDownloadTargets.set(view.webContents, {
    location: downloadTarget === 'favorite' ? 'favorite' : 'download',
    collection: String(collection || '').trim(),
  });
  mediaPortalInputState = automationValue || normalizedAutomationMode === 'music-search' || normalizedAutomationMode === 'music-preview' || normalizedAutomationMode === 'music-download'
    ? {
      requestId: mediaPortalRequestId,
      value: automationValue,
      autoSubmit: !!autoSubmit,
      qualityPreference: normalizedQualityPreference,
      automationMode: normalizedAutomationMode,
      phase: normalizedAutomationMode === 'video-parse' ? 'input' : '',
      portalUrl: value,
      retryCount: 0,
    }
    : null;
  clearMediaPortalInputTimer();
  clearMediaPortalVisibilityNudgeTimer();
  clearMediaPortalPendingDownload();
  if (mediaPortalInputState) {
    keepMediaPortalWorkerVisible(view);
    startMediaPortalProgress(mediaPortalInputState);
  }
  if (cachedPreview && mediaPortalInputState && normalizedAutomationMode === 'video-parse') {
    const state = mediaPortalInputState;
    const parsed = {
      ...(previousParsedVideo || {}),
      requestId: mediaPortalRequestId,
      ok: true,
      sourceUrl: automationValue,
      portalUrl: value,
      previewUrl: cachedPreview.url,
      title: String(previousParsedVideo?.title || '').trim().slice(0, 160),
      downloadReady: true,
      downloadActionReady: !!previousParsedVideo?.downloadActionReady,
      qualityLabel: String(previousParsedVideo?.qualityLabel || '已缓存预览').trim().slice(0, 120),
      qualityHref: String(previousParsedVideo?.qualityHref || ''),
      candidateCount: Math.max(0, Number(previousParsedVideo?.candidateCount || 0)),
      qualityOptions: Array.isArray(previousParsedVideo?.qualityOptions) ? previousParsedVideo.qualityOptions : [],
      reason: '',
      embeddedPreview: false,
      capturedDownloadUrl: '',
      capturedFilename: String(previousParsedVideo?.capturedFilename || cachedPreview.filename || '').slice(0, 220),
      capturedLocalPath: cachedPreview.localPath,
      cachedPreview: true,
    };
    notifyMediaBrowserState({
      requestId: mediaPortalRequestId,
      destroyed: false,
      opening: true,
      autoFilled: true,
      autoSubmitted: true,
      autoDownloadStarted: false,
      autoActionMissing: false,
      qualityLabel: parsed.qualityLabel,
    });
    setTimeout(() => {
      if (state.requestId !== mediaPortalRequestId) return;
      runtimeLog('media portal reused cached preview for repeated source');
      publishMediaPortalVideo(state, parsed);
    }, 40);
    return { ok: true, requestId: mediaPortalRequestId, cachedPreview: true };
  }
  let loadPromise;
  try {
    if (view.webContents.getURL() === value) {
      view.webContents.reloadIgnoringCache();
      loadPromise = Promise.resolve();
    } else {
      loadPromise = view.webContents.loadURL(value);
    }
  } catch (error) {
    loadPromise = Promise.reject(error);
  }
  loadPromise.catch((error) => {
    runtimeLog(`media portal load failed: ${error?.message || error}`);
    const state = mediaPortalInputState;
    if (state && state.requestId === mediaPortalRequestId) {
      completeMediaPortalAutomation(state, { ok: false, reason: 'load-error' });
    }
    notifyMediaBrowserState({ loadError: true, opening: false });
  });
  notifyMediaBrowserState({
    requestId: mediaPortalRequestId,
    destroyed: false,
    opening: true,
    autoFilled: false,
    autoSubmitted: false,
    autoDownloadStarted: false,
    autoActionMissing: false,
    qualityLabel: '',
  });
  return { ok: true, requestId: mediaPortalRequestId };
}

function resizeBoundsFromPointer(session, point) {
  const start = session.bounds;
  const dx = point.x - session.cursor.x;
  const dy = point.y - session.cursor.y;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const next = { ...start };

  if (session.edge.includes('w')) {
    next.x = Math.min(start.x + dx, right - MAIN_WINDOW_MIN_WIDTH);
    next.width = right - next.x;
  } else if (session.edge.includes('e')) {
    next.width = Math.max(MAIN_WINDOW_MIN_WIDTH, start.width + dx);
  }

  if (session.edge.includes('n')) {
    next.y = Math.min(start.y + dy, bottom - MAIN_WINDOW_MIN_HEIGHT);
    next.height = bottom - next.y;
  } else if (session.edge.includes('s')) {
    next.height = Math.max(MAIN_WINDOW_MIN_HEIGHT, start.height + dy);
  }

  return next;
}

function resizeStickyBoundsFromPointer(session, point) {
  const start = session.bounds;
  const dx = point.x - session.cursor.x;
  const dy = point.y - session.cursor.y;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const minWidth = 180;
  const minHeight = 140;
  const next = { ...start };

  if (session.edge.includes('w')) {
    next.x = Math.min(start.x + dx, right - minWidth);
    next.width = right - next.x;
  } else if (session.edge.includes('e')) {
    next.width = Math.max(minWidth, start.width + dx);
  }

  if (session.edge.includes('n')) {
    next.y = Math.min(start.y + dy, bottom - minHeight);
    next.height = bottom - next.y;
  } else if (session.edge.includes('s')) {
    next.height = Math.max(minHeight, start.height + dy);
  }

  const layout = normalizeStickyImageLayout(session.aspectRatio);
  const ratio = Number(layout?.ratio) || 0;
  if (ratio > 0) {
    const horizontalExtra = Number(layout.horizontalExtra) || 0;
    const extraHeight = Number(layout.extraHeight) || 0;
    const changedWidth = session.edge.includes('e') || session.edge.includes('w');
    const changedHeight = session.edge.includes('n') || session.edge.includes('s');
    if (layout.textFlexible && changedHeight && !changedWidth) {
      return next;
    }
    const preferWidth = changedWidth || !changedHeight;
    const area = session.area;
    const minContentWidth = Math.max(80, minWidth - horizontalExtra, (minHeight - extraHeight) * ratio);
    const minFlexibleExtra = layout.textFlexible ? Math.min(extraHeight, 36) : extraHeight;
    const maxContentWidth = area ? Math.max(minContentWidth, Math.min(
      area.width - 24 - horizontalExtra,
      (area.height - 24 - minFlexibleExtra) * ratio,
    )) : Number.POSITIVE_INFINITY;
    const requestedContentWidth = preferWidth
      ? next.width - horizontalExtra
      : (next.height - extraHeight) * ratio;
    const contentWidth = Math.min(maxContentWidth, Math.max(minContentWidth, requestedContentWidth));
    const effectiveExtraHeight = layout.textFlexible && area
      ? Math.min(extraHeight, Math.max(minFlexibleExtra, area.height - 24 - contentWidth / ratio))
      : extraHeight;
    next.width = Math.round(contentWidth + horizontalExtra);
    next.height = Math.round(contentWidth / ratio + effectiveExtraHeight);
    if (session.edge.includes('w')) next.x = right - next.width;
    if (session.edge.includes('n')) next.y = bottom - next.height;
  }

  return next;
}

function defaultData() {
  return {
    records: [],
    inspirationCategories: [],
    noteProjects: [
      { id: 'cp1', name: '常用回复', description: '' },
      { id: 'cp2', name: '工作模板', description: '' },
      { id: 'cp3', name: '提示词库', description: '' },
    ],
    stickyProjects: [],
    notes: [],
    inspirations: [],
    stickyNotes: [],
    settings: {
      theme: 'light',
      storagePath: app.getPath('userData'),
      retentionDays: 30,
      quickMenuHotkey: 'Ctrl+Alt+X',
      screenshotHotkey: 'Ctrl+Alt+D',
      quickStickyHotkey: 'Ctrl+Alt+S',
      fileSearchHotkey: 'Ctrl+Alt+A',
      stickyMirrorHotkey: 'X',
      stickyRotateHotkey: 'R',
      stickyOpacityHotkey: 'Shift+Wheel',
      inspirationSendHotkey: 'Ctrl+Enter',
      hideWindowOnScreenshot: false,
      alwaysOnTop: false,
    },
  };
}

function sanitizeSettings(settings = {}) {
  const { __error, ...clean } = settings || {};
  return clean;
}

function storageFileForData(data) {
  const storagePath = data?.settings?.storagePath;
  if (storagePath && path.isAbsolute(storagePath)) {
    return path.join(storagePath, 'xuannian-data.json');
  }
  return userDataFile();
}

function mergeStickyNotesIntoNotes(data) {
  const next = { ...data };
  next.notes = Array.isArray(next.notes) ? [...next.notes] : [];
  next.noteProjects = Array.isArray(next.noteProjects) && next.noteProjects.length ? [...next.noteProjects] : defaultData().noteProjects;
  const stickyProjects = Array.isArray(next.stickyProjects) ? next.stickyProjects : [];
  const stickyNotes = Array.isArray(next.stickyNotes) ? next.stickyNotes : [];
  if (!stickyNotes.length) return next;
  const projectMap = new Map();
  for (const project of stickyProjects) {
    const name = String(project?.name || '').trim() || '便签收藏';
    let target = next.noteProjects.find((item) => String(item.name || '') === name);
    if (!target) {
      target = { id: `cp_from_${project.id || crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)}`, name, description: project.description || '' };
      next.noteProjects.push(target);
    }
    if (project?.id) projectMap.set(project.id, target.id);
  }
  const existingStickyIds = new Set(next.notes.map((item) => item.sourceStickyId || item.id));
  for (const sticky of stickyNotes) {
    if (!sticky?.id || existingStickyIds.has(sticky.id)) continue;
    if (sticky.ordinary || sticky.sourceRecordId || sticky.sourceRecordDigest) continue;
    const attachments = Array.isArray(sticky.attachments) ? sticky.attachments : [];
    const content = String(sticky.content || '').trim();
    const firstAttachment = attachments[0];
    next.notes.push({
      id: sticky.id,
      projectId: projectMap.get(sticky.projectId) || next.noteProjects[0]?.id || 'cp1',
      order: Number(sticky.order || 0) || next.notes.length + 1,
      type: 'text',
      title: sticky.title || (content ? content.slice(0, 18) : (firstAttachment?.name || '置顶便签')),
      content,
      note: sticky.note || '',
      attachments,
      sourceStickyId: sticky.id,
      createdAt: sticky.createdAt || Date.now(),
      updatedAt: sticky.updatedAt || sticky.createdAt || Date.now(),
    });
  }
  return next;
}

function normalizeLegacyStickyData(data) {
  const next = mergeStickyNotesIntoNotes(data);
  next.stickyProjects = [];
  next.stickyNotes = Array.isArray(next.stickyNotes)
    ? next.stickyNotes.filter((item) => item?.ordinary || item?.sourceRecordId || item?.sourceRecordDigest)
    : [];
  return next;
}

function uniqueProjectId(prefix, used, seed = '') {
  let id = `${prefix}_${crypto.createHash('sha1').update(`${seed}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 10)}`;
  while (used.has(id)) {
    id = `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  }
  used.add(id);
  return id;
}

function repairProjectList(projects = [], items = [], prefix = 'cp') {
  const source = Array.isArray(projects) && projects.length ? projects : defaultData().noteProjects;
  const used = new Set();
  const repaired = [];
  for (let index = 0; index < source.length; index += 1) {
    const project = source[index] || {};
    let id = String(project.id || '').trim();
    const name = String(project.name || '').trim() || `分类 ${index + 1}`;
    if (!id || used.has(id)) {
      id = uniqueProjectId(prefix, used, `${name}|${index}`);
    } else {
      used.add(id);
    }
    repaired.push({ ...project, id, name });
  }
  const fallbackId = repaired[0]?.id || '';
  const valid = new Set(repaired.map((item) => item.id));
  const fixedItems = Array.isArray(items)
    ? items.map((item) => (item && item.projectId && !valid.has(item.projectId) ? { ...item, projectId: fallbackId } : item))
    : [];
  return { projects: repaired, items: fixedItems };
}

function updateUninstallStoragePath(data) {
  if (process.platform !== 'win32') return;
  const storagePath = appStorageRoot(data);
  if (!storagePath) return;
  execFile('reg.exe', [
    'ADD',
    'HKCU\\Software\\XuanNian2.0',
    '/v',
    'StoragePath',
    '/t',
    'REG_SZ',
    '/d',
    storagePath,
    '/f',
  ], { windowsHide: true }, () => {});
}

function recordsJournalTargets(data) {
  return dataPersistenceTargets(data).map((file) => path.join(path.dirname(file), RECORDS_JOURNAL_FILE));
}

function applyRecordsJournal(data) {
  const currentRevision = Number(data?.persistence?.recordsRevision || 0);
  let latest = null;
  for (const file of recordsJournalTargets(data)) {
    const journal = readDataJson(file, null);
    const revision = Number(journal?.revision || 0);
    if (!Array.isArray(journal?.records) || revision <= currentRevision || revision <= Number(latest?.revision || 0)) continue;
    latest = journal;
  }
  if (!latest) return data;
  return {
    ...data,
    records: latest.records,
    persistence: { ...(data.persistence || {}), recordsRevision: latest.revision },
  };
}

function loadData(options = {}) {
  if (!options.localizeAssets && dataCache) return options.clone === false ? dataCache : cloneDataSnapshot(dataCache);
  const base = readDataJson(userDataFile(), defaultData());
  const data = readDataJson(storageFileForData(base), base);
  const rawSettings = sanitizeSettings(data.settings);
  const settings = { ...defaultData().settings, ...rawSettings };
  if (!rawSettings.quickMenuHotkey || rawSettings.quickMenuHotkey === 'Shift+X') {
    settings.quickMenuHotkey = 'Ctrl+Alt+X';
  }
  if (!rawSettings.quickStickyHotkey || rawSettings.quickStickyHotkey === 'Ctrl+Alt+B') {
    settings.quickStickyHotkey = 'Ctrl+Alt+S';
  }
  if (!rawSettings.fileSearchHotkey) {
    settings.fileSearchHotkey = 'Ctrl+Alt+A';
    if (!rawSettings.screenshotHotkey || rawSettings.screenshotHotkey === 'Ctrl+Alt+A') {
      settings.screenshotHotkey = 'Ctrl+Alt+D';
    }
  }
  let merged = normalizeLegacyStickyData({ ...defaultData(), ...data, settings });
  const repairedNotes = repairProjectList(merged.noteProjects, merged.notes, 'cp');
  merged.noteProjects = repairedNotes.projects;
  merged.notes = repairedNotes.items;
  merged.stickyProjects = [];
  const defaultStickyProjectId = '';
  merged.stickyNotes = Array.isArray(merged.stickyNotes)
    ? merged.stickyNotes.map((item, index) => ({
      ...item,
      projectId: item.projectId || defaultStickyProjectId,
      order: Number(item.order || 0) || index + 1,
    }))
    : [];
  const prepared = applyRecordsJournal(options.localizeAssets ? localizePersistentContent(merged) : merged);
  prepared.records = (prepared.records || []).map(normalizeClipboardRecord);
  if (!options.localizeAssets) dataCache = prepared;
  return options.clone === false ? prepared : cloneDataSnapshot(prepared);
}

function normalizeRetentionDays(value, fallback = DEFAULT_RECORD_RETENTION_DAYS) {
  const days = Number(value || fallback);
  if (!Number.isFinite(days)) return fallback;
  return Math.max(1, Math.min(365, Math.round(days)));
}

function recordRetentionDays(record) {
  return normalizeRetentionDays(record?.retentionDays || record?.retentionDaysAtCreate || DEFAULT_RECORD_RETENTION_DAYS);
}

function withRecordRetention(record, settings = {}) {
  return { ...record, retentionDays: normalizeRetentionDays(settings.retentionDays) };
}

function burstDedupeClipboardKey(record) {
  if (!record) return '';
  if (record.clipboardDigest) {
    return String(record.clipboardDigest).replace(/:seq:\d+$/i, '');
  }
  if (record.type === 'image' && record.imageHash) return `image:${record.imageHash}`;
  if (Array.isArray(record.files) && record.files.length) return `${record.type}:${record.files.join('|')}`;
  return `${record.type}:${String(record.content || record.preview || '').trim()}`;
}

function moveExistingClipboardRecordToTop(data, record, digest) {
  if (!data || !record) return false;
  const nextRecord = {
    id: `rec_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: Date.now(),
    ...withRecordRetention(record, data.settings),
    clipboardDigest: digest,
  };
  const key = burstDedupeClipboardKey(nextRecord);
  const records = Array.isArray(data.records) ? data.records : [];
  const withoutCompositeTextShadow = (items) => {
    if (!Array.isArray(nextRecord.files) || !nextRecord.files.length) return items;
    const text = String(nextRecord.content || '').trim();
    if (!text) return items;
    const textDigest = `text:${crypto.createHash('sha256').update(text).digest('hex')}`;
    const now = Number(nextRecord.createdAt) || Date.now();
    return items.filter((item) => {
      if (!item || (item.type !== 'text' && item.type !== 'link')) return true;
      if (String(item.content || '').trim() !== text) return true;
      if (String(item.clipboardDigest || '').replace(/:seq:\d+$/i, '') !== textDigest) return true;
      const createdAt = Number(item.createdAt || item.updatedAt || 0);
      return createdAt && Math.abs(now - createdAt) > 10000;
    });
  };
  const existingIndex = key ? records.findIndex((item) => burstDedupeClipboardKey(item) === key) : -1;
  if (existingIndex < 0) {
    data.records = [nextRecord, ...withoutCompositeTextShadow(records)];
    return false;
  }
  const existing = records[existingIndex];
  const updated = {
    ...existing,
    ...withRecordRetention(record, data.settings),
    id: existing.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clipboardDigest: digest,
  };
  data.records = [updated, ...withoutCompositeTextShadow([...records.slice(0, existingIndex), ...records.slice(existingIndex + 1)])];
  return true;
}

function clipboardSequenceFromRecord(record) {
  const match = String(record?.clipboardDigest || '').match(/:seq:(\d+)$/i);
  return match ? Number(match[1]) || 0 : 0;
}

function removeBurstDuplicateRecords(records = []) {
  const seen = new Map();
  const result = [];
  for (const record of records) {
    const key = burstDedupeClipboardKey(record);
    const createdAt = Number(record?.createdAt) || 0;
    const sequence = clipboardSequenceFromRecord(record);
    const last = key ? seen.get(key) : null;
    if (key && last) {
      const sameSequence = sequence && last.sequence && sequence === last.sequence;
      const missingSequencePair = !sequence || !last.sequence;
      const isTextLike = record?.type === 'text' || record?.type === 'link';
      const windowMs = isTextLike ? 30 * 60 * 1000 : (missingSequencePair ? 15000 : 2000);
      if (Math.abs(last.createdAt - createdAt) <= windowMs && (isTextLike || sameSequence || missingSequencePair)) continue;
    }
    if (key && createdAt) seen.set(key, { createdAt, sequence });
    result.push(record);
  }
  return result;
}

function removeCompositeTextShadowRecords(records = []) {
  const compositeTextRecords = [];
  for (const record of records) {
    if (!Array.isArray(record?.files) || !record.files.length) continue;
    const digest = textDigestForContent(record.content);
    if (!digest) continue;
    compositeTextRecords.push({
      digest,
      createdAt: Number(record.createdAt || record.updatedAt || 0),
    });
  }
  if (!compositeTextRecords.length) return records;
  return records.filter((record) => {
    if (record?.type !== 'text' && record?.type !== 'link') return true;
    const digest = textDigestForContent(record.content);
    if (!digest) return true;
    const createdAt = Number(record.createdAt || record.updatedAt || 0);
    return !compositeTextRecords.some((item) => (
      item.digest === digest &&
      createdAt &&
      item.createdAt &&
      Math.abs(item.createdAt - createdAt) <= 45000
    ));
  });
}

function pruneSavedData(data) {
  const next = { ...data, records: Array.isArray(data.records) ? [...data.records] : [] };
  const now = Date.now();
  next.records = removeCompositeTextShadowRecords(removeBurstDuplicateRecords(next.records))
    .filter((item) => {
      if (!item.createdAt) return true;
      const cutoff = now - recordRetentionDays(item) * 24 * 60 * 60 * 1000;
      return Number(item.createdAt) >= cutoff;
    })
    .slice(0, MAX_CLIPBOARD_RECORDS);
  return next;
}

function dataPersistenceTargets(data) {
  const primaryFile = userDataFile();
  const storageFile = storageFileForData(data);
  const targets = [primaryFile];
  if (path.resolve(storageFile).toLocaleLowerCase('en-US') !== path.resolve(primaryFile).toLocaleLowerCase('en-US')) {
    targets.push(storageFile);
  }
  return targets;
}

function loadMutableData() {
  if (!dataCache) loadData({ clone: false });
  return dataCache;
}

function saveRecordsDataWithPersistence(data) {
  const revision = Math.max(Date.now(), Number(data?.persistence?.recordsRevision || 0) + 1);
  const next = pruneSavedData({
    ...data,
    persistence: { ...(data.persistence || {}), recordsRevision: revision },
  });
  const targets = recordsJournalTargets(next);
  const serialized = JSON.stringify({ version: 1, revision, records: next.records });
  lastPreparedRecordsWrite = { targets, serialized };
  const persistence = recordsWriter.enqueue(targets, serialized);
  persistence.catch(() => {});
  dataCache = next;
  return { data: next, persistence };
}

function saveRecordsData(data) {
  return saveRecordsDataWithPersistence(data).data;
}

async function saveRecordsDataDurable(data) {
  const saved = saveRecordsDataWithPersistence(data);
  await saved.persistence;
  return saved.data;
}

function saveDataWithPersistence(data, options = {}) {
  const base = normalizeLegacyStickyData({ ...data, settings: { ...defaultData().settings, ...sanitizeSettings(data.settings) } });
  const currentRecordsRevision = Number(dataCache?.persistence?.recordsRevision || 0);
  base.persistence = {
    ...(base.persistence || {}),
    recordsRevision: Math.max(Date.now(), currentRecordsRevision + 1, Number(base.persistence?.recordsRevision || 0) + 1),
  };
  const repairedNotes = repairProjectList(base.noteProjects, base.notes, 'cp');
  base.noteProjects = repairedNotes.projects;
  base.notes = repairedNotes.items;
  const persistent = options.skipLocalizeAssets ? base : localizePersistentContent(base);
  const next = pruneSavedData(persistent);
  const serialized = JSON.stringify(next);
  const targets = dataPersistenceTargets(next);
  lastPreparedDataWrite = { targets, serialized };
  let persistence;
  if (options.sync) {
    for (const target of targets) writeJsonAtomicSync(target, serialized);
    persistence = Promise.resolve();
  } else {
    persistence = dataWriter.enqueue(targets, serialized);
    persistence.catch(() => {});
  }
  dataCache = next;
  return { data: options.clone === false ? next : cloneDataSnapshot(next), persistence };
}

function saveData(data, options = {}) {
  return saveDataWithPersistence(data, options).data;
}

async function saveDataDurable(data, options = {}) {
  const saved = saveDataWithPersistence(data, options);
  await saved.persistence;
  return saved.data;
}

async function flushDataWrites(timeoutMs = 5000) {
  if (!dataWriter.hasPending() && !recordsWriter.hasPending()) return;
  let timeout;
  try {
    await Promise.race([
      Promise.all([dataWriter.flush(), recordsWriter.flush()]),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out while flushing user data')), timeoutMs);
      }),
    ]);
  } catch (error) {
    runtimeLog(`data flush fallback: ${error?.stack || error}`);
    const pendingWrites = [lastPreparedDataWrite, lastPreparedRecordsWrite].filter(Boolean);
    if (!pendingWrites.length) throw error;
    for (const write of pendingWrites) {
      for (const target of write.targets) writeJsonAtomicSync(target, write.serialized);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function broadcastDataRefresh(data = null, options = {}) {
  dataRevision += 1;
  const next = data || loadData({ clone: false });
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() && mainWindow.isVisible()) {
    if (options.recordsOnly) mainWindow.webContents.send('native-clipboard-records', next.records);
    else mainWindow.webContents.send('native-data-refresh');
  }
  scheduleQuickWindowWarmRefresh(next, options);
  if (!options.recordsOnly && options.notifySticky !== false) notifyStickyWindowsDataRefresh();
}

function scheduleQuickWindowWarmRefresh(data, options = {}) {
  if (!isQuickWindowUsable()) return;
  if (quickWindow.webContents.isLoading()) {
    quickWindowDataDirty = true;
    return;
  }
  if (!quickWindow.isVisible()) {
    clearTimeout(quickWindowWarmRefreshTimer);
    quickWindowWarmRefreshTimer = null;
    quickWindowDataDirty = true;
    return;
  }
  if (options.recordsOnly) sendQuickWindow('native-clipboard-records', data.records || []);
  else sendQuickWindow('quick:refresh');
  quickWindowRevision = dataRevision;
  quickWindowDataDirty = false;
  quickWindowWarmRefreshTimer = null;
}

function stopClipboardWatcher() {
  clearInterval(clipboardTimer);
  clearInterval(fileClipboardTimer);
  clearInterval(imageClipboardTimer);
  clipboardTimer = null;
  fileClipboardTimer = null;
  imageClipboardTimer = null;
  const process = clipboardWatcherProcess;
  clipboardWatcherProcess = null;
  clipboardWatcherBuffer = '';
  if (process && !process.killed) process.kill();
}

function startClipboardPollingTimers({ nativeBackstop = false } = {}) {
  pollFileClipboard();
  if (!nativeBackstop) pollImageClipboard();
  clipboardTimer = setInterval(() => {
    captureClipboardToData(readFastClipboardPayload()).catch(() => {});
  }, nativeBackstop ? 5000 : 1000);
  fileClipboardTimer = setInterval(pollFileClipboard, nativeBackstop ? 12000 : 2500);
  imageClipboardTimer = setInterval(pollImageClipboard, nativeBackstop ? 15000 : 3500);
}

function copyFileToClipboard(filePaths, action = 'copy', text = '', options = {}) {
  return new Promise((resolve) => {
    const files = normalizeExistingFilePaths(filePaths);
    if (!files.length) {
      resolve(false);
      return;
    }
    const effect = String(action || '').toLowerCase() === 'cut' ? 'cut' : 'copy';
    const clipboardText = String(text || '').trim();
    if (clipboardText && files.length && options.stagePaste !== false) {
      pendingCompositePaste = {
        files,
        action: effect,
        text: clipboardText,
        createdAt: Date.now(),
      };
    } else if (!clipboardText && options.stagePaste !== false) {
      pendingCompositePaste = null;
    }
    const richImageComposite = !!clipboardText
      && files.length === 1
      && isImageFile(files[0])
      && (() => {
        try { return fs.statSync(files[0]).size <= 4 * 1024 * 1024; } catch { return false; }
      })();
    const textHash = clipboardText ? crypto.createHash('sha256').update(clipboardText).digest('hex') : '';
    const clipboardDigest = `file:${effect}:${richImageComposite ? 'rich-image:' : ''}${files.join('|')}${textHash ? `:text:${textHash}` : ''}`;
    const encodedFiles = files.map((filePath) => Buffer.from(filePath, 'utf8').toString('base64'));
    const encodedText = clipboardText ? Buffer.from(clipboardText, 'utf8').toString('base64') : '';
    rememberSelfClipboardDigest(clipboardDigest, 1200);

    const helper = clipboardHelperPath();
    if (process.platform === 'win32' && fs.existsSync(helper)) {
      execFile(helper, ['write-files', effect, ...(richImageComposite ? ['--rich-image'] : []), ...(encodedText ? ['--text', encodedText] : []), ...encodedFiles], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4096,
      }, (error, stdout) => {
        if (!error) {
          const match = String(stdout || '').match(/^OK\t(\d+)/);
          const sequence = match ? Number(match[1]) || 0 : 0;
          if (sequence) {
            rememberSelfClipboardSequence(sequence, 30000);
            rememberClipboardSequence(sequence);
            lastCapturedClipboardSequence = sequence;
          }
          lastClipboardDigest = sequence ? `${clipboardDigest}:seq:${sequence}` : clipboardDigest;
        }
        resolve(!error);
      });
      return;
    }

    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$action = $env:XUANNIAN_CLIPBOARD_ACTION',
      '$richImage = $env:XUANNIAN_CLIPBOARD_RICH_IMAGE -eq "1"',
      '$encodedPaths = @()',
      'if ($env:XUANNIAN_CLIPBOARD_FILES) { $encodedPaths = ConvertFrom-Json -InputObject $env:XUANNIAN_CLIPBOARD_FILES }',
      '$paths = New-Object System.Collections.Specialized.StringCollection',
      'foreach ($encodedPath in $encodedPaths) {',
      '  $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$encodedPath))',
      '  if (Test-Path -LiteralPath $decoded) { $paths.Add((Resolve-Path -LiteralPath $decoded).Path) | Out-Null }',
      '}',
      'if ($paths.Count -lt 1) { exit 2 }',
      '$data = New-Object System.Windows.Forms.DataObject',
      '$data.SetFileDropList($paths)',
      'if ($env:XUANNIAN_CLIPBOARD_TEXT) {',
      '  $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:XUANNIAN_CLIPBOARD_TEXT))',
      '  if (-not [string]::IsNullOrWhiteSpace($text)) {',
      '    $data.SetText($text, [System.Windows.Forms.TextDataFormat]::UnicodeText)',
      '    $data.SetText($text, [System.Windows.Forms.TextDataFormat]::Text)',
      '    $escaped = [System.Net.WebUtility]::HtmlEncode($text).Replace("`r`n","`n").Replace("`r","`n").Replace("`n","<br>")',
      '    $fragment = "<div>" + $escaped + "</div>"',
      '    foreach ($p in $paths) {',
      '      $ext = [System.IO.Path]::GetExtension([string]$p).ToLowerInvariant()',
      '      if (@(".png",".jpg",".jpeg",".gif",".webp",".bmp") -contains $ext) {',
      '        $uri = [Uri]([System.IO.Path]::GetFullPath([string]$p))',
      '        $fragment += "<div><img src=`"" + [System.Net.WebUtility]::HtmlEncode($uri.AbsoluteUri) + "`" /></div>"',
      '      } else {',
      '        $uri = [Uri]([System.IO.Path]::GetFullPath([string]$p))',
      '        $name = [System.IO.Path]::GetFileName([string]$p)',
      '        $fragment += "<div><a href=`"" + [System.Net.WebUtility]::HtmlEncode($uri.AbsoluteUri) + "`">" + [System.Net.WebUtility]::HtmlEncode($name) + "</a></div>"',
      '      }',
      '    }',
      '    $html = "<html><body><!--StartFragment-->" + $fragment + "<!--EndFragment--></body></html>"',
      '    $headerTemplate = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"',
      '    $header = [string]::Format($headerTemplate,0,0,0,0)',
      '    $enc = [System.Text.Encoding]::UTF8',
      '    $startHtml = $enc.GetByteCount($header)',
      '    $startFragment = $startHtml + $enc.GetByteCount("<html><body><!--StartFragment-->")',
      '    $endFragment = $startFragment + $enc.GetByteCount($fragment)',
      '    $endHtml = $startHtml + $enc.GetByteCount($html)',
      '    $data.SetData([System.Windows.Forms.DataFormats]::Html, [string]::Format($headerTemplate,$startHtml,$endHtml,$startFragment,$endFragment) + $html)',
      '  }',
      '}',
      'if ($richImage) {',
      '  try {',
      '    $img = [System.Drawing.Image]::FromFile([string]$paths[0])',
      '    $bmp = New-Object System.Drawing.Bitmap($img)',
      '    $img.Dispose()',
      '    $data.SetImage($bmp)',
      '  } catch {}',
      '}',
      '$dropEffect = if ($action -eq "cut") { 2 } else { 1 }',
      '$bytes = [BitConverter]::GetBytes([Int32]$dropEffect)',
      '$stream = New-Object System.IO.MemoryStream',
      '$stream.Write($bytes, 0, $bytes.Length)',
      '$stream.Position = 0',
      '$data.SetData("Preferred DropEffect", $stream)',
      '[System.Windows.Forms.Clipboard]::Clear()',
      '[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
      '$check = [System.Windows.Forms.Clipboard]::GetFileDropList()',
      'if (-not $check -or $check.Count -ne $paths.Count) { exit 3 }',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: true,
      env: {
        ...process.env,
        XUANNIAN_CLIPBOARD_ACTION: effect,
        XUANNIAN_CLIPBOARD_RICH_IMAGE: richImageComposite ? '1' : '0',
        XUANNIAN_CLIPBOARD_FILES: JSON.stringify(encodedFiles),
        XUANNIAN_CLIPBOARD_TEXT: encodedText,
      },
    }, async (error) => {
      if (!error) {
        const sequence = await readClipboardSequence().catch(() => 0);
        lastClipboardDigest = sequence ? `${clipboardDigest}:seq:${sequence}` : clipboardDigest;
        if (sequence) {
          rememberSelfClipboardSequence(sequence, 30000);
          rememberClipboardSequence(sequence);
          lastCapturedClipboardSequence = sequence;
        }
        rememberSelfClipboardDigest(lastClipboardDigest, 1200);
        suppressTextClipboardUntil = Date.now() + 2500;
        suppressFileClipboardUntil = Date.now() + 2500;
      }
      resolve(!error);
    });
  });
}

function nativeImageFromStickyAttachment(item) {
  if (!item || item.kind !== 'image') return null;
  try {
    const directPath = item.path && path.isAbsolute(String(item.path)) ? String(item.path) : '';
    const previewPath = parseFileUrl(item.preview || '');
    const sourcePath = directPath || previewPath;
    if (sourcePath && fs.existsSync(sourcePath)) {
      const image = nativeImage.createFromPath(sourcePath);
      return image.isEmpty() ? null : image;
    }
    const dataUrl = String(item.dataUrl || item.preview || '');
    if (dataUrl.startsWith('data:image/')) {
      const image = nativeImage.createFromDataURL(dataUrl);
      return image.isEmpty() ? null : image;
    }
  } catch {}
  return null;
}

function stickyAttachmentFilePathForClipboard(item) {
  if (!item) return '';
  const directPath = item.path && path.isAbsolute(String(item.path)) ? String(item.path) : '';
  const previewPath = parseFileUrl(item.preview || '');
  const sourcePath = directPath || previewPath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    return isImageFile(sourcePath) ? (cacheImageFile(sourcePath) || sourcePath) : sourcePath;
  }
  const image = nativeImageFromStickyAttachment(item);
  if (!image) return '';
  const buffer = image.toPNG();
  if (!buffer?.length) return '';
  return saveClipboardImageBuffer(buffer, imageHashFromBuffer(buffer));
}

function stickyAttachmentFilesForClipboard(attachments = []) {
  const seen = new Set();
  const files = [];
  for (const item of attachments) {
    const filePath = stickyAttachmentFilePathForClipboard(item);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    files.push(filePath);
  }
  return files;
}

async function backupStickyDraftToClipboard(payload = {}) {
  const text = String(payload?.content || '').trim();
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  const attachmentFiles = stickyAttachmentFilesForClipboard(attachments);
  const attachment = attachments.find((item) => item?.kind === 'image');
  const image = nativeImageFromStickyAttachment(attachment);
  if (!text && !image && !attachmentFiles.length) return { ok: false };

  const imageBuffer = image ? image.toPNG() : null;
  const imageHash = imageBuffer?.length ? imageHashFromBuffer(imageBuffer) : '';
  const textDigest = text ? `text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
  const imageDigest = imageHash ? `image:${imageHash}` : '';
  const hasCompositeAttachments = attachmentFiles.length > 1 || attachmentFiles.some((filePath) => !isImageFile(filePath));
  const useFileClipboard = attachmentFiles.length > 0 && (text || hasCompositeAttachments);
  const fileDigest = useFileClipboard
    ? `file:copy:${attachmentFiles.join('|')}${text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : ''}`
    : '';
  if (textDigest) rememberSelfClipboardDigest(textDigest, 4000);
  if (imageDigest) rememberSelfClipboardDigest(imageDigest, 4000);
  if (fileDigest) rememberSelfClipboardDigest(fileDigest, 4000);
  suppressTextClipboardUntil = Date.now() + 2500;
  suppressImageClipboardUntil = Date.now() + SELF_IMAGE_SUPPRESS_MS;
  suppressFileClipboardUntil = Date.now() + 2500;

  if (useFileClipboard) {
    const copied = await copyFileToClipboard(attachmentFiles, 'copy', text);
    if (!copied) return { ok: false };
  } else {
    const clipboardPayload = {};
    if (text) clipboardPayload.text = text;
    if (image) clipboardPayload.image = image;
    clipboard.write(clipboardPayload);
  }

  const sequence = await readClipboardSequence().catch(() => 0);
  if (sequence) {
    rememberSelfClipboardSequence(sequence, 30000);
    rememberClipboardSequence(sequence);
    lastCapturedClipboardSequence = sequence;
  }
  lastClipboardDigest = fileDigest || imageDigest || textDigest;

  const data = loadMutableData();
  if (useFileClipboard) {
    const record = clipboardRecordFromPayload({ type: 'files', files: attachmentFiles, action: 'copy', text });
    if (record) {
      moveExistingClipboardRecordToTop(data, {
        ...record,
        content: text || record.content,
        source: 'sticky-backup',
      }, record.clipboardDigest || fileDigest);
    }
  } else if (text) {
    moveExistingClipboardRecordToTop(data, {
      type: /^https?:\/\//i.test(text) ? 'link' : 'text',
      content: text,
      source: 'sticky-backup',
    }, textDigest);
  }
  if (!useFileClipboard && imageBuffer?.length) {
    const cachedPath = saveClipboardImageBuffer(imageBuffer, imageHash);
    moveExistingClipboardRecordToTop(data, {
      type: 'image',
      content: '图片内容',
      preview: filePreviewUrl(cachedPath),
      files: [cachedPath],
      fileBacked: false,
      cachedImage: true,
      imageHash,
      source: 'sticky-backup',
    }, imageDigest);
  }
  const saved = await saveRecordsDataDurable(data);
  sendDataChanged(saved);
  return { ok: true, text: !!text, image: !!image, files: attachmentFiles.length };
}

function imageClipboardPayload() {
  if (Date.now() < suppressImageClipboardUntil) return null;
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  const hash = imageHashFromBuffer(png);
  return {
    type: 'image',
    buffer: png,
    hash,
    imageHash: hash,
    text: clipboardTextForComposite(),
  };
}

function readClipboardSequence() {
  const helper = clipboardHelperPath();
  if (process.platform === 'win32' && fs.existsSync(helper)) {
    return new Promise((resolve) => {
      execFile(helper, ['sequence'], {
        windowsHide: true,
        timeout: 1200,
        maxBuffer: 1024,
      }, (_error, stdout) => {
        resolve(Number(String(stdout || '').trim()) || 0);
      });
    });
  }
  return new Promise((resolve) => {
    const script = [
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class XuanNianClipboardSeqOnly { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }\'',
      '[Console]::Out.Write([XuanNianClipboardSeqOnly]::GetClipboardSequenceNumber())',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 1500 }, (_error, stdout) => {
      resolve(Number(String(stdout || '').trim()) || 0);
    });
  });
}

function isImageFile(filePath) {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(filePath || '');
}

function isVideoFile(filePath) {
  return /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpeg|mpg)$/i.test(filePath || '');
}

function isAudioFile(filePath) {
  return /\.(mp3|wav|m4a|aac|flac|ogg|wma)$/i.test(filePath || '');
}

function attachmentKindFromPath(filePath) {
  if (isImageFile(filePath)) return 'image';
  if (isVideoFile(filePath)) return 'video';
  if (isAudioFile(filePath)) return 'audio';
  return 'file';
}

function filePreviewUrl(filePath) {
  return `file:///${String(filePath).replace(/\\/g, '/')}`;
}

function appStorageRoot(data = null) {
  const storagePath = data?.settings?.storagePath;
  if (storagePath && path.isAbsolute(storagePath)) return storagePath;
  return app.getPath('userData');
}

function currentStorageRoot() {
  return appStorageRoot(loadData());
}

function copyPathRecursive(source, target) {
  if (!source || !target || !fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyPathRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function exportFileNameStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function createZipFromDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', sourceDir, '.'], {
      windowsHide: true,
      timeout: 120000,
    });
    return;
  }
  execFileSync('zip', ['-qry', zipPath, '.'], {
    cwd: sourceDir,
    timeout: 120000,
  });
}

function extractZipToDirectory(zipPath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-xf', zipPath, '-C', targetDir], {
      windowsHide: true,
      timeout: 120000,
    });
    return;
  }
  execFileSync('unzip', ['-q', zipPath, '-d', targetDir], {
    timeout: 120000,
  });
}

function findExportedDataFile(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'xuannian-data.json') return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return '';
}

function rewriteImportedStoragePath(value, storageRoot) {
  if (typeof value !== 'string' || !value) return value;
  const normalized = value.replace(/\\/g, '/');
  const filePrefix = /^file:\/\//i.test(normalized) ? 'file:///' : '';
  const raw = normalized.replace(/^file:\/\/\/?/i, '');
  const markers = ['/xuannian-assets/', '/clipboard-images/', '/screenshots/', '/drag-images/'];
  for (const marker of markers) {
    const index = raw.toLowerCase().indexOf(marker);
    if (index === -1) continue;
    const relative = raw.slice(index + 1).split('/').filter(Boolean);
    const localPath = path.join(storageRoot, ...relative);
    return filePrefix ? `file:///${localPath.replace(/\\/g, '/')}` : localPath;
  }
  return value;
}

function rewriteImportedDataPaths(value, storageRoot) {
  if (Array.isArray(value)) return value.map((item) => rewriteImportedDataPaths(item, storageRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === 'storagePath' ? item : rewriteImportedDataPaths(item, storageRoot),
    ]));
  }
  return rewriteImportedStoragePath(value, storageRoot);
}

async function exportUserDataPackage(ownerWindow = mainWindow) {
  const data = loadData({ clone: false });
  await saveDataDurable(data, { skipLocalizeAssets: true, clone: false });
  const storageRoot = appStorageRoot(data);
  const defaultPath = path.join(app.getPath('desktop'), `玄念收藏备份-${exportFileNameStamp()}.zip`);
  const result = await dialog.showSaveDialog(ownerWindow || mainWindow, {
    title: '导出玄念收藏数据包',
    defaultPath,
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const stagingRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'xuannian-export-'));
  const packageRoot = path.join(stagingRoot, '玄念收藏数据包');
  fs.mkdirSync(packageRoot, { recursive: true });
  const entries = [
    'xuannian-data.json',
    'xuannian-assets',
    'clipboard-images',
    'screenshots',
    'drag-images',
  ];
  for (const entry of entries) {
    copyPathRecursive(path.join(storageRoot, entry), path.join(packageRoot, entry));
  }
  fs.writeFileSync(path.join(packageRoot, 'README.txt'), [
    '玄念收藏数据包',
    '',
    '此压缩包用于迁移玄念收藏、提示词、便签、灵感、附件和相关图片数据。',
    `导出时间：${new Date().toLocaleString()}`,
    `原始数据目录：${storageRoot}`,
    '',
    '恢复到新电脑时，请先关闭玄念，再把压缩包内文件复制到新电脑的玄念数据目录。',
    '默认数据目录：',
    'Windows: %APPDATA%\\玄念',
    'macOS: ~/Library/Application Support/玄念',
  ].join('\r\n'), 'utf8');
  createZipFromDirectory(packageRoot, result.filePath);
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  return { ok: true, filePath: result.filePath, storageRoot };
}

async function importUserDataPackage(ownerWindow = mainWindow) {
  const result = await dialog.showOpenDialog(ownerWindow || mainWindow, {
    title: '导入玄念收藏数据包',
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };

  const zipPath = result.filePaths[0];
  const stagingRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'xuannian-import-'));
  try {
    extractZipToDirectory(zipPath, stagingRoot);
    const dataFile = findExportedDataFile(stagingRoot);
    if (!dataFile) return { ok: false, reason: '导入包里没有找到 xuannian-data.json。' };

    const packageRoot = path.dirname(dataFile);
    const importedRaw = readJson(dataFile, null);
    if (!importedRaw || typeof importedRaw !== 'object') {
      return { ok: false, reason: '导入包里的数据文件无法读取。' };
    }

    const current = loadData();
    const storageRoot = appStorageRoot(current);
    for (const entry of ['xuannian-assets', 'clipboard-images', 'screenshots', 'drag-images']) {
      copyPathRecursive(path.join(packageRoot, entry), path.join(storageRoot, entry));
    }

    const imported = rewriteImportedDataPaths(importedRaw, storageRoot);
    const merged = mergeDataSnapshots(current, imported);
    const saved = await saveDataDurable(merged, { skipLocalizeAssets: true, clone: false });
    sendDataChanged(saved);
    return {
      ok: true,
      filePath: zipPath,
      storageRoot,
      notes: Array.isArray(imported.notes) ? imported.notes.length : 0,
      inspirations: Array.isArray(imported.inspirations) ? imported.inspirations.length : 0,
    };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function attachmentStorageDir(data = null, scope = 'attachments') {
  return path.join(appStorageRoot(data), 'xuannian-assets', scope);
}

function safeBaseName(value = 'attachment') {
  const base = path.basename(String(value || 'attachment')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return base || 'attachment';
}

function extensionFromMime(mime = '') {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'application/pdf': '.pdf',
  };
  return map[String(mime || '').toLowerCase()] || '';
}

function parseFileUrl(value = '') {
  if (!/^file:\/\//i.test(String(value || ''))) return '';
  try {
    return decodeURIComponent(String(value).replace(/^file:\/\/\/?/i, '')).replace(/\//g, path.sep);
  } catch {
    return '';
  }
}

function parseDataUrl(value = '') {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s);
  if (!match) return null;
  try {
    return {
      mime: match[1] || '',
      buffer: Buffer.from(match[2] || '', 'base64'),
    };
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function textFromHtmlFragment(html = '') {
  const value = String(html || '')
    .replace(/<!--StartFragment-->|<!--EndFragment-->/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlAttribute(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function htmlImageFiles(html = '') {
  const files = [];
  const seen = new Set();
  const addFile = (filePath) => {
    if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(filePath)) return;
    const cached = isImageFile(filePath) ? (cacheImageFile(filePath) || filePath) : filePath;
    const key = cached.toLocaleLowerCase('en-US');
    if (seen.has(key)) return;
    seen.add(key);
    files.push(cached);
  };
  const addBuffer = (buffer, name = 'html-image.png') => {
    if (!buffer?.length) return;
    const hash = imageHashFromBuffer(buffer);
    const filePath = saveClipboardImageBuffer(buffer, hash);
    const key = filePath.toLocaleLowerCase('en-US');
    if (seen.has(key)) return;
    seen.add(key);
    files.push(filePath);
  };
  const handleSource = (sourceValue) => {
    const source = decodeHtmlAttribute(sourceValue || '').trim();
    if (!source) return;
    if (/^data:image\//i.test(source)) {
      const parsed = parseDataUrl(source);
      addBuffer(parsed?.buffer, 'html-image.png');
      return;
    }
    if (/^file:\/\//i.test(source)) {
      addFile(parseFileUrl(source));
      return;
    }
    if (path.isAbsolute(source)) {
      addFile(source);
      return;
    }
    try {
      const decoded = decodeURIComponent(source);
      if (path.isAbsolute(decoded)) addFile(decoded);
    } catch {}
  };
  const imageTagRe = /<img\b[^>]*>/gis;
  const attrRe = /\b(?:src|data-src|data-original|origin-src|file)\s*=\s*(["'])(.*?)\1/gis;
  for (const tagMatch of String(html || '').matchAll(imageTagRe)) {
    const tag = tagMatch[0] || '';
    for (const attrMatch of tag.matchAll(attrRe)) {
      handleSource(attrMatch[2] || '');
    }
  }
  const allFileAttrRe = /\b(?:href|src|data-href|data-url|file)\s*=\s*(["'])(file:\/\/.*?|[a-zA-Z]:\\.*?|\\\\.*?)(?:\1)/gis;
  for (const match of String(html || '').matchAll(allFileAttrRe)) {
    handleSource(match[2] || '');
  }
  const fileUriRe = /file:\/\/\/?[^\s"'<>]+/gis;
  for (const match of String(html || '').matchAll(fileUriRe)) {
    handleSource(match[0] || '');
  }
  return files;
}

function clipboardTextForComposite() {
  if (Date.now() < suppressTextClipboardUntil) return '';
  try {
    return String(clipboard.readText() || '').trim();
  } catch {
    return '';
  }
}

function readRichHtmlClipboardPayload() {
  try {
    const html = clipboard.readHTML();
    if (!html) return null;
    const files = htmlImageFiles(html);
    if (!files.length) return null;
    return {
      type: 'files',
      files,
      text: clipboardTextForComposite() || textFromHtmlFragment(html),
      action: 'copy',
      richHtml: true,
    };
  } catch {
    return null;
  }
}

function isPathInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function localAttachmentTarget(data, sourceName, fingerprint, ext = '', scope = 'attachments') {
  const folder = attachmentStorageDir(data, scope);
  fs.mkdirSync(folder, { recursive: true });
  const safeName = safeBaseName(sourceName || `attachment${ext || ''}`);
  const currentExt = path.extname(safeName);
  const finalName = currentExt || !ext ? safeName : `${safeName}${ext}`;
  const stem = path.basename(finalName, path.extname(finalName)).slice(0, 80) || 'attachment';
  const suffix = fingerprint.slice(0, 16);
  return path.join(folder, `${stem}-${suffix}${path.extname(finalName) || ext || ''}`);
}

function localizeAttachment(item, data, scope = 'attachments') {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  let sourcePath = next.path || parseFileUrl(next.preview || '') || '';
  if (sourcePath && path.isAbsolute(String(sourcePath)) && fs.existsSync(sourcePath)) {
    if (scope === 'sticky-notes' && next.kind !== 'image') {
      return {
        ...next,
        path: sourcePath,
        originalPath: next.originalPath || sourcePath,
        localCopy: false,
        dataUrl: '',
      };
    }
    const assetRoot = attachmentStorageDir(data, scope);
    if (isPathInside(sourcePath, assetRoot)) {
      return { ...next, path: sourcePath, localCopy: true, dataUrl: '' };
    }
    try {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) return next;
      const detectedKind = next.kind || attachmentKindFromPath(sourcePath);
      if (detectedKind !== 'image' && stat.size > MAX_LOCALIZED_BINARY_BYTES) {
        return {
          ...next,
          path: sourcePath,
          originalPath: next.originalPath || sourcePath,
          localCopy: false,
          size: next.size || stat.size,
          ext: next.ext || path.extname(sourcePath).slice(1).toLowerCase(),
          kind: detectedKind,
          dataUrl: '',
        };
      }
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${sourcePath}|${stat.size}|${stat.mtimeMs}`)
        .digest('hex');
      const target = localAttachmentTarget(data, next.name || sourcePath, fingerprint, path.extname(sourcePath), scope);
      if (!fs.existsSync(target)) fs.copyFileSync(sourcePath, target);
      return {
        ...next,
        path: target,
        originalPath: next.originalPath || sourcePath,
        localCopy: true,
        size: next.size || stat.size,
        ext: next.ext || path.extname(target).slice(1).toLowerCase(),
        kind: detectedKind,
        dataUrl: '',
      };
    } catch {
      return next;
    }
  }

  const dataUrl = next.dataUrl || (String(next.preview || '').startsWith('data:') ? next.preview : '');
  const parsed = parseDataUrl(dataUrl);
  if (parsed?.buffer?.length) {
    try {
      const hash = imageHashFromBuffer(parsed.buffer);
      const ext = path.extname(next.name || '') || extensionFromMime(next.mime || parsed.mime) || '.bin';
      const target = localAttachmentTarget(data, next.name || `attachment${ext}`, hash, ext, scope);
      if (!fs.existsSync(target)) fs.writeFileSync(target, parsed.buffer);
      return {
        ...next,
        path: target,
        localCopy: true,
        size: next.size || parsed.buffer.length,
        mime: next.mime || parsed.mime,
        ext: next.ext || path.extname(target).slice(1).toLowerCase(),
        kind: next.kind || attachmentKindFromPath(target),
        dataUrl: '',
        preview: '',
      };
    } catch {
      return next;
    }
  }
  return next;
}

function localizePersistentContent(data) {
  const next = { ...data };
  next.notes = Array.isArray(next.notes)
    ? next.notes.map((note) => ({
      ...note,
      attachments: Array.isArray(note.attachments)
        ? note.attachments.map((item) => localizeAttachment(item, next, 'notes'))
        : [],
    }))
    : [];
  next.inspirations = Array.isArray(next.inspirations) ? next.inspirations : [];
  next.stickyNotes = Array.isArray(next.stickyNotes)
    ? next.stickyNotes.map((note) => ({
      ...note,
      attachments: Array.isArray(note.attachments)
        ? note.attachments.map((item) => localizeAttachment(item, next, 'sticky-notes'))
        : [],
    }))
    : [];
  return next;
}

function clipboardImageCacheDir() {
  return path.join(app.getPath('userData'), 'clipboard-images');
}

function saveClipboardImageBuffer(buffer, imageHash = '') {
  if (!buffer || !buffer.length) return '';
  const hash = imageHash || imageHashFromBuffer(buffer);
  const folder = clipboardImageCacheDir();
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `image-${hash.slice(0, 24)}.png`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
  return filePath;
}

function imageHashFromBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function imageHashFromNativeImage(image) {
  if (!image || image.isEmpty()) return '';
  return imageHashFromBuffer(image.toPNG());
}

function imageHashFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const image = nativeImage.createFromPath(filePath);
  return imageHashFromNativeImage(image);
}

function cacheImageFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return '';
  const buffer = image.toPNG();
  return saveClipboardImageBuffer(buffer, imageHashFromBuffer(buffer));
}

async function readSystemImageClipboardPayload() {
  if (Date.now() < suppressImageClipboardUntil) return Promise.resolve(null);
  const direct = imageClipboardPayload();
  if (direct) return { ...direct, sequence: await readClipboardSequence() };
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class XuanNianClipboardSeqImage { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }\'',
      '$image = [System.Windows.Forms.Clipboard]::GetImage()',
      'if ($image) {',
      '  $ms = New-Object System.IO.MemoryStream',
      '  $image.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
      '  [Console]::Out.Write("__SEQ__=" + [XuanNianClipboardSeqImage]::GetClipboardSequenceNumber() + "`n")',
      '  if ([System.Windows.Forms.Clipboard]::ContainsText()) {',
      '    $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)',
      '    if (-not [string]::IsNullOrWhiteSpace($text)) { [Console]::Out.Write("__TEXT64__=" + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)) + "`n") }',
      '  }',
      '  [Console]::Out.Write("data:image/png;base64," + [Convert]::ToBase64String($ms.ToArray()))',
      '}',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, maxBuffer: 25 * 1024 * 1024 }, (error, stdout) => {
      const dataUrl = !error ? String(stdout || '').trim() : '';
      const sequenceMatch = dataUrl.match(/__SEQ__=(\d+)/);
      const textMatch = dataUrl.match(/__TEXT64__=([A-Za-z0-9+/=]+)/);
      const text = textMatch ? Buffer.from(textMatch[1], 'base64').toString('utf8').trim() : '';
      const cleanDataUrl = dataUrl.replace(/__SEQ__=\d+\s*/,'').replace(/__TEXT64__=[A-Za-z0-9+/=]+\s*/,'');
      if (cleanDataUrl.startsWith('data:image/')) {
        const raw = cleanDataUrl.split(',')[1] || cleanDataUrl;
        const buffer = Buffer.from(raw, 'base64');
        const hash = imageHashFromBuffer(buffer);
        resolve({
          type: 'image',
          buffer,
          hash,
          imageHash: hash,
          text,
          sequence: sequenceMatch ? Number(sequenceMatch[1]) || 0 : 0,
        });
        return;
      }
      resolve(null);
    });
  });
}

function readFastClipboardPayload() {
  if (Date.now() < suppressTextClipboardUntil) return { type: 'text', text: '' };
  const richPayload = readRichHtmlClipboardPayload();
  if (richPayload) return richPayload;
  const formats = availableClipboardFormats();
  if (mayContainFileClipboard(formats) || mayContainImageClipboard(formats)) return null;
  return { type: 'text', text: clipboard.readText() };
}

function availableClipboardFormats() {
  try {
    return clipboard.availableFormats().map((format) => String(format || ''));
  } catch {
    return [];
  }
}

function mayContainFileClipboard(formats = availableClipboardFormats()) {
  return formats.some((format) => /file|drop|shell|filename|FileNameW|FileName|FileDrop/i.test(format));
}

function mayContainImageClipboard(formats = availableClipboardFormats()) {
  return formats.some((format) => /^image\//i.test(format) || /png|bitmap|dib|image/i.test(format));
}

function parseFileClipboardSnapshotOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!lines.length || lines.some((line) => line.startsWith('__CHANGED__='))) return null;
  const seqLine = lines.find((line) => line.startsWith('__SEQ__='));
  const sequence = seqLine ? Number(seqLine.split('=')[1] || 0) : 0;
  const effectLine = lines.find((line) => line.startsWith('__DROPEFFECT__='));
  const dropEffect = effectLine ? Number(effectLine.split('=')[1] || 0) : 0;
  const files = lines
    .filter((line) => line.startsWith('__PATH64__='))
    .map((line) => {
      try {
        return Buffer.from(line.slice('__PATH64__='.length), 'base64').toString('utf8');
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  const textLine = lines.find((line) => line.startsWith('__TEXT64__='));
  const text = textLine ? Buffer.from(textLine.slice('__TEXT64__='.length), 'base64').toString('utf8').trim() : '';
  return files.length ? { type: 'files', files, text, action: (dropEffect & 2) ? 'cut' : 'copy', sequence } : null;
}

function readFileClipboardPayload() {
  if (Date.now() < suppressFileClipboardUntil) return Promise.resolve(null);
  return new Promise((resolve) => {
    const helper = clipboardHelperPath();
    if (process.platform === 'win32' && fs.existsSync(helper)) {
      execFile(helper, ['read-files'], {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 6 * 1024 * 1024,
      }, (error, stdout) => {
        if (!error) {
          const payload = parseFileClipboardSnapshotOutput(stdout);
          if (payload) {
            resolve(payload);
            return;
          }
        }
        resolve(null);
      });
      return;
    }
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class XuanNianClipboardSeq { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }\'',
      '$seqStart = [XuanNianClipboardSeq]::GetClipboardSequenceNumber()',
      '$data = [System.Windows.Forms.Clipboard]::GetDataObject()',
      '$dropEffect = 0',
      'if ($data) {',
      '  $effect = $data.GetData("Preferred DropEffect")',
      '  if ($effect -is [System.IO.MemoryStream]) { $bytes = $effect.ToArray(); if ($bytes.Length -ge 4) { $dropEffect = [BitConverter]::ToInt32($bytes, 0) } }',
      '  elseif ($effect -is [byte[]] -and $effect.Length -ge 4) { $dropEffect = [BitConverter]::ToInt32($effect, 0) }',
      '  elseif ($effect -is [int]) { $dropEffect = $effect }',
      '}',
      '[Console]::Out.WriteLine("__DROPEFFECT__=" + $dropEffect)',
      '$allPaths = New-Object System.Collections.Generic.List[string]',
      '$hasFileDrop = $false',
      '$files = [System.Windows.Forms.Clipboard]::GetFileDropList()',
      'if ($files -and $files.Count -gt 0) {',
      '  $hasFileDrop = $true',
      '  $files | ForEach-Object { if ($_ -and (Test-Path -LiteralPath ([string]$_))) { $allPaths.Add([System.IO.Path]::GetFullPath([string]$_)) } }',
      '}',
      'if ($data -and -not $hasFileDrop) {',
      '  foreach ($fmt in @("FileNameW","FileName")) {',
      '    try {',
      '      $value = $data.GetData($fmt)',
      '      if ($value -is [System.Array]) { foreach ($p in $value) { if ($p -and (Test-Path -LiteralPath ([string]$p))) { $allPaths.Add([System.IO.Path]::GetFullPath([string]$p)) } } }',
      '      elseif ($value -and (Test-Path -LiteralPath ([string]$value))) { $allPaths.Add([System.IO.Path]::GetFullPath([string]$value)) }',
      '    } catch {}',
      '  }',
      '}',
      'if ($allPaths.Count -gt 0) {',
      '  $allPaths | Select-Object -Unique | ForEach-Object { [Console]::Out.WriteLine("__PATH64__=" + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$_))) }',
      '}',
      'if ([System.Windows.Forms.Clipboard]::ContainsText()) {',
      '  $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)',
      '  if (-not [string]::IsNullOrWhiteSpace($text)) { [Console]::Out.WriteLine("__TEXT64__=" + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))) }',
      '}',
      '$seqEnd = [XuanNianClipboardSeq]::GetClipboardSequenceNumber()',
      'if ($seqStart -ne $seqEnd) { [Console]::Out.WriteLine("__CHANGED__=1"); exit 0 }',
      '[Console]::Out.WriteLine("__SEQ__=" + $seqEnd)',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (!error && stdout.trim()) {
        const payload = parseFileClipboardSnapshotOutput(stdout);
        if (payload) {
          resolve(payload);
          return;
        }
      }
      resolve(null);
    });
  });
}

function uniqueExistingFiles(files = []) {
  const seen = new Set();
  const result = [];
  for (const filePath of normalizeExistingFilePaths(files)) {
    const key = filePath.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(filePath);
  }
  return result;
}

async function readClipboardPayload() {
  const formats = availableClipboardFormats();
  const mayHaveFiles = mayContainFileClipboard(formats);
  const mayHaveImages = mayContainImageClipboard(formats);
  const filePayload = mayHaveFiles ? await readFileClipboardPayload() : null;
  const richPayload = readRichHtmlClipboardPayload();
  const needsImagePayload = !filePayload?.files?.length && mayHaveImages;
  const imagePayload = needsImagePayload ? await readSystemImageClipboardPayload() : null;
  const text = String(
    filePayload?.text ||
    richPayload?.text ||
    imagePayload?.text ||
    clipboardTextForComposite() ||
    ''
  ).trim();
  const mergedFiles = uniqueExistingFiles([
    ...(filePayload?.files || []),
    ...(richPayload?.files || []),
  ]);
  if (mergedFiles.length) {
    return {
      type: 'files',
      files: mergedFiles,
      text,
      action: filePayload?.action || richPayload?.action || 'copy',
      sequence: filePayload?.sequence || imagePayload?.sequence || 0,
      composite: !!text,
    };
  }
  if (imagePayload) return { ...imagePayload, text };
  return readFastClipboardPayload();
}

function clipboardRecordFromPayload(payload) {
  if (payload?.type === 'files' && payload.files?.length) {
    const files = normalizeExistingFilePaths(payload.files);
    if (!files.length) return null;
    const first = files[0];
    const text = String(payload.text || '').trim();
    const textDigestPart = text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
    if (files.every(isImageFile)) {
      const cachedFiles = files.map((filePath) => cacheImageFile(filePath) || filePath);
      const imageHashes = cachedFiles.map(imageHashFromFile).filter(Boolean);
      const imageHash = imageHashes.length ? imageHashes.join('|') : '';
      return {
        type: 'image',
        content: text || '\u56fe\u7247\u5185\u5bb9',
        preview: filePreviewUrl(cachedFiles[0] || first),
        files: cachedFiles,
        originalFiles: files,
        fileBacked: false,
        cachedImage: true,
        imageHash,
        clipboardAction: payload.action || 'copy',
        clipboardDigest: `image-file:${payload.action || 'copy'}:${files.join('|')}:${imageHash || ''}${textDigestPart}`,
        sizeText: files.length > 1 ? `${files.length} \u4e2a\u56fe\u7247\u6587\u4ef6` : '',
      };
    }
    const storedFiles = files.map((filePath) => (isImageFile(filePath) ? (cacheImageFile(filePath) || filePath) : filePath));
    return {
      type: 'file',
      content: text || storedFiles[0] || first,
      files: storedFiles,
      originalFiles: files,
      fileBacked: true,
      clipboardAction: payload.action || 'copy',
      clipboardDigest: `file:${payload.action || 'copy'}:${files.join('|')}${textDigestPart}`,
      sizeText: files.length > 1 ? `${files.length} \u4e2a\u6587\u4ef6` : '',
    };
  }
  if (payload?.type === 'image' && payload.dataUrl) {
    const text = String(payload.text || '').trim();
    const raw = String(payload.dataUrl).split(',')[1] || '';
    const buffer = raw ? Buffer.from(raw, 'base64') : null;
    const imageHash = payload.imageHash || payload.hash || (buffer ? imageHashFromBuffer(buffer) : crypto.createHash('sha256').update(payload.dataUrl).digest('hex'));
    const filePath = buffer ? saveClipboardImageBuffer(buffer, imageHash) : '';
    const textDigestPart = text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
    return {
      type: 'image',
      content: text || '图片内容',
      preview: filePath ? filePreviewUrl(filePath) : payload.dataUrl,
      files: filePath ? [filePath] : [],
      fileBacked: false,
      cachedImage: !!filePath,
      imageHash,
      clipboardDigest: `image:${imageHash}${textDigestPart}`,
    };
  }
  if (payload?.type === 'image' && payload.buffer) {
    const text = String(payload.text || '').trim();
    const buffer = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer);
    const imageHash = payload.imageHash || payload.hash || imageHashFromBuffer(buffer);
    const filePath = saveClipboardImageBuffer(buffer, imageHash);
    const textDigestPart = text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
    return {
      type: 'image',
      content: text || '图片内容',
      preview: filePreviewUrl(filePath),
      files: [filePath],
      fileBacked: false,
      cachedImage: true,
      imageHash,
      clipboardDigest: `image:${imageHash}${textDigestPart}`,
    };
  }
  const text = String(payload?.text || clipboard.readText() || '').trim();
  if (!text) return null;
  return {
    type: /^https?:\/\//i.test(text) ? 'link' : 'text',
    content: text,
    clipboardDigest: `text:${crypto.createHash('sha256').update(text).digest('hex')}`,
  };
}

function clipboardDigestFromPayload(payload) {
  if (payload?.type === 'files' && payload.files?.length) {
    const files = normalizeExistingFilePaths(payload.files);
    if (!files.length) return '';
    const effect = payload.action || 'copy';
    const imageDigestPrefix = files.every(isImageFile) ? 'image-file' : 'file';
    const text = String(payload.text || '').trim();
    const textDigestPart = text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
    const baseDigest = `${imageDigestPrefix}:${effect}:${files.join('|')}${textDigestPart}`;
    return payload.sequence ? `${baseDigest}:seq:${payload.sequence}` : baseDigest;
  }
  if (payload?.type === 'image') {
    const hash = payload.imageHash || payload.hash || (payload.buffer ? imageHashFromBuffer(Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer)) : '');
    const text = String(payload.text || '').trim();
    const textDigestPart = text ? `:text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
    if (hash) return `image:${hash}${textDigestPart}`;
    if (payload.dataUrl) return `image:${crypto.createHash('sha256').update(String(payload.dataUrl)).digest('hex')}${textDigestPart}`;
    return '';
  }
  const text = String(payload?.text || clipboard.readText() || '').trim();
  return text ? `text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
}

async function seedCurrentClipboardDigest() {
  const payload = await readClipboardPayload();
  const digest = clipboardDigestFromPayload(payload);
  if (!digest) return;
  lastClipboardDigest = digest;
  rememberDigest(digest);
}

function sendDataChanged(data) {
  broadcastDataRefresh(data, { recordsOnly: true });
}

function hasMojibake(value) {
  return /[\u00c3\u00c2\u00e2\u00a5\u00ba\u00bb]/.test(String(value || ''));
}

function normalizeClipboardRecord(record) {
  if (!record) return record;
  if (record.type === 'image') {
    const isScreenshot = record.sizeText === '\u622a\u56fe' || (record.files || []).some((filePath) => /screenshots/i.test(String(filePath)));
    let sizeText = record.sizeText || '';
    if (hasMojibake(sizeText)) {
      sizeText = isScreenshot ? '\u622a\u56fe' : ((record.files || []).length > 1 ? `${record.files.length} \u4e2a\u56fe\u7247\u6587\u4ef6` : '');
    }
    let imageHash = record.imageHash || '';
    if (!imageHash && /^data:image\//i.test(String(record.preview || ''))) {
      try {
        imageHash = imageHashFromBuffer(Buffer.from(String(record.preview).split(',')[1] || '', 'base64'));
      } catch {}
    }
    let preview = record.preview;
    let files = Array.isArray(record.files) ? record.files : [];
    if (/^data:image\//i.test(String(record.preview || ''))) {
      try {
        const buffer = Buffer.from(String(record.preview).split(',')[1] || '', 'base64');
        const hash = imageHash || imageHashFromBuffer(buffer);
        const filePath = saveClipboardImageBuffer(buffer, hash);
        preview = filePreviewUrl(filePath);
        files = [filePath];
        imageHash = hash;
      } catch {}
    }
    if (!imageHash && (record.files || []).length === 1 && isImageFile(record.files[0])) {
      try {
        const stat = fs.statSync(record.files[0]);
        if (stat.size <= 2 * 1024 * 1024) imageHash = imageHashFromFile(record.files[0]);
      } catch {}
    }
    const clipboardDigest = imageHash && !record.fileBacked && (!record.clipboardDigest || record.clipboardDigest.startsWith('image-file:'))
      ? `image:${imageHash}`
      : record.clipboardDigest;
    const content = String(record.content || '').trim();
    const normalizedContent = content && !hasMojibake(content) ? content : '\u56fe\u7247\u5185\u5bb9';
    return { ...record, content: normalizedContent, preview, files, sizeText, imageHash, clipboardDigest, cachedImage: record.cachedImage || (!record.fileBacked && files.length > 0) };
  }
  if (record.type === 'file' && hasMojibake(record.sizeText)) {
    return { ...record, sizeText: (record.files || []).length > 1 ? `${record.files.length} \u4e2a\u6587\u4ef6` : '' };
  }
  return record;
}

function trimMapSize(map, limit) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function rememberDigest(digest) {
  if (!digest) return;
  const now = Date.now();
  recentClipboardDigests.set(digest, now);
  for (const [key, ts] of recentClipboardDigests) {
    if (now - ts > 60000) recentClipboardDigests.delete(key);
  }
  trimMapSize(recentClipboardDigests, RECENT_CACHE_LIMIT);
}

function pruneRecentClipboardSequences(now = Date.now()) {
  for (const [key, expiresAt] of recentClipboardSequences) {
    if (expiresAt <= now) recentClipboardSequences.delete(key);
  }
}

function rememberClipboardSequence(sequence, ttl = 60000) {
  const value = Number(sequence) || 0;
  if (!value) return;
  pruneRecentClipboardSequences();
  recentClipboardSequences.set(value, Date.now() + ttl);
  trimMapSize(recentClipboardSequences, RECENT_CACHE_LIMIT);
}

function hasRecentClipboardSequence(sequence) {
  const value = Number(sequence) || 0;
  if (!value) return false;
  pruneRecentClipboardSequences();
  return recentClipboardSequences.has(value);
}

function claimClipboardSequence(sequence) {
  const value = Number(sequence) || 0;
  if (!value) return 0;
  if (
    pendingClipboardSequences.has(value) ||
    hasRecentClipboardSequence(value) ||
    value === lastCapturedClipboardSequence ||
    isSelfClipboardSequence(value)
  ) {
    return 0;
  }
  pendingClipboardSequences.add(value);
  return value;
}

function rememberSelfClipboardDigest(digest, ttl = 1500) {
  if (!digest) return;
  selfClipboardDigests.set(digest, Date.now() + ttl);
  trimMapSize(selfClipboardDigests, SELF_CACHE_LIMIT);
  rememberDigest(digest);
}

function rememberSelfClipboardSequence(sequence, ttl = 30000) {
  const value = Number(sequence) || 0;
  if (!value) return;
  selfClipboardSequences.set(value, Date.now() + ttl);
  trimMapSize(selfClipboardSequences, SELF_CACHE_LIMIT);
}

function textDigestForContent(value = '') {
  const text = String(value || '').trim();
  return text ? `text:${crypto.createHash('sha256').update(text).digest('hex')}` : '';
}

function rememberCompositeTextSuppression(text, ttl = 30000) {
  const digest = textDigestForContent(text);
  if (!digest) return;
  const now = Date.now();
  compositeTextSuppressions.set(digest, now + ttl);
  for (const [key, expiresAt] of compositeTextSuppressions) {
    if (expiresAt <= now) compositeTextSuppressions.delete(key);
  }
  trimMapSize(compositeTextSuppressions, SELF_CACHE_LIMIT);
}

function isCompositeTextSuppressed(text) {
  const digest = textDigestForContent(text);
  if (!digest) return false;
  const now = Date.now();
  for (const [key, expiresAt] of compositeTextSuppressions) {
    if (expiresAt <= now) compositeTextSuppressions.delete(key);
  }
  return (compositeTextSuppressions.get(digest) || 0) > now;
}

function isSelfClipboardSequence(sequence) {
  const value = Number(sequence) || 0;
  if (!value) return false;
  const now = Date.now();
  for (const [key, expiresAt] of selfClipboardSequences) {
    if (expiresAt <= now) selfClipboardSequences.delete(key);
  }
  return (selfClipboardSequences.get(value) || 0) > now;
}

function isSelfClipboardDigest(digest) {
  if (!digest) return false;
  const now = Date.now();
  for (const [key, expiresAt] of selfClipboardDigests) {
    if (expiresAt <= now) selfClipboardDigests.delete(key);
  }
  return (selfClipboardDigests.get(digest) || 0) > now;
}

async function captureClipboardToData(payload = null, options = {}) {
  const trustedNativePayload = options.trustedNativePayload === true;
  let claimedSequence = 0;
  const initialSequence = Number(payload?.sequence) || (!payload ? await readClipboardSequence().catch(() => 0) : 0);
  if (initialSequence) {
    if (isSelfClipboardSequence(initialSequence)) return false;
    if (!trustedNativePayload) {
      claimedSequence = claimClipboardSequence(initialSequence);
      if (!claimedSequence) return false;
    }
  }
  try {
    payload = payload || await readClipboardPayload();
    const sequence = Number(payload?.sequence) || initialSequence || 0;
    if (sequence && isSelfClipboardSequence(sequence)) return false;
    if (sequence && !trustedNativePayload && sequence !== claimedSequence) {
      if (claimedSequence) pendingClipboardSequences.delete(claimedSequence);
      claimedSequence = claimClipboardSequence(sequence);
      if (!claimedSequence) return false;
    }
    const record = normalizeClipboardRecord(clipboardRecordFromPayload(payload));
    if (!record) return false;
    if ((record.type === 'text' || record.type === 'link') && isCompositeTextSuppressed(record.content)) {
      return false;
    }
    if (Array.isArray(record.files) && record.files.length && String(record.content || '').trim()) {
      rememberCompositeTextSuppression(record.content);
    }
    const baseDigest = record.clipboardDigest || `${record.type}:${record.files?.join('|') || record.preview || record.content}`;
    const digest = sequence ? `${baseDigest}:seq:${sequence}` : baseDigest;
    if (sequence && !trustedNativePayload && (hasRecentClipboardSequence(sequence) || sequence === lastCapturedClipboardSequence || isSelfClipboardSequence(sequence))) {
      return false;
    }
    if (isSelfClipboardDigest(baseDigest) || isSelfClipboardDigest(digest)) return false;
    if (!sequence && digest === lastClipboardDigest) return false;
    const data = loadMutableData();
    lastClipboardDigest = digest;
    if (sequence) {
      lastCapturedClipboardSequence = sequence;
      rememberClipboardSequence(sequence);
    }
    rememberDigest(digest);
    moveExistingClipboardRecordToTop(data, record, digest);
    const saved = saveRecordsData(data);
    sendDataChanged(saved);
    return true;
  } finally {
    if (claimedSequence) pendingClipboardSequences.delete(claimedSequence);
  }
}

function handleNativeClipboardSnapshot(line) {
  const parts = String(line || '').trim().split('\t');
  if (parts[0] === 'READY') {
    lastCapturedClipboardSequence = Number(parts[1]) || 0;
    rememberClipboardSequence(lastCapturedClipboardSequence);
    return;
  }
  const sequence = Number(parts[0]) || 0;
  const kind = parts[1] || '';
  const dropEffect = Number(parts[2]) || 0;
  const textPart = parts.find((value) => String(value || '').startsWith('__TEXT64__='));
  const compositeText = textPart
    ? Buffer.from(String(textPart).slice('__TEXT64__='.length), 'base64').toString('utf8').trim()
    : '';
  if (
    !sequence ||
    sequence === lastCapturedClipboardSequence ||
    pendingClipboardSequences.has(sequence) ||
    hasRecentClipboardSequence(sequence) ||
    isSelfClipboardSequence(sequence)
  ) return;

  const nativeFilePayload = kind === 'files' ? (() => {
    const files = normalizeExistingFilePaths(parts.slice(3).filter((value) => !String(value || '').startsWith('__TEXT64__=')).map((value) => {
      try {
        return Buffer.from(value, 'base64').toString('utf8');
      } catch {
        return '';
      }
    }));
    return files.length ? {
      type: 'files',
      files,
      text: compositeText,
      action: (dropEffect & 2) ? 'cut' : 'copy',
      sequence,
    } : null;
  })() : null;

  if (nativeFilePayload) {
    captureClipboardToData(nativeFilePayload, { trustedNativePayload: true }).catch(() => {});
    return;
  }

  readClipboardPayload()
    .then((payload) => {
      if (!payload) return;
      const merged = {
        ...payload,
        sequence: Number(payload.sequence) || sequence,
        text: String(payload.text || compositeText || '').trim(),
        action: payload.action || 'copy',
      };
      captureClipboardToData(merged).catch(() => {});
    })
    .catch(() => {});
  return;
}

function startNativeClipboardWatcher() {
  if (process.platform !== 'win32') return false;
  const helper = clipboardHelperPath();
  runtimeLog(`startNativeClipboardWatcher helper=${helper} exists=${fs.existsSync(helper)}`);
  if (!fs.existsSync(helper)) return false;

  let child;
  try {
    child = spawn(helper, ['watch'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    runtimeLog(`clipboard helper spawn failed: ${error?.message || error}`);
    return false;
  }
  clipboardWatcherProcess = child;
  clipboardWatcherBuffer = '';
  child.stdout.setEncoding('utf8');
  clipboardHelperRetryCount = 0;
  child.stdout.on('data', (chunk) => {
    clipboardWatcherBuffer += chunk;
    const lines = clipboardWatcherBuffer.split(/\r?\n/);
    clipboardWatcherBuffer = lines.pop() || '';
    for (const line of lines) handleNativeClipboardSnapshot(line);
  });
  child.on('exit', () => {
    runtimeLog('clipboard helper exited');
    if (clipboardWatcherProcess !== child) return;
    clipboardWatcherProcess = null;
    if (!isQuitting) setTimeout(() => startClipboardWatcher(), 800);
  });
  child.on('error', (error) => {
    runtimeLog(`clipboard helper error: ${error?.message || error}`);
    if (clipboardWatcherProcess === child) clipboardWatcherProcess = null;
    if (!isQuitting && !clipboardTimer) startClipboardPollingTimers();
  });
  runtimeLog(`clipboard helper spawned pid=${child.pid || 0}`);
  return true;
}

function startClipboardWatcher() {
  stopClipboardWatcher();
  if (startNativeClipboardWatcher()) {
    setTimeout(() => {
      if (clipboardWatcherProcess && !isQuitting) startClipboardPollingTimers({ nativeBackstop: true });
    }, 500);
    return;
  }
  const helperExists = process.platform === 'win32' && fs.existsSync(clipboardHelperPath());
  if (!helperExists && process.platform === 'win32' && app.isPackaged && clipboardHelperRetryCount < 12) {
    clipboardHelperRetryCount += 1;
    runtimeLog(`clipboard helper missing, retry=${clipboardHelperRetryCount}`);
    setTimeout(() => startClipboardWatcher(), 500);
    return;
  }
  runtimeLog('using fallback clipboard polling');
  seedCurrentClipboardDigest()
    .catch(() => {})
    .finally(() => {
      startClipboardPollingTimers();
    });
}

function pollFileClipboard() {
  if (fileClipboardReadInFlight) return;
  const formats = availableClipboardFormats();
  if (!mayContainFileClipboard(formats)) return;
  fileClipboardReadInFlight = true;
  readFileClipboardPayload()
    .then((payload) => payload && captureClipboardToData(payload))
    .catch(() => {})
    .finally(() => { fileClipboardReadInFlight = false; });
}

function pollImageClipboard() {
  if (imageClipboardReadInFlight) return;
  imageClipboardReadInFlight = true;
  Promise.resolve()
    .then(() => {
    const formats = availableClipboardFormats();
    imageClipboardPollCount = (imageClipboardPollCount + 1) % 10;
    if (mayContainFileClipboard(formats)) return null;
    if (!mayContainImageClipboard(formats) && imageClipboardPollCount !== 0) return null;
    return readSystemImageClipboardPayload().then((payload) => payload && captureClipboardToData(payload));
    })
    .catch(() => {})
    .finally(() => { imageClipboardReadInFlight = false; });
}

function selectInspirationFiles(ownerWindow) {
  return dialog.showOpenDialog(ownerWindow || mainWindow, {
    title: '选择要加入灵感的图片或文件',
    properties: ['openFile', 'multiSelections'],
  }).then((result) => result.canceled ? [] : result.filePaths.map((filePath) => {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return {
      kind: attachmentKindFromPath(filePath),
      name: path.basename(filePath),
      path: filePath,
      ext,
      size: stat.size,
    };
  }));
}

function triggerWechatScreenshot() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.SendKeys]::SendWait("%a")',
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, () => {});
}

function isWechatRunning() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-Process -Name WeChat -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ProcessName'], { windowsHide: true }, (_error, stdout) => {
      resolve(stdout.trim().length > 0);
    });
  });
}

function warmUpScreenCapturer() {
  if (screenCapturerWarmup) return screenCapturerWarmup;
  screenCapturerWarmup = getScreenCapture({ skipWarmupCache: true }).then((image) => {
    if (image && !image.isEmpty()) screenCapturerWarmupImage = { image, at: Date.now() };
    return image;
  }).catch(() => null).finally(() => {
    setTimeout(() => {
      screenCapturerWarmup = null;
    }, 500);
  });
  return screenCapturerWarmup;
}

async function getScreenCapture(options = {}) {
  const now = Date.now();
  if (!options.skipWarmupCache && screenCapturerWarmupImage && now - screenCapturerWarmupImage.at < 1200) {
    return screenCapturerWarmupImage.image;
  }
  const primary = screen.getPrimaryDisplay();
  const width = Math.round(primary.bounds.width * (primary.scaleFactor || 1));
  const height = Math.round(primary.bounds.height * (primary.scaleFactor || 1));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find((item) => String(item.display_id || '') === String(primary.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  return source.thumbnail;
}

async function captureScreenFallback() {
  const image = await getScreenCapture();
  if (!image) return null;
  const folder = path.join(app.getPath('userData'), 'screenshots');
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `screenshot-${Date.now()}.png`);
  fs.writeFileSync(filePath, image.toPNG());
  return { kind: 'image', name: path.basename(filePath), path: filePath };
}

function addClipboardRecord(record) {
  record = normalizeClipboardRecord(record);
  const data = loadMutableData();
  const digest = record.clipboardDigest || `${record.type}:${record.preview || record.content || Date.now()}`;
  const exists = data.records.some((item) => (
    item.clipboardDigest === digest ||
    (record.type === 'image' && record.imageHash && item.imageHash === record.imageHash) ||
    (record.type === 'image' && record.imageHash && item.clipboardDigest === `image:${record.imageHash}`) ||
    (record.preview && item.preview === record.preview)
  ));
  lastClipboardDigest = digest;
  rememberDigest(digest);
  if (!exists) {
    data.records.unshift({
      id: `rec_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      createdAt: Date.now(),
      ...withRecordRetention(record, data.settings),
      clipboardDigest: digest,
    });
    const saved = saveRecordsData(data);
    sendDataChanged(saved);
  }
  return data.records;
}

function createOrdinaryStickyFromScreenshot(result, imageDigest = '') {
  if (!result?.path || !fs.existsSync(result.path)) return null;
  const data = loadData();
  data.stickyProjects = [];
  data.stickyNotes = Array.isArray(data.stickyNotes) ? data.stickyNotes : [];
  const projectId = '';
  const note = {
    id: `sticky_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectId,
    order: Math.max(0, ...data.stickyNotes.filter((item) => item.projectId === projectId).map((item) => Number(item.order || 0))) + 1,
    title: '截图便签',
    content: '',
    attachments: [{
      kind: 'image',
      name: path.basename(result.path),
      path: result.path,
      ext: 'png',
    }],
    sourceRecordDigest: imageDigest,
    ordinary: true,
  };
  data.stickyNotes.unshift(note);
  const saved = saveData(data, { skipLocalizeAssets: true });
  sendDataChanged(saved);
  showStickyNoteWindow({ noteId: note.id, source: 'sticky' });
  return note;
}

async function captureScreenshotToClipboard(options = {}, ownerWindow = null) {
  const target = options.hideWindow ? (ownerWindow || mainWindow) : null;
  const shouldRestore = target && !target.isDestroyed() && target.isVisible();
  const previousOpacity = shouldRestore && typeof target.getOpacity === 'function' ? target.getOpacity() : 1;
  if (shouldRestore) {
    screenCapturerWarmupImage = null;
    target.setOpacity(0);
    await new Promise((resolve) => setTimeout(resolve, 28));
  }
  try {
    const result = await captureScreenSelection();
    if (!result?.path) return result;
    const image = nativeImage.createFromPath(result.path);
    const png = image.isEmpty() ? null : image.toPNG();
    const imageHash = png ? imageHashFromBuffer(png) : '';
    const imageDigest = imageHash ? `image:${imageHash}` : `screenshot:${result.path}`;
    if (!image.isEmpty()) {
      suppressImageClipboardUntil = Date.now() + SELF_IMAGE_SUPPRESS_MS;
      clipboard.writeImage(image);
      lastClipboardDigest = imageDigest;
      rememberSelfClipboardDigest(imageDigest, SELF_IMAGE_SUPPRESS_MS);
      rememberDigest(imageDigest);
      rememberDigest(`image:${crypto.createHash('sha256').update(png.toString('base64')).digest('hex')}`);
    }
    const preview = filePreviewUrl(result.path);
    addClipboardRecord({
      type: 'image',
      content: '\u56fe\u7247\u5185\u5bb9',
      preview,
      files: [result.path],
      imageHash,
      sizeText: '\u622a\u56fe',
      clipboardDigest: imageDigest,
    });
    if (result.pin) createOrdinaryStickyFromScreenshot(result, imageDigest);
    return { ...result, preview };
  } finally {
    if (shouldRestore) {
      target.setOpacity(previousOpacity || 1);
      target.focus();
    }
    setTimeout(() => warmUpScreenCapturer(), 800);
  }
}

async function captureScreenSelection() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const imagePromise = getScreenCapture();

  return new Promise((resolve) => {
    let settled = false;
    let loaded = false;
    let initPayload = null;
    let image = null;
    let size = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('screenshot-selector:ready');
      ipcMain.removeHandler('screenshot-selector:done');
      if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.close();
      screenshotWindow = null;
      resolve(result);
    };
    const trySendInit = () => {
      if (!loaded || !initPayload || settled || !screenshotWindow || screenshotWindow.isDestroyed()) return;
      screenshotWindow.webContents.send('screenshot-selector:init', initPayload);
    };

    imagePromise.then((captured) => {
      if (!captured || captured.isEmpty()) {
        finish(null);
        return;
      }
      image = captured;
      size = image.getSize();
      const previewScale = Math.min(1, 1024 / size.width, 640 / size.height);
      const previewImage = previewScale < 1
        ? image.resize({ width: Math.round(size.width * previewScale), height: Math.round(size.height * previewScale), quality: 'good' })
        : image;
      initPayload = {
        dataUrl: `data:image/jpeg;base64,${previewImage.toJPEG(48).toString('base64')}`,
        width: size.width,
        height: size.height,
      };
      trySendInit();
    }).catch(() => finish(null));

    screenshotWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      fullscreenable: false,
      skipTaskbar: true,
      transparent: false,
      backgroundColor: '#101010',
      hasShadow: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    screenshotWindow.setMenuBarVisibility(false);
    screenshotWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    screenshotWindow.on('closed', () => finish(null));
    screenshotWindow.webContents.once('did-finish-load', () => {
      loaded = true;
      trySendInit();
    });
    ipcMain.handle('screenshot-selector:ready', () => {
      if (screenshotWindow && !screenshotWindow.isDestroyed() && !screenshotWindow.isVisible()) {
        screenshotWindow.show();
        screenshotWindow.focus();
      }
      return true;
    });
    ipcMain.handle('screenshot-selector:done', async (_event, rect) => {
      if (!rect || rect.canceled) {
        finish(null);
        return null;
      }
      const crop = {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      crop.width = Math.min(crop.width, size.width - crop.x);
      crop.height = Math.min(crop.height, size.height - crop.y);
      const cropped = image.crop(crop);
      const folder = path.join(app.getPath('userData'), 'screenshots');
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, `screenshot-${Date.now()}.png`);
      fs.writeFileSync(filePath, cropped.toPNG());
      const result = { kind: 'image', name: path.basename(filePath), path: filePath, pin: !!rect.pin };
      finish(result);
      return result;
    });
    loadAppHtml(screenshotWindow, 'screenshot-select.html');
  });
}

if (gotSingleInstanceLock) {
app.whenReady().then(() => {
  runtimeLog(`app ready platform=${process.platform} arch=${process.arch} packaged=${app.isPackaged} appPath=${app.getAppPath()} resources=${process.resourcesPath || ''}`);
  app.setAppUserModelId('app.xuannian.desktop.rounded');
  Menu.setApplicationMenu(null);
  protectUserDataOnStartup();
  cleanupMediaPreviewCache();
  createWindow();
  createTray();
  scheduleQuickWindowPrewarm(40);
  scheduleStickyDraftPrewarm(80);
  const data = loadData({ clone: false });
  updateUninstallStoragePath(data);
  alwaysOnTop = !!data.settings.alwaysOnTop;
  mainWindow.setAlwaysOnTop(alwaysOnTop);
  registerAppHotkeys(data.settings);
  startClipboardWatcher();
  initializeAutoUpdater();
  setTimeout(() => {
    if (!isQuitting) getFileSearchService().prewarm().catch((error) => runtimeLog(`file search prewarm failed: ${error?.message || error}`));
  }, 1800);
  setTimeout(() => {
    if (!isQuitting) app.setLoginItemSettings({ openAtLogin: true, path: startupExecutablePath() });
  }, 1200);
});
}

app.on('before-quit', (event) => {
  runtimeLog('before-quit');
  isQuitting = true;
  if (quitAfterDataFlush || (!dataWriter.hasPending() && !recordsWriter.hasPending())) return;
  event.preventDefault();
  stopClipboardWatcher();
  if (quitFlushInProgress) return;
  quitFlushInProgress = true;
  flushDataWrites()
    .catch((error) => runtimeLog(`data flush before quit failed: ${error?.stack || error}`))
    .finally(() => {
      quitAfterDataFlush = true;
      app.quit();
    });
});

app.on('will-quit', () => {
  runtimeLog('will-quit');
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  globalShortcut.unregisterAll();
  stopKeyboardHotkeyHook();
  stopMouseHotkeyHook();
  stopNativeHotkeyHook();
  stopClipboardWatcher();
  if (mediaExternalAudioMonitorTimer) {
    clearInterval(mediaExternalAudioMonitorTimer);
    mediaExternalAudioMonitorTimer = null;
  }
  mediaExternalAudioTrackers.clear();
  mediaExternalSearchService?.shutdown();
  fileSearchService?.shutdown();
  destroyVideoThumbnailWindow();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

ipcMain.handle('data:load', () => loadData({ clone: false }));

ipcMain.handle('search:status', () => getFileSearchService().getStatus());
ipcMain.handle('search:initialize', () => getFileSearchService().initialize());
ipcMain.handle('search:query', (_event, query, options = {}) => getFileSearchService().search(query, options));
ipcMain.handle('search:cancel', () => getFileSearchService().cancel());
ipcMain.handle('media:resolveVideoProvider', (_event, value) => {
  const provider = detectVideoProvider(value);
  if (!provider) return null;
  return {
    id: provider.id,
    label: provider.label,
    portalUrl: provider.portalUrl,
    fallbackUrl: provider.fallbackUrl || '',
    sourceUrl: provider.sourceUrl,
    autoDownloadQuality: provider.autoDownloadQuality || '',
  };
});
ipcMain.handle('media:musicSearchUrl', (_event, keyword) => musicSearchUrl(keyword));
ipcMain.handle('media:getConfig', () => ({
  ...mediaDirectories(),
  downloadHistory: loadMediaDownloadHistory(),
}));
ipcMain.handle('media:listLocal', async () => {
  const directories = mediaDirectories();
  const [items, downloadCollections, favoriteCollections] = await Promise.all([
    listMediaFiles(directories.downloadPath, directories.favoritePath),
    listMediaCollections(directories.downloadPath),
    listMediaCollections(directories.favoritePath),
  ]);
  return {
    ok: true,
    ...directories,
    items,
    collections: { downloads: downloadCollections, favorites: favoriteCollections },
  };
});
ipcMain.handle('media:localPlaybackUrl', async (_event, filePath) => {
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value) || mediaKindForPath(value) !== 'audio') return '';
  try {
    const stat = await fs.promises.stat(value);
    return stat.isFile() ? pathToFileURL(value).href : '';
  } catch {
    return '';
  }
});
ipcMain.handle('media:favoriteLocal', async (_event, filePath, collection = '') => {
  const { favoritePath } = mediaDirectories();
  const result = await runMediaFileOperation('favorite media', () => copyMediaToFavorites(filePath, favoritePath, collection));
  if (result.ok) notifyMediaDownloadsChanged({ status: 'favorited', path: result.path });
  return result;
});
ipcMain.handle('media:createCollection', async (_event, location, kind, name) => {
  const directories = mediaDirectories();
  const root = location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  return runMediaFileOperation('create media collection', () => createMediaCollection(root, kind, name));
});
ipcMain.handle('media:renameCollection', async (_event, location, kind, currentName, nextName) => {
  const directories = mediaDirectories();
  const root = location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  return runMediaFileOperation('rename media collection', () => renameMediaCollection(root, kind, currentName, nextName));
});
ipcMain.handle('media:deleteCollection', async (_event, location, kind, name) => {
  const directories = mediaDirectories();
  const root = location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  return runMediaFileOperation('delete media collection', () => deleteMediaCollection(root, kind, name));
});
ipcMain.handle('media:moveLocal', async (_event, filePath, location, collection = '') => {
  const directories = mediaDirectories();
  const root = location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  return runMediaFileOperation('move media file', () => moveMediaToCollection(filePath, root, collection));
});
ipcMain.handle('media:deleteLocal', async (_event, filePath, location) => {
  const directories = mediaDirectories();
  const root = location === 'favorites' ? directories.favoritePath : directories.downloadPath;
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value) || !isPathInside(value, root) || !mediaKindForPath(value) || !fs.existsSync(value)) {
    return { ok: false, reason: '文件已被移动或删除' };
  }
  return runMediaFileOperation('delete media file', async () => {
    await shell.trashItem(value);
    notifyMediaDownloadsChanged({ status: 'deleted', path: value });
    return { ok: true };
  });
});
ipcMain.handle('media:deleteDownloadHistoryItem', async (_event, taskId) => {
  const id = String(taskId || '').trim();
  const task = loadMediaDownloadHistory().find((item) => item.id === id);
  if (!task) return { ok: false, reason: '下载记录不存在或已被清除' };
  const filePath = String(task.path || '').trim();
  const removed = await runMediaFileOperation('delete completed media download', async () => {
    const existed = !!filePath && path.isAbsolute(filePath) && !!mediaKindForPath(filePath) && fs.existsSync(filePath);
    if (existed) {
      await shell.trashItem(filePath);
    }
    const history = forgetCompletedMediaDownload(id);
    if (!history) throw new Error('download history could not be updated');
    notifyMediaDownloadsChanged({ status: 'deleted', path: filePath });
    return { ok: true, missing: !existed };
  });
  return removed;
});
ipcMain.handle('media:openPortal', (_event, url, downloadTarget = 'download', sourceText = '', autoSubmit = false, collection = '', qualityPreference = '', automationMode = '') => (
  openMediaPortal(url, downloadTarget, sourceText, autoSubmit, collection, qualityPreference, automationMode)
));
ipcMain.handle('media:downloadParsedVideo', (_event, downloadTarget = 'download', collection = '') => {
  runtimeLog(`media:downloadParsedVideo invoked target=${downloadTarget === 'favorite' ? 'favorite' : 'download'}`);
  return downloadParsedMediaVideo(downloadTarget, collection);
});
ipcMain.handle('media:resumeAfterVerification', () => ({
  ok: resumeMediaPortalAfterVerification(),
}));
ipcMain.handle('media:downloadMusicResult', (_event, url, downloadTarget = 'download', collection = '', preferredName = '') => (
  downloadMediaMusicResult(url, downloadTarget, collection, preferredName)
));
ipcMain.handle('media:previewMusicResult', (_event, url) => previewMediaMusicResult(url));
ipcMain.handle('media:openHighQualityMusic', (_event, query = '', downloadTarget = 'download', collection = '') => openHighQualityMusic(query, downloadTarget, collection));
ipcMain.on('media:browserBounds', (event, bounds = {}, visible = false, mode = 'browser') => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  setMediaPortalBounds(bounds, visible, mode);
});
ipcMain.handle('media:browserState', () => mediaBrowserState());
ipcMain.handle('media:browserAction', (event, action) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !mediaPortalView || mediaPortalView.webContents.isDestroyed()) return false;
  const webContents = mediaPortalView.webContents;
  const navigationHistory = webContents.navigationHistory;
  if (action === 'back' && navigationHistory.canGoBack()) navigationHistory.goBack();
  else if (action === 'forward' && navigationHistory.canGoForward()) navigationHistory.goForward();
  else if (action === 'reload') webContents.reload();
  else if (action === 'stop' && webContents.isLoading()) webContents.stop();
  else return false;
  notifyMediaBrowserState();
  return true;
});
ipcMain.handle('main:openNoteEditor', (_event, noteId) => {
  const id = String(noteId || '').trim();
  if (!id || !mainWindow || mainWindow.isDestroyed()) return false;
  showMainWindow();
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('main:navigate', 'notes');
    mainWindow.webContents.send('main:editNote', id);
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else setTimeout(send, 40);
  return true;
});

ipcMain.handle('update:getState', () => publicUpdateState());
ipcMain.handle('update:check', () => checkForAppUpdates());
ipcMain.handle('update:download', () => downloadAppUpdate());
ipcMain.handle('update:install', () => installAppUpdate());

ipcMain.handle('records:save', async (_event, records = []) => {
  const data = loadMutableData();
  data.records = Array.isArray(records) ? records.map(normalizeClipboardRecord) : [];
  const saved = await saveRecordsDataDurable(data);
  sendDataChanged(saved);
  return saved.records;
});

ipcMain.handle('data:save', async (_event, data) => {
  const current = loadData({ clone: false });
  const incomingSettings = { ...current.settings, ...sanitizeSettings(data.settings) };
  const settingsChanged = JSON.stringify(incomingSettings) !== JSON.stringify(current.settings || {});
  const stickyRefreshNeeded =
    JSON.stringify(data.stickyProjects || []) !== JSON.stringify(current.stickyProjects || []) ||
    JSON.stringify(data.stickyNotes || []) !== JSON.stringify(current.stickyNotes || []);
  const hotkeysChanged =
    incomingSettings.quickMenuHotkey !== current.settings.quickMenuHotkey ||
    incomingSettings.screenshotHotkey !== current.settings.screenshotHotkey ||
    incomingSettings.quickStickyHotkey !== current.settings.quickStickyHotkey ||
    incomingSettings.fileSearchHotkey !== current.settings.fileSearchHotkey;
  if (hotkeysChanged) {
    const result = registerAppHotkeys(incomingSettings);
    if (!result.quickOk) {
      registerAppHotkeys(current.settings);
      return { ok: false, reason: '快捷窗口快捷键已被其他软件占用，请换一个组合键。', data: current };
    }
    if (!result.screenshotOk) {
      registerAppHotkeys(current.settings);
      return { ok: false, reason: '截图快捷键已被其他软件占用，或与快捷窗口快捷键重复，请换一个组合键。', data: current };
    }
    if (!result.stickyOk) {
      registerAppHotkeys(current.settings);
      return { ok: false, reason: '快捷便签快捷键已被其他软件占用，或与其他玄念快捷键重复，请换一个组合键。', data: current };
    }
    if (!result.searchOk) {
      registerAppHotkeys(current.settings);
      return { ok: false, reason: '全盘查找快捷键已被其他软件占用，或与其他玄念快捷键重复，请换一个组合键。', data: current };
    }
  }
  const saved = await saveDataDurable({ ...data, settings: incomingSettings }, { clone: false });
  updateUninstallStoragePath(saved);
  broadcastDataRefresh(saved, { notifySticky: stickyRefreshNeeded });
  if (settingsChanged) notifySettingsChanged(saved.settings);
  return { ok: true, data: saved };
});

ipcMain.handle('window:setAlwaysOnTop', (_event, enabled) => {
  alwaysOnTop = !!enabled;
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
  const data = loadData();
  data.settings.alwaysOnTop = alwaysOnTop;
  saveData(data, { skipLocalizeAssets: true });
  return alwaysOnTop;
});

ipcMain.handle('window:minimize', () => {
  notifyMainSuspend();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  return true;
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  hideMainToTray();
  return true;
});

ipcMain.handle('window:moveStart', (event, point) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  if (mainWindow.isMaximized()) return false;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  mainWindowMoveSession = {
    cursor: { x: point.x, y: point.y },
    bounds: mainWindow.getBounds(),
    lastAt: 0,
  };
  return true;
});

ipcMain.on('window:moveMove', (event, point) => {
  if (!mainWindowMoveSession || !mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const now = Date.now();
  if (mainWindowMoveSession.lastAt && now - mainWindowMoveSession.lastAt < 10) return;
  mainWindowMoveSession.lastAt = now;
  mainWindow.setPosition(
    mainWindowMoveSession.bounds.x + Math.round(point.x - mainWindowMoveSession.cursor.x),
    mainWindowMoveSession.bounds.y + Math.round(point.y - mainWindowMoveSession.cursor.y),
    false,
  );
});

ipcMain.on('window:moveEnd', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) return;
  mainWindowMoveSession = null;
});

ipcMain.handle('window:resizeStart', (event, edge, point) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  if (!RESIZE_EDGES.has(edge) || mainWindow.isMaximized() || !mainWindow.isResizable()) return false;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  mainWindowResizeSession = {
    edge,
    cursor: { x: point.x, y: point.y },
    bounds: mainWindow.getBounds(),
  };
  return true;
});

ipcMain.on('window:resizeMove', (event, point) => {
  if (!mainWindowResizeSession || !mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  mainWindow.setBounds(resizeBoundsFromPointer(mainWindowResizeSession, point), false);
});

ipcMain.on('window:resizeEnd', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) return;
  mainWindowResizeSession = null;
});

ipcMain.handle('sticky:open', (_event, noteId) => {
  const win = showStickyNoteWindow({ noteId: String(noteId || '') });
  return { ok: !!win };
});

ipcMain.handle('sticky:getPinnedIds', () => pinnedStickyNoteIds());

ipcMain.handle('sticky:toggle', (_event, noteId) => {
  const id = String(noteId || '');
  if (!id) return { pinned: false, reason: '便签不存在。' };
  const existing = stickyNoteWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.close();
    return { pinned: false };
  }
  const win = showStickyNoteWindow({ noteId: id });
  return { pinned: !!win };
});

ipcMain.handle('sticky:create', (_event, options = {}) => {
  const win = showStickyNoteWindow({ editNew: true, source: options?.source || 'sticky' });
  return { ok: !!win };
});

ipcMain.handle('sticky:canPin', () => true);

ipcMain.handle('sticky:backupClipboard', (_event, payload) => backupStickyDraftToClipboard(payload));

ipcMain.handle('sticky:closeAll', () => {
  let closed = 0;
  for (const win of [...stickyNoteWindows.values()]) {
    if (!win || win.isDestroyed()) continue;
    closed += 1;
    win.close();
  }
  return { closed };
});

ipcMain.handle('sticky:registerSaved', (event, noteId) => {
  const id = String(noteId || '');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!id || !win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  const existing = stickyNoteWindows.get(id);
  if (existing && existing !== win && !existing.isDestroyed()) {
    existing.close();
  }
  stickyDraftWindows.delete(win);
  stickyNoteWindows.set(id, win);
  notifyStickyPinState();
  return true;
});

ipcMain.handle('sticky:focusTop', (event) => focusStickyWindowByWebContents(event.sender));

ipcMain.handle('sticky:pointerStatus', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) {
    return { insideWindow: false, x: -1, y: -1 };
  }
  const point = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const insideWindow = (
    point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
  );
  return {
    insideWindow,
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  };
});

ipcMain.handle('sticky:setAspectRatio', (event, ratio = 0) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  const value = normalizeStickyImageLayout(ratio);
  if (value) stickyAspectRatios.set(event.sender.id, value);
  else stickyAspectRatios.delete(event.sender.id);
  return true;
});

ipcMain.handle('sticky:fitImageLayout', (event, layout) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  const value = normalizeStickyImageLayout(layout);
  if (!value) return false;
  stickyAspectRatios.set(event.sender.id, value);
  return fitStickyWindowToImageLayout(win, value);
});

ipcMain.handle('sticky:expandVertical', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  const current = win.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  const margin = 18;
  const width = Math.min(Math.max(current.width, 180), Math.max(180, area.width - margin * 2));
  const height = Math.max(140, area.height - margin * 2);
  const x = Math.min(Math.max(current.x, area.x + margin), area.x + area.width - width - margin);
  const layout = normalizeStickyImageLayout(stickyAspectRatios.get(event.sender.id));
  if (layout?.ratio) {
    const contentWidth = Math.max(80, width - (layout.horizontalExtra || 0));
    stickyAspectRatios.set(event.sender.id, {
      ...layout,
      textFlexible: true,
      extraHeight: Math.max(layout.extraHeight || 0, Math.round(height - contentWidth / layout.ratio)),
    });
  }
  win.setBounds({ x, y: area.y + margin, width, height }, false);
  return true;
});

ipcMain.handle('sticky:collapseVertical', (event, layout) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  const current = win.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  const value = normalizeStickyImageLayout(layout) || normalizeStickyImageLayout(stickyAspectRatios.get(event.sender.id));
  const explicitHeight = Number(layout?.defaultHeight);
  let height = explicitHeight > 0
    ? explicitHeight
    : Math.min(Math.max(140, current.width), Math.max(140, area.height - 24));
  if (value?.ratio) {
    const contentWidth = Math.max(80, current.width - (value.horizontalExtra || 0));
    height = Math.round(contentWidth / value.ratio + (value.extraHeight || 0));
    stickyAspectRatios.set(event.sender.id, value);
  } else {
    stickyAspectRatios.delete(event.sender.id);
  }
  const next = clampBoundsToArea({
    x: current.x,
    y: current.y,
    width: current.width,
    height,
  }, area);
  win.setBounds(next, false);
  return true;
});

ipcMain.handle('sticky:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
  return true;
});

ipcMain.handle('sticky:resizeStart', (event, edge, point) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  if (!RESIZE_EDGES.has(edge)) return false;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  const bounds = win.getBounds();
  stickyResizeSessions.set(event.sender.id, {
    edge,
    cursor: { x: point.x, y: point.y },
    bounds,
    area: screen.getDisplayMatching(bounds).workArea,
    aspectRatio: stickyAspectRatios.get(event.sender.id) || 0,
    lastAt: 0,
  });
  return true;
});

ipcMain.handle('sticky:moveStart', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !stickyWindows.has(win)) return false;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  const sessionId = event.sender.id;
  const previous = stickyMoveSessions.get(sessionId);
  if (previous?.timer) clearTimeout(previous.timer);
  const session = {
    cursor: { x: point.x, y: point.y },
    bounds: win.getBounds(),
    area: screen.getDisplayMatching(win.getBounds()).workArea,
    lastAt: 0,
    timer: null,
  };
  session.timer = setTimeout(() => {
    const current = stickyMoveSessions.get(sessionId);
    if (current === session) stickyMoveSessions.delete(sessionId);
  }, 12000);
  stickyMoveSessions.set(sessionId, session);
  return true;
});

ipcMain.on('sticky:moveMove', (event, point) => {
  const session = stickyMoveSessions.get(event.sender.id);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!session || !win || win.isDestroyed() || !stickyWindows.has(win)) return;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const now = Date.now();
  if (session.lastAt && now - session.lastAt < 16) return;
  session.lastAt = now;
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      const current = stickyMoveSessions.get(event.sender.id);
      if (current === session) stickyMoveSessions.delete(event.sender.id);
    }, 12000);
  }
  const next = clampBoundsToArea({
    x: session.bounds.x + Math.round(point.x - session.cursor.x),
    y: session.bounds.y + Math.round(point.y - session.cursor.y),
    width: session.bounds.width,
    height: session.bounds.height,
  }, session.area);
  win.setBounds(next, false);
});

ipcMain.on('sticky:moveEnd', (event) => {
  const session = stickyMoveSessions.get(event.sender.id);
  if (session?.timer) clearTimeout(session.timer);
  stickyMoveSessions.delete(event.sender.id);
});

ipcMain.on('sticky:resizeMove', (event, point) => {
  const session = stickyResizeSessions.get(event.sender.id);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!session || !win || win.isDestroyed() || !stickyWindows.has(win)) return;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const now = Date.now();
  if (session.lastAt && now - session.lastAt < 16) return;
  session.lastAt = now;
  win.setBounds(resizeStickyBoundsFromPointer(session, point), false);
});

ipcMain.on('sticky:resizeEnd', (event) => {
  stickyResizeSessions.delete(event.sender.id);
});

ipcMain.handle('dialog:selectStorageFolder', async (_event, currentPath = '') => {
  const requested = String(currentPath || '').trim();
  let defaultPath = requested && path.isAbsolute(requested) ? requested : app.getPath('userData');
  if (!fs.existsSync(defaultPath)) {
    const parent = path.dirname(defaultPath);
    defaultPath = fs.existsSync(parent) ? parent : app.getPath('userData');
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择玄念数据存储文件夹',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});

ipcMain.handle('dialog:selectMediaFolder', async (_event, kind = 'download', currentPath = '') => {
  const directories = mediaDirectories();
  const requested = String(currentPath || '').trim();
  const fallback = kind === 'favorite' ? directories.favoritePath : directories.downloadPath;
  const defaultPath = requested && path.isAbsolute(requested) && fs.existsSync(requested) ? requested : fallback;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'favorite' ? '选择媒体收藏文件夹' : '选择媒体下载文件夹',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});

ipcMain.handle('data:exportPackage', async (event) => {
  const result = await exportUserDataPackage(BrowserWindow.fromWebContents(event.sender));
  if (result?.ok && result.filePath) shell.showItemInFolder(result.filePath);
  return result;
});

ipcMain.handle('data:importPackage', async (event) => {
  return importUserDataPackage(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('data:revealFolder', () => {
  const storageRoot = currentStorageRoot();
  fs.mkdirSync(storageRoot, { recursive: true });
  const dataFile = path.join(storageRoot, 'xuannian-data.json');
  if (fs.existsSync(dataFile)) shell.showItemInFolder(dataFile);
  else shell.openPath(storageRoot);
  return { ok: true, folder: storageRoot, dataFile };
});

ipcMain.handle('dialog:pickInspirationFiles', (event) => {
  return selectInspirationFiles(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('file:open', async (_event, filePath) => {
  if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(filePath)) return false;
  const error = await shell.openPath(String(filePath));
  return !error;
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) return false;
  await shell.openExternal(value);
  return true;
});

ipcMain.handle('file:showInFolder', (_event, filePath) => {
  if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(String(filePath));
  return true;
});

ipcMain.on('ui:setNativeTheme', (_event, theme) => {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
});

ipcMain.handle('file:startDrag', (event, filePath) => {
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value) || !fs.existsSync(value) || event.sender.isDestroyed()) return false;
  try {
    const pngIcon = path.join(__dirname, 'xuannian-logo-256.png');
    const iconPath = fs.existsSync(pngIcon) ? pngIcon : appIconPath();
    let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (icon && !icon.isEmpty()) icon = icon.resize({ width: 64, height: 64, quality: 'best' });
    event.sender.startDrag({ file: value, files: [value], icon });
    return true;
  } catch (error) {
    runtimeLog(`native file drag failed: ${error?.message || error}`);
    return false;
  }
});

ipcMain.handle('file:showContextMenu', (event, filePath) => {
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value) || !fs.existsSync(value)) return false;
  let directory = false;
  try {
    directory = fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
  const owner = BrowserWindow.fromWebContents(event.sender);
  const menu = Menu.buildFromTemplate([
    {
      label: directory ? '打开文件夹' : '打开文件',
      click: () => shell.openPath(value),
    },
    {
      label: '打开所在文件夹',
      click: () => shell.showItemInFolder(value),
    },
  ]);
  menu.popup({ window: owner || undefined });
  return true;
});

ipcMain.handle('ui:showItemContextMenu', (event, kind, options = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const items = [];
  const action = (id, label, extra = {}) => ({ id, label, ...extra });
  if (kind === 'clipboard') {
    items.push(action('pin', options.pinned ? '取消置顶' : '置顶'));
    items.push(action('favorite', options.saved ? '已收藏' : '收藏', { enabled: !options.saved }));
    if (options.hasFile) {
      items.push({ type: 'separator' });
      items.push(action('open', '打开文件'));
      items.push(action('reveal', '打开所在文件夹'));
    }
    items.push({ type: 'separator' });
    items.push(action('batch-delete', '批量删除'));
    items.push(action('delete', '删除'));
  } else if (kind === 'note') {
    items.push(action('pin', options.pinned ? '取消置顶' : '置顶'));
    items.push(action('edit', '修改'));
    if (options.hasFile) {
      items.push({ type: 'separator' });
      items.push(action('open', '打开文件'));
      items.push(action('reveal', '打开所在文件夹'));
    }
    items.push({ type: 'separator' });
    items.push(action('delete', '删除'));
  } else if (kind === 'media') {
    if (options.location !== 'favorites') {
      items.push(action('favorite', options.favorite ? '已收藏' : '收藏', { enabled: !options.favorite }));
    }
    items.push(action('open', '打开文件'));
    items.push(action('reveal', '打开所在文件夹'));
    if (options.location === 'favorites') {
      const collections = Array.isArray(options.collections)
        ? options.collections.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 50)
        : [];
      items.push({
        label: '移动到收藏夹',
        submenu: [
          action('move:', '未分类', { type: 'checkbox', checked: !options.collection }),
          ...collections.map((name) => action(`move:${name}`, name.slice(0, 48), { type: 'checkbox', checked: name === options.collection })),
        ],
      });
    }
    items.push({ type: 'separator' });
    items.push(action('delete', '删除'));
  } else if (kind === 'media-folder') {
    items.push(action('rename', '修改收藏夹名称'));
    items.push(action('delete', '删除收藏夹'));
  } else if (kind === 'note-category') {
    items.push(action('rename', '修改'));
    items.push(action('delete', '删除', { enabled: options.canDelete !== false }));
  } else if (kind === 'note-category-empty') {
    items.push(action('create', '新建分类'));
  } else {
    return '';
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value = '') => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const bind = (template) => template.map((item) => {
      if (item.type === 'separator') return item;
      if (Array.isArray(item.submenu)) return { ...item, submenu: bind(item.submenu) };
      const { id, ...menuItem } = item;
      return { ...menuItem, click: () => finish(id) };
    });
    const menu = Menu.buildFromTemplate(bind(items));
    menu.popup({ window: owner || undefined, callback: () => finish('') });
  });
});

ipcMain.handle('file:getIcon', async (_event, filePath) => {
  if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(filePath)) return '';
  const resolvedPath = path.resolve(String(filePath));
  const cacheKey = resolvedPath.toLocaleLowerCase('en-US');
  const cached = fileIconCache.get(cacheKey);
  if (cached) {
    fileIconCache.delete(cacheKey);
    fileIconCache.set(cacheKey, cached);
    return cached;
  }
  const pending = app.getFileIcon(resolvedPath, { size: 'large' })
    .then((image) => {
      if (!image || image.isEmpty()) return '';
      const size = image.getSize();
      const target = 128;
      const normalized = (size.width < target || size.height < target)
        ? image.resize({ width: target, height: target, quality: 'best' })
        : image;
      return normalized && !normalized.isEmpty() ? normalized.toDataURL() : image.toDataURL();
    })
    .catch(() => '');
  fileIconCache.set(cacheKey, pending);
  trimMapSize(fileIconCache, FILE_ICON_CACHE_LIMIT);
  const dataUrl = await pending;
  if (!dataUrl) {
    if (fileIconCache.get(cacheKey) === pending) fileIconCache.delete(cacheKey);
    return '';
  }
  fileIconCache.delete(cacheKey);
  fileIconCache.set(cacheKey, dataUrl);
  trimMapSize(fileIconCache, FILE_ICON_CACHE_LIMIT);
  return dataUrl;
});

function destroyVideoThumbnailWindow() {
  if (videoThumbnailIdleTimer) {
    clearTimeout(videoThumbnailIdleTimer);
    videoThumbnailIdleTimer = null;
  }
  const win = videoThumbnailWindow;
  videoThumbnailWindow = null;
  videoThumbnailWindowReady = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function scheduleVideoThumbnailWindowCleanup() {
  if (videoThumbnailIdleTimer) clearTimeout(videoThumbnailIdleTimer);
  if (videoThumbnailActive > 0) return;
  videoThumbnailIdleTimer = setTimeout(destroyVideoThumbnailWindow, VIDEO_THUMBNAIL_IDLE_MS);
}

async function getVideoThumbnailWindow() {
  if (videoThumbnailWindow && !videoThumbnailWindow.isDestroyed() && videoThumbnailWindowReady) {
    await videoThumbnailWindowReady;
    return videoThumbnailWindow;
  }
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  videoThumbnailWindow = win;
  videoThumbnailWindowReady = win.loadFile(path.join(__dirname, 'video-thumbnail.html'));
  win.on('closed', () => {
    if (videoThumbnailWindow === win) {
      videoThumbnailWindow = null;
      videoThumbnailWindowReady = null;
    }
  });
  await videoThumbnailWindowReady;
  return win;
}

async function createVideoFrameThumbnail(filePath, width, height) {
  videoThumbnailActive += 1;
  if (videoThumbnailIdleTimer) {
    clearTimeout(videoThumbnailIdleTimer);
    videoThumbnailIdleTimer = null;
  }
  try {
    const win = await getVideoThumbnailWindow();
    if (!win || win.isDestroyed()) return '';
    const source = pathToFileURL(filePath).href;
    const dataUrl = await win.webContents.executeJavaScript(
      `window.captureVideoThumbnail(${JSON.stringify(source)},${width},${height},${VIDEO_THUMBNAIL_TIMEOUT_MS})`,
      true,
    );
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : '';
  } catch (error) {
    runtimeLog(`video thumbnail fallback failed: ${error?.message || error}`);
    return '';
  } finally {
    videoThumbnailActive = Math.max(0, videoThumbnailActive - 1);
    scheduleVideoThumbnailWindowCleanup();
  }
}

async function createImageFrameThumbnail(filePath, width, height) {
  videoThumbnailActive += 1;
  if (videoThumbnailIdleTimer) {
    clearTimeout(videoThumbnailIdleTimer);
    videoThumbnailIdleTimer = null;
  }
  try {
    const win = await getVideoThumbnailWindow();
    if (!win || win.isDestroyed()) return '';
    const source = pathToFileURL(filePath).href;
    const dataUrl = await win.webContents.executeJavaScript(
      `window.captureImageThumbnail(${JSON.stringify(source)},${width},${height},${VIDEO_THUMBNAIL_TIMEOUT_MS})`,
      true,
    );
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : '';
  } catch (error) {
    runtimeLog(`image thumbnail fallback failed: ${error?.message || error}`);
    return '';
  } finally {
    videoThumbnailActive = Math.max(0, videoThumbnailActive - 1);
    scheduleVideoThumbnailWindowCleanup();
  }
}

async function createSystemFileThumbnail(filePath, width, height) {
  let timeoutId = null;
  try {
    return await Promise.race([
      nativeImage.createThumbnailFromPath(filePath, { width, height }).catch(() => null),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), SYSTEM_THUMBNAIL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

ipcMain.handle('file:getThumbnail', async (_event, filePath, requestedSize = {}) => {
  const input = String(filePath || '').trim();
  const fileType = fileTypeForPath(input);
  if (!input || !path.isAbsolute(input) || !['image', 'video'].includes(fileType)) return '';
  const resolvedPath = path.resolve(input);
  let stat;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch {
    return '';
  }
  if (!stat.isFile()) return '';
  const width = Math.max(40, Math.min(160, Math.round(Number(requestedSize?.width) || 96)));
  const height = Math.max(32, Math.min(120, Math.round(Number(requestedSize?.height) || 64)));
  const cacheKey = `${resolvedPath.toLocaleLowerCase('en-US')}|${stat.size}|${Math.round(stat.mtimeMs)}|${width}x${height}`;
  if (fileThumbnailCache.has(cacheKey)) {
    const cached = fileThumbnailCache.get(cacheKey);
    if (cached) {
      fileThumbnailCache.delete(cacheKey);
      fileThumbnailCache.set(cacheKey, cached);
      return cached;
    }
    fileThumbnailCache.delete(cacheKey);
  }
  const pending = (async () => {
    const image = await createSystemFileThumbnail(resolvedPath, width, height);
    if (image && !image.isEmpty()) return image.toDataURL();
    if (fileType === 'video') return createVideoFrameThumbnail(resolvedPath, width, height);
    if (fileType === 'image') return createImageFrameThumbnail(resolvedPath, width, height);
    return '';
  })();
  fileThumbnailCache.set(cacheKey, pending);
  trimMapSize(fileThumbnailCache, FILE_THUMBNAIL_CACHE_LIMIT);
  const dataUrl = await pending;
  if (!dataUrl) {
    if (fileThumbnailCache.get(cacheKey) === pending) fileThumbnailCache.delete(cacheKey);
    return '';
  }
  fileThumbnailCache.delete(cacheKey);
  fileThumbnailCache.set(cacheKey, dataUrl);
  trimMapSize(fileThumbnailCache, FILE_THUMBNAIL_CACHE_LIMIT);
  return dataUrl;
});

ipcMain.handle('attachments:localizeForCopy', (_event, attachments = [], scope = 'notes') => {
  if (!Array.isArray(attachments)) return [];
  try {
    const data = loadData();
    const targetScope = scope === 'sticky-notes' ? 'sticky-notes' : 'notes';
    return attachments.map((item) => localizeAttachment(item, data, targetScope));
  } catch {
    return attachments;
  }
});

ipcMain.handle('clipboard:copyFile', (_event, filePath, action, text) => copyFileToClipboard(filePath, action, text));

ipcMain.handle('clipboard:readPayload', () => readClipboardPayload());

ipcMain.handle('clipboard:captureNow', () => captureClipboardToData());

ipcMain.handle('clipboard:copyText', (_event, text) => {
  const value = String(text || '');
  const digest = `text:${crypto.createHash('sha256').update(value.trim()).digest('hex')}`;
  rememberSelfClipboardDigest(digest, 1200);
  suppressTextClipboardUntil = Date.now() + 2500;
  clipboard.writeText(value);
  lastClipboardDigest = digest;
  readClipboardSequence().then((sequence) => {
    if (sequence) {
      rememberSelfClipboardSequence(sequence, 30000);
      rememberClipboardSequence(sequence);
      lastCapturedClipboardSequence = sequence;
    }
  }).catch(() => {});
  return true;
});

function imageFromCopySource(value = '') {
  const source = String(value || '');
  if (!source) return { image: nativeImage.createEmpty(), sourceFilePath: '' };
  if (/^file:\/\//i.test(source)) {
    const filePath = parseFileUrl(source) || decodeURIComponent(source.replace(/^file:\/\/\/?/i, '')).replace(/\//g, path.sep);
    return { image: nativeImage.createFromPath(filePath), sourceFilePath: filePath };
  }
  if (path.isAbsolute(source)) {
    return { image: nativeImage.createFromPath(source), sourceFilePath: source };
  }
  return { image: nativeImage.createFromDataURL(source), sourceFilePath: '' };
}

function saveDragImageSource(value = '', name = '') {
  const { image, sourceFilePath } = imageFromCopySource(value);
  if (sourceFilePath && fs.existsSync(sourceFilePath) && isImageFile(sourceFilePath)) {
    return { filePath: sourceFilePath, image: image && !image.isEmpty() ? image : nativeImage.createFromPath(sourceFilePath) };
  }
  if (!image || image.isEmpty()) return null;
  const buffer = image.toPNG();
  if (!buffer?.length) return null;
  const hash = imageHashFromBuffer(buffer);
  const folder = path.join(app.getPath('userData'), 'drag-images');
  fs.mkdirSync(folder, { recursive: true });
  const base = safeBaseName(name || 'image.png');
  const stem = (path.basename(base, path.extname(base)) || 'image').slice(0, 80);
  const filePath = path.join(folder, `${stem}-${hash.slice(0, 12)}.png`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
  return { filePath, image };
}

function startStickyImageDrag(event, dataUrl, name) {
  const result = saveDragImageSource(dataUrl, name);
  if (!result?.filePath) return false;
  const icon = result.image.resize({ width: 96, height: 96, quality: 'best' });
  event.sender.startDrag({
    file: result.filePath,
    icon: icon && !icon.isEmpty() ? icon : nativeImage.createFromPath(result.filePath),
  });
  return true;
}

ipcMain.on('sticky:startImageDrag', (event, dataUrl, name) => {
  try {
    startStickyImageDrag(event, dataUrl, name);
  } catch (error) {
    runtimeLog(`sticky image drag failed: ${error?.message || error}`);
  }
});

ipcMain.handle('clipboard:copyImage', async (_event, dataUrl) => {
  if (!dataUrl) return false;
  const { image } = imageFromCopySource(dataUrl);
  if (image.isEmpty()) return false;
  const buffer = image.toPNG();
  const imageHash = imageHashFromBuffer(buffer);
  const imageDigest = `image:${imageHash}`;
  rememberSelfClipboardDigest(imageDigest, 1200);
  suppressImageClipboardUntil = Date.now() + SELF_IMAGE_SUPPRESS_MS;
  clipboard.writeImage(image);
  const sequence = await readClipboardSequence().catch(() => 0);
  lastClipboardDigest = sequence ? `${imageDigest}:seq:${sequence}` : imageDigest;
  if (sequence) {
    rememberSelfClipboardSequence(sequence, 30000);
    rememberClipboardSequence(sequence);
    lastCapturedClipboardSequence = sequence;
  }
  rememberSelfClipboardDigest(lastClipboardDigest, 1200);
  return true;
});

ipcMain.handle('quick:hide', () => {
  hideQuickWindow();
  return true;
});

ipcMain.handle('quick:show', () => {
  showQuickWindow();
  return true;
});

ipcMain.handle('quick:setEditorMode', (_event, enabled) => setQuickEditorMode(enabled));

ipcMain.handle('quick:moveStart', (event, point) => {
  if (!quickWindow || quickWindow.isDestroyed() || event.sender !== quickWindow.webContents) return false;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  stopQuickOutsideCloseWatcher();
  quickWindowMoveSession = {
    cursor: { x: point.x, y: point.y },
    bounds: quickWindow.getBounds(),
    lastAt: 0,
  };
  return true;
});

ipcMain.on('quick:moveMove', (event, point) => {
  if (!quickWindowMoveSession || !quickWindow || quickWindow.isDestroyed() || event.sender !== quickWindow.webContents) return;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const now = Date.now();
  if (quickWindowMoveSession.lastAt && now - quickWindowMoveSession.lastAt < 10) return;
  quickWindowMoveSession.lastAt = now;
  quickWindow.setPosition(
    quickWindowMoveSession.bounds.x + Math.round(point.x - quickWindowMoveSession.cursor.x),
    quickWindowMoveSession.bounds.y + Math.round(point.y - quickWindowMoveSession.cursor.y),
    false,
  );
});

ipcMain.on('quick:moveEnd', (event) => {
  if (quickWindow && !quickWindow.isDestroyed() && event.sender !== quickWindow.webContents) return;
  quickWindowMoveSession = null;
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) startQuickOutsideCloseWatcher();
});

ipcMain.handle('quick:pasteToActiveTarget', () => pasteClipboardToActiveTarget());

ipcMain.handle('screenshot:capture', async (event, options = {}) => {
  if (!options.forceInternal && await isWechatRunning()) {
    triggerWechatScreenshot();
    return { delegatedToWechat: true };
  }
  return captureScreenshotToClipboard(options, BrowserWindow.fromWebContents(event.sender));
});

ipcMain.handle('screenshot:warmup', () => {
  warmUpScreenCapturer();
  return true;
});
