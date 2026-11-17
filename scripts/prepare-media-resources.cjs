const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const build = path.join(project, 'build');
const output = path.join(build, 'media-resources');
const metadataName = '.xuannian-media-resources.json';
const release = {
  repository: 'wu798998264-crypto/xuannian',
  tag: 'v9.1.11',
  artifact: 'XuanNian-9.1.11-Portable.exe',
  sha256: '77ef758b5c3d8607c1bbcc642c827bdf6f5380c50e5f664bd3fa20c948d73e66',
};

function hashFile(file) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(128 * 1024);
  try {
    let size;
    while ((size = fs.readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
      digest.update(buffer.subarray(0, size));
    }
    return digest.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function inventory(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (relative === metadataName) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        files.push({ path: relative, size: fs.statSync(absolute).size, sha256: hashFile(absolute) });
      } else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        const resolved = path.resolve(path.dirname(absolute), target);
        if (!resolved.startsWith(path.resolve(root) + path.sep)) {
          throw new Error(`Media runtime symlink leaves its resource directory: ${relative}`);
        }
        files.push({ path: relative, symlink: target });
      } else {
        throw new Error(`Unsupported media resource: ${relative}`);
      }
    }
  }
  visit(root);
  return files;
}

function run(command, args) {
  execFileSync(command, args, { cwd: project, stdio: 'inherit', windowsHide: true });
}

function findSevenZip() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
        '7zz.exe', '7z.exe',
        path.join(project, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe'),
      ]
    : ['7zz', '7z', '/opt/homebrew/bin/7zz', '/usr/local/bin/7zz'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['i'], { stdio: 'ignore', windowsHide: true });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('7-Zip is required to prepare media resources; install 7-Zip (7z or 7zz).');
}

function assertInsideBuild(directory) {
  if (!path.resolve(directory).startsWith(path.resolve(build) + path.sep)) {
    throw new Error(`Refusing to move a directory outside build: ${directory}`);
  }
}

function verifyRequiredResources(root) {
  const java = process.platform === 'win32' ? 'java.exe' : 'java';
  const extension = process.platform === 'win32' ? '.exe' : '';
  const required = [
    'yunx/classes/YunxBridge.class',
    'yunx/runtime/app/desktop.jar',
    `yunx/runtime/runtime/bin/${java}`,
    'yunx/LICENSE',
    'yunx/UPSTREAM.json',
    'yunx/yunx-corresponding-source.zip',
    'yunx/runtime-manifest.json',
    `ffmpeg/ffmpeg${extension}`,
    `ffmpeg/ffprobe${extension}`,
  ];
  for (const relative of required) {
    if (!fs.statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing media resource: ${relative}`);
    }
  }
}

function prepare() {
  if (!['win32', 'darwin'].includes(process.platform)) {
    throw new Error(`Media packaging is supported on Windows and macOS, received ${process.platform}.`);
  }
  if (!['x64', 'arm64'].includes(process.arch) || (process.platform === 'win32' && process.arch !== 'x64')) {
    throw new Error(`Unsupported media runtime: ${process.platform}/${process.arch}.`);
  }
  if (fs.existsSync(output)) {
    const metadataFile = path.join(output, metadataName);
    if (!fs.existsSync(metadataFile)) {
      throw new Error(`Existing ${output} has no preparation metadata; move it aside before rebuilding.`);
    }
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    if (metadata.format !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch
      || JSON.stringify(metadata.release) !== JSON.stringify(release)) {
      throw new Error(`Existing ${output} belongs to a different runtime or source release; move it aside before rebuilding.`);
    }
    verifyRequiredResources(output);
    if (JSON.stringify(inventory(output)) !== JSON.stringify(metadata.files)) {
      throw new Error(`Existing ${output} failed its file integrity check; move it aside before rebuilding.`);
    }
    console.log(`Reusing verified ${process.platform}/${process.arch} media resources: ${output}`);
    return;
  }

  fs.mkdirSync(build, { recursive: true });
  const cache = path.join(build, 'media-resource-downloads');
  fs.mkdirSync(cache, { recursive: true });
  const portable = path.join(cache, release.artifact);
  if (!fs.existsSync(portable)) {
    run('gh', ['release', 'download', release.tag, '--repo', release.repository,
      '--pattern', release.artifact, '--dir', cache]);
  }
  if (hashFile(portable) !== release.sha256) {
    throw new Error(`Release archive failed SHA-256 verification: ${portable}`);
  }
  console.log(`Verified source archive ${release.artifact}.`);

  const sevenZip = findSevenZip();
  const stage = fs.mkdtempSync(path.join(build, 'media-resources-stage-'));
  run(sevenZip, ['e', portable, `-o${stage}`, '-ir!*app-64.7z', '-y', '-bd']);
  const applicationArchive = path.join(stage, 'app-64.7z');
  if (!fs.existsSync(applicationArchive)) throw new Error('The verified portable archive contains no app-64.7z.');
  const extracted = path.join(stage, 'extracted');
  const patterns = process.platform === 'win32'
    ? ['resources/yunx/*', 'resources/ffmpeg/*']
    : [
        'resources/yunx/bridge/*', 'resources/yunx/classes/*', 'resources/yunx/runtime/app/*',
        'resources/yunx/LICENSE', 'resources/yunx/UPSTREAM.json', 'resources/yunx/BUILD.md',
        'resources/yunx/yunx-corresponding-source.zip',
      ];
  run(sevenZip, ['x', applicationArchive, `-o${extracted}`, ...patterns, '-y', '-bd']);

  let prepared = path.join(extracted, 'resources');
  if (process.platform === 'darwin') {
    const sourceYunx = path.join(prepared, 'yunx');
    prepared = path.join(stage, 'native-resources');
    run('bash', [path.join(__dirname, 'prepare-macos-runtime.sh'), sourceYunx, prepared, process.arch]);
  }
  verifyRequiredResources(prepared);
  const metadata = { format: 1, platform: process.platform, arch: process.arch, release, files: inventory(prepared) };
  fs.writeFileSync(path.join(prepared, metadataName), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  assertInsideBuild(prepared);
  assertInsideBuild(output);
  fs.renameSync(prepared, output);
  // Only the archive created in this run is removed; existing directories are retained.
  fs.unlinkSync(applicationArchive);
  console.log(`Prepared ${process.platform}/${process.arch} media resources: ${output}`);
}

try {
  prepare();
} catch (error) {
  console.error(`Media resource preparation failed: ${error.message}`);
  process.exitCode = 1;
}
