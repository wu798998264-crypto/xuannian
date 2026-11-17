const { BaseWindow, WebContentsView } = require('electron');

function createApplicationWindow(options) {
  const { webPreferences, ...windowOptions } = options;
  const window = new BaseWindow(windowOptions);
  const applicationView = new WebContentsView({ webPreferences });
  applicationView.setBackgroundColor(options.backgroundColor || '#ffffff');
  Object.defineProperties(window, {
    webContents: { value: applicationView.webContents },
    applicationView: { value: applicationView },
  });
  window.contentView.addChildView(applicationView);
  const layout = () => {
    if (window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    applicationView.setBounds({ x: 0, y: 0, width, height });
  };
  layout();
  for (const event of ['resize', 'enter-full-screen', 'leave-full-screen']) window.on(event, layout);
  applicationView.webContents.on('page-title-updated', (_event, title) => {
    if (!window.isDestroyed()) window.setTitle(title);
  });
  window.on('closed', () => {
    if (!applicationView.webContents.isDestroyed()) applicationView.webContents.close();
  });
  return window;
}

module.exports = { createApplicationWindow };
