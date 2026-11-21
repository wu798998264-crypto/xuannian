const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createZipFromDirectory, extractZipToDirectory } = require('../src/favorites-archive');
const { exportFavoritesArchive, importFavoritesArchive } = require('../src/favorites-package');
const { FAVORITES_BACKUP_FORMAT, mergeImportedFavorites } = require('../src/favorites-backup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xn-favorites-package-'));
const sender = path.join(root, 'sender');
const receiver = path.join(root, 'receiver');
const local = { noteProjects: [{ id: 'p', name: '本机分类' }], notes: [{ id: '1', projectId: 'p', content: '本机内容' }] };
const zip = path.join(root, 'transfer.zip');
const failures = [];

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function fixture(name, files) {
  const dir = path.join(root, name);
  for (const [entry, bytes] of Object.entries(files)) write(path.join(dir, 'nested', 'backup', entry), bytes);
  const file = path.join(root, name + '.zip');
  createZipFromDirectory(dir, file);
  return file;
}

const favorite = attachments => ({
  noteProjects: [{ id: 'p', name: '源分类' }],
  notes: [{ id: '1', projectId: 'p', content: '保留换行\n下一段 🌄', attachments }],
});

async function check(name, run) {
  try {
    await run();
    console.log('PASS ' + name);
  } catch (err) {
    failures.push(err);
    console.error('FAIL ' + name + '\n' + err.stack);
  }
}

