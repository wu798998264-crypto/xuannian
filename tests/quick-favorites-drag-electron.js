// Run with: node tests/quick-favorites-drag-electron.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-quick-row-'));
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = spawnSync(require('electron'), [__filename,profile], {env,stdio:'inherit',timeout:50000});
    if (run.error) throw run.error;
    process.exitCode = run.status ?? 1;
  } finally {
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
  }
  return;
}

const {app, BaseWindow, ipcMain, clipboard} = require('electron');
const profile = process.argv[2];
assert.equal(path.dirname(profile), os.tmpdir());
assert(path.basename(profile).startsWith('xuannian-quick-row-'));
require('./isolate-media-probe')(profile);
app.setName('QuickFavoritesRowTest');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.disableHardwareAcceleration();
const copies = [];
clipboard.writeText = value => copies.push(value);
app.on('browser-window-created', (_e, win) => {
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setFocusable(false);
});
const windows = require('../src/application-window');
const makeWindow = windows.createApplicationWindow;
windows.createApplicationWindow = options => makeWindow({
  ...options,show:false,opacity:0,focusable:false,skipTaskbar:true,
  webPreferences:{...options.webPreferences,backgroundThrottling:false},
});
require('../src/main');
let pastes = 0;
// Exercise the real quick-panel paste command without sending Ctrl+V to the host desktop.
ipcMain.removeHandler('quick:pasteToActiveTarget');
ipcMain.handle('quick:pasteToActiveTarget', () => { pastes++; return true; });

async function until(read, description) {
  const end = Date.now()+9000;
  do {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve,35));
  } while (Date.now()<end);
  throw Error('Timed out: '+description);
}

async function verify() {
  await app.whenReady();
  const windowFor = suffix => until(() => BaseWindow.getAllWindows().find(w =>
    w.webContents?.getURL().endsWith(suffix) && !w.webContents.isLoading()), suffix);
  const [main,quick] = await Promise.all([windowFor('/index.html'),windowFor('/quick.html')]);
  main.setIgnoreMouseEvents(true);
  main.showInactive();
  quick.showInactive();
  const page = quick.webContents;
  const read = script => page.executeJavaScript(script);
  await read(`(async()=>{
    const projectId=(await nativeAPI.getNoteProjects())[0].id;
    await nativeAPI.saveNotes(Array.from({length:54},(_,i)=>({
      id:'q'+i,projectId,type:'text',title:i%2?'隐藏项':'定位项',content:'快捷收藏'+i,order:i+1,createdAt:1700000000000+i,
    })));
    await loadData();
    document.querySelector('[data-tab="notes"]').click();
  })()`);
  await main.webContents.executeJavaScript(`localStorage.setItem(onboardingKeys.firstRun,'seen');switchView('notes',{skipCoach:true})`);
  page.debugger.attach('1.3');
  const frame = () => read('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))');
  await frame();
  const order = () => read("Array.from(document.querySelectorAll('#noteList [data-note]'), n=>n.dataset.note)");
  const expectTop = (...ids) => until(async() => (await order()).slice(0,ids.length).join()===ids.join(), 'quick order '+ids);
  const point = (selector, frac=.5) => read(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width*.35),y:Math.round(r.top+r.height*${frac})}})()`);
  const card = (id, f) => point('[data-note="'+id+'"]',f);
  const mouse = (type, p, down=false) => page.debugger.sendCommand('Input.dispatchMouseEvent', {
    type,...p,button:type==='mouseMoved'?'none':'left',buttons:down?1:0,clickCount:type==='mouseMoved'?0:1,
  });
  async function drag(from, to) {
    const start = await card(from);
    await mouse('mouseMoved',start);
    await mouse('mousePressed',start,true);
    await mouse('mouseMoved',{x:start.x,y:start.y+9},true);
    await mouse('mouseMoved',to,true);
    await frame();
    await mouse('mouseReleased',to);
  }
  await drag('q0',await card('q2',.25));
  await expectTop('q1','q0','q2');
  await drag('q2',await card('q1',.75));
  await expectTop('q1','q2','q0');
  await until(()=>main.webContents.executeJavaScript("Array.from(document.querySelectorAll('#noteList [data-note-card]'), el=>el.dataset.noteCard).slice(0,3).join()==='q1,q2,q0'"),'open main window rendered the new quick-panel order');
  const reload = new Promise(resolve=>page.once('did-finish-load',resolve));
  page.reload();
  await reload;
  await expectTop('q1','q2','q0');
  assert.deepEqual(copies,[]);
  assert.equal(pastes,0);
  console.log('Quick-panel up/down drag, main-window synchronization and reloaded order passed.');

  const pin = await point('[data-pin-note="q1"]');
  await mouse('mouseMoved',await card('q1'));
  await mouse('mouseMoved',pin);
  await frame();
  assert.equal(await read(`document.elementFromPoint(${pin.x},${pin.y})?.closest('[data-pin-note]')?.dataset.pinNote`), 'q1');
  await mouse('mousePressed',pin,true);
  await mouse('mouseReleased',pin);
  await until(()=>read("document.querySelector('[data-pin-note=\"q1\"]')?.classList.contains('active')"),'row pin button');
  assert((await read('nativeAPI.getPinnedStickyIds()')).includes('q1'));
  assert.deepEqual(copies,[]);
  assert.equal(pastes,0);
  const press = await card('q2');
  const release = {x:press.x+1,y:press.y+1};
  await mouse('mouseMoved',press);
  await mouse('mousePressed',press,true);
  await mouse('mouseMoved',release,true);
  await mouse('mouseReleased',release);
  await until(()=>pastes===1,'short movement kept click-to-paste');
  assert.deepEqual(copies,['快捷收藏2']);
  await expectTop('q1','q2','q0');
  console.log('Drag caused zero copy/paste commands; pin toggled the real sticky and a 1px click copied/pasted once.');
}

verify().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
