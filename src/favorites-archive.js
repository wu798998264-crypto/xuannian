const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function tarCommand() {
  return process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
}

function runArchiveTool(command, args, options = {}) {
  return execFileSync(command, args, {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    ...options,
  });
}

function createZipFromDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    // Exports are first written to .zip.part. Automatic format selection sees
    // .part and creates a TAR, which older Mac importers cannot open as a ZIP.
    runArchiveTool(tarCommand(), ['--format', 'zip', '-c', '-f', zipPath, '-C', sourceDir, '.']);
    return;
  }
  runArchiveTool('/usr/bin/zip', ['-qry', zipPath, '.'], { cwd: sourceDir });
}

function archiveLines(value) {
  return String(value).replace(/\r?\n$/, '').split(/\r?\n/);
}

function validateArchiveMembers(names, details) {
  if (!names.length || names.length !== details.length) {
    throw new Error('收藏备份的文件列表无法安全读取。');
  }
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const normalized = name.replace(/\\/g, '/');
    if (!name || /[\x00-\x1f\x7f]/.test(name)
      || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)
      || normalized.split('/').includes('..')) {
      throw new Error('收藏备份包含不安全的文件路径。');
    }
    // bsdtar's verbose listing identifies symlinks as l, hard links as h and
    // special files with their own type letters. Only regular files and
    // directories belong in an exported favorites package.
    if (!/^[d-][rwxstST-]{9}(?:\s|[+@])/.test(details[index])) {
      throw new Error('收藏备份包含链接或不受支持的文件类型。');
    }
  }
}

function extractZipToDirectory(zipPath, targetDir) {
  const archive = path.resolve(zipPath);
  const target = path.resolve(targetDir);
  const stat = fs.statSync(archive);
  if (!stat.isFile() || stat.size <= 0) throw new Error('收藏备份文件为空或无法读取。');
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink() || fs.readdirSync(target).length) {
      throw new Error('收藏备份只能解压到新的临时目录。');
    }
  }
  const command = tarCommand();
  const names = archiveLines(runArchiveTool(command, ['-tf', archive]));
  const details = archiveLines(runArchiveTool(command, ['-tvf', archive]));
  validateArchiveMembers(names, details);
  fs.mkdirSync(target, { recursive: true });
  // macOS bsdtar reads both real ZIPs and the TAR files older Windows builds
  // accidentally named .zip. Keep its default path and symlink protections.
  runArchiveTool(command, ['-xf', archive, '-C', target]);
}

module.exports = { createZipFromDirectory, extractZipToDirectory };
