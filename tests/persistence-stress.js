const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const {
  CoalescedAtomicJsonWriter,
  readJsonWithRecoverySync,
  writeJsonAtomicSync,
} = require('../src/data-persistence');

function syntheticSnapshot(revision) {
  return {
    revision,
    records: Array.from({ length: 500 }, (_, index) => ({
      id: `record-${index}`,
      content: `synthetic clipboard ${index} `.repeat(30),
    })),
    notes: Array.from({ length: 5000 }, (_, index) => ({
      id: `note-${index}`,
      title: index % 3 ? '' : `Synthetic ${index}`,
      content: `synthetic favorite ${index} `.repeat(24),
      projectId: `project-${index % 12}`,
      order: index,
    })),
  };
}

function removeVerifiedTempDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('xuannian-persistence-test-')) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function run() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuannian-persistence-test-'));
  try {
    const dataFile = path.join(tempDirectory, 'xuannian-data.json');
    const writer = new CoalescedAtomicJsonWriter();
    const snapshot = syntheticSnapshot(0);
    const serializedSize = Buffer.byteLength(JSON.stringify(snapshot));
    const journalSize = Buffer.byteLength(JSON.stringify({ version: 1, revision: 1, records: snapshot.records }));
    assert(journalSize < serializedSize / 5, 'bounded clipboard journal should stay much smaller than the full favorite library');
    const promises = [];
    const enqueueStarted = performance.now();
    for (let revision = 1; revision <= 100; revision += 1) {
      snapshot.revision = revision;
      promises.push(writer.enqueue([dataFile], JSON.stringify(snapshot)));
    }
    const enqueueDuration = performance.now() - enqueueStarted;
    await Promise.all(promises);

    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.strictEqual(persisted.revision, 100, 'the newest coalesced snapshot must be persisted');
    assert(writer.writeCount <= 2, `rapid saves should coalesce, received ${writer.writeCount} physical writes`);
    assert(enqueueDuration < 1500, `enqueueing synthetic snapshots took ${enqueueDuration.toFixed(1)}ms`);

    writeJsonAtomicSync(dataFile, JSON.stringify({ revision: 101, notes: [{ id: 'latest' }] }));
    fs.writeFileSync(dataFile, '{broken json', 'utf8');
    let recovered = false;
    const restored = readJsonWithRecoverySync(dataFile, null, { onRecover: () => { recovered = true; } });
    assert(recovered, 'corrupt primary data should trigger backup recovery');
    assert.strictEqual(restored.revision, 100, 'backup recovery must restore the last valid snapshot');
    assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).revision, 100, 'recovered JSON must replace the corrupt primary');

    const leftovers = fs.readdirSync(tempDirectory).filter((name) => name.includes('.tmp-'));
    assert.deepStrictEqual(leftovers, [], 'atomic persistence must clean temporary files');
    console.log(`persistence stress checks passed (${(serializedSize / 1024 / 1024).toFixed(2)} MiB full, ${(journalSize / 1024).toFixed(1)} KiB journal, ${writer.writeCount} physical write)`);
  } finally {
    removeVerifiedTempDirectory(tempDirectory);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
