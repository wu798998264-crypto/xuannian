const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { app, BrowserWindow } = require('electron');

const repository = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-window-controls-'));
const screenshots = path.join(repository, 'dist-9.2.0-qa');
app.setPath('userData', path.join(temporary, 'user-data'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

function productionPlatform(platform) {
  let exposed;
  vm.runInNewContext(fs.readFileSync(path.join(repository, 'src', 'preload.js'), 'utf8'), {
    process: { platform },
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(name, api) {
        assert.equal(name, 'nativeAPI');
        exposed = api;
      } } };
    },
  });
  assert.equal(exposed.platform, platform);
  return exposed.platform;
}

async function waitForUI(window) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await window.webContents.executeJavaScript("typeof state !== 'undefined' && state.settings && !!document.querySelector('#clipboardList')")) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Window controls UI did not initialize.');
}

async function verifyPlatform(platform) {
  const preload = path.join(temporary, `${platform}-preload.js`);
  fs.writeFileSync(preload, `
    const { contextBridge } = require('electron');
    let pinned = false;
    contextBridge.exposeInMainWorld('nativeAPI', {
      platform: ${JSON.stringify(productionPlatform(platform))},
      setAlwaysOnTop: async enabled => (pinned = !!enabled),
      getPinProbe: () => pinned,
    });
    localStorage.setItem('xuannian.onboarding.first-run.v1', 'seen');
  `);
  const window = new BrowserWindow({
    width: 1280, height: 820, show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  try {
    await window.loadFile(path.join(repository, 'index.html'));
    await waitForUI(window);
    for (const width of [1280, 620]) {
      window.setContentSize(width, 720);
      const metrics = await window.webContents.executeJavaScript(`(() => {
        const ids = ['windowMinBtn', 'windowMaxBtn', 'windowCloseBtn', 'windowPinBtn'];
        const controls = Object.fromEntries(ids.map(id => {
          const element = document.getElementById(id);
          const bounds = element.getBoundingClientRect();
          return [id, { display: getComputedStyle(element).display, width: bounds.width, height: bounds.height }];
        }));
        const pin = document.getElementById('windowPinBtn');
        const bounds = pin.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        const originalPlatform = window.nativeAPI.platform;
        try { window.nativeAPI.platform = 'changed'; } catch {}
        return {
          controls,
          macClass: document.documentElement.classList.contains('platform-mac'),
          readonlyPlatform: window.nativeAPI.platform === originalPlatform && Object.isFrozen(window.nativeAPI),
          pinClickable: hit === pin || pin.contains(hit),
          dragRight: getComputedStyle(document.querySelector('.drag-strip')).right,
        };
      })()`);
      assert.equal(metrics.macClass, platform === 'darwin');
      assert.equal(metrics.readonlyPlatform, true);
      assert.equal(metrics.pinClickable, true);
      for (const id of ['windowMinBtn', 'windowMaxBtn', 'windowCloseBtn']) {
        assert.equal(metrics.controls[id].display === 'none', platform === 'darwin', `${platform} ${width}: ${id}`);
        assert.equal(metrics.controls[id].width > 0, platform !== 'darwin', `${platform} ${width}: ${id} layout`);
      }
      assert.notEqual(metrics.controls.windowPinBtn.display, 'none');
      assert(metrics.controls.windowPinBtn.width > 0);
      assert.equal(metrics.dragRight, platform === 'darwin' ? '46px' : '154px');
      console.log(JSON.stringify({ platform, width, ...metrics }));
      fs.mkdirSync(screenshots, { recursive: true });
      fs.writeFileSync(path.join(screenshots, `mac-window-controls-${platform}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript("document.getElementById('windowPinBtn').click()");
    const pinned = await window.webContents.executeJavaScript("new Promise(resolve => setTimeout(() => resolve(window.nativeAPI.getPinProbe() && document.getElementById('windowPinBtn').classList.contains('active')), 50))");
    assert.equal(pinned, true, `${platform}: pin action remains connected`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function run() {
  const html = fs.readFileSync(path.join(repository, 'index.html'), 'utf8');
  const platformScript = html.indexOf("document.documentElement.classList.add('platform-mac')");
  assert(platformScript > 0 && platformScript < html.indexOf('rel="stylesheet"'), 'Platform class must be set before stylesheets and body parsing.');
  await app.whenReady();
  await verifyPlatform('win32');
  await verifyPlatform('darwin');
  console.log('Mac native window controls regression passed.');
}

const timeout = setTimeout(() => { console.error('Window controls probe timed out.'); app.exit(1); }, 30000);
run().then(() => {
  clearTimeout(timeout);
  app.quit();
}).catch(error => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
