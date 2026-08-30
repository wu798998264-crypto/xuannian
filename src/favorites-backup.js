const path = require('path');

const FAVORITES_BACKUP_FORMAT = 'xuannian-favorites-backup';
const FAVORITES_BACKUP_VERSION = 2;
const FAVORITE_ARRAY_KEYS = [
  'noteProjects',
  'notes',
  'stickyProjects',
  'stickyNotes',
  'inspirationCategories',
  'inspirations',
];
const FAVORITE_ITEM_KEYS = ['notes', 'stickyNotes', 'inspirations'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickFavoritesData(source = {}) {
  return Object.fromEntries(FAVORITE_ARRAY_KEYS.map((key) => [
    key,
    Array.isArray(source?.[key]) ? clone(source[key]) : [],
  ]));
}

function createFavoritesBackupSnapshot(source = {}, options = {}) {
  return {
    format: FAVORITES_BACKUP_FORMAT,
    version: FAVORITES_BACKUP_VERSION,
    exportedAt: options.exportedAt || new Date().toISOString(),
    data: pickFavoritesData(source),
  };
}

function normalizeImportedFavorites(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('收藏备份数据无法读取。');
  if (raw.format === FAVORITES_BACKUP_FORMAT) {
    const version = Number(raw.version || 0);
    if (!version || version > FAVORITES_BACKUP_VERSION) {
      throw new Error(`收藏备份版本 ${raw.version || '未知'} 暂不受支持，请先更新玄念。`);
    }
    if (!raw.data || typeof raw.data !== 'object') throw new Error('收藏备份缺少 data 数据。');
    return pickFavoritesData(raw.data);
  }
  return pickFavoritesData(raw);
}

function fileUrlToPath(value = '') {
  if (!/^file:\/\//i.test(String(value || ''))) return '';
  try {
    let pathname = decodeURIComponent(new URL(String(value)).pathname || '');
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname.replace(/\//g, path.sep);
  } catch {
    return '';
  }
}

function attachmentSourcePath(attachment = {}) {
  const direct = String(attachment.path || attachment.filePath || '').trim();
  if (direct) return direct;
  return fileUrlToPath(attachment.preview || '');
}

function favoriteAttachments(data = {}) {
  const normalized = rawFavoritesData(data);
  const result = [];
  for (const key of FAVORITE_ITEM_KEYS) {
    for (const item of Array.isArray(normalized[key]) ? normalized[key] : []) {
      if (Array.isArray(item?.attachments)) result.push(...item.attachments.filter(Boolean));
    }
  }
  return result;
}

function rawFavoritesData(value = {}) {
  return value?.format === FAVORITES_BACKUP_FORMAT ? (value.data || {}) : value;
}

function normalizedPathKey(value = '') {
  return String(value || '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
}

function collectFavoriteAssetPaths(value = {}) {
  const seen = new Set();
  const result = [];
  for (const attachment of favoriteAttachments(value)) {
    const sourcePath = attachmentSourcePath(attachment);
    if (!sourcePath) continue;
    const key = normalizedPathKey(sourcePath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(sourcePath);
  }
  return result;
}

function assetLookup(assetMap) {
  const lookup = new Map();
  const entries = assetMap instanceof Map ? assetMap.entries() : Object.entries(assetMap || {});
  for (const [source, target] of entries) {
    if (!source || !target) continue;
    lookup.set(normalizedPathKey(source), String(target));
  }
  return lookup;
}

function mappedAssetReference(value, lookup) {
  const text = String(value || '');
  if (!text) return value;
  const sourcePath = fileUrlToPath(text) || text;
  return lookup.get(normalizedPathKey(sourcePath)) || value;
}

function rewriteAttachment(attachment, lookup) {
  if (!attachment || typeof attachment !== 'object') return attachment;
  const next = { ...attachment };
  for (const key of ['path', 'filePath', 'preview', 'originalPath']) {
    if (typeof next[key] === 'string' && next[key]) {
      const mapped = mappedAssetReference(next[key], lookup);
      next[key] = mapped !== next[key]
        ? mapped
        : (path.isAbsolute(fileUrlToPath(next[key]) || next[key]) ? '' : next[key]);
    }
  }
  if (next.path || next.filePath) next.dataUrl = '';
  return next;
}

function rewriteFavoriteAssetPaths(value = {}, assetMap = new Map()) {
  const envelope = value?.format === FAVORITES_BACKUP_FORMAT;
  const result = clone(value);
  const data = envelope ? result.data : result;
  const lookup = assetLookup(assetMap);
  for (const key of FAVORITE_ITEM_KEYS) {
    data[key] = Array.isArray(data[key]) ? data[key].map((item) => ({
      ...item,
      attachments: Array.isArray(item?.attachments)
        ? item.attachments.map((attachment) => rewriteAttachment(attachment, lookup))
        : [],
    })) : [];
  }
  return result;
}

function favoriteContentCounts(value = {}) {
  const data = normalizeImportedFavorites(value);
  return {
    projects: data.noteProjects.length,
    notes: data.notes.length,
    stickyNotes: data.stickyNotes.length,
    inspirationCategories: data.inspirationCategories.length,
    inspirations: data.inspirations.length,
    attachments: favoriteAttachments(data).length,
  };
}

module.exports = {
  FAVORITES_BACKUP_FORMAT,
  FAVORITES_BACKUP_VERSION,
  FAVORITE_ARRAY_KEYS,
  createFavoritesBackupSnapshot,
  normalizeImportedFavorites,
  collectFavoriteAssetPaths,
  rewriteFavoriteAssetPaths,
  favoriteContentCounts,
};
