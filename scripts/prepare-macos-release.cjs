#!/usr/bin/env node
'use strict';

// Restore the published 9.1.11 application, keeping its exact dependency tree.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

const SOURCE_SHA256 = '7122b14416410f60de092027ef443b4f14d568878d345a4a40fd8e715b4d6595';
const SOURCE_VERSION = '9.1.11';
const ELECTRON_VERSION = '42.4.0';
const ALLOWED_ROOTS = new Set([
  'index.html', 'quick.html', 'sticky.html', 'screenshot-select.html',
  'src', 'integration', 'node_modules', 'package.json',
]);
const DIRECTORY_ROOTS = new Set(['src', 'integration', 'node_modules']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function validateSegment(name) {
  assert(typeof name === 'string' && name.length > 0, 'Empty archive path segment.');
  assert(name !== '.' && name !== '..' && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name), `Unsafe archive path: ${name}`);
  assert(!/[\\/\u0000-\u001f<>:"|?*]/u.test(name) && !/[. ]$/u.test(name), `Unsafe archive path segment: ${name}`);
  assert(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name), `Reserved archive path segment: ${name}`);
}

function archiveEntries(archive) {
  const { header } = asar.getRawHeader(archive);
  assert(header && header.files && typeof header.files === 'object', 'ASAR header has no root directory.');
  const entries = [];
  const seen = new Set();
  const visit = (directory, prefix = '') => {
    for (const [name, metadata] of Object.entries(directory.files)) {
      validateSegment(name);
      const relative = prefix ? `${prefix}/${name}` : name;
      assert(prefix || ALLOWED_ROOTS.has(name), `Unexpected archive root: ${name}`);
      assert(metadata && typeof metadata === 'object', `Invalid archive entry: ${relative}`);
      assert(!Object.hasOwn(metadata, 'link'), `Archive symlinks are forbidden: ${relative}`);
      assert(!metadata.unpacked, `External ASAR entries are forbidden: ${relative}`);
      const identity = relative.toLocaleLowerCase('en-US');
      assert(!seen.has(identity), `Case-colliding archive paths: ${relative}`);
      seen.add(identity);
      if (Object.hasOwn(metadata, 'files')) {
        assert(metadata.files && typeof metadata.files === 'object', `Invalid archive directory: ${relative}`);
        assert(prefix || DIRECTORY_ROOTS.has(name), `Expected a file at archive root: ${name}`);
        entries.push({ relative, directory: true });
        visit(metadata, relative);
      } else {
        assert(prefix || !DIRECTORY_ROOTS.has(name), `Expected a directory at archive root: ${name}`);
        assert(Number.isSafeInteger(metadata.size) && metadata.size >= 0, `Invalid archive file size: ${relative}`);
        assert(!/\.(?:exe|dll|node|dylib|jnilib|so(?:\.\d+)*)$/iu.test(relative), `Native binaries cannot be restored from the Windows archive: ${relative}`);
        entries.push({ relative, directory: false, metadata });
      }
    }
  };
  visit(header);
  for (const root of ALLOWED_ROOTS) assert(seen.has(root), `Missing required archive root: ${root}`);
  return entries;
}

function extract(archive, appDirectory, entries) {
  fs.mkdirSync(appDirectory, { recursive: true });
  for (const entry of entries) {
    const destination = path.resolve(appDirectory, ...entry.relative.split('/'));
    assert(within(appDirectory, destination), `Archive path escapes output directory: ${entry.relative}`);
    if (entry.directory) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }
    const content = asar.extractFile(archive, entry.relative.split('/').join(path.sep), false);
    assert(content.length === entry.metadata.size, `Incomplete archive entry: ${entry.relative}`);
    const magic = content.subarray(0, 4).toString('hex');
    assert(content.subarray(0, 2).toString('ascii') !== 'MZ'
      && !['7f454c46', 'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic),
    `Native binary payload is forbidden: ${entry.relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { flag: 'wx', mode: 0o644 });
  }
}

function replaceOnce(file, original, replacement) {
  const text = fs.readFileSync(file, 'utf8');
  const occurrences = text.split(original).length - 1;
  assert(occurrences === 1, `Expected exactly one platform patch in ${file}; found ${occurrences}: ${original}`);
  fs.writeFileSync(file, text.replace(original, replacement), 'utf8');
}

function checkSources(appDirectory, entries) {
  let checked = 0;
  for (const entry of entries) {
    if (entry.directory || !/^(?:src|integration)\//u.test(entry.relative) || !/\.(?:js|cjs|mjs)$/iu.test(entry.relative)) continue;
    const file = path.join(appDirectory, ...entry.relative.split('/'));
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    assert(!result.error && result.status === 0, `JavaScript syntax check failed for ${entry.relative}: ${result.error?.message || result.stderr || result.stdout}`);
    checked += 1;
  }
  return checked;
}

function main() {
  const args = process.argv.slice(2);
  assert(args.length === 5, 'Usage: node scripts/prepare-macos-release.cjs <app.asar> <outputAppDir> <expectedVersion> <arm64|x64> <outputResourcesDir>');
  const [archiveArgument, appArgument, versionArgument, arch, resourcesArgument] = args;
  const expectedVersion = versionArgument || SOURCE_VERSION;
  assert(expectedVersion === SOURCE_VERSION, `Only verified release ${SOURCE_VERSION} is supported.`);
  assert(arch === 'arm64' || arch === 'x64', 'macOS architecture must be arm64 or x64.');
  const archive = path.resolve(archiveArgument);
  const appDirectory = path.resolve(appArgument);
  const resourcesDirectory = path.resolve(resourcesArgument);
  const repository = path.resolve(__dirname, '..');
  const configPath = path.join(path.dirname(appDirectory), 'electron-builder.mac.json');
  const outputDirectory = path.join(path.dirname(appDirectory), `dist-mac-${arch}`);
  assert(!within(appDirectory, archive), 'The source archive must be outside the output application directory.');
  assert(!within(appDirectory, resourcesDirectory) && !within(resourcesDirectory, appDirectory), 'Application and external resources directories must not overlap.');
  assert(!fs.existsSync(configPath), `Builder configuration already exists: ${configPath}`);
  if (fs.existsSync(appDirectory)) {
    const stat = fs.lstatSync(appDirectory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(appDirectory).length === 0, `Output application directory must be absent or empty: ${appDirectory}`);
  }
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  assert(digest === SOURCE_SHA256, `Unverified source ASAR: expected ${SOURCE_SHA256}, received ${digest}`);
  const entries = archiveEntries(archive);
  const packageJson = JSON.parse(asar.extractFile(archive, 'package.json', false).toString('utf8'));
  assert(packageJson.name === 'xuannian' && packageJson.version === expectedVersion, `Archive package does not match xuannian ${expectedVersion}.`);
  assert(packageJson.main === 'src/main.js', 'Unexpected application entry point.');
  const electronVersion = JSON.parse(fs.readFileSync(path.join(repository, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  assert(electronVersion === ELECTRON_VERSION, `Expected Electron ${ELECTRON_VERSION}, received ${electronVersion}.`);

  extract(archive, appDirectory, entries);
  replaceOnce(path.join(appDirectory, 'integration', 'apps', 'desktop', 'yunx-engine.mjs'),
    "join(resolve(runtimeRoot),'runtime','bin','java.exe')",
    "join(resolve(runtimeRoot),'runtime','bin',process.platform==='win32'?'java.exe':'java')");
  const mainFile = path.join(appDirectory, 'src', 'main.js');
  replaceOnce(mainFile,
    "path.join(yunxResources, 'ffmpeg', 'ffmpeg.exe')",
    "path.join(yunxResources, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')");
  replaceOnce(mainFile,
    "path.join(yunxResources, 'ffmpeg', 'ffprobe.exe')",
    "path.join(yunxResources, 'ffmpeg', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')");
  const checkedSources = checkSources(appDirectory, entries);
  const configuration = {
    appId: 'app.xuannian.desktop',
    productName: '玄念',
    electronVersion,
    asar: true,
    disableAsarIntegrity: true,
    compression: 'maximum',
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    afterSign: path.join(repository, 'scripts', 'macos-after-sign.cjs'),
    electronLanguages: ['zh-CN'],
    directories: { app: appDirectory, output: outputDirectory, buildResources: path.join(repository, 'build') },
    files: ['**/*', '!src/native/**', '!**/*.exe', '!**/*.dll', '!**/*.node'],
    extraResources: [{ from: resourcesDirectory, to: '.', filter: ['**/*'] }],
    mac: {
      icon: path.join(repository, 'build', 'mac', 'icon.icns'),
      category: 'public.app-category.productivity',
      identity: '-',
      hardenedRuntime: false,
      gatekeeperAssess: false,
      target: [{ target: 'dmg', arch: [arch] }, { target: 'zip', arch: [arch] }],
      artifactName: 'XuanNian-${version}-${arch}.${ext}',
    },
    dmg: { artifactName: 'XuanNian-${version}-${arch}.dmg' },
    publish: [{ provider: 'github', owner: 'wu798998264-crypto', repo: 'xuannian', releaseType: 'release' }],
  };
  fs.writeFileSync(configPath, `${JSON.stringify(configuration, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ version: packageJson.version, sourceSha256: digest, architecture: arch, appDirectory, resourcesDirectory, configPath, outputDirectory, checkedSources }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`prepare-macos-release: ${error.message}`);
  process.exitCode = 1;
}
