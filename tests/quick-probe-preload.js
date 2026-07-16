const { contextBridge } = require('electron');

const now = Date.now();
const notes = Array.from({ length: 10000 }, (_, index) => ({
  id: `note-${index}`,
  projectId: 'stress-project',
  order: index + 1,
  type: 'text',
  title: `Synthetic ${index}`,
  content: `Runtime favorite ${index} ${'content '.repeat(10)}`,
  note: '',
  createdAt: now - index,
}));

contextBridge.exposeInMainWorld('nativeAPI', {
  getRecords: async () => Array.from({ length: 500 }, (_, index) => ({
    id: `record-${index}`,
    type: 'text',
    content: `synthetic clipboard ${index}`,
    createdAt: now - index,
  })),
  getNoteProjects: async () => [{ id: 'stress-project', name: 'Stress' }],
  getNotes: async () => notes,
  getStickyProjects: async () => [],
  getStickyNotes: async () => [],
  getSettings: async () => ({ theme: 'light' }),
  getPinnedStickyIds: async () => [],
  copyText: async () => true,
  copyFileToClipboard: async () => true,
  copyImage: async () => true,
  toggleStickyNote: async () => ({ pinned: false }),
  hideQuickPanel: async () => true,
  setQuickEditorMode: async () => true,
  onClipboardRecords: () => {},
  onQuickRefresh: () => {},
  onSettingsChanged: () => {},
  onStickyPinState: () => {},
  onQuickHotkey: () => {},
});
