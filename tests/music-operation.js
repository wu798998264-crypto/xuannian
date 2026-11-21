const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { musicOperationDeadline, musicOperationTimeoutReason, executeMusicPageScript } = require('../src/music-operation');
const { createMusicDownloadQueue } = require('../src/music-download-queue');

class Page extends EventEmitter {
  loading = false;
  destroyed = false;
  calls = 0;
  isLoading() { return this.loading; }
  isDestroyed() { return this.destroyed; }
  executeJavaScript(...args) { this.calls += 1; this.scriptArguments = args; return new Promise(resolve => { this.resolveScript = resolve; }); }
}

async function run() {
  const started = [];
  let portalBusy = true;
  const queue = createMusicDownloadQueue({ busy: () => portalBusy, start: job => started.push(job) });
  const jobs = Array.from({ length: 17 }, (_, i) => ({
    taskId: String(i + 1), url: '/music/' + (i + 1), location: i % 2 ? 'favorite' : 'download', collection: i % 2 ? '歌单' : '',
  }));
  for (const job of jobs) assert.equal(queue.add(job), true);
  assert.equal(started.length, 0, 'Queue must preserve the current search until its result is ready.');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  portalBusy = false;
  queue.wake();
  await tick();
  assert.deepEqual(started, [jobs[0]]);
  const oldSearch = queue.openForeground('audio', () => assert.fail('Superseded request opened the portal'));
  const newPreview = queue.openForeground('audio', () => { portalBusy = true; return 'preview'; });
  assert.equal((await oldSearch).superseded, true);
  assert.deepEqual(queue.remove('5'), jobs[4]);
  queue.advance('5'); // Cancelling a queued song must not release the current one.
  await tick();
  assert.deepEqual(started, [jobs[0]]);
  queue.advance('1');
  assert.equal(await newPreview, 'preview');
  assert.equal(started.length, 1);
  portalBusy = false;
  queue.wake();
  await tick();
  const cleared = queue.openForeground('video', () => assert.fail('Cleared video reopened the portal'));
  queue.cancelForeground('video');
  assert.equal((await cleared).superseded, true);
  const expected = jobs.filter(job => job.taskId !== '5');
  for (const job of expected.slice(1)) {
    assert.equal(queue.isPreparing(job.taskId), true);
    queue.advance(job.taskId); // A transfer start, failure or cancellation releases just this job.
    await tick();
  }
  assert.deepEqual(started, expected, 'All sixteen accepted jobs must start once, with the original destination and order.');
  const extra = { taskId: '18' };
  assert.equal(queue.add(extra), false, 'Starting after 10+ completed tasks must not require clearing history.');
  assert.equal(started.at(-1), extra);

  const start = 10000;
  assert.equal(musicOperationDeadline('music-search', start), start + 45000);
  assert.equal(musicOperationDeadline('music-preview', start), start + 45000);
  assert.equal(musicOperationDeadline('music-download', start), start + 65000);
  assert.equal(musicOperationDeadline('video-parse', start), 0);
  assert.equal(musicOperationTimeoutReason({ automationMode: 'music-search' }), 'search-timeout');
  assert.equal(musicOperationTimeoutReason({ automationMode: 'music-preview' }), 'preview-unavailable');
  assert.equal(musicOperationTimeoutReason({ automationMode: 'music-download' }), 'download-timeout');
  assert.equal(musicOperationTimeoutReason({ automationMode: 'music-search', automaticSecurityCheck: true }), 'security-check-timeout');

  const page = new Page();
  page.loading = true;
  for (let i = 0; i < 30; i++) await assert.rejects(executeMusicPageScript(page, 'read()'), { code: 'music-page-loading' });
  assert.equal(page.calls, 0, 'Loading reads must never queue native did-stop-loading listeners.');
  assert.equal(page.eventNames().length, 0);
  page.loading = false;
  page.musicManagedChallenge = true;
  for (let i = 0; i < 30; i++) await assert.rejects(executeMusicPageScript(page, 'read()'), { code: 'music-page-loading' });
  assert.equal(page.calls, 0, 'Managed challenge documents must run without application script injection.');
  assert.equal(page.eventNames().length, 0, 'Skipped challenge reads must not attach navigation or loading observers.');
  page.musicManagedChallenge = false;
  for (let i = 0; i < 30; i++) {
    const pending = executeMusicPageScript(page, 'longRunningPagePromise()');
    const rejected = assert.rejects(pending, { code: 'music-page-navigation' });
    page.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    assert.equal(page.listenerCount('did-start-navigation'), 1, 'Subframe or same-document navigation must preserve the active document.');
    page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await rejected;
    assert.equal(page.eventNames().length, 0, 'Repeated reloads must clean up every active listener.');
    page.resolveScript({ stale: true });
  }
  const controller = new AbortController();
  const cancelled = executeMusicPageScript(page, 'pending()', controller.signal);
  const cancellation = assert.rejects(cancelled, { code: 'music-operation-cancelled' });
  controller.abort();
  await cancellation;
  assert.equal(page.eventNames().length, 0, 'Changing query or clearing search must release the previous page Promise.');
  await assert.rejects(executeMusicPageScript(page, 'pending()', controller.signal), { code: 'music-operation-cancelled' });

  const completed = executeMusicPageScript(page, 'results()');
  assert.deepEqual(page.scriptArguments, ['results()'], 'Reading page results must not impersonate a user gesture.');
  page.resolveScript({ results: ['song'] });
  assert.deepEqual(await completed, { results: ['song'] });
  assert.equal(page.eventNames().length, 0, 'Successful scripts must remove navigation and destruction observers.');
  const destroyed = executeMusicPageScript(page, 'pending()');
  const destruction = assert.rejects(destroyed, { code: 'music-operation-cancelled' });
  page.emit('destroyed');
  await destruction;
  assert.equal(page.eventNames().length, 0);
  console.log('music operation lifecycle passed: reload cancellation, loading/challenge guards, ordinary result reads, abort cleanup, fixed wall-clock limits');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
