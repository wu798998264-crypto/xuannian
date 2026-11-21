const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createZipFromDirectory, extractZipToDirectory } = require('./favorites-archive');
const {
  FAVORITES_BACKUP_FORMAT, createFavoritesBackupSnapshot, normalizeImportedFavorites,
  attachmentAssetPaths, rewriteAttachmentAsset, favoriteContentCounts,
} = require('./favorites-backup');

const legacyAssetDirs = ['xuannian-assets', 'clipboard-images', 'screenshots', 'drag-images'];

function findPackage(root) {
  const candidates = [];
  function visit(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const names = new Set(entries.filter(e => e.isFile()).map(e => e.name));
    if (names.has('manifest.json') || names.has('favorites-data.json')) {
      if (!names.has('manifest.json') || !names.has('favorites-data.json')) throw Error('收藏备份缺少清单或收藏数据文件。');
      candidates.push({ dir, legacy: false });
    } else if (names.has('xuannian-data.json')) {
      candidates.push({ dir, legacy: true });
    } else {
      for (const e of entries) {
        if (e.isDirectory() && !['__MACOSX', 'assets', ...legacyAssetDirs].includes(e.name)) visit(path.join(dir, e.name));
      }
    }
  }
  visit(root);
  if (candidates.length !== 1) throw Error(candidates.length ? '压缩包内有多份收藏备份，请选择单份备份。' : '未找到玄念收藏备份。');
  return candidates[0];
}

function readPackageJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw Error('收藏备份中的 ' + name + ' 无法读取。');
  }
}

function relativeAsset(value, legacy) {
  const parts = value.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  const index = legacy ? parts.findIndex(p => legacyAssetDirs.includes(p.toLowerCase())) : 0;
  if (index < 0 || (!legacy && parts[0] !== 'assets')) return '';
  const relative = parts.slice(index);
  if (relative.length < 2 || relative.some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) return '';
  return relative.join('/');
}

function findAsset(dir, relative) {
  if (!relative) return '';
  const exact = path.join(dir, relative);
  if (fs.existsSync(exact)) return exact;
  let current = dir;
  for (const segment of relative.split('/')) {
    if (!fs.statSync(current).isDirectory()) return '';
    const key = segment.normalize('NFC').toLowerCase();
    const matches = fs.readdirSync(current).filter(entry => entry.normalize('NFC').toLowerCase() === key);
    if (matches.length !== 1) return '';
    current = path.join(current, matches[0]);
  }
  return current;
}

function inlineBytes(item) {
  const url = [item.dataUrl, item.preview].find(s => typeof s === 'string' && s.startsWith('data:'));
  if (!url) return null;
  const match = /^data:([^,]*),(.*)$/s.exec(url);
  if (!match) throw Error('内嵌附件格式错误。');
  const buffer = /;base64$/i.test(match[1]) ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]));
  if (!buffer.length && match[2]) throw Error('内嵌附件无法解码。');
  return buffer;
}

function checkedCopy(source, target) {
  fs.cpSync(source, target, {
    recursive: true, errorOnExist: true, force: false,
    filter(entry) {
      const stat = fs.lstatSync(entry);
      if (!stat.isFile() && !stat.isDirectory()) throw Error('附件含链接或特殊文件：' + path.basename(entry));
      return true;
    },
  });
}

async function assetDigest(source) {
  const hash = crypto.createHash('sha256');
  const stat = fs.lstatSync(source);
  if (stat.isFile()) {
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
  } else if (stat.isDirectory()) {
    hash.update('directory\0');
    const entries = fs.readdirSync(source).map(name => [name.normalize('NFC'), name])
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const portableNames = new Set();
    for (const [name, actual] of entries) {
      const key = name.toLowerCase();
      if (portableNames.has(key) || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw Error('文件夹内的名称无法跨系统还原：' + name);
      }
      portableNames.add(key);
      const digest = await assetDigest(path.join(source, actual));
      hash.update(JSON.stringify([name, digest]) + '\n');
    }
  } else {
    throw Error('附件含链接或特殊文件：' + path.basename(source));
  }
  return hash.digest('hex');
}

