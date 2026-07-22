const assert = require('assert');
const path = require('path');
const {
  executableCandidates,
  findInstalledMusicClient,
  highQualityMusicSearchUrl,
  musicClientLaunchArguments,
} = require('../src/media-app-launcher');

function run() {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    APPDATA: 'C:\\Users\\Test\\AppData\\Roaming',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  };
  const candidates = executableCandidates(env);
  assert.strictEqual(candidates[0].id, 'quark');
  assert.strictEqual(candidates[1].id, 'aliyun-drive');
  const quarkPath = path.win32.join(env.LOCALAPPDATA, 'Programs', 'Quark', 'quark.exe');
  const detected = findInstalledMusicClient({ env, existsSync: (value) => value === quarkPath });
  assert.strictEqual(detected.id, 'quark');
  assert.strictEqual(detected.executablePath, quarkPath);
  assert.strictEqual(findInstalledMusicClient({ env, existsSync: () => false }), null);
  assert.strictEqual(
    highQualityMusicSearchUrl('南山雪 - 叶里'),
    'https://quark.sm.cn/s?q=%E5%8D%97%E5%B1%B1%E9%9B%AA%20-%20%E5%8F%B6%E9%87%8C%20%E6%97%A0%E6%8D%9F%20FLAC%20%E5%A4%B8%E5%85%8B%E7%BD%91%E7%9B%98',
  );
  assert.deepStrictEqual(
    musicClientLaunchArguments({ id: 'quark' }, '南山雪'),
    ['--brand-quark', 'https://quark.sm.cn/s?q=%E5%8D%97%E5%B1%B1%E9%9B%AA%20%E6%97%A0%E6%8D%9F%20FLAC%20%E5%A4%B8%E5%85%8B%E7%BD%91%E7%9B%98'],
  );
  console.log('media app launcher tests passed');
}

run();
