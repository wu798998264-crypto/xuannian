const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  parseDelimited,
  parseEverythingCsv,
  normalizeQuery,
  normalizeOptions,
  fileTypeForPath,
  matchesResultType,
  fileSearchTermForType,
  buildWindowsServiceInstallScript,
  compareResults,
  constants,
} = require('../src/file-search');

function verifyParsers() {
  assert.strictEqual(normalizeQuery('  report\0\n2026  '), 'report 2026');
  assert.strictEqual(normalizeQuery('x'.repeat(400)).length, constants.MAX_QUERY_LENGTH);
  assert.deepStrictEqual(normalizeOptions({ type: 'folder', sort: 'modified', direction: 'desc', limit: 99999 }), {
    type: 'folder', sort: 'modified', direction: 'desc', limit: constants.MAX_RESULTS,
  });
  assert.strictEqual(normalizeOptions({ type: 'image' }).type, 'image');
  assert.strictEqual(normalizeOptions({ type: 'video' }).type, 'video');
  assert.strictEqual(normalizeOptions({ type: 'audio' }).type, 'audio');
  assert.strictEqual(normalizeOptions({ type: 'document' }).type, 'document');
  assert.strictEqual(normalizeOptions({ type: 'archive' }).type, 'all');
  assert.strictEqual(fileTypeForPath('C:\\Media\\photo.HEIC'), 'image');
  assert.strictEqual(fileTypeForPath('C:\\Media\\clip.mkv'), 'video');
  assert.strictEqual(fileTypeForPath('C:\\Media\\song.flac'), 'audio');
  assert.strictEqual(fileTypeForPath('C:\\Media\\report.docx'), 'document');
  assert.strictEqual(fileTypeForPath('C:\\Media\\notes.bin'), '');
  assert.strictEqual(matchesResultType({ kind: 'file', path: 'C:\\Media\\photo.png' }, 'image'), true);
  assert.strictEqual(matchesResultType({ kind: 'file', path: 'C:\\Media\\photo.png' }, 'video'), false);
  assert.strictEqual(matchesResultType({ kind: 'folder', path: 'C:\\Media' }, 'folder'), true);
  assert(fileSearchTermForType('image').startsWith('ext:jpg;jpeg;'));
  assert(fileSearchTermForType('video').includes(';mkv;'));
  assert(fileSearchTermForType('audio').includes(';flac;'));
  assert(fileSearchTermForType('document').includes(';docx;'));
  assert(fileSearchTermForType('document').includes(';pdf;'));
  assert.strictEqual(fileSearchTermForType('folder'), '');
  const setupScript = buildWindowsServiceInstallScript("C:\\Program Files\\玄念's\\玄念全盘查找初始化.exe", 'C:\\Users\\Test User\\Everything.exe');
  assert(setupScript.includes("Start-Process -FilePath 'C:\\Program Files\\玄念''s\\玄念全盘查找初始化.exe'"));
  assert(setupScript.includes("@('--install-service-base64',"));
  assert(!setupScript.includes("Start-Process -FilePath 'C:\\Users\\Test User\\Everything.exe'"));
  const encodedPath = setupScript.match(/--install-service-base64','([^']+)'/)?.[1] || '';
  assert.strictEqual(Buffer.from(encodedPath, 'base64').toString('utf8'), 'C:\\Users\\Test User\\Everything.exe');
  assert.deepStrictEqual(parseDelimited('name,path\r\n"a,b.txt","C:\\One"\r\n'), [
    ['name', 'path'], ['a,b.txt', 'C:\\One'],
  ]);

  const csv = [
    'Name,Path,Size,Date Modified,Attributes',
    '"report, final.txt","C:\\Work",128,2026-07-19 12:30,A',
    'Projects,"D:\\Data",,,D',
  ].join('\r\n');
  const results = parseEverythingCsv(csv);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].path, 'C:\\Work\\report, final.txt');
  assert.strictEqual(results[0].kind, 'file');
  assert.strictEqual(results[0].size, 128);
  assert.strictEqual(results[1].kind, 'folder');
  assert.strictEqual(results[1].size, null);
  assert(compareResults(results[0], results[1], 'name', 'asc') > 0);
}

function verifyWindowsHelperStarts() {
  if (process.platform !== 'win32') return Promise.resolve();
  const helper = path.join(__dirname, '..', 'src', 'native', 'XuanNianFileSearchHelper.exe');
  const setupHelper = path.join(__dirname, '..', 'src', 'native', 'XuanNianSearchSetup.exe');
  assert(fs.existsSync(helper), `missing native file-search helper: ${helper}`);
  assert(fs.existsSync(setupHelper), `missing native search setup helper: ${setupHelper}`);
  const invalidSetup = spawnSync(setupHelper, ['--invalid'], { windowsHide: true, timeout: 3000 });
  assert.strictEqual(invalidSetup.status, 64, 'search setup helper must reject unsupported commands');
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('native file-search helper did not become ready'));
    }, 3000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!/(^|\r?\n)READY\r?\n/.test(output)) return;
      clearTimeout(timer);
      child.stdin.write('EXIT\n');
      resolve();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function run() {
  verifyParsers();
  await verifyWindowsHelperStarts();
  console.log('file-search checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
