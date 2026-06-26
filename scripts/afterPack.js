const fs = require('fs');
const path = require('path');

exports.default = async function trimUnusedElectronRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;

  // XuanNian uses Chromium's normal Windows D3D rendering path but does not
  // use WebGPU or Vulkan. These optional runtimes are not needed by the
  // current UI, clipboard, media preview, screenshot, or tray features.
  const unusedRuntimeFiles = [
    'dxcompiler.dll',
    'dxil.dll',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll',
    'LICENSES.chromium.html',
    path.join('resources', 'default_app.asar'),
  ];

  for (const relativePath of unusedRuntimeFiles) {
    const target = path.join(context.appOutDir, relativePath);
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // A missing optional runtime should not block packaging.
    }
  }
};
