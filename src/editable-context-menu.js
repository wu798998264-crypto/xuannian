const attachedWebContents = new WeakSet();

function buildEditableContextMenuTemplate(webContents, editFlags = {}) {
  const command = (label, method, enabled) => ({
    label,
    enabled: Boolean(enabled),
    click: () => {
      if (!webContents || webContents.isDestroyed()) return;
      webContents[method]();
    },
  });

  return [
    command('撤销', 'undo', editFlags.canUndo),
    command('重做', 'redo', editFlags.canRedo),
    { type: 'separator' },
    command('剪切', 'cut', editFlags.canCut),
    command('复制', 'copy', editFlags.canCopy),
    command('粘贴', 'paste', editFlags.canPaste),
    command('删除', 'delete', editFlags.canDelete),
    { type: 'separator' },
    command('全选', 'selectAll', editFlags.canSelectAll),
  ];
}

function attachEditableContextMenu(win, Menu) {
  if (!win || win.isDestroyed()) return;
  const webContents = win.webContents;
  if (!webContents || webContents.isDestroyed() || attachedWebContents.has(webContents)) return;
  attachedWebContents.add(webContents);

  webContents.on('context-menu', (event, params = {}) => {
    if (!params.isEditable || webContents.isDestroyed() || win.isDestroyed()) return;
    event.preventDefault();
    const menu = Menu.buildFromTemplate(buildEditableContextMenuTemplate(webContents, params.editFlags));
    menu.popup({ window: win });
  });
}

module.exports = {
  attachEditableContextMenu,
  buildEditableContextMenuTemplate,
};
