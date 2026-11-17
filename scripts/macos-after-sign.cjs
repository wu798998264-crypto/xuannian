const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 60000, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function manifest(root, arch) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (relative === 'runtime-manifest.json') continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const contents = fs.readFileSync(absolute);
        files.push({ path: relative, size: contents.length, sha256: crypto.createHash('sha256').update(contents).digest('hex') });
      }
    }
  }
  visit(root);
  return { platform: 'darwin', arch, files };
}

// Signing the bundled JVM changes its bytes. Refresh its manifest, then seal
// the outer application without changing the already signed nested binaries.
exports.default = async function afterSign(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const root = path.join(app, 'Contents', 'Resources', 'yunx');
  fs.writeFileSync(path.join(root, 'runtime-manifest.json'), JSON.stringify(manifest(root, process.arch), null, 2) + '\n');
  run('codesign', ['--force', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
};

async function verify(app, version, arch) {
  if (process.platform !== 'darwin' || process.arch !== arch) throw Error('Verification requires the matching native Mac.');
  const resources = path.join(app, 'Contents', 'Resources');
  const root = path.join(resources, 'yunx');
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(manifest(root, arch))) throw Error('Packaged runtime manifest does not match.');
  const asar = require('@electron/asar');
  const pkg = JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json'));
  if (pkg.version !== version) throw Error('Packaged application version does not match.');
  const java = path.join(root, 'runtime', 'runtime', 'bin', 'java');
  const response = run(java, ['-Djava.awt.headless=true', '-cp', `${path.join(root, 'classes')}:${path.join(root, 'runtime', 'app', '*')}`, 'YunxBridge'], { input: '{"action":"version"}\n' });
  const bridge = JSON.parse(response.trim());
  if (!bridge.ok || bridge.data?.version !== '1.3.4') throw Error('Packaged parser bridge could not start.');
  for (const tool of ['ffmpeg', 'ffprobe']) run(path.join(resources, 'ffmpeg', tool), ['-version']);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const executable = path.join(app, 'Contents', 'MacOS', '玄念');
  const child = spawn(executable, [], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Application exited during startup (${code}): ${output}`)); });
    });
    if (/uncaught exception|error: cannot find module|err_module_not_found/i.test(output)) throw Error(output);
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  console.log(`Verified XuanNian ${version} ${arch}: signature, runtime hashes, Java bridge, FFmpeg and application startup.`);
}

if (require.main === module) {
  verify(...process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
