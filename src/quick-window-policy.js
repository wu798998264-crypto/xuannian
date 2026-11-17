function quickWindowPlatformOptions(platform = process.platform) {
  return platform === 'darwin' ? { type: 'panel' } : {};
}

function configureQuickWindowPlatform(window, platform = process.platform) {
  if (platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
}

function showQuickWindowPlatform(window, platform = process.platform) {
  if (platform === 'darwin') window.showInactive();
  else window.show();
  // A nonactivating macOS panel can receive keyboard focus while the user's
  // foreground application and Space remain active.
  window.focus();
}

module.exports = {
  quickWindowPlatformOptions,
  configureQuickWindowPlatform,
  showQuickWindowPlatform,
};
