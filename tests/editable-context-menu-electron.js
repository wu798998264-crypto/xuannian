const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const { attachEditableContextMenu } = require('../src/editable-context-menu');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-context-menu-probe-'));
app.setPath('userData', tempDirectory);

function waitFor(check, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('Timed out waiting for editable context menu'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function removeTempDirectory() {
  const resolved = path.resolve(tempDirectory);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('xuannian-context-menu-probe-')) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
  }
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 320, height: 180 });
  let capturedTemplate = null;
  let popupWindow = null;
  const originalBuildFromTemplate = Menu.buildFromTemplate;
  Menu.buildFromTemplate = (template) => {
    capturedTemplate = template;
    return { popup: (options) => { popupWindow = options.window; } };
  };

  try {
    attachEditableContextMenu(win, Menu);
    await win.loadURL('data:text/html;charset=utf-8,<input id="search" type="search" value="XuanNian" style="position:fixed;left:10px;top:10px;width:240px;height:40px">');
    const point = await win.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('#search');
      input.focus();
      input.setSelectionRange(0,input.value.length);
      const rect=input.getBoundingClientRect();
      return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: point.x, y: point.y });
    await waitFor(() => Boolean(capturedTemplate));

    assert.strictEqual(popupWindow, win);
    assert(capturedTemplate.some((item) => item.label === '剪切' && item.enabled), 'selected search text should be cuttable');
    assert(capturedTemplate.some((item) => item.label === '复制' && item.enabled), 'selected search text should be copyable');
    assert(capturedTemplate.some((item) => item.label === '全选'), 'search input should expose select all');
    console.log('electron editable context menu probe passed');
  } finally {
    Menu.buildFromTemplate = originalBuildFromTemplate;
    if (!win.isDestroyed()) win.destroy();
  }
}

run()
  .then(() => {
    app.once('quit', removeTempDirectory);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.once('quit', removeTempDirectory);
    app.exit(1);
  });
