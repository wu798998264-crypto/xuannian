const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectId = 'transfer-test-project';
const projectName = '跨电脑收藏分类';
const sourceContent = '跨电脑提示词\n保留换行、空格与中文 🎵';
const plainPrompt = '可复制的纯文本提示词\n保留换行 🎵';
const localContent = '接收机原有收藏';
const imageName = '收藏 #50% 图片 🎵.png';
const fileName = '包含 # 和 %.bin';
const folderName = '参考 #50% 🎵';
const nestedName = '子目录/内容 🎵 %.bin';
const imageBytes = fs.readFileSync(path.join(__dirname, '../src/xuannian-logo-256.png'));
const binaryBytes = Buffer.from([0, 9, 35, 37, 127, 128, 254, 255]);
const otherBytes = Buffer.from([255, 254, 128, 127, 37, 35, 9, 0]);
let closingTestInstance = false;

function runDriver(mode, archive) {
  assert(['export', 'import'].includes(mode), 'Use export|import <archive.zip>');
  if (mode === 'export') {
    assert(!fs.existsSync(archive), 'Choose a new path for this synthetic backup');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
  } else {
    assert(fs.statSync(archive).isFile());
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-favorites-transfer-'));
  // Each origin/destination is a separate installation profile. Special characters in the
  // receiving path also exercise conversion of native paths into renderer preview URLs.
  const profile = path.join(root, '测试电脑 #50%');
  fs.mkdirSync(profile);
  const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const operation of mode === 'import' ? ['import', 'verify'] : ['export']) {
      const child = spawnSync(require('electron'), [__filename, operation, archive, profile], {
        env, encoding: 'utf8', timeout: 150000, windowsHide: true,
      });
      if (child.stdout) process.stdout.write(child.stdout);
      if (child.stderr) process.stderr.write(child.stderr);
      if (child.error || child.status !== 0) {
        const diagnostic = path.join(profile, 'transfer-test.log');
        if (fs.existsSync(diagnostic)) process.stderr.write(fs.readFileSync(diagnostic, 'utf8'));
      }
      if (child.error) throw child.error;
      // Electron 42 can emit SIGTRAP after app.exit(0) on the macOS hosted runner.
      // Assertions run before that shutdown signal and a nonzero app.exit remains a failure.
      const macShutdownTrap = process.platform === 'darwin' && child.signal === 'SIGTRAP';
      assert(child.status === 0 || macShutdownTrap, `Electron ${operation} failed (${child.signal || child.status})`);
    }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    console.log(`${process.platform} ${process.arch} ${mode} archive SHA256 ${sha}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function waitFor(read, label) {
  const deadline = Date.now() + 30000;
  do {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

async function runElectron(mode, archive, profile) {
  const { app, clipboard, dialog, shell, webContents } = require('electron');
  const trace = message => fs.appendFileSync(path.join(profile, 'transfer-test.log'), message + '\n');
  trace(`Starting ${mode} using Electron ${process.versions.electron}`);
  const fail = error => {
    if (closingTestInstance) return;
    closingTestInstance = true;
    trace(String(error?.stack || error));
    app.exit(1);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  // The archive module captures the real system ZIP/tar tool. Isolate every other native
  // subprocess before production startup (registry, auto-start, clipboard and hotkeys).
  require('../src/favorites-archive');
  require('./isolate-media-probe')(profile);
  let copiedText;
  clipboard.writeText = value => { copiedText = value; };
  if (process.platform === 'win32') {
    // Production subscribes to stdout on the hotkey helper at startup. Keep the
    // native clipboard and global input hooks disconnected throughout the test.
    const child = require('node:child_process');
    const isolatedSpawn = child.spawn;
    child.spawn = (binary, args, ...rest) => {
      if (path.basename(binary) !== 'XuanNianClipboardHelper.exe' || !['hotkeys', 'watch'].includes(args[0])) {
        return isolatedSpawn(binary, args, ...rest);
      }
      const stub = new (require('node:events').EventEmitter)();
      stub.stdout = new (require('node:stream').PassThrough)();
      stub.kill = () => { stub.stdout.end(); stub.killed = true; stub.emit('exit', 0); };
      return stub;
    };
  }
  app.setName('XuanNianFavoritesTransferTest');
  app.disableHardwareAcceleration();
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: archive });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
  shell.showItemInFolder = selected => assert.equal(path.resolve(selected), archive);
  require('../src/main');
  trace('Loaded production main process');
  await app.whenReady();
  trace('Electron ready');
  const page = await waitFor(() => webContents.getAllWebContents().find(item =>
    !item.isLoading() && /\/index\.html(?:$|[?#])/.test(item.getURL())), 'production favorites interface');
  const evaluate = script => page.executeJavaScript(script);
  trace('Production renderer ready');
  await evaluate("localStorage.setItem('xuannian.onboarding.first-run.v1', 'seen')");
  await waitFor(() => evaluate(`document.querySelector('[data-view="notes"]').click();
    Boolean(document.querySelector('[data-project-id]'));`), 'initial favorites view');

  if (mode !== 'verify') {
    const source = mode === 'export';
    const attachments = [];
    if (source) {
      const image = path.join(profile, imageName);
      const file = path.join(profile, fileName);
      const otherFile = path.join(profile, '同名文件', fileName);
      const folder = path.join(profile, folderName);
      const nestedFile = path.join(folder, nestedName);
      fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
      fs.mkdirSync(path.dirname(otherFile));
      fs.writeFileSync(image, imageBytes);
      fs.writeFileSync(file, binaryBytes);
      fs.writeFileSync(otherFile, otherBytes);
      fs.writeFileSync(nestedFile, binaryBytes);
      attachments.push({ kind: 'image', name: imageName, path: image },
        { kind: 'file', name: fileName, path: file }, { kind: 'file', name: fileName, path: otherFile },
        { kind: 'folder', name: folderName, path: folder });
    }
    const project = { id: projectId, name: source ? projectName : '接收机原有分类' };
    const note = { id: 'same-note-id', projectId, type: 'text', content: source ? sourceContent : localContent, attachments };
    await evaluate(`nativeAPI.addNoteProject(${JSON.stringify(project)})`);
    await evaluate(`nativeAPI.addNote(${JSON.stringify(note)})`);
    if (source) {
      await evaluate(`nativeAPI.addNote(${JSON.stringify({ projectId, type: 'text', content: plainPrompt })})`);
    }
    await evaluate(`document.querySelector('[data-view="settings"]').click()`);
    for (let attempt = 0; attempt < (source ? 1 : 2); attempt++) {
      await evaluate(`document.querySelector('#toast').textContent = '';
        document.querySelector('#${source ? 'export' : 'import'}UserData').click();`);
      if (!source) {
        await waitFor(() => evaluate("document.querySelector('#confirmModal')?.textContent.includes('选择导入包')"), 'import confirmation');
        await evaluate("document.querySelector('#confirmModal').click()");
      }
      const expected = source ? '已导出' : '已导入';
      await waitFor(async () => {
        const feedback = await evaluate(`({toast: document.querySelector('#toast')?.textContent,
          error: document.querySelector('.modal-header h3')?.textContent.includes('失败') && document.querySelector('.modal-message')?.textContent})`);
        if (feedback.error) throw Error(feedback.error);
        return feedback.toast?.includes(expected);
      }, `application ${mode} result`);
    }
    if (source) {
      assert.equal(fs.readFileSync(archive).subarray(0, 4).toString('hex'), '504b0304', 'must emit standard ZIP data');
      return;
    }
  }

  const notes = await evaluate('nativeAPI.getNotes()');
  const projects = await evaluate('nativeAPI.getNoteProjects()');
  const incoming = notes.find(note => note.content === sourceContent);
  const existing = notes.find(note => note.content === localContent);
  const textOnly = notes.find(note => note.content === plainPrompt);
  for (const content of [sourceContent, plainPrompt, localContent]) {
    assert.equal(notes.filter(note => note.content === content).length, 1, 'repeated import must retain exactly one copy of each note');
  }
  assert.equal(projects.filter(p => p.name === projectName).length, 1);
  assert(incoming && existing, 'both imported and existing favorites must survive');
  assert.equal(projects.find(p => p.id === incoming.projectId)?.name, projectName);
  assert.equal(projects.find(p => p.id === existing.projectId)?.name, '接收机原有分类');
  const expectedAttachments = [[imageName, imageBytes], [fileName, binaryBytes], [fileName, otherBytes], [folderName, binaryBytes]];
  assert.equal(incoming.attachments.length, expectedAttachments.length);
  for (const [index, [name, bytes]] of expectedAttachments.entries()) {
    const attachment = incoming.attachments[index];
    assert.equal(attachment.name, name);
    assert(attachment?.path, `missing receiver-local path for ${name}`);
    const relative = path.relative(profile, attachment.path);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `must use receiver storage: ${attachment.path}`);
    const target = name === folderName ? path.join(attachment.path, nestedName) : attachment.path;
    assert.deepEqual(fs.readFileSync(target), bytes, `received bytes for ${name}`);
  }
  await evaluate(`document.querySelector('[data-view="notes"]').click();
    document.querySelector('[data-project-id="' + CSS.escape(${JSON.stringify(incoming.projectId)}) + '"]').click();`);
  const preview = await evaluate(`(async () => {
    const card = document.querySelector('[data-note-card="' + CSS.escape(${JSON.stringify(incoming.id)}) + '"]');
    const image = card?.querySelector('img.previewable-image');
    if (!image) throw Error('Favorite card has no image');
    image.loading = 'eager';
    try { await image.decode(); } catch (error) { throw Error('Favorite preview failed: ' + image.src + ' (' + error + ')'); }
    return {width: image.naturalWidth, height: image.naturalHeight, content: card.querySelector('.record-title')?.textContent};
  })()`);
  assert.equal(preview.content, sourceContent);
  assert.equal(preview.width, imageBytes.readUInt32BE(16));
  assert.equal(preview.height, imageBytes.readUInt32BE(20));
  await evaluate(`document.querySelector('[data-note-card="' + CSS.escape(${JSON.stringify(textOnly.id)}) + '"]').click()`);
  await waitFor(() => copiedText === plainPrompt, 'copying the imported prompt card into the isolated clipboard');
  console.log(`${process.platform} Electron ${process.versions.electron} ${mode}: duplicate import, ID collisions, copied prompt, decoded PNG ${preview.width}x${preview.height}, same-name binaries and nested folder verified`);
}

const [mode, inputPath, profile] = process.argv.slice(2);
if (process.versions.electron) {
  const { app } = require('electron');
  runElectron(mode, path.resolve(inputPath), profile).then(() => {
    // app.exit tears down all WebContents, including unused warm-up windows that
    // may still be loading. Results above are final before this point.
    closingTestInstance = true;
    app.exit(0);
  }).catch(error => { closingTestInstance = true; console.error(error); app.exit(1); });
} else {
  runDriver(mode, path.resolve(inputPath));
}
