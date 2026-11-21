const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createZipFromDirectory, extractZipToDirectory } = require('../src/favorites-archive');
const {
  createFavoritesBackupSnapshot,
  normalizeImportedFavorites,
  rewriteFavoriteAssetPaths,
} = require('../src/favorites-backup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-archive-test-'));
const command = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';

// Small USTAR fixtures exercise the real native archive reader without needing
// symlink permissions on Windows or touching files outside this test directory.
function tarFixture(name, type = '0', link = '') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  const field = (value, offset, length) => header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
  field(type === '5' ? 0o755 : 0o644, 100, 8);
  field(0, 108, 8);
  field(0, 116, 8);
  field(0, 124, 12);
  field(0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write(link, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, Buffer.alloc(1024)]);
}

try {
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  const reference = Buffer.from('prompt reference attachment\n', 'utf8');
  fs.writeFileSync(path.join(source, 'assets', '参考图.txt'), reference);
  const snapshot = createFavoritesBackupSnapshot({
    noteProjects: [{ id: 'project', name: '画面提示词' }],
    notes: [{ id: 'prompt', projectId: 'project', title: '夕阳', content: '电影感，中文与 emoji 🌄', attachments: [{ kind: 'file', path: 'assets/参考图.txt' }] }],
  });
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ format: snapshot.format, version: snapshot.version }));
  fs.writeFileSync(path.join(source, 'favorites-data.json'), JSON.stringify(snapshot.data));

  const zipPart = path.join(root, 'current.zip.part');
  createZipFromDirectory(source, zipPart);
  assert(fs.existsSync(zipPart), 'export must create exactly the requested temporary filename');
  assert.strictEqual(fs.readFileSync(zipPart).subarray(0, 4).toString('hex'), '504b0304', '.zip.part exports must contain a real ZIP');

  const legacy = path.join(root, 'legacy-windows.zip');
  const legacyPart = path.join(root, 'legacy-windows.zip.part');
  execFileSync(command, [process.platform === 'win32' ? '--format=ustar' : '--format=pax', '-c', '-f', legacyPart, '-C', source, '.'], { windowsHide: true });
  assert.notStrictEqual(fs.readFileSync(legacyPart).subarray(0, 2).toString(), 'PK', 'fixture must reproduce the old Windows TAR payload');
  fs.renameSync(legacyPart, legacy);

  for (const [index, archive] of [zipPart, legacy].entries()) {
    const destination = path.join(root, `import-${index}`);
    // Match main.js, which passes a freshly created mkdtemp directory.
    fs.mkdirSync(destination);
    extractZipToDirectory(archive, destination);
    const data = JSON.parse(fs.readFileSync(path.join(destination, 'favorites-data.json'), 'utf8'));
    const target = path.join(destination, 'assets', '参考图.txt');
    const imported = normalizeImportedFavorites(rewriteFavoriteAssetPaths({ ...snapshot, data }, new Map([['assets/参考图.txt', target]])));
    assert.strictEqual(imported.notes[0].content, snapshot.data.notes[0].content);
    assert.strictEqual(imported.noteProjects[0].name, '画面提示词');
    assert.strictEqual(imported.notes[0].attachments[0].path, target);
    assert.deepStrictEqual(fs.readFileSync(target), reference);
  }

  for (const [index, [name, type, link]] of [
    ['../escaped.txt', '0', ''],
    ['/absolute.txt', '0', ''],
    ['C:/outside.txt', '0', ''],
    ['assets/../../escaped.txt', '0', ''],
    ['assets/link', '2', '../../outside'],
    ['assets/hardlink', '1', '../outside'],
  ].entries()) {
    const archive = path.join(root, `unsafe-${index}.zip`);
    const destination = path.join(root, `rejected-${index}`);
    fs.writeFileSync(archive, tarFixture(name, type, link));
    assert.throws(() => extractZipToDirectory(archive, destination), /不安全|链接|文件列表/, `unsafe archive must be rejected before extraction: ${name}`);
    assert(!fs.existsSync(destination), 'unsafe archives must not create an extraction directory');
  }
  console.log('favorites archive tests passed: real .zip.part ZIP, legacy Windows TAR, Unicode prompts, attachments and unsafe members');
} finally {
  const resolvedRoot = path.resolve(root);
  if (path.dirname(resolvedRoot) !== path.resolve(os.tmpdir()) || !path.basename(resolvedRoot).startsWith('xuannian-archive-test-')) {
    throw new Error('Refusing to remove an unexpected archive test directory.');
  }
  fs.rmSync(root, { recursive: true, force: true });
}
