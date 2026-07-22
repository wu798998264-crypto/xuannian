const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  copyMediaToFavorites,
  createMediaCollection,
  deleteMediaCollection,
  detectVideoProvider,
  bilibiliEpisodeId,
  bilibiliPlaybackAccess,
  bilibiliProgressiveOptions,
  bilibiliProgressiveApiUrl,
  bilibiliVideoIdentity,
  bilibiliViewApiUrl,
  isAllowedPortalUrl,
  listManagedMediaFiles,
  listMediaCollections,
  listMediaFiles,
  mediaKindForPath,
  moveMediaToCollection,
  musicSearchUrl,
  renameMediaCollection,
  sanitizeMediaVideoTitle,
  scoreMediaDownloadQualityLabel,
} = require('../src/media-library');
const {
  createMediaDownloadControl,
  isMediaDownloadCancelled,
} = require('../src/media-download-control');

async function run() {
  const downloadControl = createMediaDownloadControl();
  assert.strictEqual(downloadControl.pause(), true);
  let pauseReleased = false;
  const pauseWait = downloadControl.waitIfPaused().then(() => { pauseReleased = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(pauseReleased, false, 'paused downloads must stop advancing until resumed');
  assert.strictEqual(downloadControl.resume(), true);
  await pauseWait;
  assert.strictEqual(pauseReleased, true);
  let abortCalls = 0;
  downloadControl.attachAbort(() => { abortCalls += 1; });
  downloadControl.pause();
  const cancelledWait = downloadControl.waitIfPaused().catch((error) => error);
  downloadControl.cancel();
  const cancelledError = await cancelledWait;
  assert.strictEqual(abortCalls, 1);
  assert.strictEqual(isMediaDownloadCancelled(cancelledError, downloadControl), true);

  const douyin = detectVideoProvider('https://v.douyin.com/example');
  assert.strictEqual(douyin.id, 'douyin');
  assert.strictEqual(douyin.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(douyin.fallbackUrl, undefined);
  assert.deepStrictEqual(douyin.portals.map((route) => route.label), ['Seekin']);
  assert.strictEqual(douyin.portals[0].requiresVpn, undefined);
  assert.strictEqual(douyin.portals[0].url, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(douyin.autoDownloadQuality, 'highest');
  const tiktok = detectVideoProvider('https://www.tiktok.com/@example/video/1');
  assert.strictEqual(tiktok.id, 'tiktok');
  assert.strictEqual(tiktok.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(tiktok.portals[0].requiresVpn, undefined);
  assert.strictEqual(tiktok.label, 'TikTok');
  assert.strictEqual(tiktok.autoDownloadQuality, undefined);
  const bilibili = detectVideoProvider('看看这个 https://www.bilibili.com/video/BV1xx');
  assert.strictEqual(bilibili.id, 'bilibili');
  assert.strictEqual(bilibili.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.deepStrictEqual(bilibili.portals.map((route) => route.label), ['Seekin']);
  assert.strictEqual(bilibiliEpisodeId('https://www.bilibili.com/bangumi/play/ep3648907/?share_source=copy_web'), '3648907');
  assert.strictEqual(bilibiliEpisodeId('https://www.bilibili.com/video/BV1STE56zEdA'), '');
  assert.strictEqual(bilibiliProgressiveApiUrl('https://www.bilibili.com/bangumi/play/ep3648907/'), 'https://api.bilibili.com/pgc/player/web/playurl?ep_id=3648907&qn=80&fnval=0&fourk=1');
  assert.deepStrictEqual(bilibiliVideoIdentity('https://www.bilibili.com/video/BV1STE56zEdA?p=2'), { bvid: 'BV1STE56zEdA', aid: '' });
  assert.deepStrictEqual(bilibiliVideoIdentity('https://www.bilibili.com/video/av12345'), { bvid: '', aid: '12345' });
  assert.strictEqual(bilibiliViewApiUrl('https://www.bilibili.com/video/BV1STE56zEdA'), 'https://api.bilibili.com/x/web-interface/view?bvid=BV1STE56zEdA');
  assert.strictEqual(bilibiliProgressiveApiUrl('https://www.bilibili.com/video/BV1STE56zEdA', 64, '987654'), 'https://api.bilibili.com/x/player/playurl?bvid=BV1STE56zEdA&cid=987654&qn=64&fnval=0&fourk=1');
  const bilibiliPreviewPayload = {
    code: 0,
    result: {
      quality: 64,
      is_preview: 1,
      is_drm: false,
      timelength: 439296,
      durl: [{ url: 'https://cdn.example.com/member-preview.mp4', length: 60160, size: 512000 }],
    },
  };
  assert.deepStrictEqual(bilibiliPlaybackAccess(bilibiliPreviewPayload), {
    previewOnly: true,
    drm: false,
    sourceDurationMs: 439296,
    deliveredDurationMs: 60160,
  });
  assert.deepStrictEqual(bilibiliProgressiveOptions([bilibiliPreviewPayload]), [], 'one-minute Bilibili trials must never be advertised as full downloads');
  assert.strictEqual(bilibiliPlaybackAccess({
    code: 0,
    data: { timelength: 439296, durl: [{ length: 439296 }] },
  }).previewOnly, false);
  assert.strictEqual(bilibiliPlaybackAccess({
    code: 0,
    data: { timelength: 439296, durl: [{ length: 60000 }] },
  }).previewOnly, true, 'clearly truncated responses must be rejected even when the preview flag is absent');
  assert.deepStrictEqual(bilibiliProgressiveOptions([
    { code: 0, data: { quality: 32, accept_quality: [80, 64, 32, 16], accept_description: ['1080P', '720P', '480P', '360P'], durl: [{ url: 'https://cdn.example.com/video-480.mp4', size: 20 * 1024 * 1024 }] } },
    { code: 0, data: { quality: 32, accept_quality: [80, 64, 32, 16], accept_description: ['1080P', '720P', '480P', '360P'], durl: [{ url: 'https://cdn.example.com/video-480-duplicate.mp4', size: 18 * 1024 * 1024 }] } },
    { code: 0, data: { quality: 16, accept_quality: [80, 64, 32, 16], accept_description: ['1080P', '720P', '480P', '360P'], durl: [{ url: 'https://cdn.example.com/video-360.mp4', size: 10 * 1024 * 1024 }] } },
  ]), [
    { label: '480P · 20.0 MB', href: 'https://cdn.example.com/video-480.mp4', quality: 32, source: 'bilibili' },
    { label: '360P · 10.0 MB', href: 'https://cdn.example.com/video-360.mp4', quality: 16, source: 'bilibili' },
  ]);
  assert.strictEqual(detectVideoProvider('【凡人修仙传：第183话 慕兰之战07】 https://www.bilibili.com/bangumi/play/ep3854807/?share_source=copy_web').id, 'bilibili');
  assert.strictEqual(detectVideoProvider('https://xhslink.com/example').id, 'xiaohongshu');
  assert.deepStrictEqual(detectVideoProvider('https://xhslink.com/example').portals.map((route) => route.label), ['Seekin']);
  assert.strictEqual(detectVideoProvider('34 【codex制作个人作品集网站】 https://www.xiaohongshu.com/discovery/item/6a4a67270000000006036794?source=webshare&xsec_token=test').id, 'xiaohongshu');
  assert.strictEqual(detectVideoProvider('https://v.kuaishou.com/example').id, 'kuaishou');
  const kuaishou = detectVideoProvider('https://www.kuaishou.com/f/X-1NCQbuUPVIY1dm');
  assert.strictEqual(kuaishou.id, 'kuaishou');
  assert.strictEqual(kuaishou.portalUrl, 'https://www.seekin.ai/zh/downloader/');
  assert.strictEqual(kuaishou.fallbackUrl, undefined);
  assert.deepStrictEqual(kuaishou.portals.map((route) => route.label), ['Seekin']);
  const universalSources = [
    'https://www.youtube.com/watch?v=example',
    'https://www.tiktok.com/@example/video/1',
    'https://www.xiaohongshu.com/discovery/item/example',
    'https://www.instagram.com/reel/example/',
    'https://x.com/example/status/1',
    'https://v.douyin.com/example/',
    'https://www.bilibili.com/video/BV1example',
    'https://www.facebook.com/watch/?v=1',
    'https://www.kwai.com/example',
  ];
  universalSources.forEach((source) => {
    const provider = detectVideoProvider(source);
    assert(provider, 'provider should be detected for ' + source);
    assert.strictEqual(provider.portalUrl, 'https://www.seekin.ai/zh/downloader/');
    assert.strictEqual(provider.portals.length, 1);
    assert.strictEqual(provider.portals[0].url, 'https://www.seekin.ai/zh/downloader/');
  });
  assert.strictEqual(detectVideoProvider('https://youtu.be/example').id, 'youtube');
  assert.strictEqual(detectVideoProvider('https://www.instagram.com/reel/example').id, 'instagram');
  assert.strictEqual(detectVideoProvider('https://x.com/example/status/1').id, 'twitter');
  assert.strictEqual(detectVideoProvider('https://fb.watch/example').id, 'facebook');
  assert.strictEqual(detectVideoProvider('7.10 J@i.ca 10/01 《万物生》第01集 https://v.douyin.com/RSoqNxKyWQE/ 复制此链接').id, 'douyin');
  assert.strictEqual(detectVideoProvider('https://example.com/video'), null);
  assert.strictEqual(mediaKindForPath('clip.MP4'), 'video');
  assert.strictEqual(mediaKindForPath('song.flac'), 'audio');
  assert.strictEqual(mediaKindForPath('setup.exe'), '');
  assert.strictEqual(isAllowedPortalUrl('https://www.hellotik.app/zh/kuaishou'), false);
  assert.strictEqual(isAllowedPortalUrl('https://www.hellotik.app/zh/douyin'), false);
  assert.strictEqual(isAllowedPortalUrl('https://www.bilibili.com/bangumi/play/ep3648907/'), true);
  assert.strictEqual(isAllowedPortalUrl('https://evil.example/'), false);
  assert.strictEqual(musicSearchUrl('测试 歌曲'), 'https://www.gequbao.com/s/%E6%B5%8B%E8%AF%95%20%E6%AD%8C%E6%9B%B2');
  assert(scoreMediaDownloadQualityLabel('下载原画 65 MB') > scoreMediaDownloadQualityLabel('下载 4K 40 MB'));
  assert(scoreMediaDownloadQualityLabel('下载 4K 40 MB') > scoreMediaDownloadQualityLabel('下载 1080P 80 MB'));
  assert(scoreMediaDownloadQualityLabel('下载 1080P 80 MB') > scoreMediaDownloadQualityLabel('下载高清 100 MB'));
  assert(scoreMediaDownloadQualityLabel('144p Download') >= 0);
  assert(scoreMediaDownloadQualityLabel('下载 720P') > scoreMediaDownloadQualityLabel('144p Download'));
  assert(scoreMediaDownloadQualityLabel('下载无水印') >= 0);
  assert.strictEqual(scoreMediaDownloadQualityLabel('复制链接 4K'), -1);
  assert.strictEqual(scoreMediaDownloadQualityLabel('解析视频'), -1);
  assert.strictEqual(
    sanitizeMediaVideoTitle('【万物生】第01集 😆 1080P Download 42 MB https://example.com/video.mp4'),
    '【万物生】第01集',
  );
  assert.strictEqual(
    sanitizeMediaVideoTitle('免费的社交媒体视频下载', '34 【个人作品集网站】 https://www.xiaohongshu.com/discovery/item/abc 复制此链接'),
    '34 【个人作品集网站】',
  );
  assert(sanitizeMediaVideoTitle('', 'https://x.com/example/status/2034711267571609988').includes('2034711267571609988'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-media-test-'));
  const downloads = path.join(root, 'downloads');
  const favorites = path.join(root, 'favorites');
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, 'clip.mp4'), Buffer.alloc(64));
  fs.writeFileSync(path.join(downloads, 'song.mp3'), Buffer.alloc(32));
  fs.writeFileSync(path.join(downloads, 'ignore.txt'), Buffer.alloc(16));
  try {
    let items = await listMediaFiles(downloads, favorites);
    assert.deepStrictEqual(items.map((item) => item.kind).sort(), ['audio', 'video']);
    const copied = await copyMediaToFavorites(path.join(downloads, 'clip.mp4'), favorites);
    assert.strictEqual(copied.ok, true);
    assert.strictEqual(fs.existsSync(copied.path), true);
    const duplicate = await copyMediaToFavorites(path.join(downloads, 'clip.mp4'), favorites);
    assert.strictEqual(duplicate.alreadyFavorite, true);
    const created = await createMediaCollection(downloads, 'audio', '工作配乐');
    assert.strictEqual(created.ok, true);
    const moved = await moveMediaToCollection(path.join(downloads, 'song.mp3'), downloads, '工作配乐');
    assert.strictEqual(moved.ok, true);
    assert.strictEqual(fs.existsSync(moved.path), true);
    let collections = await listMediaCollections(downloads);
    assert.deepStrictEqual(collections.audio, ['工作配乐']);
    const renamed = await renameMediaCollection(downloads, 'audio', '工作配乐', '常用配乐');
    assert.strictEqual(renamed.ok, true);
    collections = await listMediaCollections(downloads);
    assert.deepStrictEqual(collections.audio, ['常用配乐']);
    let managed = await listManagedMediaFiles(downloads);
    assert.deepStrictEqual(managed.map((item) => item.name), ['song.mp3']);
    assert.strictEqual(managed.some((item) => item.name === 'clip.mp4'), false, 'cache cleanup must exclude media placed directly in the selected root');
    const removed = await deleteMediaCollection(downloads, 'audio', '常用配乐');
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(removed.moved, 1);
    assert.strictEqual(fs.existsSync(path.join(downloads, '音乐', 'song.mp3')), true);
    managed = await listManagedMediaFiles(downloads);
    assert.deepStrictEqual(managed.map((item) => item.name), ['song.mp3']);
    fs.unlinkSync(path.join(downloads, '音乐', 'song.mp3'));
    items = await listMediaFiles(downloads, favorites);
    assert.strictEqual(items.some((item) => item.name === 'song.mp3'), false);
    assert.strictEqual(items.some((item) => item.favorite), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('media library checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
