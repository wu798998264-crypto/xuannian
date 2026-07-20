const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  copyMediaToFavorites,
  detectVideoProvider,
  isAllowedPortalUrl,
  listMediaFiles,
  mediaKindForPath,
  musicSearchUrl,
} = require('../src/media-library');

async function run() {
  assert.strictEqual(detectVideoProvider('https://v.douyin.com/example').id, 'douyin-tiktok');
  assert.strictEqual(detectVideoProvider('看看这个 https://www.bilibili.com/video/BV1xx').id, 'bilibili');
  assert.strictEqual(detectVideoProvider('https://xhslink.com/example').id, 'xiaohongshu');
  assert.strictEqual(detectVideoProvider('https://v.kuaishou.com/example').id, 'kuaishou');
  assert.strictEqual(detectVideoProvider('https://example.com/video'), null);
  assert.strictEqual(mediaKindForPath('clip.MP4'), 'video');
  assert.strictEqual(mediaKindForPath('song.flac'), 'audio');
  assert.strictEqual(mediaKindForPath('setup.exe'), '');
  assert.strictEqual(isAllowedPortalUrl('https://www.hellotik.app/zh/kuaishou'), true);
  assert.strictEqual(isAllowedPortalUrl('https://evil.example/'), false);
  assert(musicSearchUrl('测试 歌曲').includes('%E6%B5%8B%E8%AF%95%20%E6%AD%8C%E6%9B%B2'));

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
    fs.unlinkSync(path.join(downloads, 'song.mp3'));
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
