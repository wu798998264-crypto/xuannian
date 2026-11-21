const path = require('path');
const { createHash } = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');

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
      let index = projects.length + 1;
      while (projects.some(item => item.id === `cp_legacy_${index}`)) index++;
      target = {
        id: `cp_legacy_${index}`,
        name,
        description: String(project?.description || ''),
      };
      projects.push(target);
    }
    if (project?.id) projectMap.set(String(project.id), target.id);
  }

  const existingIds = new Set(notes.flatMap(item => [item?.id, item?.sourceStickyId]).filter(Boolean).map(String));
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
        createdAt: item.createdAt || item.updatedAt || 0,
        updatedAt: item.updatedAt || item.createdAt || 0,
      };
    });
  return { noteProjects: projects, notes: [...notes, ...converted] };
}

function pickFavoritesData(source = {}, options = {}) {
  const noteProjects = Array.isArray(source?.noteProjects) ? clone(source.noteProjects) : [];
  const notes = Array.isArray(source?.notes) ? clone(source.notes) : [];
  const records = new Map((Array.isArray(source.records) ? source.records : []).map(record => [record?.id, record]));
  for (const note of notes) {
    const record = note.sourceRecordId && records.get(note.sourceRecordId);
    if (record && !note.attachments?.length) {
      const files = Array.isArray(record.files) && record.files.length ? record.files
        : (record.type === 'file' ? String(record.content || '').split(/\r?\n/).filter(isPortableAbsolutePath) : []);
      if (files.length) {
        note.attachments = files.map(file => {
          const name = String(file).split(/[\\/]/).pop();
          const ext = path.extname(name).slice(1).toLowerCase();
          const kind = /^(png|jpe?g|gif|webp|bmp|tiff?)$/.test(ext) ? 'image'
            : /^(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpeg|mpg)$/.test(ext) ? 'video'
            : /^(mp3|wav|m4a|aac|flac|ogg|wma)$/.test(ext) ? 'audio' : 'file';
          return { kind, name, ext, path: file };
        });
      } else if (record.type === 'image' && record.preview) {
        note.attachments = [{ kind: 'image', name: '剪切板图片', preview: record.preview }];
      }
      if (!note.content && ['text', 'link'].includes(record.type)) note.content = record.content || '';
    }
    if (record?.type === 'file' && note.content && note.content === record.content
      && note.attachments?.length && String(note.content).split(/\r?\n/).every(isPortableAbsolutePath)) {
      note.content = '';
    }
    if (record?.type === 'image' && note.content === '图片内容' && note.attachments?.length) note.content = '';
    delete note.sourceRecordId;
    delete note.sourceRecordDigest;
  }
  return options.includeLegacySticky
    ? legacyStickyNotesAsFavorites(source, noteProjects, notes)
    : { noteProjects, notes };
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('收藏备份数据无法读取。');
  const envelope = Object.hasOwn(raw, 'format');
  if (envelope && raw.format !== FAVORITES_BACKUP_FORMAT) throw new Error('无法识别收藏备份格式。');
  const version = envelope ? Number(raw.version) : 1;
  if (!Number.isSafeInteger(version) || version < 1 || version > FAVORITES_BACKUP_VERSION) {
    throw new Error(`收藏备份版本 ${raw.version || '未知'} 暂不受支持，请先更新玄念。`);
  }
  const source = envelope ? raw.data : raw;
  const legacy = version < FAVORITES_BACKUP_VERSION;
  const keys = legacy ? [...FAVORITE_ARRAY_KEYS, 'stickyProjects', 'stickyNotes'] : FAVORITE_ARRAY_KEYS;
  const isItem = item => item && typeof item === 'object' && !Array.isArray(item);
  if (!isItem(source) || !keys.some(key => Array.isArray(source[key]))) throw new Error('收藏备份缺少收藏数据。');
  if (!legacy && !FAVORITE_ARRAY_KEYS.every(key => Array.isArray(source[key]))) throw new Error('收藏备份缺少分类或收藏列表。');
  for (const key of keys) {
    if (!Object.hasOwn(source, key)) continue;
    if (!Array.isArray(source[key]) || !source[key].every(isItem)) throw new Error('收藏备份的分类或条目格式无效。');
    if ((key === 'notes' || key === 'stickyNotes') && source[key].some(item => item.attachments != null
      && (!Array.isArray(item.attachments) || !item.attachments.every(isItem)))) throw new Error('收藏附件格式无效。');
  }
  return pickFavoritesData(source, { includeLegacySticky: legacy });
}

