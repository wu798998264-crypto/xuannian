const assert = require('assert');
const { EventEmitter } = require('events');
const {
  attachEditableContextMenu,
  buildEditableContextMenuTemplate,
} = require('../src/editable-context-menu');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.commands = [];
  }

  isDestroyed() {
    return this.destroyed;
  }
}

for (const method of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']) {
  FakeWebContents.prototype[method] = function runCommand() {
    this.commands.push(method);
  };
}

const webContents = new FakeWebContents();
const win = {
  webContents,
  destroyed: false,
  isDestroyed() {
    return this.destroyed;
  },
};

let builtTemplate = null;
let popupOptions = null;
const Menu = {
  buildFromTemplate(template) {
    builtTemplate = template;
    return {
      popup(options) {
        popupOptions = options;
      },
    };
  },
};

attachEditableContextMenu(win, Menu);
attachEditableContextMenu(win, Menu);
assert.strictEqual(webContents.listenerCount('context-menu'), 1, 'context menu listener must only be attached once');

webContents.emit('context-menu', { preventDefault() {} }, { isEditable: false });
assert.strictEqual(builtTemplate, null, 'non-editable content must keep its existing context-menu behavior');

let prevented = false;
webContents.emit('context-menu', { preventDefault() { prevented = true; } }, {
  isEditable: true,
  editFlags: {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canDelete: true,
    canSelectAll: true,
  },
});

assert.strictEqual(prevented, true);
assert.deepStrictEqual(builtTemplate.map((item) => item.label || item.type), [
  '撤销', '重做', 'separator', '剪切', '复制', '粘贴', '删除', 'separator', '全选',
]);
assert.strictEqual(builtTemplate.find((item) => item.label === '重做').enabled, false);
assert.strictEqual(popupOptions.window, win);

for (const label of ['撤销', '剪切', '复制', '粘贴', '删除', '全选']) {
  builtTemplate.find((item) => item.label === label).click();
}
assert.deepStrictEqual(webContents.commands, ['undo', 'cut', 'copy', 'paste', 'delete', 'selectAll']);

const directTemplate = buildEditableContextMenuTemplate(webContents, { canCopy: true });
assert.strictEqual(directTemplate.find((item) => item.label === '复制').enabled, true);
assert.strictEqual(directTemplate.find((item) => item.label === '粘贴').enabled, false);

console.log('editable context menu probe passed');
