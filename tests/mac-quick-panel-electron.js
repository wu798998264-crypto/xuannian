const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  quickWindowPlatformOptions,
  configureQuickWindowPlatform,
  showQuickWindowPlatform,
} = require('../src/quick-window-policy');

function verifyPolicy() {
  for (const platform of ['win32', 'darwin']) {
    const calls = [];
    const window = Object.fromEntries(['setVisibleOnAllWorkspaces', 'showInactive', 'show', 'focus']
      .map(method => [method, (...args) => calls.push([method, ...args])]));
    assert.deepEqual(quickWindowPlatformOptions(platform), platform === 'darwin' ? { type: 'panel' } : {});
    configureQuickWindowPlatform(window, platform);
    showQuickWindowPlatform(window, platform);
    assert.deepEqual(calls, platform === 'darwin' ? [
      ['setVisibleOnAllWorkspaces', true, { visibleOnFullScreen: true, skipTransformProcessType: true }],
      ['showInactive'], ['focus'],
    ] : [['show'], ['focus']]);
  }
  console.log('Quick window platform policy checks passed.');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await sleep(80);
  }
  throw Error(`Timed out waiting for ${label}.`);
}

function execute(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) {
    throw Error(`${executable} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function frontmostPid() {
  // NSWorkspace is a read-only AppKit query; no System Events or TCC grant.
  const output = execute('osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);"]);
  const pid = Number(output.trim());
  assert(Number.isInteger(pid) && pid > 0, `Unexpected foreground application PID: ${output}`);
  return pid;
}

function readStatus(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

async function verifyNativeMac() {
  const { app, BrowserWindow, screen } = require('electron');
  assert(app?.whenReady, 'Run this native macOS probe with Electron.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-mac-quick-panel-'));
  app.setPath('userData', path.join(temporary, 'user-data'));
  app.on('window-all-closed', () => {});
  let main;
  let panel;
  let host;
  const statusPath = path.join(temporary, 'host-status.json');
  try {
    const contents = path.join(temporary, 'QuickPanelHost.app', 'Contents');
    const executable = path.join(contents, 'MacOS', 'QuickPanelHost');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0"><dict>
        <key>CFBundleExecutable</key><string>QuickPanelHost</string>
        <key>CFBundleIdentifier</key><string>app.xuannian.quick-panel-probe-host</string>
        <key>CFBundleName</key><string>QuickPanelHost</string>
        <key>CFBundlePackageType</key><string>APPL</string>
        <key>NSHighResolutionCapable</key><true/>
      </dict></plist>`);
    execute('xcrun', ['swiftc', path.join(__dirname, 'fixtures', 'mac-quick-panel-host.swift'), '-o', executable]);
    await app.whenReady();
    main = new BrowserWindow({ show: false, width: 640, height: 480 });
    let mainShows = 0;
    let mainFocuses = 0;
    main.on('show', () => { mainShows += 1; });
    main.on('focus', () => { mainFocuses += 1; });
    await main.loadURL('data:text/html,<title>Hidden XuanNian main fixture</title>');
    panel = new BrowserWindow({
      ...quickWindowPlatformOptions(),
      width: 420, height: 180, show: false, frame: false,
      resizable: false, skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    configureQuickWindowPlatform(panel);
    await panel.loadURL('data:text/html,<title>Quick panel fixture</title><input id="entry" autofocus placeholder="Quick panel keyboard input">');
    host = spawn(executable, [statusPath, String(process.pid)], { stdio: 'ignore' });
    let hostError;
    host.once('error', error => { hostError = error; });
    await waitUntil(() => {
      if (hostError) throw hostError;
      assert.equal(host.exitCode, null, 'External fixture exited before becoming ready.');
      return readStatus(statusPath).pid === host.pid;
    }, 'external application startup');
    await waitUntil(() => frontmostPid() === host.pid, 'external application activation');

    for (const fullscreen of [false, true]) {
      if (fullscreen) {
        fs.writeFileSync(`${statusPath}.command`, 'fullscreen');
        await waitUntil(() => readStatus(statusPath).fullscreen === true, 'external application fullscreen Space', 15000);
        await waitUntil(() => frontmostPid() === host.pid, 'fullscreen external application activation');
      }
      const point = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(point).workArea;
      panel.setBounds({ x: area.x + 80, y: area.y + 80, width: 420, height: 180 });
      const before = frontmostPid();
      showQuickWindowPlatform(panel);
      await waitUntil(() => panel.isVisible() && panel.isFocused(), 'visible keyboard-focused panel');
      const panelWindowId = Number(panel.getMediaSourceId().split(':')[1]);
      assert(Number.isInteger(panelWindowId) && panelWindowId > 0, 'Panel did not expose its native window ID.');
      await waitUntil(() => {
        const status = readStatus(statusPath);
        return status.hostOnActiveSpace === true && status.electronOnScreenWindowIds?.includes(panelWindowId);
      }, 'panel on the external application active Space');
      await sleep(350);
      const after = frontmostPid();
      assert.equal(before, host.pid);
      assert.equal(after, host.pid, 'Panel activated Electron or changed the foreground application.');
      assert.equal(main.isVisible(), false, 'Quick panel showed the main window.');
      assert.equal(main.isFocused(), false, 'Quick panel focused the main window.');
      assert.equal(mainShows, 0);
      assert.equal(mainFocuses, 0);
      assert.equal(panel.isVisibleOnAllWorkspaces(), true);
      await panel.webContents.executeJavaScript("document.getElementById('entry').value = ''; document.getElementById('entry').focus()");
      for (const character of 'quick') panel.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await waitUntil(async () => await panel.webContents.executeJavaScript("document.getElementById('entry').value") === 'quick', 'panel keyboard input');
      panel.hide();
      await waitUntil(() => !panel.isVisible() && frontmostPid() === host.pid, 'return to external application after hide');
      assert.equal(main.isVisible(), false);
      console.log(JSON.stringify({ nativeMac: true, arch: process.arch, fullscreen, before, after, panelWindowId, hostOnActiveSpace: true, panelOnScreen: true, mainHidden: true, input: 'quick', hiddenWithoutActivation: true }));
    }
    fs.writeFileSync(`${statusPath}.command`, 'windowed');
    await waitUntil(() => readStatus(statusPath).fullscreen === false, 'fixture fullscreen cleanup', 15000);
    console.log('Native macOS quick panel regression passed (windowed and fullscreen external application).');
  } finally {
    if (host && host.exitCode === null && !host.killed) host.kill('SIGTERM');
    if (panel && !panel.isDestroyed()) panel.destroy();
    if (main && !main.isDestroyed()) main.destroy();
  }
}

verifyPolicy();
if (process.platform !== 'darwin') {
  console.log('Native macOS foreground/Space checks skipped on this platform; policy mocks passed.');
  const { app } = require('electron');
  if (app) app.whenReady().then(() => app.quit());
} else {
  const { app } = require('electron');
  const timeout = setTimeout(() => { console.error('Native quick panel probe timed out.'); app.exit(1); }, 120000);
  verifyNativeMac().then(() => {
    clearTimeout(timeout);
    app.quit();
  }).catch(error => {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  });
}
