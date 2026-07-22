const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-fullscreen-probe-'));
app.setPath('userData', tempDirectory);

function waitForEvent(emitter, name, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs);
    emitter.once(name, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 640,
    height: 420,
    show: true,
    frame: false,
    fullscreenable: true,
  });
  const canUsePermission = (webContents, permission) => (
    permission === 'fullscreen' && webContents === window.webContents
  );
  window.webContents.session.setPermissionCheckHandler(canUsePermission);
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(canUsePermission(webContents, permission));
  });
  await window.loadURL('data:text/html,<style>html,body,video{width:100%;height:100%;margin:0;background:%23000}</style><video id="preview" controls></video>');
  window.show();
  window.moveTop();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 200));

  const entered = waitForEvent(window.webContents, 'enter-html-full-screen');
  const requested = await Promise.race([
    window.webContents.executeJavaScript(
      "preview.requestFullscreen().then(() => Boolean(document.fullscreenElement))",
      true,
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error('fullscreen request timeout')), 5000)),
  ]);
  await entered;
  const active = await window.webContents.executeJavaScript('Boolean(document.fullscreenElement)');

  const left = waitForEvent(window.webContents, 'leave-html-full-screen');
  await window.webContents.executeJavaScript('document.exitFullscreen()', true);
  await left;

  assert.strictEqual(requested, true);
  assert.strictEqual(active, true);
  assert.strictEqual(window.isFullScreen(), false);
  console.log('fullscreen permission probe passed');
  window.destroy();
}

function cleanup() {
  try { fs.rmSync(tempDirectory, { recursive: true, force: true }); } catch {}
}

const hardTimeout = setTimeout(() => {
  console.error('fullscreen permission probe hard timeout');
  cleanup();
  process.exit(1);
}, 15000);

run()
  .then(() => {
    clearTimeout(hardTimeout);
    cleanup();
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(hardTimeout);
    console.error(error);
    cleanup();
    process.exit(1);
  });
