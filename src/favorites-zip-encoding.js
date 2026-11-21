const fs = require('node:fs');
const { crc32 } = require('node:zlib');
const { isUtf8 } = require('node:buffer');

const maxDirectoryBytes = 16 * 1024 * 1024;
const gbk = new TextDecoder('gbk', { fatal: true });

function read(fd, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid ZIP offset');
  const bytes = Buffer.alloc(length);
  if (fs.readSync(fd, bytes, 0, length, offset) !== length) throw Error('Truncated ZIP directory');
  return bytes;
}

function centralDirectory(fd) {
  const size = fs.fstatSync(fd).size;
  // The standard end record has a 22-byte header and at most 65535 bytes of comment.
  const start = Math.max(0, size - 65557);
  const end = read(fd, start, size - start);
  for (let i = end.length - 22; i >= 0; i--) {
    if (end.readUInt32LE(i) !== 0x06054b50 || i + 22 + end.readUInt16LE(i + 20) !== end.length) continue;
    if (end.readUInt32LE(i + 4) !== 0 || end.readUInt16LE(i + 8) !== end.readUInt16LE(i + 10)) return null;
    let count = end.readUInt16LE(i + 10);
    let length = end.readUInt32LE(i + 12);
    let offset = end.readUInt32LE(i + 16);
    if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
      const locator = read(fd, start + i - 20, 20);
      if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) || locator.readUInt32LE(16) !== 1) return null;
      const record = read(fd, Number(locator.readBigUInt64LE(8)), 56);
      if (record.readUInt32LE(0) !== 0x06064b50 || record.readBigUInt64LE(4) < 44n
        || record.readBigUInt64LE(16) !== 0n || record.readBigUInt64LE(24) !== record.readBigUInt64LE(32)) return null;
      count = Number(record.readBigUInt64LE(32));
      length = Number(record.readBigUInt64LE(40));
      offset = Number(record.readBigUInt64LE(48));
    }
    if (length > maxDirectoryBytes || count > length / 46 || offset + length > start + i) return null;
    return { count, bytes: read(fd, offset, length) };
  }
  return null;
}

// Info-ZIP's Unicode Path extra field contains a UTF-8 name and the CRC of
// the original encoded name. Only a matching CRC describes this entry.
function unicodePath(extra, name) {
  for (let i = 0; i + 4 <= extra.length;) {
    const tag = extra.readUInt16LE(i);
    const length = extra.readUInt16LE(i + 2);
    const next = i + 4 + length;
    if (next > extra.length) throw Error('Invalid ZIP extra field');
    if (tag === 0x7075 && length > 5 && extra[i + 4] === 1 && extra.readUInt32LE(i + 5) === crc32(name)) {
      const bytes = extra.subarray(i + 9, next);
      if (isUtf8(bytes)) return bytes.toString('utf8');
    }
    i = next;
  }
  return '';
}

function hasLegacyGbkNames(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const directory = centralDirectory(fd);
    if (!directory) return false;
    let foundGbk = false;
    let foundUtf8 = false;
    let offset = 0;
    for (let i = 0; i < directory.count; i++) {
      const { bytes } = directory;
      if (bytes.readUInt32LE(offset) !== 0x02014b50) return false;
      const utf8Flag = bytes.readUInt16LE(offset + 8) & 0x0800;
      const nameStart = offset + 46;
      const nameEnd = nameStart + bytes.readUInt16LE(offset + 28);
      const extraEnd = nameEnd + bytes.readUInt16LE(offset + 30);
      offset = extraEnd + bytes.readUInt16LE(offset + 32);
      if (offset > bytes.length) return false;
      const name = bytes.subarray(nameStart, nameEnd);
      if (utf8Flag || !name.some(byte => byte >= 0x80)) continue;
      const unicode = unicodePath(bytes.subarray(nameEnd, extraEnd), name);
      if (isUtf8(name) && (!unicode || unicode === name.toString('utf8'))) {
        foundUtf8 = true;
      } else {
        const decoded = gbk.decode(name);
        if (unicode ? decoded !== unicode : !/\p{Script=Han}/u.test(decoded)) return false;
        foundGbk = true;
      }
    }
    // An archive-wide override would damage unflagged UTF-8 entries in a mixed archive.
    return foundGbk && !foundUtf8;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { hasLegacyGbkNames };
