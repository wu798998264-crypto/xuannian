const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  copyMediaToFavorites,
  createMediaCollection,
  deleteMediaCollection,
  detectVideoProvider,
  isAllowedPortalUrl,
  listManagedMediaFiles,
  listMediaCollections,
  listMediaFiles,
  mediaKindForPath,
  moveMediaToCollection,
  musicSearchUrl,
  renameMediaCollection,
  scoreMediaDownloadQualityLabel,
} = require('../src/media-library');

async function run() {
  const douyin = detectVideoProvider('https://v.douyin.com/example');
  assert.strictEqual(douyin.id, 'douyin');
  assert.strictEqual(douyin.portalUrl, 'https://www.hellotik.app/zh/douyin');
  assert.strictEqual(douyin.autoDownloadQuality, 'highest');
  const tiktok = detectVideoProvider('https://www.tiktok.com/@example/video/1');
  assert.strictEqual(tiktok.id, 'tiktok');
  assert.strictEqual(tiktok.portalUrl, 'https://dlpanda.com/zh-CN');
  assert(tiktok.label.includes('VPN'));
  assert.strictEqual(tiktok.autoDownloadQuality, undefined);
  assert.strictEqual(detectVideoProvider('看看这个 https://www.bilibili.com/video/BV1xx').id, 'bilibili');
  assert.strictEqual(detectVideoProvider('https://xhslink.com/example').id, 'xiaohongshu');
  assert.strictEqual(detectVideoProvider('https://v.kuaishou.com/example').id, 'kuaishou');
  assert.strictEqual(detectVideoProvider('https://example.com/video'), null);
  assert.strictEqual(mediaKindForPath('clip.MP4'), 'video');
  assert.strictEqual(mediaKindForPath('song.flac'), 'audio');
  assert.strictEqual(mediaKindForPath('setup.exe'), '');
  assert.strictEqual(isAllowedPortalUrl('https://www.hellotik.app/zh/kuaishou'), true);
  assert.strictEqual(isAllowedPortalUrl('https://www.hellotik.app/zh/douyin'), true);
  assert.strictEqual(isAllowedPortalUrl('https://evil.example/'), false);
  assert.strictEqual(musicSearchUrl('测试 歌曲'), 'https://www.gequbao.com/');
  assert(scoreMediaDownloadQualityLabel('下载原画 65 MB') > scoreMediaDownloadQualityLabel('下载 4K 40 MB'));
  assert(scoreMediaDownloadQualityLabel('下载 4K 40 MB') > scoreMediaDownloadQualityLabel('下载 1080P 80 MB'));
  assert(scoreMediaDownloadQualityLabel('下载 1080P 80 MB') > scoreMediaDownloadQualityLabel('下载高清 100 MB'));
  assert(scoreMediaDownloadQualityLabel('下载无水印') >= 0);
  assert.strictEqual(scoreMediaDownloadQualityLabel('复制链接 4K'), -1);
  assert.strictEqual(scoreMediaDownloadQualityLabel('解析视频'), -1);

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