function attachmentName(item, fallback) {
  let name = path.win32.basename(String(item.name || fallback || '附件')).normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '附件';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

async function eachAttachment(data, callback) {
  for (const note of data.notes) {
    for (const [i, item] of (note.attachments || []).entries()) {
      try {
        note.attachments[i] = await callback(item);
      } catch (error) {
        throw Error('收藏「' + (note.title || note.content?.slice(0, 24) || note.id) + '」的附件「'
          + (item?.name || '第 ' + (i + 1) + ' 项') + '」：' + error.message);
      }
    }
  }
}

async function exportFavoritesArchive(data, destination, tempDir, storageRoot) {
  const snapshot = createFavoritesBackupSnapshot(data);
  const root = fs.mkdtempSync(path.join(tempDir, 'xuannian-export-'));
  let outputDir;
  try {
    const assets = path.join(root, 'assets');
    fs.mkdirSync(assets);
    const digests = {};
    const copied = new Map();
    let sequence = 0;
    await eachAttachment(snapshot.data, async item => {
      const candidates = attachmentAssetPaths(item);
      const local = candidates.flatMap(value => {
        const relative = relativeAsset(value, true);
        return [value, ...(relative ? [path.join(storageRoot, relative)] : [])];
      });
      const source = local.find(p => path.isAbsolute(p) && fs.existsSync(p));
      let relative = source && copied.get(source);
      const name = attachmentName(item, source);
      if (!relative) {
        const ext = path.extname(name) || path.extname(source || '');
        relative = 'assets/' + (++sequence) + (/^\.[a-z0-9]{1,15}$/i.test(ext) ? ext.toLowerCase() : '');
        const target = path.join(root, relative);
        if (source) {
          checkedCopy(source, target);
          copied.set(source, relative);
        } else {
          const buffer = inlineBytes(item);
          if (!buffer) throw Error('找不到原文件，请在源电脑恢复或重新添加附件后导出。');
          fs.writeFileSync(target, buffer);
        }
        digests[relative] = await assetDigest(target);
      }
      return rewriteAttachmentAsset({ ...item, name: item.name || name }, relative);
    });
    const counts = favoriteContentCounts(snapshot.data);
    const { format, version, exportedAt } = snapshot;
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ format, version, exportedAt, counts, digests }));
    fs.writeFileSync(path.join(root, 'favorites-data.json'), JSON.stringify(snapshot.data));
    fs.writeFileSync(path.join(root, 'README.txt'), '玄念收藏数据包\r\n请在玄念“设置 > 收藏导入”中选择此 ZIP 文件。', 'utf8');
    outputDir = fs.mkdtempSync(path.join(path.dirname(destination), '.xuannian-backup-'));
    const archive = path.join(outputDir, 'favorites.zip');
    createZipFromDirectory(root, archive);
    fs.renameSync(archive, destination);
    return counts;
  } finally {
    if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function importFavoritesArchive(archive, tempDir, importedRoot) {
  const root = fs.mkdtempSync(path.join(tempDir, 'xuannian-import-'));
  let pending;
  try {
    extractZipToDirectory(archive, root);
    const { dir, legacy } = findPackage(root);
    const manifest = legacy ? null : readPackageJson(dir, 'manifest.json');
    if (!legacy && manifest?.format !== FAVORITES_BACKUP_FORMAT) throw Error('这不是有效的玄念收藏备份。');
    const raw = readPackageJson(dir, legacy ? 'xuannian-data.json' : 'favorites-data.json');
    const data = normalizeImportedFavorites(legacy ? raw : { format: manifest.format, version: manifest.version, data: raw });
    const files = new Map();
    const digestCache = new Map();
    let inlineCount = 0;
    await eachAttachment(data, async item => {
      let relative;
      let source;
      for (const value of attachmentAssetPaths(item)) {
        relative = relativeAsset(value, legacy);
        source = findAsset(dir, relative);
        if (source) break;
      }
      if (!source) {
        const bytes = inlineBytes(item);
        if (!bytes) throw Error('备份内缺少原文件，请从源电脑重新导出完整收藏。');
        pending ||= fs.mkdtempSync(path.join(tempDir, 'xuannian-inline-'));
        source = path.join(pending, String(++inlineCount));
        fs.writeFileSync(source, bytes);
      }
      const digest = digestCache.get(source) || await assetDigest(source);
      digestCache.set(source, digest);
      if (manifest?.digests && manifest.digests[relative] !== digest) throw Error('附件内容校验失败，请重新传输收藏备份。');
      let name = attachmentName(item, relative);
      const extension = path.extname(relative || '') || (item.ext ? '.' + item.ext : '');
      if (!path.extname(name) && /^\.[a-z0-9]{1,15}$/i.test(extension) && fs.statSync(source).isFile()) name += extension;
      let target = path.join(importedRoot, digest, name);
      // An imported attachment may have been edited in place since the previous import.
      for (let i = 1; fs.existsSync(target) && await assetDigest(target) !== digest; i++) {
        target = path.join(importedRoot, digest + '-' + i, name);
      }
      files.set(target, source);
      return rewriteAttachmentAsset({ ...item, name: item.name || name, assetSha256: digest }, target);
    });
    // Validate every reference before installing any attachment or merging any note.
    for (const [target, source] of files) {
      if (fs.existsSync(target)) continue;
      const parent = path.dirname(target);
      fs.mkdirSync(parent, { recursive: true });
      const staging = fs.mkdtempSync(path.join(parent, '.staging-'));
      try {
        const staged = path.join(staging, 'item');
        checkedCopy(source, staged);
        fs.renameSync(staged, target);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }
    return data;
  } finally {
    if (pending) fs.rmSync(pending, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { exportFavoritesArchive, importFavoritesArchive };
