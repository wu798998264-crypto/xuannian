const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') throw Error('Build the Mac configuration on its native runner.');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = structuredClone(pkg.build);
for (const key of ['win', 'nsis', 'portable', 'asarUnpack', 'afterPack']) delete build[key];
build.directories = { output: 'dist-mac' };
build.extraResources = [{ from: 'build/media-resources', to: '.', filter: ['**/*'] }];
build.afterSign = path.join(root, 'scripts', 'macos-after-sign.cjs');
build.mac = {
  icon: 'build/mac/icon.icns',
  category: 'public.app-category.productivity',
  identity: '-',
  hardenedRuntime: false,
  gatekeeperAssess: false,
  target: ['dmg', 'zip'],
  artifactName: 'XuanNian-${version}-${arch}.${ext}',
};
build.dmg = { artifactName: 'XuanNian-${version}-${arch}.dmg' };
fs.writeFileSync(path.join(root, 'build', 'electron-builder.mac.generated.json'), JSON.stringify(build, null, 2) + '\n');
console.log(`Prepared macOS ${process.arch} configuration for XuanNian ${pkg.version}.`);
