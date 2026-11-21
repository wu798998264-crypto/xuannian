const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { hasLegacyGbkNames } = require('../src/favorites-zip-encoding');
const { extractZipToDirectory } = require('../src/favorites-archive');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xn-zip-encoding-'));
const payload = Buffer.from('中文文件内容 🌄\n');
const gbkName = Buffer.from('6173736574732fd6d0cec42e62696e', 'hex'); // assets/中文.bin in CP936
const utf8Name = Buffer.from('assets/中文.bin');

// Create a genuine one-file stored ZIP without relying on the host's active code page.
// The raw name must remain identical between the local and central headers.
function fixture(id, name, { utf8Flag = 0, unicode = '', zip64 = false } = {}) {
  const filename = path.join(root, id + '.zip');
  const unicodeBytes = Buffer.from(unicode);
  const extra = unicode ? Buffer.alloc(9 + unicodeBytes.length) : Buffer.alloc(0);
  if (unicode) {
    extra.writeUInt16LE(0x7075, 0);
    extra.writeUInt16LE(extra.length - 4, 2);
    extra[4] = 1;
    extra.writeUInt32LE(crc32(name), 5);
    unicodeBytes.copy(extra, 9);
  }
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(utf8Flag, 6);
  local.writeUInt32LE(crc32(payload), 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const prefix = Buffer.concat([local, name, extra, payload]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  local.copy(central, 6, 4, 30);
  const directory = Buffer.concat([central, name, extra]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : 1, 8);
  end.writeUInt16LE(zip64 ? 0xffff : 1, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : prefix.length, 16);
  const extension = zip64 ? Buffer.alloc(56 + 20) : Buffer.alloc(0);
  if (zip64) {
    extension.writeUInt32LE(0x06064b50, 0);
    extension.writeBigUInt64LE(44n, 4);
    extension.writeUInt16LE(45, 12);
    extension.writeUInt16LE(45, 14);
    extension.writeBigUInt64LE(1n, 24);
    extension.writeBigUInt64LE(1n, 32);
    extension.writeBigUInt64LE(BigInt(directory.length), 40);
    extension.writeBigUInt64LE(BigInt(prefix.length), 48);
    extension.writeUInt32LE(0x07064b50, 56);
    extension.writeBigUInt64LE(BigInt(prefix.length + directory.length), 64);
    extension.writeUInt32LE(1, 72);
  }
  fs.writeFileSync(filename, Buffer.concat([prefix, directory, extension, end]));
  return filename;
}

try {
  const classic = fixture('legacy', gbkName);
  assert(hasLegacyGbkNames(classic));
  assert(hasLegacyGbkNames(fixture('zip64', gbkName, { zip64: true })));
  assert(hasLegacyGbkNames(fixture('unicode', gbkName, { unicode: 'assets/中文.bin' })));
  assert(!hasLegacyGbkNames(fixture('unrelated-unicode', gbkName, { unicode: 'assets/unrelated.bin' })));
  assert(!hasLegacyGbkNames(fixture('ascii', Buffer.from('assets/a.bin'))));
  assert(!hasLegacyGbkNames(fixture('utf8', utf8Name)));
  assert(!hasLegacyGbkNames(fixture('flagged', utf8Name, { utf8Flag: 0x0800 })));
  const truncated = path.join(root, 'truncated.zip');
  fs.writeFileSync(truncated, fs.readFileSync(classic).subarray(0, 18));
  assert(!hasLegacyGbkNames(truncated));

  const dest = path.join(root, 'restored');
  extractZipToDirectory(classic, dest);
  assert.deepEqual(fs.readFileSync(path.join(dest, 'assets', '中文.bin')), payload);
  console.log('PASS legacy CP936 ZIP filenames, ZIP64 directory, UTF-8 flags and Unicode extra fields');
} finally {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('xn-zip-encoding-')) throw Error('Unexpected temporary test path');
  fs.rmSync(root, { recursive: true, force: true });
}
