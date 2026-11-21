const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { app, clipboard, globalShortcut, nativeImage } = require('electron');

// Call before loading the production main process, which captures child-process methods
// and otherwise reads and writes the installed StoragePath and enables Windows autostart.
module.exports = function isolateMediaProbe(root) {
  app.setPath('appData', root);
  for (const [key, folder] of Object.entries({
    userData: '玄念', sessionData: 'session', downloads: 'Downloads', documents: 'Documents',
  })) {
    const directory = path.join(root, folder);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(key, directory);
  }
  app.setLoginItemSettings = () => {};
  globalShortcut.register = () => false;
  clipboard.availableFormats = () => [];
  clipboard.readText = clipboard.readHTML = () => '';
  clipboard.readImage = () => nativeImage.createEmpty();

  for (const method of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    const original = child[method];
    child[method] = (binary, ...args) => {
      if (/^ff(?:mpeg|probe)(?:\.exe)?$/i.test(path.basename(binary))) return original(binary, ...args);
      const error = new Error('Native host integration disabled in media probe');
      if (method !== 'execFile') throw error;
      const callback = args.at(-1);
      if (typeof callback === 'function') setImmediate(callback, error);
    };
  }
  require('../src/file-search').FileSearchService.prototype.prewarm = async () => {};
};
