const assert = require('assert');

const {
  FAVORITES_BACKUP_FORMAT,
  FAVORITES_BACKUP_VERSION,
  createFavoritesBackupSnapshot,
  normalizeImportedFavorites,
  collectFavoriteAssetPaths,
  attachmentAssetPaths,
  rewriteAttachmentAsset,
  rewriteFavoriteAssetPaths,
  remapConflictingProjectIds,
  mergeImportedFavorites,
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

function withAttachments(attachments) {
  return { noteProjects: [], notes: [{ id: 'note', attachments }] };
}

const referenced = createFavoritesBackupSnapshot({
  notes: [{ id: 'image-note', sourceRecordId: 'ref' }],
  records: [
    { id: 'ref', type: 'image', preview: 'file:///C:/saved/%E5%9B%BE%20%23%25.png' },
    { id: 'unrelated', type: 'file', files: ['C:/private.pdf'] },
  ],
});
assert.deepStrictEqual(collectFavoriteAssetPaths(referenced), ['C:\\saved\\图 #%.png']);
assert(!JSON.stringify(referenced.data).includes('private.pdf'));
assert(!Object.hasOwn(referenced.data.notes[0], 'sourceRecordId'));
const fromRecord = createFavoritesBackupSnapshot({
  notes: [{ id: 'link-note', sourceRecordId: 'rec' }],
  records: [{ id: 'rec', type: 'link', content: 'https://example.com' }],
});
assert.strictEqual(fromRecord.data.notes[0].content, 'https://example.com');
const references = attachmentAssetPaths({
  path: 'C:\\missing.png', filePath: '/Users/newer.png',
  preview: 'file:////Users/café%20#copy%.png', dataUrl: 'data:image/png;base64,dGVzdA==',
  originalPath: '\\\\server\\files\\old.png',
});
assert.deepStrictEqual(references, ['C:\\missing.png', '/Users/newer.png', '/Users/café #copy%.png', '\\\\server\\files\\old.png']);
const unusual = withAttachments([
  { kind: 'image', dataUrl: 'file://server/share/Scan%20%23.jpg' },
  { kind: 'file', filePath: '/Users/a/PICTURE' },
  { kind: 'file', path: '/Users/a/picture' },
]);
assert.deepStrictEqual(collectFavoriteAssetPaths(unusual), ['\\\\server\\share\\Scan #.jpg', '/Users/a/PICTURE', '/Users/a/picture']);
const portableUnusual = rewriteFavoriteAssetPaths(unusual, new Map([
  ['\\\\server\\share\\Scan #.jpg', 'assets/scan.jpg'],
  ['/Users/a/PICTURE', 'assets/1'], ['/Users/a/picture', 'assets/2'],
]));
assert.deepStrictEqual(portableUnusual.notes[0].attachments.map(item => item.path), ['assets/scan.jpg', 'assets/1', 'assets/2']);
const decomposed = 'assets/café #%.png'.normalize('NFD');
const restored = rewriteFavoriteAssetPaths(withAttachments([
  { kind: 'image', preview: 'assets/café #%.png' },
  { kind: 'image', path: 'assets/backslash.png' },
]), new Map([
  [decomposed, '/Users/new/图 #%.png'],
  ['assets\\backslash.png', 'D:\\新目录\\图 #%.png'],
])).notes[0].attachments;
assert.strictEqual(restored[0].path, '/Users/new/图 #%.png');
assert.strictEqual(restored[0].preview, 'file:///Users/new/%E5%9B%BE%20%23%25.png');
assert.strictEqual(restored[1].preview, 'file:///D:/%E6%96%B0%E7%9B%AE%E5%BD%95/%E5%9B%BE%20%23%25.png');
const inline = { kind: 'image', path: 'C:\\missing.png', dataUrl: 'data:image/png;base64,dGVzdA==' };
assert.strictEqual(rewriteFavoriteAssetPaths(withAttachments([inline])).notes[0].attachments[0].dataUrl, inline.dataUrl);
assert.strictEqual(rewriteAttachmentAsset(inline, '/Users/a.png').preview, 'file:///Users/a.png');
const oldSticky = normalizeImportedFavorites({
  format: FAVORITES_BACKUP_FORMAT, version: 2,
  data: { stickyNotes: [{ id: 'old', attachments: [{ filePath: 'assets/legacy.bin' }] }] },
});
assert.strictEqual(rewriteFavoriteAssetPaths(oldSticky, { 'assets/legacy.bin': '/Users/restored.bin' }).notes[0].attachments[0].path, '/Users/restored.bin');

for (const invalid of [
  {}, { format: 'unrelated', notes: [] }, { notes: 'broken' },
  { format: FAVORITES_BACKUP_FORMAT, version: -1, data: { notes: [] } },
  { format: FAVORITES_BACKUP_FORMAT, version: 3, data: { noteProjects: [] } },
  { format: FAVORITES_BACKUP_FORMAT, version: 3, data: { noteProjects: [], notes: [null] } },
  { format: FAVORITES_BACKUP_FORMAT, version: 3, data: { noteProjects: [], notes: [{ attachments: 'corrupt' }] } },
]) assert.throws(() => normalizeImportedFavorites(invalid));

const target = {
  settings: { local: true }, records: [{ id: 'local' }],
  noteProjects: [{ id: 'cp1', name: '目标' }],
  notes: [{ id: 'same', projectId: 'cp1', content: '原文', createdAt: 1 }],
};
const foreign = {
  noteProjects: [{ id: 'cp1', name: '来源' }],
  notes: [{ id: 'same', projectId: 'cp1', content: '带回来的收藏', createdAt: 2 }],
};
const once = mergeImportedFavorites(target, foreign);
assert.strictEqual(once.notes.length, 2);
assert.strictEqual(once.noteProjects.length, 2);
assert.strictEqual(once.notes.find(item => item.content === '带回来的收藏').projectId, once.noteProjects.find(item => item.name === '来源').id);
assert.deepStrictEqual(mergeImportedFavorites(once, foreign), once);
assert.deepStrictEqual(once.settings, target.settings);
assert.deepStrictEqual(once.records, target.records);
const fileNote = {
  id: 'with-file', projectId: 'cp1', title: '同一文件名',
  attachments: [{ kind: 'file', name: 'brief.pdf', path: 'D:\\one.pdf', size: 40, assetSha256: 'aaaa' }],
};
const firstFile = { ...target, notes: [fileNote] };
const secondFile = {
  noteProjects: target.noteProjects, notes: [{
    ...fileNote, attachments: [{ ...fileNote.attachments[0], path: 'D:\\two.pdf', assetSha256: 'bbbb' }],
  }],
};
const bothFiles = mergeImportedFavorites(firstFile, secondFile);
assert.strictEqual(bothFiles.notes.length, 2);
assert.deepStrictEqual(mergeImportedFavorites(bothFiles, secondFile), bothFiles);
const previous = {
  id: 'same-source', projectId: 'cp1', createdAt: 123, sourceRecordId: 'local-record',
  attachments: [{ kind: 'image', name: 'pic.png', path: 'C:\\old.png' }],
};
const repaired = mergeImportedFavorites({ ...target, notes: [previous] }, {
  noteProjects: target.noteProjects,
  notes: [{ ...previous, attachments: [{ ...previous.attachments[0], path: 'C:\\restored.png', assetSha256: 'aaaa' }] }],
});
assert.strictEqual(repaired.notes.length, 1);
assert.strictEqual(repaired.notes[0].attachments[0].path, 'C:\\restored.png');
const orphan = mergeImportedFavorites({ notes: [], noteProjects: [] }, { notes: [{ content: '失去分类的旧收藏' }] });
assert.strictEqual(orphan.notes[0].projectId, orphan.noteProjects[0].id);
assert.deepStrictEqual(mergeImportedFavorites(orphan, { notes: [{ content: '失去分类的旧收藏' }] }), orphan);

console.log('favorites backup tests passed');
