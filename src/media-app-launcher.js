const fs = require('fs');
const path = require('path');

function executableCandidates(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || '').trim();
  const appData = String(env.APPDATA || '').trim();
  const programFiles = String(env.ProgramFiles || '').trim();
  const programFilesX86 = String(env['ProgramFiles(x86)'] || '').trim();
  const candidates = [
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
    {
      id: 'quark',
      label: '夸克',
      url: 'https://pan.quark.cn/',
      paths: [
        path.win32.join(localAppData, 'Programs', 'Quark', 'quark.exe'),
        path.win32.join(localAppData, 'Quark', 'Application', 'quark.exe'),
        path.win32.join(programFiles, 'Quark', 'quark.exe'),
        path.win32.join(programFilesX86, 'Quark', 'quark.exe'),
      ],
    },
  ];
  return candidates.map((candidate) => ({
    ...candidate,
    paths: candidate.paths.filter((value) => value && path.win32.isAbsolute(value)),
  }));
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
};