function fileUrlToPath(value = '') {
  if (!/^file:\/\//i.test(String(value || ''))) return '';
  try {
    // Early renderers prefixed file:/// even to /Users/... and //server/share.
    const text = String(value).replace(/^file:\/{5}(?=[^/])/i, 'file://')
      .replace(/^file:\/{4}(?=[^/])/i, 'file:///')
      .replace(/%(?![a-f\d]{2})/gi, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
    const url = new URL(text);
    return fileURLToPath(url, { windows: !!url.hostname || /^\/[a-z]:\//i.test(url.pathname) });
  } catch {
    return '';
  }
}

function attachmentAssetPaths(attachment = {}) {
  const paths = new Set();
  for (const key of ['path', 'filePath', 'preview', 'dataUrl', 'originalPath']) {
    const value = attachment?.[key];
    if (!value || typeof value !== 'string') continue;
    const source = /^file:\/\//i.test(value) ? fileUrlToPath(value) : value;
    if (!source || (!/^[a-z]:[\\/]/i.test(source) && /^[a-z][a-z\d+.-]*:/i.test(source))) continue;
    paths.add(source);
  }
  return [...paths];
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

function isPortableAbsolutePath(value = '') {
  const text = String(value || '');
  return text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\/.test(text);
}

function collectFavoriteAssetPaths(value = {}) {
  const seen = new Set();
  const result = [];
  for (const attachment of favoriteAttachments(value)) {
    const [sourcePath] = attachmentAssetPaths(attachment);
    if (!sourcePath) continue;
    const key = sourcePath.replace(/\\/g, '/');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(sourcePath);
  }
  return result;
}

function assetLookup(assetMap) {
  const exact = new Map();
  const folded = new Map();
  const entries = assetMap instanceof Map ? assetMap.entries() : Object.entries(assetMap || {});
  for (const [source, target] of entries) {
    if (!source || !target) continue;
    const key = String(source).replace(/\\/g, '/');
    exact.set(key, target);
    const alternate = key.normalize('NFC').toLowerCase();
    folded.set(alternate, folded.has(alternate) && folded.get(alternate) !== target ? null : target);
  }
  return value => {
    const key = value.replace(/\\/g, '/');
    return exact.get(key) || folded.get(key.normalize('NFC').toLowerCase());
  };
}

function rewriteAttachmentAsset(attachment, target) {
  const next = { ...attachment, path: target, dataUrl: '' };
  if (next.filePath) next.filePath = target;
  if (next.originalPath) next.originalPath = target;
  if (next.preview || next.kind === 'image' || next.kind === 'video') {
    const windows = /^[a-z]:[\\/]/i.test(target) || /^[\\/]{2}/.test(target);
    next.preview = isPortableAbsolutePath(target) ? pathToFileURL(target, { windows }).href : target;
  }
  return next;
}

function rewriteAttachment(attachment, lookup) {
  if (!attachment || typeof attachment !== 'object') return attachment;
  const next = { ...attachment };
  for (const source of attachmentAssetPaths(attachment)) {
    const target = lookup(source);
    if (target) return rewriteAttachmentAsset(attachment, target);
  }
  for (const key of ['path', 'filePath', 'preview', 'dataUrl', 'originalPath']) {
    if (isPortableAbsolutePath(next[key]) || /^file:\/\//i.test(next[key] || '')) next[key] = '';
  }
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

function importId(prefix, identity) {
  return prefix + '_imported_' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
}

function remapConflictingProjectIds(base = {}, incoming = {}) {
  const result = clone(incoming) || {};
  const used = new Map((base.noteProjects || []).map(project => [project.id, project]));
  const idMap = new Map();
  result.noteProjects = (result.noteProjects || []).map(project => {
    let id = project.id || importId('cp', project.name || '');
    while (used.has(id) && !projectNamesMatch(used.get(id), project)) {
      id = importId('cp', [id, project.name]);
    }
    const next = { ...project, id };
    used.set(id, next);
    idMap.set(project.id, id);
    return next;
  });
  const recovery = { id: importId('cp', 'recovered-notes'), name: '导入收藏' };
  result.notes = (result.notes || []).map(note => {
    let projectId = idMap.get(note.projectId) || (used.has(note.projectId) ? note.projectId : result.noteProjects[0]?.id);
    if (!projectId) {
      projectId = recovery.id;
      result.noteProjects.push(recovery);
    }
    return { ...note, projectId };
  });
  return result;
}

function noteContentKey(note) {
  const attachments = (note.attachments || []).map(item => [
    item.kind || '', item.name || '', item.size || 0, item.ext || '',
  ]);
  return JSON.stringify([note.projectId, note.title || '', note.content || '', note.note || '', attachments]);
}

function mergeImportedFavorites(current, incoming) {
  const imported = remapConflictingProjectIds(current, incoming);
  const projects = new Map((current.noteProjects || []).map(project => [project.id, project]));
  for (const project of imported.noteProjects) if (!projects.has(project.id)) projects.set(project.id, project);
  const notes = new Map((current.notes || []).map(note => [note.id, note]));
  for (const note of imported.notes) {
    const contentKey = noteContentKey(note);
    const hashes = (note.attachments || []).map(item => item.assetSha256 || '');
    const identity = [note.createdAt || 0, contentKey, hashes];
    let id = note.id || importId('note', identity);
    let existing = notes.get(id);
    while (existing) {
      const sameContent = noteContentKey(existing) === contentKey && hashes.every((hash, index) => {
        const local = existing.attachments?.[index];
        if (hash && local?.assetSha256) return local.assetSha256 === hash;
        // Entries without IDs or timestamps lack creation identity. If the
        // bytes cannot be compared, preserve distinct local files as well.
        return !!note.createdAt || !!existing.createdAt || local?.path === note.attachments[index]?.path;
      });
      const sameCreation = note.createdAt && existing.createdAt && note.createdAt === existing.createdAt;
      const distinctCreation = note.createdAt && existing.createdAt && note.createdAt !== existing.createdAt;
      const localTime = Number(existing.updatedAt || existing.createdAt || 0);
      const importTime = Number(note.updatedAt || note.createdAt || 0);
      if (!distinctCreation && (sameContent || (sameCreation && localTime !== importTime))) {
        // An equal timestamp can still carry a repaired copy of the attachments.
        if (importTime >= localTime) notes.set(id, { ...existing, ...note, id });
        break;
      }
      // Independent installations can reuse IDs, and older clients edit notes
      // without updating their timestamp. Keep both versions in that case.
      id = importId('note', [id, identity]);
      existing = notes.get(id);
    }
    if (!existing) notes.set(id, { ...note, id });
  }
  return { ...current, noteProjects: [...projects.values()], notes: [...notes.values()] };
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
  attachmentAssetPaths,
  rewriteAttachmentAsset,
  rewriteFavoriteAssetPaths,
  remapConflictingProjectIds,
  mergeImportedFavorites,
  favoriteContentCounts,
};
