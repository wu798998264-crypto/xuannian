const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { hasLegacyGbkNames } = require('./favorites-zip-encoding');

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

// The Windows inbox bsdtar can crash writing ZIP members outside the active code page.
// Pass paths as environment values so PowerShell never interprets names as commands.
function windowsZip(operation, archive, directory, legacyNames = false) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "[AppContext]::SetSwitch('Switch.System.IO.Compression.ZipFile.UseBackslash', $false)",
    "Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem",
    "$archive = $env:XN_FAVORITES_ZIP",
    "$dir = $env:XN_FAVORITES_DIR",
    legacyNames ? '$encoding = [Text.Encoding]::GetEncoding(936)' : '$encoding = [Text.Encoding]::UTF8',
    operation === 'create'
      ? '[IO.Compression.ZipFile]::CreateFromDirectory($dir, $archive, [IO.Compression.CompressionLevel]::Optimal, $false, [Text.Encoding]::UTF8)'
      : [
        '$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Read, $encoding)',
        'try {',
        '  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)',
        '  foreach ($entry in $zip.Entries) {',
        "    $name = $entry.FullName.Replace('\\', '/')",
        "    $parts = @($name.Split('/') | Where-Object { $_ -ne '.' -and $_ -ne '' })",
        "    if ($name.StartsWith('/') -or $name -match '[:\\x00-\\x1f]' -or $parts -contains '..') { throw 'Unsafe ZIP path' }",
        "    foreach ($part in $parts) { if ($part -match '[<>\"|?*]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\.|$)') { throw 'Unsupported ZIP filename' } }",
        '    $type = ($entry.ExternalAttributes -shr 16) -band 0xf000',
        "    if ($type -notin @(0, 0x4000, 0x8000) -or ($entry.ExternalAttributes -band 0x400)) { throw 'Unsupported ZIP link or special entry' }",
        "    if ($parts.Count -and !$seen.Add(($parts -join '/').Normalize())) { throw 'Duplicate ZIP filename' }",
        '  }',
        '} finally { $zip.Dispose() }',
        '[IO.Compression.ZipFile]::ExtractToDirectory($archive, $dir, $encoding)',
      ].join('\n'),
  ].join('\n');
  try {
    runArchiveTool('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      stdio: 'pipe',
      env: { ...process.env, XN_FAVORITES_ZIP: path.resolve(archive), XN_FAVORITES_DIR: path.resolve(directory) },
    });
  } catch (error) {
    if (operation === 'create') throw Error('无法写入收藏 ZIP，请检查目标目录、可用空间及写入权限。', { cause: error });
    throw Error('无法读取收藏 ZIP，请确认传输完整，且包内没有不安全的路径、链接或重名条目。', { cause: error });
  }
}

function createZipFromDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    windowsZip('create', zipPath, sourceDir);
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
  const signature = Buffer.alloc(4);
  const file = fs.openSync(archive, 'r');
  try { fs.readSync(file, signature, 0, 4, 0); } finally { fs.closeSync(file); }
  const zip = [0x04034b50, 0x06054b50].includes(signature.readUInt32LE());
  const legacyNames = zip && hasLegacyGbkNames(archive);
  if (zip && process.platform === 'win32') {
    windowsZip('extract', archive, target, legacyNames);
    return;
  }
  const command = tarCommand();
  const encoding = legacyNames ? ['--options', 'zip:hdrcharset=CP936'] : [];
  const names = archiveLines(runArchiveTool(command, [...encoding, '-tf', archive]));
  const details = archiveLines(runArchiveTool(command, [...encoding, '-tvf', archive]));
  validateArchiveMembers(names, details);
  fs.mkdirSync(target, { recursive: true });
  // macOS bsdtar reads both real ZIPs and the TAR files older Windows builds
  // accidentally named .zip. Keep its default path and symlink protections.
  runArchiveTool(command, [...encoding, '-xf', archive, '-C', target]);
}

module.exports = { createZipFromDirectory, extractZipToDirectory };
