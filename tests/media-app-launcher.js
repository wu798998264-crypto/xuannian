const assert = require('assert');
const path = require('path');
const { executableCandidates, findInstalledMusicClient } = require('../src/media-app-launcher');

function run() {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    APPDATA: 'C:\\Users\\Test\\AppData\\Roaming',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  };
  const candidates = executableCandidates(env);
  assert.strictEqual(candidates[0].id, 'aliyun-drive');
  assert.strictEqual(candidates[1].id, 'quark');
  const quarkPath = path.win32.join(env.LOCALAPPDATA, 'Programs', 'Quark', 'quark.exe');
  const detected = findInstalledMusicClient({ env, existsSync: (value) => value === quarkPath });
  assert.strictEqual(detected.id, 'quark');
  assert.strictEqual(detected.executablePath, quarkPath);
  assert.strictEqual(findInstalledMusicClient({ env, existsSync: () => false }), null);
  console.log('media app launcher tests passed');
}

run();
