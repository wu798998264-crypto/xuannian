// Run with: node tests/favorites-drag-electron.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-favorite-drag-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const child = spawnSync(require('electron'), [__filename, profile], { env, stdio:'inherit', timeout:60000 });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    fs.rmSync(profile, { recursive:true, force:true, maxRetries:8, retryDelay:150 });
  }
  return;
}

const { app, BaseWindow, clipboard } = require('electron');
const profile = process.argv[2];
assert.equal(path.dirname(profile), os.tmpdir());
assert(path.basename(profile).startsWith('xuannian-favorite-drag-'));
app.setName('FavoriteDragProbe');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
require('./isolate-media-probe')(profile);
const copies = [];
clipboard.writeText = text => copies.push(text);
const windows = require('../src/application-window');
const createWindow = windows.createApplicationWindow;
windows.createApplicationWindow = options => createWindow({
  ...options, show:false, opacity:0, focusable:false, skipTaskbar:true,
  webPreferences:{ ...options.webPreferences, backgroundThrottling:false },
});
require('../src/main');

async function until(read, label, ms = 4000) {
  const deadline = Date.now() + ms;
  do {
    const value = await read();
    if (value) return value;
    await pause(35);
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for ' + label);
}

async function run() {
  await app.whenReady();
  const win = await until(() => BaseWindow.getAllWindows().find(w =>
    w.webContents?.getURL().endsWith('index.html') && !w.webContents.isLoading()), 'favorites window', 12000);
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  const page = win.webContents;
  page.debugger.attach('1.3');
  const read = script => page.executeJavaScript(script);
  const frame = () => read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await read(`(async () => {
    localStorage.setItem(onboardingKeys.firstRun, 'seen');
    const projects = await nativeAPI.getNoteProjects();
    await nativeAPI.addNoteProject({id:'drag-destination', name:'拖入这里'});
    const notes = Array.from({length:110}, (_, i) => ({
      id:'row'+i, order:i+1, type:'text', projectId:projects[0].id, content:'内容'+i, title:i%2?'隐藏项':'定位项', createdAt:1700000000000+i,
    }));
    await nativeAPI.saveNotes(notes);
  })()`);
  async function reopen() {
    const ready = new Promise(resolve => page.once('did-finish-load', resolve));
    page.reload();
    await ready;
    await until(() => read('state.notes.length===110'), 'saved favorites');
    await read("document.querySelector('.nav-btn[data-view=notes]').click()");
    await until(() => read("state.view === 'notes'"), 'normal favorites view');
    await frame();
  }
  await reopen();
  if (process.env.XUANNIAN_TEST_INPUT_TRACE) {
    await read(`window.__trace=[];
      for (const name of ['pointerdown','pointermove','pointerup','lostpointercapture','pointercancel']) {
        document.addEventListener(name, e => window.__trace.push([name,e.target.closest('[data-note-card]')?.dataset.noteCard,e.target.id,e.clientY,e.buttons,!!document.querySelector('.note-sort-ghost'),document.querySelector('#noteList').scrollTop]),true);
      }`);
  }

  const order = () => read('filteredNotes().map(item => item.id)');
  async function point(selector, fraction = 0.5) {
    const rect = await read(`(() => {
      const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
      return r && { x:Math.round(r.left+r.width*0.35), y:Math.round(r.top+r.height*${fraction}) };
    })()`);
    assert(rect, 'Missing ' + selector);
    return rect;
  }
  const card = (id, fraction) => point('[data-note-card="'+id+'"]', fraction);
  const mouse = (type, p, held = false) => page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, ...p, button:type === 'mouseMoved' ? 'none' : 'left', buttons:held ? 1 : 0, clickCount:type === 'mouseMoved' ? 0 : 1,
  });
  async function dragTo(id, p, finish = true) {
    const start = await card(id);
    await mouse('mouseMoved', start);
    await mouse('mousePressed', start, true);
    await mouse('mouseMoved', { x:start.x, y:start.y + 9 }, true);
    await mouse('mouseMoved', p, true);
    await frame();
    if (finish) await mouse('mouseReleased', p);
  }
  async function first(expected) {
    try {
      await until(async () => (await order()).slice(0,expected.length).join(',') === expected.join(','), 'order '+expected);
    } catch (error) {
      console.error('Observed order:', (await order()).slice(0,expected.length+2), await read('window.__trace'));
      throw error;
    }
  }

  await until(() => read("document.querySelector('#pageCoach').classList.contains('show') && document.querySelector('#pageCoachTitle').textContent === '收藏'"), 'first-visit favorites hint');
  await dragTo('row0', await card('row2', 0.25));
  await first(['row1','row0','row2']);
  assert.equal(await read("!!document.querySelector('#pageCoach.show, #modalBackdrop.show, .note-sort-ghost')"), false,
    'First drop must return directly to the normal favorites list');
  await dragTo('row2', await card('row1', 0.75));
  await first(['row1','row2','row0']);
  await reopen();
  await first(['row1','row2','row0']);
  console.log('Upper/lower insertion and persisted order passed');

  const target = await card('row0', 0.75);
  await dragTo('row1', target, false);
  await page.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await page.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await mouse('mouseReleased', target);
  await frame();
  await first(['row1','row2','row0']);
  assert.equal(copies.length, 0, 'Drag or cancellation accidentally copied a favorite');
  console.log('Escape cancellation and click suppression passed');

  const edge = await point('#noteList', 0.99);
  await dragTo('row1', edge, false);
  await until(() => read("document.querySelector('[data-note-card=\"row67\"]') !== null && document.querySelector('#noteList').scrollTop>0"),
    'stationary pointer to scroll past the original virtual window', 10000);
  await mouse('mouseReleased', edge);
  await until(async () => (await order()).indexOf('row1') > 8, 'drop after virtualized scrolling');
  const movedOrder = await order();
  await reopen();
  assert.deepEqual(await order(), movedOrder);
  console.log('Continuous edge scroll, virtualized drop and persistence passed');

  const moved = movedOrder[0];
  await dragTo(moved, await point('[data-project-id="drag-destination"]'));
  await until(() => read(`state.notes.find(n=>n.id===${JSON.stringify(moved)}).projectId==='drag-destination'`), 'move to another category');
  const clickId = (await order())[0];
  const clickPoint = await card(clickId);
  await mouse('mousePressed', clickPoint, true);
  const jitter = {x:clickPoint.x+1, y:clickPoint.y+1};
  await mouse('mouseMoved', jitter, true);
  await mouse('mouseReleased', jitter);
  await until(() => copies.length === 1, 'ordinary single click to copy');
  assert.equal(copies[0], '内容'+clickId.slice(3));
  const editPoint = await point('[data-edit-note="'+clickId+'"]');
  await mouse('mousePressed', editPoint, true);
  await mouse('mouseReleased', editPoint);
  await until(() => read(`document.querySelector('#noteContent')?.value === ${JSON.stringify('内容'+clickId.slice(3))}`), 'edit button on draggable row');
  const cancelPoint = await point('#cancelModal');
  await mouse('mousePressed', cancelPoint, true);
  await mouse('mouseReleased', cancelPoint);
  await until(() => read("!document.querySelector('#modalBackdrop').classList.contains('show')"), 'close editor');
  assert.equal(copies.length, 1, 'Action button accidentally copied a favorite');
  console.log('Category drop, ordinary click-to-copy and row action button passed');

  const all = await order();
  await read("const search=document.querySelector('#noteSearch'); search.value='定位项'; search.dispatchEvent(new Event('input',{bubbles:true}))");
  await frame();
  const visible = await order();
  const filtered = [...visible.slice(1,3), visible[0], ...visible.slice(3)];
  await dragTo(visible[0], await card(visible[2], 0.75));
  await until(async () => (await order()).join(',') === filtered.join(','), 'filtered drag');
  await reopen();
  const fullOrder = await order();
  const visibleIds = new Set(visible);
  const ids = filtered.values();
  assert.deepEqual(fullOrder, all.map(id => visibleIds.has(id) ? ids.next().value : id));
  assert.equal(await read('new Set(filteredNotes().map(n=>n.order)).size === filteredNotes().length'), true);
  console.log('Filtered drag preserves hidden favorites and a unique persisted order');
}

run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
