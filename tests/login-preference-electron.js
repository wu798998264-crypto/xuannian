// node tests/login-preference-electron.js
// Exercise the real settings UI, IPC, and local preference file across launches.
// The OS login-item service is replaced before loading the application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-login-pref-'));
  try {
    for (const phase of ['disable', 'enable', 'check-enabled']) {
      const child = spawnSync(require('electron'), [__filename, profile, phase], { stdio: 'inherit', timeout: 30000 });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, phase + ' failed');
    }
  } finally {
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert(path.basename(profile).startsWith('xuannian-login-pref-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
  return;
}

const { app, BaseWindow } = require('electron');
const [profile, phase] = process.argv.slice(2);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
require('./isolate-media-probe')(profile);
const loginRequests = [];
let actual = false;
let rejectChange = false;
const loginPath = process.platform === 'win32' ? { path: process.execPath } : {};
app.setLoginItemSettings = options => {
  assert.deepEqual(options, { ...loginPath, openAtLogin: options.openAtLogin });
  loginRequests.push(options.openAtLogin);
  if (!rejectChange) actual = options.openAtLogin;
};
app.getLoginItemSettings = options => {
  assert.deepEqual(options, loginPath);
  return { openAtLogin: actual };
};
Object.defineProperty(app, 'isPackaged', { value: true });
process.env.PORTABLE_EXECUTABLE_FILE = process.execPath;
const windows = require('../src/application-window');
const createWindow = windows.createApplicationWindow;
windows.createApplicationWindow = options => createWindow({ ...options, show: false });
require('../src/main');

async function verify() {
  await app.whenReady();
  const main = BaseWindow.getAllWindows().find(w => w.applicationView);
  const ui = script => main.webContents.executeJavaScript(script);
  await ui("localStorage.setItem('xuannian.onboarding.first-run.v1','seen')");
  while (!await ui("document.getElementById('settingOpenAtLogin')?.disabled === false")) await wait(30);
  await ui("switchView('settings', {skipCoach:true})");
  const previous = phase !== 'enable';
  assert.deepEqual(loginRequests, [previous], 'Startup must apply the saved choice exactly once');
  assert.equal(await ui("document.getElementById('settingOpenAtLogin').checked"), previous);
  if (phase === 'check-enabled') return;
  const clickAndWait = async () => {
    await ui("document.getElementById('settingOpenAtLogin').click()");
    while (await ui("document.getElementById('settingOpenAtLogin').disabled")) await wait(25);
  };
  await clickAndWait();
  assert.equal(actual, !previous);
  const persisted = () => JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'login-preference.json'))).enabled;
  assert.equal(persisted(), !previous);
  rejectChange = true;
  await clickAndWait();
  assert.equal(await ui("document.getElementById('settingOpenAtLogin').checked"), !previous);
  assert.equal(persisted(), !previous, 'Rejected OS change must preserve the previous preference');
}
const timeout = setTimeout(() => { console.error(phase + ' timed out'); app.exit(1); }, 20000);
verify().then(() => { console.log('Login preference verified:', phase); app.exit(0); })
  .catch(error => { console.error(error); app.exit(1); }).finally(() => clearTimeout(timeout));
