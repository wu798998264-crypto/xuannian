const fs = require('fs');
const path = require('path');

function executableCandidates(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || '').trim();
  const appData = String(env.APPDATA || '').trim();
  const programFiles = String(env.ProgramFiles || '').trim();
  const programFilesX86 = String(env['ProgramFiles(x86)'] || '').trim();
  const candidates = [
    {
      id: 'quark',
      label: '夸克',
      url: 'https://pan.quark.cn/',
      paths: [
        path.win32.join(localAppData, 'Programs', 'Quark', 'quark.exe'),
        path.win32.join(localAppData, 'Programs', 'Quark', 'Application', 'quark.exe'),
        path.win32.join(localAppData, 'Quark', 'Application', 'quark.exe'),
        path.win32.join(programFiles, 'Quark', 'quark.exe'),
        path.win32.join(programFiles, 'Quark', 'Application', 'quark.exe'),
        path.win32.join(programFilesX86, 'Quark', 'quark.exe'),
        path.win32.join(programFilesX86, 'Quark', 'Application', 'quark.exe'),
      ],
    },
    {
      id: 'aliyun-drive',
      label: '阿里云盘',
      url: 'https://www.alipan.com/',
      paths: [
        path.win32.join(localAppData, 'Programs', 'AliyunDrive', 'AliyunDrive.exe'),
        path.win32.join(appData, 'aliyundrive', 'AliyunDrive.exe'),
        path.win32.join(programFiles, 'AliyunDrive', 'AliyunDrive.exe'),
        path.win32.join(programFilesX86, 'AliyunDrive', 'AliyunDrive.exe'),
      ],
    },
  ];
  return candidates.map((candidate) => ({
    ...candidate,
    paths: candidate.paths.filter((value) => value && path.win32.isAbsolute(value)),
  }));
}

function highQualityMusicSearchUrl(query = '') {
  const keyword = String(query || '').trim().slice(0, 240);
  const search = [keyword, '无损', 'FLAC', '夸克网盘'].filter(Boolean).join(' ');
  return `https://quark.sm.cn/s?q=${encodeURIComponent(search)}`;
}

function musicClientLaunchArguments(client = {}, query = '') {
  const searchUrl = highQualityMusicSearchUrl(query);
  if (client.id === 'quark') return ['--brand-quark', searchUrl];
  return [searchUrl];
}

function findInstalledMusicClient({ env = process.env, existsSync = fs.existsSync } = {}) {
  for (const candidate of executableCandidates(env)) {
    const executablePath = candidate.paths.find((value) => {
      try { return existsSync(value); } catch { return false; }
    });
    if (executablePath) return { ...candidate, executablePath };
  }
  return null;
}

module.exports = {
  executableCandidates,
  findInstalledMusicClient,
  highQualityMusicSearchUrl,
  musicClientLaunchArguments,
};
