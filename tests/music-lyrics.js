const assert = require('assert');
const {
  extractGequbaoLyrics,
  isGequbaoMusicUrl,
} = require('../src/music-lyrics');

const fixture = `
  <main>
    <div class="content-lrc mt-1" id="content-lrc">
      [00:00.00]Song &amp; Artist<br />
      [00:03.25]Hello &#x4e16;&#30028;<br>
      [01:02.003]It&#39;s ready
    </div>
  </main>
`;

assert.strictEqual(
  extractGequbaoLyrics(fixture),
  "[00:00.00]Song & Artist\n[00:03.25]Hello 世界\n[01:02.003]It's ready\n",
);
assert.strictEqual(extractGequbaoLyrics('<div id="content-lrc">暂无歌词信息</div>'), '');
assert.strictEqual(extractGequbaoLyrics('<div>missing target</div>'), '');
assert.strictEqual(isGequbaoMusicUrl('https://www.gequbao.com/music/25924'), true);
assert.strictEqual(isGequbaoMusicUrl('https://gequbao.com/music/25924?source=test'), true);
assert.strictEqual(isGequbaoMusicUrl('http://www.gequbao.com/music/25924'), false);
assert.strictEqual(isGequbaoMusicUrl('https://example.com/music/25924'), false);

console.log('music lyrics tests passed');
