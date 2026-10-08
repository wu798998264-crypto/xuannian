const assert = require('assert');

const {
  FAVORITES_BACKUP_FORMAT,
  FAVORITES_BACKUP_VERSION,
  createFavoritesBackupSnapshot,
  normalizeImportedFavorites,
  collectFavoriteAssetPaths,
  rewriteFavoriteAssetPaths,
  remapConflictingProjectIds,
  favoriteContentCounts,
} = require('../src/favorites-backup');

const source = {
  records: [
    { id: 'clipboard-1', type: 'image', files: ['C:\\profile\\clipboard-images\\large.png'] },
  ],
  settings: {
    storagePath: 'C:\\profile\\玄念',
    mediaFavoritePath: 'D:\\media-favorites',
    quickMenuHotkey: 'Ctrl+Alt+X',
  },
  noteProjects: [{ id: 'project-1', name: '提示词' }],
  notes: [{
    id: 'note-1',
    projectId: 'project-1',
    title: '收藏提示词',
    attachments: [{
      kind: 'image',
      path: 'C:\\profile\\玄念\\xuannian-assets\\notes\\prompt.png',
      preview: 'file:///C:/profile/玄念/xuannian-assets/notes/prompt.png',
    }],
  }],
  stickyProjects: [],
  stickyNotes: [{
    id: 'sticky-1',
    content: '便签',
    attachments: [{ kind: 'file', filePath: 'D:\\references\\brief.pdf' }],
  }],
  inspirationCategories: [{ id: 'idea-project-1', name: '灵感' }],
  inspirations: [{
    id: 'idea-1',
    categoryId: 'idea-project-1',
    content: '灵感条目',
    attachments: [{ kind: 'image', path: 'C:\\profile\\玄念\\xuannian-assets\\ideas\\idea.jpg' }],
  }],
};

const snapshot = createFavoritesBackupSnapshot(source, { exportedAt: '2026-08-30T00:00:00.000Z' });
assert.strictEqual(snapshot.format, FAVORITES_BACKUP_FORMAT);
assert.strictEqual(snapshot.version, FAVORITES_BACKUP_VERSION);
assert.strictEqual(snapshot.exportedAt, '2026-08-30T00:00:00.000Z');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'records'), 'clipboard records must not be exported');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'settings'), 'device settings must not be exported');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'stickyProjects'), 'sticky categories must not be exported');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'stickyNotes'), 'sticky notes must not be exported as a separate feature');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'inspirationCategories'), 'inspiration categories must not be exported');
assert(!Object.prototype.hasOwnProperty.call(snapshot.data, 'inspirations'), 'inspirations must not be exported');
assert.deepStrictEqual(snapshot.data.noteProjects, source.noteProjects);
assert.strictEqual(snapshot.data.notes.length, 1, 'new backups must contain only ordinary favorites');

const paths = collectFavoriteAssetPaths(snapshot);
assert.deepStrictEqual(paths.sort(), [
  'C:\\profile\\玄念\\xuannian-assets\\notes\\prompt.png',
].sort(), 'only attachments referenced by favorite content should be collected');
assert(!paths.some((item) => item.includes('clipboard-images')), 'clipboard image cache must not enter favorites backups');

const portable = rewriteFavoriteAssetPaths(snapshot, new Map([
  ['C:\\profile\\玄念\\xuannian-assets\\notes\\prompt.png', 'assets/prompt.png'],
  ['D:\\references\\brief.pdf', 'assets/brief.pdf'],
  ['C:\\profile\\玄念\\xuannian-assets\\ideas\\idea.jpg', 'assets/idea.jpg'],
]));
assert.strictEqual(portable.data.notes[0].attachments[0].path, 'assets/prompt.png');
assert.strictEqual(portable.data.notes[0].attachments[0].preview, 'assets/prompt.png');
const missingAsset = rewriteFavoriteAssetPaths(snapshot, new Map());
assert.strictEqual(missingAsset.data.notes[0].attachments[0].path, '', 'missing absolute attachment paths must not leak into a portable backup');

const importedLegacy = normalizeImportedFavorites(source);
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'records'), 'legacy imports must discard clipboard records');
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'settings'), 'legacy imports must discard source-device settings');
assert.strictEqual(importedLegacy.notes.length, 2, 'legacy sticky notes should import as ordinary favorites');
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'stickyNotes'));
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'inspirations'));

const importedCurrent = normalizeImportedFavorites(portable);
assert.deepStrictEqual(importedCurrent, portable.data, 'current backup envelopes must normalize to favorite data');
assert.deepStrictEqual(favoriteContentCounts(importedCurrent), {
  projects: 1,
  notes: 1,
  attachments: 1,
});
const currentWithLegacyFields = normalizeImportedFavorites({
  format: FAVORITES_BACKUP_FORMAT,
  version: FAVORITES_BACKUP_VERSION,
  data: { ...source, notes: source.notes, stickyNotes: source.stickyNotes },
});
assert.strictEqual(currentWithLegacyFields.notes.length, 1, 'v3 backups must ignore retired fields');

const remapped = remapConflictingProjectIds(
  {
    noteProjects: [{ id: 'same-id', name: '目标分类' }],
    notes: [],
  },
  {
    noteProjects: [{ id: 'same-id', name: '导入分类' }],
    notes: [{ id: 'import-note', projectId: 'same-id', content: '收藏内容' }],
  },
);
assert.notStrictEqual(remapped.noteProjects[0].id, 'same-id');
assert.strictEqual(remapped.notes[0].projectId, remapped.noteProjects[0].id);

assert.throws(
  () => normalizeImportedFavorites({ format: FAVORITES_BACKUP_FORMAT, version: FAVORITES_BACKUP_VERSION + 1, data: {} }),
  /版本/,
  'future backup versions must fail with an actionable version error',
);

console.log('favorites backup tests passed');
