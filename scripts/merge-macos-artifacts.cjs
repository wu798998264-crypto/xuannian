const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const version = require('../package.json').version;
const input = process.argv[2] || 'macos-artifacts';
const output = process.argv[3] || 'release-mac';
fs.mkdirSync(output, { recursive: true });
let combined;
for (const arch of ['x64', 'arm64']) {
  const root = path.join(input, `macos-${arch}`);
  const metadata = yaml.load(fs.readFileSync(path.join(root, 'latest-mac.yml'), 'utf8'));
  if (metadata.version !== version) throw Error('Incorrect updater version.');
  if (!metadata.files?.some(file => file.url === `XuanNian-${version}-${arch}.zip`)) throw Error(`Missing ${arch} updater ZIP.`);
  combined = combined ? { ...combined, files: [...combined.files, ...metadata.files] } : metadata;
  for (const extension of ['dmg', 'dmg.blockmap', 'zip', 'zip.blockmap']) {
    const name = `XuanNian-${version}-${arch}.${extension}`;
    if (!fs.statSync(path.join(root, name)).size) throw Error(`Empty asset: ${name}`);
    fs.copyFileSync(path.join(root, name), path.join(output, name));
  }
}
fs.writeFileSync(path.join(output, 'latest-mac.yml'), yaml.dump(combined));
