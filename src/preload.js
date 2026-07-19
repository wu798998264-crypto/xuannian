const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');

let cache = null;
let cacheLoadPromise = null;
let cacheGeneration = 0;

function replaceCache(data) {
  cacheGeneration += 1;
  cache = data;
  cacheLoadPromise = null;
  return cache;
}

function invalidateCache() {
  cacheGeneration += 1;
  cache = null;
  cacheLoadPromise = null;
}

async function load() {
  if (cache) return cache;
  if (cacheLoadPromise) return cacheLoadPromise;
  const generation = cacheGeneration;
  let trackedPromise;
  trackedPromise = ipcRenderer.invoke('data:load')
    .then((data) => {
      if (generation === cacheGeneration && !cache) cache = data;
      if (generation !== cacheGeneration && cacheLoadPromise && cacheLoadPromise !== trackedPromise) {
        return cacheLoadPromise;
      }
      return cache || data;
    })
    .finally(() => {
      if (cacheLoadPromise === trackedPromise) cacheLoadPromise = null;
    });
  cacheLoadPromise = trackedPromise;
  return trackedPromise;
}

async function save(data) {
  const cleanData = {
    ...data,
    settings: data?.settings ? Object.fromEntries(Object.entries(data.settings).filter(([key]) => key !== '__error')) : data?.settings,
  };
  const result = await ipcRenderer.invoke('data:save', cleanData);
  replaceCache(result.data);
  if (!result.ok) {
    return { ok: false, reason: result.reason, data: cache };
  }
  return { ok: true, data: cache };
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function attachmentFilePath(item) {
  if (!item) return '';
  return String(item.path || item.filePath || '').trim();
}

function recordFromNoteBackup(note, settings = {}) {
  const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
  const files = attachments.map(attachmentFilePath).filter(Boolean);
  const firstImage = attachments.find((item) => item?.kind === 'image' && (item.preview || item.dataUrl || item.path));
  const content = String(note?.content || note?.title || '').trim();
  const hasOnlyImages = files.length && attachments.every((item) => item?.kind === 'image');
  return {
    id: uid('rec'),
    createdAt: Date.now(),
    retentionDays: Number(settings?.retentionDays || 30),
    type: files.length ? (hasOnlyImages ? 'image' : 'file') : 'text',
    content: content || (hasOnlyImages ? '图片内容' : (files.length ? files.join('\n') : '收藏备份')),
    preview: firstImage?.preview || firstImage?.dataUrl || (firstImage?.path ? `file:///${String(firstImage.path).replace(/\\/g, '/')}` : ''),
    files,
    sizeText: files.length ? `${files.length} 个附件` : '',
    sourceNoteId: note?.id || '',
    source: 'deleted-note-backup',
  };
}

contextBridge.exposeInMainWorld('nativeAPI', {
  async getRecords() {
    return (await load()).records;
  },
  async saveRecords(records) {
    const nextRecords = await ipcRenderer.invoke('records:save', records);
    const data = await load();
    data.records = nextRecords;
    replaceCache(data);
    return nextRecords;
  },
  async addRecord(record) {
    const data = await load();
    data.records.unshift({ id: uid('rec'), createdAt: Date.now(), retentionDays: Number(data.settings?.retentionDays || 30), ...record });
    return (await save(data)).data.records;
  },
  async deleteRecord(id) {
    const data = await load();
    data.records = data.records.filter((item) => item.id !== id);
    return (await save(data)).data.records;
  },
  async copyText(text) {
    return ipcRenderer.invoke('clipboard:copyText', String(text || ''));
  },
  async copyFileToClipboard(filePath, action = 'copy', text = '') {
    return ipcRenderer.invoke('clipboard:copyFile', filePath, action, text || '');
  },
  async copyImage(dataUrl) {
    return ipcRenderer.invoke('clipboard:copyImage', dataUrl);
  },
  startImageDrag(dataUrl, name = '') {
    ipcRenderer.send('sticky:startImageDrag', dataUrl || '', name || '');
    return true;
  },
  async localizeAttachmentsForCopy(attachments = [], scope = 'notes') {
    return ipcRenderer.invoke('attachments:localizeForCopy', Array.isArray(attachments) ? attachments : [], scope || 'notes');
  },
  async getFileIcon(filePath) {
    return ipcRenderer.invoke('file:getIcon', filePath || '');
  },
  async getFileThumbnail(filePath, size = {}) {
    return ipcRenderer.invoke('file:getThumbnail', filePath || '', size || {});
  },
  async getNoteProjects() {
    return (await load()).noteProjects;
  },
  async addNoteProject(project) {
    const data = await load();
    const item = { id: uid('cp'), ...project };
    data.noteProjects.push(item);
    await save(data);
    return item;
  },
  async updateNoteProject(id, patch) {
    const data = await load();
    data.noteProjects = data.noteProjects.map((item) => item.id === id ? { ...item, ...patch } : item);
    return (await save(data)).data.noteProjects;
  },
  async deleteNoteProject(id) {
    const data = await load();
    const remaining = data.noteProjects.filter((item) => item.id !== id);
    if (!remaining.length) return data.noteProjects;
    data.noteProjects = remaining;
    data.notes = data.notes.map((item) => item.projectId === id ? { ...item, projectId: remaining[0].id } : item);
    return (await save(data)).data.noteProjects;
  },
  async getNotes() {
    return (await load()).notes;
  },
  async saveNotes(notes) {
    const data = await load();
    data.notes = Array.isArray(notes) ? notes : data.notes;
    return (await save(data)).data.notes;
  },
  async addNote(note) {
    const data = await load();
    const nextOrder = Math.max(0, ...data.notes.filter((item) => item.projectId === note.projectId).map((item) => Number(item.order || 0))) + 1;
    data.notes.unshift({ id: uid('note'), createdAt: Date.now(), order: nextOrder, ...note });
    return (await save(data)).data.notes;
  },
  async updateNote(id, patch) {
    const data = await load();
    data.notes = data.notes.map((item) => item.id === id ? { ...item, ...patch } : item);
    return (await save(data)).data.notes;
  },
  async deleteNote(id) {
    const data = await load();
    const current = data.notes.find((item) => item.id === id);
    if (current) {
      data.records = Array.isArray(data.records) ? data.records : [];
      data.records.unshift(recordFromNoteBackup(current, data.settings));
    }
    data.notes = data.notes.filter((item) => item.id !== id);
    return (await save(data)).data.notes;
  },
  async getStickyNotes() {
    return (await load()).stickyNotes || [];
  },
  async saveStickyNotes(stickyNotes) {
    const data = await load();
    data.stickyNotes = Array.isArray(stickyNotes) ? stickyNotes : (data.stickyNotes || []);
    return (await save(data)).data.stickyNotes || [];
  },
  async addStickyNote(note) {
    const data = await load();
    data.stickyNotes = data.stickyNotes || [];
    const projectId = note.projectId || '';
    const nextOrder = Math.max(0, ...data.stickyNotes.filter((item) => item.projectId === projectId).map((item) => Number(item.order || 0))) + 1;
    data.stickyNotes.unshift({
      id: uid('sticky'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId,
      order: nextOrder,
      ...note,
    });
    return (await save(data)).data.stickyNotes || [];
  },
  async updateStickyNote(id, patch) {
    const data = await load();
    const current = (data.stickyNotes || []).find((item) => item.id === id);
    const movedProject = patch.projectId && current && patch.projectId !== current.projectId;
    const nextOrder = movedProject
      ? Math.max(0, ...(data.stickyNotes || []).filter((item) => item.projectId === patch.projectId).map((item) => Number(item.order || 0))) + 1
      : null;
    data.stickyNotes = (data.stickyNotes || []).map((item) => item.id === id ? { ...item, ...patch, ...(nextOrder ? { order: nextOrder } : {}), updatedAt: Date.now() } : item);
    return (await save(data)).data.stickyNotes || [];
  },
  async deleteStickyNote(id) {
    const data = await load();
    data.stickyNotes = (data.stickyNotes || []).filter((item) => item.id !== id);
    return (await save(data)).data.stickyNotes || [];
  },
  async getStickyProjects() {
    return (await load()).stickyProjects || [];
  },
  async addStickyProject(project) {
    const data = await load();
    data.stickyProjects = data.stickyProjects || [];
    const item = { id: uid('sp'), ...project };
    data.stickyProjects.push(item);
    await save(data);
    return item;
  },
  async updateStickyProject(id, patch) {
    const data = await load();
    data.stickyProjects = (data.stickyProjects || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    return (await save(data)).data.stickyProjects || [];
  },
  async deleteStickyProject(id) {
    const data = await load();
    const projects = data.stickyProjects || [];
    const remaining = projects.filter((item) => item.id !== id);
    if (!remaining.length) return projects;
    data.stickyProjects = remaining;
    data.stickyNotes = (data.stickyNotes || []).map((item) => item.projectId === id ? { ...item, projectId: remaining[0].id } : item);
    return (await save(data)).data.stickyProjects || [];
  },
  async reorderStickyNotes(projectId, orderedIds) {
    const data = await load();
    const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
    data.stickyNotes = (data.stickyNotes || []).map((item) => item.projectId === projectId && orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id), updatedAt: Date.now() } : item);
    return (await save(data)).data.stickyNotes || [];
  },
  async reorderNotes(projectId, orderedIds) {
    const data = await load();
    const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
    data.notes = data.notes.map((item) => item.projectId === projectId && orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) } : item);
    return (await save(data)).data.notes;
  },
  async getInspirations() {
    return (await load()).inspirations;
  },
  async saveInspirations(inspirations) {
    const data = await load();
    data.inspirations = Array.isArray(inspirations) ? inspirations : data.inspirations;
    return (await save(data)).data.inspirations;
  },
  async getInspirationCategories() {
    return (await load()).inspirationCategories || [];
  },
  async addInspirationCategory(category) {
    const data = await load();
    const item = { id: uid('icat'), ...category };
    data.inspirationCategories = data.inspirationCategories || [];
    data.inspirationCategories.push(item);
    await save(data);
    return item;
  },
  async updateInspirationCategory(id, patch) {
    const data = await load();
    data.inspirationCategories = (data.inspirationCategories || []).map((item) => item.id === id ? { ...item, ...patch } : item);
    return (await save(data)).data.inspirationCategories || [];
  },
  async deleteInspirationCategory(id) {
    const data = await load();
    data.inspirationCategories = (data.inspirationCategories || []).filter((item) => item.id !== id);
    data.inspirations = data.inspirations.map((item) => item.categoryId === id ? { ...item, categoryId: null, favorite: false, updatedAt: Date.now() } : item);
    return (await save(data)).data.inspirationCategories || [];
  },
  async addInspiration(content, attachments = [], categoryId = null) {
    const data = await load();
    data.inspirations.push({ id: uid('idea'), content, attachments, categoryId: categoryId || null, expandedContent: '', favorite: !!categoryId, createdAt: Date.now(), updatedAt: Date.now() });
    return (await save(data)).data.inspirations;
  },
  async updateInspiration(id, content, expandedContent, attachments) {
    const data = await load();
    data.inspirations = data.inspirations.map((item) => item.id === id ? { ...item, content, expandedContent, ...(Array.isArray(attachments) ? { attachments } : {}), updatedAt: Date.now() } : item);
    return (await save(data)).data.inspirations;
  },
  async toggleInspirationFavorite(id) {
    const data = await load();
    data.inspirations = data.inspirations.map((item) => item.id === id ? { ...item, favorite: !item.favorite, updatedAt: Date.now() } : item);
    return (await save(data)).data.inspirations;
  },
  async moveInspiration(id, categoryId) {
    const data = await load();
    data.inspirations = data.inspirations.map((item) => item.id === id ? { ...item, categoryId: categoryId || null, favorite: !!categoryId, updatedAt: Date.now() } : item);
    return (await save(data)).data.inspirations;
  },
  async reorderInspirations(orderedIds) {
    const data = await load();
    const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
    data.inspirations = [...data.inspirations].sort((a, b) => (orderMap.has(a.id) ? orderMap.get(a.id) : 9999) - (orderMap.has(b.id) ? orderMap.get(b.id) : 9999));
    return (await save(data)).data.inspirations;
  },
  async deleteInspiration(id) {
    const data = await load();
    data.inspirations = data.inspirations.filter((item) => item.id !== id);
    return (await save(data)).data.inspirations;
  },
  async getSettings() {
    return (await load()).settings;
  },
  async saveSettings(settings) {
    const data = await load();
    data.settings = { ...data.settings, ...settings };
    const result = await save(data);
    if (!result.ok) return { ...result.data.settings, __error: result.reason };
    return result.data.settings;
  },
  async getUpdateState() {
    return ipcRenderer.invoke('update:getState');
  },
  async getFileSearchStatus() {
    return ipcRenderer.invoke('search:status');
  },
  async initializeFileSearch() {
    return ipcRenderer.invoke('search:initialize');
  },
  async searchFiles(query, options = {}) {
    return ipcRenderer.invoke('search:query', String(query || ''), options || {});
  },
  async cancelFileSearch() {
    return ipcRenderer.invoke('search:cancel');
  },
  async checkForUpdates() {
    return ipcRenderer.invoke('update:check');
  },
  async downloadUpdate() {
    return ipcRenderer.invoke('update:download');
  },
  async installUpdate() {
    return ipcRenderer.invoke('update:install');
  },
  onUpdateState(callback) {
    ipcRenderer.on('update:state', (_event, nextState) => callback(nextState || {}));
  },
  async setAlwaysOnTop(enabled) {
    return ipcRenderer.invoke('window:setAlwaysOnTop', enabled);
  },
  async minimizeWindow() {
    return ipcRenderer.invoke('window:minimize');
  },
  async toggleMaximizeWindow() {
    return ipcRenderer.invoke('window:toggleMaximize');
  },
  async closeWindow() {
    return ipcRenderer.invoke('window:close');
  },
  async beginWindowMove(point) {
    return ipcRenderer.invoke('window:moveStart', point);
  },
  updateWindowMove(point) {
    ipcRenderer.send('window:moveMove', point);
  },
  endWindowMove() {
    ipcRenderer.send('window:moveEnd');
  },
  async beginWindowResize(edge, point) {
    return ipcRenderer.invoke('window:resizeStart', edge, point);
  },
  updateWindowResize(point) {
    ipcRenderer.send('window:resizeMove', point);
  },
  endWindowResize() {
    ipcRenderer.send('window:resizeEnd');
  },
  async selectStorageFolder(currentPath) {
    return ipcRenderer.invoke('dialog:selectStorageFolder', currentPath || '');
  },
  async exportUserDataPackage() {
    return ipcRenderer.invoke('data:exportPackage');
  },
  async importUserDataPackage() {
    invalidateCache();
    return ipcRenderer.invoke('data:importPackage');
  },
  async revealUserDataFolder() {
    return ipcRenderer.invoke('data:revealFolder');
  },
  async pickInspirationFiles() {
    return ipcRenderer.invoke('dialog:pickInspirationFiles');
  },
  getPathForFile(file) {
    try {
      return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : '';
    } catch {
      return '';
    }
  },
  async openPath(filePath) {
    return ipcRenderer.invoke('file:open', filePath);
  },
  async openExternal(url) {
    return ipcRenderer.invoke('shell:openExternal', url || '');
  },
  async showItemInFolder(filePath) {
    return ipcRenderer.invoke('file:showInFolder', filePath);
  },
  async openStickyNote(noteId) {
    return ipcRenderer.invoke('sticky:open', noteId || '');
  },
  async getPinnedStickyIds() {
    return ipcRenderer.invoke('sticky:getPinnedIds');
  },
  async toggleStickyNote(noteId) {
    return ipcRenderer.invoke('sticky:toggle', noteId || '');
  },
  async createStickyNoteWindow(options = {}) {
    return ipcRenderer.invoke('sticky:create', options || {});
  },
  async canPinStickyNote() {
    return ipcRenderer.invoke('sticky:canPin');
  },
  async backupStickyToClipboard(payload) {
    const result = await ipcRenderer.invoke('sticky:backupClipboard', payload || {});
    replaceCache(await ipcRenderer.invoke('data:load'));
    return result;
  },
  async closeAllStickyNotes() {
    return ipcRenderer.invoke('sticky:closeAll');
  },
  async registerSavedStickyNote(noteId) {
    return ipcRenderer.invoke('sticky:registerSaved', noteId || '');
  },
  async focusStickyWindow() {
    return ipcRenderer.invoke('sticky:focusTop');
  },
  async getStickyPointerStatus() {
    return ipcRenderer.invoke('sticky:pointerStatus');
  },
  async setStickyAspectRatio(ratio) {
    return ipcRenderer.invoke('sticky:setAspectRatio', ratio || 0);
  },
  async fitStickyToImageLayout(layout) {
    return ipcRenderer.invoke('sticky:fitImageLayout', layout || {});
  },
  async expandStickyVertically() {
    return ipcRenderer.invoke('sticky:expandVertical');
  },
  async collapseStickyVertically(layout) {
    return ipcRenderer.invoke('sticky:collapseVertical', layout || {});
  },
  async closeStickyWindow() {
    return ipcRenderer.invoke('sticky:close');
  },
  async beginStickyResize(edge, point) {
    return ipcRenderer.invoke('sticky:resizeStart', edge, point);
  },
  updateStickyResize(point) {
    ipcRenderer.send('sticky:resizeMove', point);
  },
  endStickyResize() {
    ipcRenderer.send('sticky:resizeEnd');
  },
  async beginStickyMove(point) {
    return ipcRenderer.invoke('sticky:moveStart', point);
  },
  updateStickyMove(point) {
    ipcRenderer.send('sticky:moveMove', point);
  },
  endStickyMove() {
    ipcRenderer.send('sticky:moveEnd');
  },
  async captureScreenshot(options) {
    return ipcRenderer.invoke('screenshot:capture', options || {});
  },
  async warmupScreenshot() {
    return ipcRenderer.invoke('screenshot:warmup');
  },
  onScreenshotCaptured(callback) {
    ipcRenderer.on('native-screenshot-captured', (_event, payload) => callback(payload));
  },
  onScreenshotSelectorInit(callback) {
    ipcRenderer.once('screenshot-selector:init', (_event, payload) => callback(payload));
  },
  async screenshotSelectorReady() {
    return ipcRenderer.invoke('screenshot-selector:ready');
  },
  async finishScreenshotSelection(rect) {
    return ipcRenderer.invoke('screenshot-selector:done', rect);
  },
  async readSystemClipboard() {
    const payload = await ipcRenderer.invoke('clipboard:readPayload');
    if (payload?.type === 'files' && payload.files?.length) {
      return payload.files.join('\n');
    }
    return clipboard.readText();
  },
  async readClipboardPayload() {
    return ipcRenderer.invoke('clipboard:readPayload');
  },
  async captureSystemClipboard() {
    return ipcRenderer.invoke('clipboard:captureNow');
  },
  onClipboardRecords(callback) {
    ipcRenderer.on('native-clipboard-records', (_event, records) => {
      load().then((data) => {
        data.records = records;
        replaceCache(data);
        callback(records);
      });
    });
  },
  onQuickRefresh(callback) {
    ipcRenderer.on('quick:refresh', () => {
      invalidateCache();
      callback();
    });
  },
  onDataRefresh(callback) {
    ipcRenderer.on('native-data-refresh', () => {
      invalidateCache();
      callback();
    });
  },
  onSettingsChanged(callback) {
    ipcRenderer.on('settings:changed', (_event, settings) => callback(settings || {}));
  },
  onStickyPinState(callback) {
    ipcRenderer.on('native-sticky-pin-state', (_event, ids) => callback(Array.isArray(ids) ? ids : []));
  },
  onStickyLimit(callback) {
    ipcRenderer.on('sticky:limit', (_event, message) => callback(String(message || '便签数量已达到上限。')));
  },
  onMainNavigate(callback) {
    ipcRenderer.on('main:navigate', (_event, view) => callback(view));
  },
  onFileSearchFocus(callback) {
    ipcRenderer.on('search:focus', callback);
  },
  onMainSuspend(callback) {
    ipcRenderer.on('main:suspend', callback);
  },
  onQuickHotkey(callback) {
    ipcRenderer.on('quick:hotkey', (_event, parts) => callback(parts));
  },
  async hideQuickPanel() {
    return ipcRenderer.invoke('quick:hide');
  },
  async showQuickPanel() {
    return ipcRenderer.invoke('quick:show');
  },
  async setQuickEditorMode(enabled) {
    return ipcRenderer.invoke('quick:setEditorMode', !!enabled);
  },
  async beginQuickWindowMove(point) {
    return ipcRenderer.invoke('quick:moveStart', point);
  },
  updateQuickWindowMove(point) {
    ipcRenderer.send('quick:moveMove', point);
  },
  endQuickWindowMove() {
    ipcRenderer.send('quick:moveEnd');
  },
  async pasteClipboardToActiveTarget() {
    return ipcRenderer.invoke('quick:pasteToActiveTarget');
  },
});
