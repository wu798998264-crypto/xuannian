const assert = require('assert');
const {
  buildPortalScript,
  classifyMediaPortalPopup,
  isBenignMediaPortalNavigationError,
  isCurrentMediaPortalRequest,
  isMediaUrl,
  mediaPortalLoadFailureAction,
  parseMediaSizeBytes,
  selectMediaPreviewOption,
  shouldExtendMediaPortalVideoResultWait,
  shouldRetryMediaPortalVideoAutomation,
} = require('../src/media-portal-automation');
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

  const activeRequest = { requestId: 12 };
  const staleRequest = { requestId: 11 };
  assert.strictEqual(isCurrentMediaPortalRequest(activeRequest, activeRequest, 12), true);
  assert.strictEqual(isCurrentMediaPortalRequest(staleRequest, activeRequest, 12), false);
  assert.strictEqual(isBenignMediaPortalNavigationError(new Error("ERR_ABORTED (-3) loading 'https://www.seekin.ai/zh/downloader/'")), true);
  assert.strictEqual(isBenignMediaPortalNavigationError(Object.assign(new Error('net::ERR_NAME_NOT_RESOLVED'), { errno: -105 })), false);
  assert.strictEqual(mediaPortalLoadFailureAction({
    error: new Error('net::ERR_FAILED'),
    expectedState: staleRequest,
    activeState: activeRequest,
    activeRequestId: 12,
  }), 'ignore-stale');
  assert.strictEqual(mediaPortalLoadFailureAction({
    error: new Error('ERR_ABORTED (-3)'),
    expectedState: activeRequest,
    activeState: activeRequest,
    activeRequestId: 12,
  }), 'wait-for-navigation');
  assert.strictEqual(mediaPortalLoadFailureAction({
    error: new Error('net::ERR_CONNECTION_RESET'),
    expectedState: activeRequest,
    activeState: activeRequest,
    activeRequestId: 12,
    retryCount: 0,
  }), 'retry');
  assert.strictEqual(mediaPortalLoadFailureAction({
    error: new Error('net::ERR_CONNECTION_RESET'),
    expectedState: activeRequest,
    activeState: activeRequest,
    activeRequestId: 12,
    retryCount: 2,
  }), 'fail');
  assert.strictEqual(shouldRetryMediaPortalVideoAutomation('parse-timeout', 0), true);
  assert.strictEqual(shouldRetryMediaPortalVideoAutomation('parse-timeout', 1), false);
  assert.strictEqual(shouldRetryMediaPortalVideoAutomation('content-unavailable', 0), false);
  assert.strictEqual(shouldExtendMediaPortalVideoResultWait('parse-timeout', 'result', 0), true);
  assert.strictEqual(shouldExtendMediaPortalVideoResultWait('parse-timeout', 'result', 1), false);
  assert.strictEqual(shouldExtendMediaPortalVideoResultWait('parse-timeout', 'input', 0), false);
  assert.strictEqual(parseMediaSizeBytes('Original (1.05 GB)'), Math.round(1.05 * 1024 ** 3));
  assert.strictEqual(parseMediaSizeBytes('2K (67.84 MB)'), Math.round(67.84 * 1024 ** 2));
  assert.strictEqual(parseMediaSizeBytes('Video'), 0);
  assert.deepStrictEqual(
    selectMediaPreviewOption([
      { label: 'Original (1.05 GB)', href: 'https://cdn.example.com/original.mp4' },
      { label: '1080P (79.37 MB)', href: 'https://cdn.example.com/1080.mp4' },
      { label: '2K (67.84 MB)', href: 'https://cdn.example.com/2k.mp4' },
    ], 96 * 1024 ** 2),
    {
      label: '2K (67.84 MB)',
      href: 'https://cdn.example.com/2k.mp4',
      index: 2,
      sizeBytes: Math.round(67.84 * 1024 ** 2),
    },
  );
  assert.strictEqual(selectMediaPreviewOption([
    { label: 'Original (1.05 GB)', href: 'https://cdn.example.com/original.mp4' },
  ], 96 * 1024 ** 2), null);
  assert.strictEqual(selectMediaPreviewOption([
    { label: 'Original', href: 'https://cdn.example.com/original.mp4' },
    { label: 'Video', href: 'https://cdn.example.com/video.mp4' },
  ], 96 * 1024 ** 2).index, 1);

  const parseScript = buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 45000 }, scoreMediaDownloadQualityLabel);
  assert(parseScript.includes("mode === 'video-parse'"));
  const extendedParseScript = buildPortalScript({ mode: 'video-parse', phase: 'result', timeoutMs: 75000 }, scoreMediaDownloadQualityLabel);
  assert(extendedParseScript.includes('Date.now() + 75000'));
  assert(!parseScript.includes('window.open = () => null'));
  assert(parseScript.includes('window.alert = () => undefined'));
  assert(parseScript.includes("reason: 'human-verification'"));
  assert(parseScript.includes('attemptVideoResult'));
  assert(parseScript.includes('actionLabel'));
  assert(parseScript.includes('previewUrl'));
  assert(parseScript.includes('mismatchedPlatformLink'));
  assert(parseScript.includes('hasResultEvidence'));
  assert(parseScript.includes('repeatsSourceInput'));
  assert(parseScript.includes('candidateCount'));
  assert(parseScript.includes('qualityOptions'));
  assert(parseScript.includes('imageOnlyDownload'));
  assert(parseScript.includes('audioOnlyDownload'));
  assert(parseScript.includes('content-not-video'));
  const nativeSubmitScript = buildPortalScript({ mode: 'video-parse', phase: 'input', value: 'https://example.com/video', nativeSubmit: true }, scoreMediaDownloadQualityLabel);
  assert(nativeSubmitScript.includes('const nativeSubmit = true'));
  assert(nativeSubmitScript.includes('nativeSubmitRequired: true'));
  assert(nativeSubmitScript.includes('actionPoint'));
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
