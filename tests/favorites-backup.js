const assert = require('assert');

const {
  FAVORITES_BACKUP_FORMAT,
  FAVORITES_BACKUP_VERSION,
  createFavoritesBackupSnapshot,
  normalizeImportedFavorites,
  collectFavoriteAssetPaths,
  rewriteFavoriteAssetPaths,
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
assert.deepStrictEqual(snapshot.data.noteProjects, source.noteProjects);
assert.deepStrictEqual(snapshot.data.notes, source.notes);
assert.deepStrictEqual(snapshot.data.stickyNotes, source.stickyNotes);
assert.deepStrictEqual(snapshot.data.inspirations, source.inspirations);

const paths = collectFavoriteAssetPaths(snapshot);
assert.deepStrictEqual(paths.sort(), [
  'C:\\profile\\玄念\\xuannian-assets\\ideas\\idea.jpg',
  'C:\\profile\\玄念\\xuannian-assets\\notes\\prompt.png',
  'D:\\references\\brief.pdf',
].sort(), 'only attachments referenced by favorite content should be collected');
assert(!paths.some((item) => item.includes('clipboard-images')), 'clipboard image cache must not enter favorites backups');

const portable = rewriteFavoriteAssetPaths(snapshot, new Map([
  ['C:\\profile\\玄念\\xuannian-assets\\notes\\prompt.png', 'assets/prompt.png'],
  ['D:\\references\\brief.pdf', 'assets/brief.pdf'],
  ['C:\\profile\\玄念\\xuannian-assets\\ideas\\idea.jpg', 'assets/idea.jpg'],
]));
assert.strictEqual(portable.data.notes[0].attachments[0].path, 'assets/prompt.png');
assert.strictEqual(portable.data.notes[0].attachments[0].preview, 'assets/prompt.png');
assert.strictEqual(portable.data.stickyNotes[0].attachments[0].filePath, 'assets/brief.pdf');
assert.strictEqual(portable.data.inspirations[0].attachments[0].path, 'assets/idea.jpg');
const missingAsset = rewriteFavoriteAssetPaths(snapshot, new Map());
assert.strictEqual(missingAsset.data.notes[0].attachments[0].path, '', 'missing absolute attachment paths must not leak into a portable backup');

const importedLegacy = normalizeImportedFavorites(source);
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'records'), 'legacy imports must discard clipboard records');
assert(!Object.prototype.hasOwnProperty.call(importedLegacy, 'settings'), 'legacy imports must discard source-device settings');
assert.strictEqual(importedLegacy.notes.length, 1);
assert.strictEqual(importedLegacy.stickyNotes.length, 1);
assert.strictEqual(importedLegacy.inspirations.length, 1);

const importedCurrent = normalizeImportedFavorites(portable);
assert.deepStrictEqual(importedCurrent, portable.data, 'current backup envelopes must normalize to favorite data');
assert.deepStrictEqual(favoriteContentCounts(importedCurrent), {
  projects: 1,
  notes: 1,
  stickyNotes: 1,
  inspirationCategories: 1,
  inspirations: 1,
  attachments: 3,
});

assert.throws(
  () => normalizeImportedFavorites({ format: FAVORITES_BACKUP_FORMAT, version: FAVORITES_BACKUP_VERSION + 1, data: {} }),
  /版本/,
  'future backup versions must fail with an actionable version error',
);

console.log('favorites backup tests passed');
