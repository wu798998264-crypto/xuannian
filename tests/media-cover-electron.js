const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, nativeImage } = require('electron');
const { writeVideoCover } = require('../src/media-cover');

async function run() {
  await app.whenReady();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-cover-test-'));
  try {
    const source = path.join(__dirname, '..', 'qa-fixtures', 'xn_test_video_valid.webm');
    const destination = path.join(directory, 'cover.png');
    const result = await writeVideoCover(source, destination, 640);
    assert.strictEqual(result.path, destination);
    assert(result.bytes > 100);
    assert(result.size.width > 0 && result.size.height > 0);
    assert.strictEqual(fs.existsSync(destination), true);
    assert.strictEqual(nativeImage.createFromPath(destination).isEmpty(), false);
    console.log('media video cover generation probe passed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    app.quit();
  }
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
