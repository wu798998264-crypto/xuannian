const MUSIC_OPERATION_TIMEOUT_MS = { 'music-search': 45000, 'music-preview': 45000, 'music-download': 65000 };

function musicOperationDeadline(mode, startedAt = Date.now()) {
  return MUSIC_OPERATION_TIMEOUT_MS[mode] ? startedAt + MUSIC_OPERATION_TIMEOUT_MS[mode] : 0;
}

function musicOperationTimeoutReason(state) {
  if (state.automaticSecurityCheck) return 'security-check-timeout';
  return state.automationMode === 'music-search' ? 'search-timeout'
    : state.automationMode === 'music-preview' ? 'preview-unavailable' : 'download-timeout';
}

// Electron queues executeJavaScript behind did-stop-loading. Never enqueue a
// read during a reload; release an in-flight page Promise when its document goes
// away, even if that document's own timeout can no longer run.
function executeMusicPageScript(webContents, script, signal, readyFrame) {
  const interrupted = code => Object.assign(new Error(code), { code });
  if (signal?.aborted || webContents.isDestroyed()) return Promise.reject(interrupted('music-operation-cancelled'));
  if (webContents.musicManagedChallenge || (webContents.isLoading() && !readyFrame)) return Promise.reject(interrupted('music-page-loading'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      webContents.removeListener('did-start-navigation', onNavigation);
      webContents.removeListener('destroyed', onDestroyed);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onNavigation = event => {
      if (event.isMainFrame && !event.isSameDocument) finish(interrupted('music-page-navigation'));
    };
    const onDestroyed = () => finish(interrupted('music-operation-cancelled'));
    const onAbort = () => finish(interrupted('music-operation-cancelled'));
    webContents.on('did-start-navigation', onNavigation);
    webContents.once('destroyed', onDestroyed);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      // A DOM-ready frame can expose results while images or subframes keep
      // WebContents loading. executeJavaScript on the frame itself reads now.
      Promise.resolve((readyFrame || webContents).executeJavaScript(script)).then(value => finish(null, value), finish);
    } catch (error) { finish(error); }
  });
}

module.exports = { musicOperationDeadline, musicOperationTimeoutReason, executeMusicPageScript };
