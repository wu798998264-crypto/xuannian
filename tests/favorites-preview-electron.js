const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow } = require('electron');

const project = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-favorite-preview-'));
app.setPath('userData', temp);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

async function verify() {
  const fixture = path.join(temp, '收藏 #100% %23.png');
  fs.copyFileSync(path.join(project, 'src', 'xuannian-logo-256.png'), fixture);
  for (const [page, render] of [
    ['index.html', 'renderNoteAttachments([item])'],
    ['quick.html', 'renderNoteThumbs({ attachments: [item] })'],
    ['sticky.html', 'attachmentMarkup(item)'],
  ]) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: page === 'index.html' ? undefined : path.join(__dirname, 'quick-probe-preload.js'),
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    try {
      console.log('Checking', page);
      window.webContents.on('render-process-gone', (_event, details) => console.error(page, details.reason));
      await window.loadFile(path.join(project, page));
      const item = { name: path.basename(fixture), kind: 'image', path: fixture, preview: fixture };
      const result = await window.webContents.executeJavaScript(`
        (async () => {
          const item = ${JSON.stringify(item)};
          const holder = document.createElement('div');
          holder.innerHTML = ${render};
          const img = holder.querySelector('img');
          img.loading = 'eager';
          document.body.appendChild(holder);
          await img.decode();
          return { url: img.currentSrc, size: [img.naturalWidth, img.naturalHeight], path: filePathFromPreview(img.currentSrc) };
        })()
      `);
      assert.equal(fileURLToPath(result.url), fixture);
      assert.deepEqual(result.size, [256, 256]);
      assert.equal(result.path, fixture);
      console.log(page, 'decoded a 256×256 favorite attachment');
    } finally {
      window.destroy();
    }
  }
}

const timeout = setTimeout(() => {
  console.error('Timed out waiting for Electron to render favorite attachments');
  app.exit(1);
}, 90000);
app.whenReady().then(verify).then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => {
  clearTimeout(timeout);
  const directory = path.resolve(temp);
  if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('xuannian-favorite-preview-')) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn('Temporary profile cleanup:', error.message);
    }
  }
});
