const assert = require('assert');
const { buildPortalScript, classifyMediaPortalPopup, isMediaUrl } = require('../src/media-portal-automation');
const { scoreMediaDownloadQualityLabel } = require('../src/media-library');

function run() {
  assert.strictEqual(classifyMediaPortalPopup('javascript:alert(1)', 'https://www.hellotik.app/zh/douyin'), 'block');
  assert.strictEqual(classifyMediaPortalPopup('https://ads.example.com/offer', 'https://www.hellotik.app/zh/douyin'), 'block');
  assert.strictEqual(classifyMediaPortalPopup('https://www.hellotik.app/result/1', 'https://www.hellotik.app/zh/douyin'), 'same-site');
  assert.strictEqual(classifyMediaPortalPopup('https://cdn.example.com/video.mp4', 'https://www.hellotik.app/zh/douyin'), 'download');
  assert.strictEqual(isMediaUrl('https://cdn.example.com/video.mp4?token=1'), true);
  assert.strictEqual(isMediaUrl('https://ads.example.com/page'), false);

  const parseScript = buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 45000 }, scoreMediaDownloadQualityLabel);
  assert(parseScript.includes("mode === 'video-parse'"));
  assert(!parseScript.includes('window.open = () => null'));
  assert(parseScript.includes('window.alert = () => undefined'));
  assert(parseScript.includes("reason: 'human-verification'"));
  assert(parseScript.includes('attemptVideoResult'));
  assert(parseScript.includes('previewUrl'));

  const musicScript = buildPortalScript({ mode: 'music-search', value: '测试歌曲' }, scoreMediaDownloadQualityLabel);
  assert(musicScript.includes('parseMusicResults'));
  assert(musicScript.includes('results.length'));
  console.log('media portal automation tests passed');
}

run();
