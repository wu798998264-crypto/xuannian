const path = require('path');

const FAVORITES_BACKUP_FORMAT = 'xuannian-favorites-backup';
const FAVORITES_BACKUP_VERSION = 3;
const FAVORITE_ARRAY_KEYS = ['noteProjects', 'notes'];
const FAVORITE_ITEM_KEYS = ['notes'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function legacyStickyNotesAsFavorites(source = {}, noteProjects = [], notes = []) {
  const stickyProjects = Array.isArray(source?.stickyProjects) ? source.stickyProjects : [];
  const stickyNotes = Array.isArray(source?.stickyNotes) ? source.stickyNotes : [];
  if (!stickyNotes.length) return { noteProjects, notes };

  const projects = [...noteProjects];
  const projectMap = new Map();
  for (const project of stickyProjects) {
    const name = String(project?.name || '').trim() || '便签收藏';
    let target = projects.find((item) => String(item?.name || '').trim() === name);
    if (!target) {
      target = {
        id: `cp_legacy_${projects.length + 1}`,
        name,
        description: String(project?.description || ''),
      };
      projects.push(target);
    }
    if (project?.id) projectMap.set(String(project.id), target.id);
  }

  const existingIds = new Set(notes.map((item) => String(item?.id || '')));
  const converted = stickyNotes
    .filter((item) => item && item.id && !item.ordinary && !item.sourceRecordId && !item.sourceRecordDigest)
    .filter((item) => !existingIds.has(String(item.id)))
    .map((item, index) => {
      const content = String(item.content || '').trim();
      const firstAttachment = Array.isArray(item.attachments) ? item.attachments[0] : null;
      return {
        id: item.id,
        projectId: projectMap.get(String(item.projectId || '')) || projects[0]?.id || '',
        order: Number(item.order || 0) || notes.length + index + 1,
        type: 'text',
        title: item.title || (content ? content.slice(0, 18) : (firstAttachment?.name || '便签收藏')),
        content,
        note: item.note || '',
        attachments: Array.isArray(item.attachments) ? clone(item.attachments) : [],
        sourceStickyId: item.id,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      };
    });
  return { noteProjects: projects, notes: [...notes, ...converted] };
}

function pickFavoritesData(source = {}, options = {}) {
  const noteProjects = Array.isArray(source?.noteProjects) ? clone(source.noteProjects) : [];
  const notes = Array.isArray(source?.notes) ? clone(source.notes) : [];
  const migrated = options.includeLegacySticky
    ? legacyStickyNotesAsFavorites(source, noteProjects, notes)
    : { noteProjects, notes };
  return Object.fromEntries(FAVORITE_ARRAY_KEYS.map((key) => [
    key,
    key === 'noteProjects' ? migrated.noteProjects : migrated.notes,
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
    return pickFavoritesData(raw.data, { includeLegacySticky: version < FAVORITES_BACKUP_VERSION });
  }
  return pickFavoritesData(raw, { includeLegacySticky: true });
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

function isPortableAbsolutePath(value = '') {
  const text = String(value || '');
  return path.isAbsolute(text) || /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\/.test(text);
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
        : (isPortableAbsolutePath(fileUrlToPath(next[key]) || next[key]) ? '' : next[key]);
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

function projectNamesMatch(left = {}, right = {}) {
  return String(left?.name || '').trim() === String(right?.name || '').trim();
}

function remapConflictingProjectIds(base = {}, incoming = {}) {
  const result = clone(incoming) || {};
  const remapReferences = (items, key, idMap) => {
    result[items] = Array.isArray(result[items])
      ? result[items].map((item) => (
        item && idMap.has(item[key]) ? { ...item, [key]: idMap.get(item[key]) } : item
      ))
      : [];
  };
  const reconcile = (projectKey, itemKey, referenceKey, prefix) => {
    const baseProjects = Array.isArray(base?.[projectKey]) ? base[projectKey] : [];
    const incomingProjects = Array.isArray(result?.[projectKey]) ? result[projectKey] : [];
    const used = new Set([
      ...baseProjects.map((item) => String(item?.id || '').trim()).filter(Boolean),
      ...incomingProjects.map((item) => String(item?.id || '').trim()).filter(Boolean),
    ]);
    const idMap = new Map();
    let sequence = 1;
    result[projectKey] = incomingProjects.map((project) => {
      const id = String(project?.id || '').trim();
      if (!id) return project;
      const existing = baseProjects.find((item) => String(item?.id || '').trim() === id);
      if (!existing || projectNamesMatch(existing, project)) return project;
      let nextId = `${prefix}_imported_${sequence++}`;
      while (used.has(nextId)) nextId = `${prefix}_imported_${sequence++}`;
      used.add(nextId);
      idMap.set(id, nextId);
      return { ...project, id: nextId };
    });
    remapReferences(itemKey, referenceKey, idMap);
  };
  reconcile('noteProjects', 'notes', 'projectId', 'cp');
  return result;
}

function favoriteContentCounts(value = {}) {
  const data = normalizeImportedFavorites(value);
  return {
    projects: data.noteProjects.length,
    notes: data.notes.length,
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
  remapConflictingProjectIds,
  favoriteContentCounts,
};
