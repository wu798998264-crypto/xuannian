const assert = require('assert');
const { buildPortalScript, classifyMediaPortalPopup, isMediaUrl } = require('../src/media-portal-automation');
const { scoreMediaDownloadQualityLabel } = require('../src/media-library');

function run() {
  assert.strictEqual(classifyMediaPortalPopup('javascript:alert(1)', 'https://www.hellotik.app/zh/douyin'), 'block');
  assert.strictEqual(classifyMediaPortalPopup('https://ads.example.com/offer', 'https://www.hellotik.app/zh/douyin'), 'block');
  assert.strictEqual(classifyMediaPortalPopup('https://www.hellotik.app/result/1', 'https://www.hellotik.app/zh/douyin'), 'same-site');
  assert.strictEqual(classifyMediaPortalPopup('https://cdn.example.com/video.mp4', 'https://www.hellotik.app/zh/douyin'), 'download');
  assert.strictEqual(isMediaUrl('https://cdn.example.com/video.mp4?token=1'), true);
  assert.strictEqual(classifyMediaPortalPopup('https://cdn.example.com/video-stream.m4s?token=1', 'https://www.seekin.ai/zh/downloader/'), 'download');
  assert.strictEqual(isMediaUrl('https://cdn.example.com/video-stream.m4s?token=1'), true);
  assert.strictEqual(classifyMediaPortalPopup('https://v11.douyinvod.com/token/video/tos/cn/file/?mime_type=video_mp4', 'https://www.seekin.ai/zh/downloader/'), 'download');
  assert.strictEqual(isMediaUrl('https://v11.douyinvod.com/token/video/tos/cn/file/?mime_type=video_mp4'), true);
  assert.strictEqual(isMediaUrl('https://ads.example.com/page'), false);

  const parseScript = buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 45000 }, scoreMediaDownloadQualityLabel);
  assert(parseScript.includes("mode === 'video-parse'"));
  assert(!parseScript.includes('window.open = () => null'));
  assert(parseScript.includes('window.alert = () => undefined'));
  assert(parseScript.includes("reason: 'human-verification'"));
  assert(parseScript.includes('attemptVideoResult'));
  assert(parseScript.includes('previewUrl'));
  assert(parseScript.includes('mismatchedPlatformLink'));
  assert(parseScript.includes('hasResultEvidence'));
  assert(parseScript.includes('repeatsSourceInput'));
  assert(parseScript.includes('candidateCount'));
  assert(parseScript.includes('qualityOptions'));
  assert(parseScript.includes('imageOnlyDownload'));
  assert(parseScript.includes('audioOnlyDownload'));
  assert(parseScript.includes('content-not-video'));
  const secondCandidateScript = buildPortalScript({ mode: 'video-download', candidateIndex: 1 }, scoreMediaDownloadQualityLabel);
  assert(secondCandidateScript.includes('const requestedCandidateIndex = 1'));
  assert(secondCandidateScript.includes('candidates[requestedCandidateIndex]'));

  const musicScript = buildPortalScript({ mode: 'music-search', value: '测试歌曲' }, scoreMediaDownloadQualityLabel);
  assert(musicScript.includes('parseMusicResults'));
  assert(musicScript.includes('results.length'));
  assert(musicScript.includes('musicDownloadCandidates'));
  assert(musicScript.includes('低品质'));
  assert(musicScript.includes('finalAction'));
  assert(musicScript.includes('directAudioUrl'));
  assert(musicScript.includes("label: '普通音质'"));
  const previewScript = buildPortalScript({ mode: 'music-preview' }, scoreMediaDownloadQualityLabel);
  assert(previewScript.includes('attemptMusicPreview'));
  assert(previewScript.includes('preview-unavailable'));
  assert(previewScript.includes('qr-code-required'));
  console.log('media portal automation tests passed');
}

run();