async function main() {
  await check('same-name files with distinct bytes, backup replacement, missing source, repeat import', async () => {
    const files = [Buffer.from([0, 1, 254]), Buffer.from([0, 2, 255])];
    const items = files.map((bytes, i) => ({
      kind: 'file', name: '同名 #50%.bin', path: write(path.join(sender, String(i), 'source.bin'), bytes),
    }));
    // A successful re-export replaces an existing file, then a failed re-export must preserve that ZIP.
    await exportFavoritesArchive(favorite([]), zip, root, sender);
    await exportFavoritesArchive(favorite(items), zip, root, sender);
    const goodZip = fs.readFileSync(zip);
    fs.unlinkSync(items[1].path);
    await assert.rejects(exportFavoritesArchive(favorite(items), zip, root, sender), /原文件|附件/);
    assert.deepEqual(fs.readFileSync(zip), goodZip);
    fs.unlinkSync(items[0].path);
    const imported = await importFavoritesArchive(zip, root, receiver);
    const received = imported.notes[0].attachments;
    assert.notEqual(received[0].path, received[1].path);
    assert.notEqual(received[0].assetSha256, received[1].assetSha256);
    assert.deepEqual(received.map(a => fs.readFileSync(a.path)), files);
    assert(received.every(item => item.name === items[0].name));
    const merged = mergeImportedFavorites(local, imported);
    assert.equal(merged.notes.length, 2);
    assert.equal(merged.noteProjects.length, 2);
    const again = await importFavoritesArchive(zip, root, receiver);
    assert.deepEqual(mergeImportedFavorites(merged, again), merged);
    // Receiver-side edits must survive a later import of the unchanged source.
    fs.writeFileSync(received[0].path, 'edited locally');
    const restored = (await importFavoritesArchive(zip, root, receiver)).notes[0].attachments[0];
    assert.deepEqual(fs.readFileSync(restored.path), files[0]);
    assert.equal(fs.readFileSync(received[0].path, 'utf8'), 'edited locally');
  });

  await check('nested folder including emoji filenames and empty subdirectories', async () => {
    const folder = path.join(sender, 'folder');
    const nested = path.join('嵌套 🎵', '图 #50% 🌄.bin');
    write(path.join(folder, nested), Buffer.from([34, 16, 90]));
    fs.mkdirSync(path.join(folder, 'empty'));
    const archive = path.join(root, 'folder.zip');
    await exportFavoritesArchive(favorite([{ kind: 'folder', name: '目录 🎵', path: folder }]), archive, root, sender);
    fs.rmSync(folder, { recursive: true });
    const attachment = (await importFavoritesArchive(archive, root, receiver)).notes[0].attachments[0];
    assert.deepEqual(fs.readFileSync(path.join(attachment.path, nested)), Buffer.from([34, 16, 90]));
    assert(fs.statSync(path.join(attachment.path, 'empty')).isDirectory());
  });

  await check('legacy full-data ZIP in nested directory, BOM, Windows and Mac file references', async () => {
    const raw = favorite([
      { filePath: 'C:\\old\\xuannian-assets\\notes\\a.bin', name: 'win.bin' },
      { kind: 'image', dataUrl: 'file:////Users/old/clipboard-images/pic%20%2350%25.png', name: 'original.png' },
      { kind: 'folder', path: '/Users/old/xuannian-assets/notes/group', name: 'group' },
      { path: 'C:\\missing.jpg', dataUrl: 'data:image/jpeg;base64,AQI=', name: 'embedded.jpg', kind: 'image' },
    ]);
    raw.records = [{ id: 'unrelated', type: 'text', content: 'private' }];
    const archive = fixture('legacy', {
      'xuannian-data.json': '\uFEFF' + JSON.stringify(raw),
      'xuannian-assets/notes/a.bin': 'from Windows',
      'clipboard-images/pic #50%.png': 'from Mac',
      'xuannian-assets/notes/group/child.txt': 'child',
    });
    const data = await importFavoritesArchive(archive, root, receiver);
    assert(!Object.hasOwn(data, 'records'));
    const [win, mac, folder, inline] = data.notes[0].attachments;
    assert.equal(fs.readFileSync(win.path, 'utf8'), 'from Windows');
    assert.equal(win.filePath, win.path);
    assert.equal(fs.readFileSync(mac.path, 'utf8'), 'from Mac');
    assert.equal(mac.preview, pathToFileURL(mac.path).href);
    assert.equal(fs.readFileSync(path.join(folder.path, 'child.txt'), 'utf8'), 'child');
    assert.deepEqual(fs.readFileSync(inline.path), Buffer.from([1, 2]));
  });

  await check('legacy v2 sticky with only a backslash preview reference', async () => {
    const manifest = { format: FAVORITES_BACKUP_FORMAT, version: 2 };
    const raw = { stickyProjects: [{ id: 's', name: '以前的分类' }], stickyNotes: [
      { id: 'sticky', projectId: 's', content: '以前的收藏', attachments: [{ preview: 'assets\\old.png', kind: 'image' }] },
    ] };
    const archive = fixture('v2', {
      'manifest.json': '\uFEFF' + JSON.stringify(manifest), 'favorites-data.json': '\uFEFF' + JSON.stringify(raw), 'assets/old.png': 'legacy-sticky-bytes',
    });
    const restored = await importFavoritesArchive(archive, root, receiver);
    const image = restored.notes[0].attachments[0];
    assert.equal(restored.noteProjects.find(project => project.id === restored.notes[0].projectId).name, '以前的分类');
    assert.equal(image.preview, pathToFileURL(image.path).href);
    assert.equal(fs.readFileSync(image.path, 'utf8'), 'legacy-sticky-bytes');
  });

  await check('reject missing, foreign and tampered packages before installing any files', async () => {
    const extracted = path.join(root, 'corrupt-source');
    extractZipToDirectory(zip, extracted);
    const data = JSON.parse(fs.readFileSync(path.join(extracted, 'favorites-data.json')));
    write(path.join(extracted, data.notes[0].attachments[1].path), 'incorrect bytes');
    const damaged = path.join(root, 'corrupt.zip');
    createZipFromDirectory(extracted, damaged);
    const receiver2 = path.join(root, 'receiver2');
    await assert.rejects(importFavoritesArchive(damaged, root, receiver2), /校验/);
    assert(!fs.existsSync(receiver2));
    const manifest = JSON.stringify({ format: FAVORITES_BACKUP_FORMAT, version: 3 });
    const noAsset = fixture('lost', {
      'manifest.json': manifest,
      'favorites-data.json': JSON.stringify(favorite([{ path: 'assets/a.bin' }, { path: 'assets/lost.bin' }])),
      'assets/a.bin': 'first',
    });
    await assert.rejects(importFavoritesArchive(noAsset, root, receiver2), /缺少原文件/);
    assert(!fs.existsSync(receiver2));
    const unrelated = fixture('foreign', { 'manifest.json': '{"format":"other"}', 'favorites-data.json': '{}' });
    await assert.rejects(importFavoritesArchive(unrelated, root, receiver2), /备份/);
    assert(!fs.existsSync(receiver2));
  });
  if (failures.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('xn-favorites-package-')) throw Error('Unexpected temporary test path');
  fs.rmSync(root, { recursive: true, force: true });
});
