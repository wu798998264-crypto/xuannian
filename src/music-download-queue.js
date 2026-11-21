// The provider has one detail page. Release it once a transfer has claimed its
// file target, so the actual file writes can continue in parallel.
function createMusicDownloadQueue({ busy, start }) {
  const pending = [];
  let preparing = null;
  let foreground = null;

  function run() {
    if (preparing) return;
    if (foreground) {
      const request = foreground;
      foreground = null;
      try { request.resolve(request.open()); } catch (error) { request.reject(error); }
    }
    if (!pending.length || busy()) return;
    preparing = pending.shift();
    start(preparing);
  }

  return {
    add(job) {
      pending.push(job);
      run();
      return preparing !== job;
    },
    advance(id) {
      if (!preparing || preparing.taskId !== id) return;
      preparing = null;
      setImmediate(run);
    },
    wake() {
      if (!preparing && pending.length && !busy()) setImmediate(run);
    },
    remove(id) {
      const index = pending.findIndex(job => job.taskId === id);
      return index >= 0 ? pending.splice(index, 1)[0] : null;
    },
    isPreparing(id) { return preparing?.taskId === id; },
    openForeground(kind, open) {
      foreground?.resolve({ ok: false, superseded: true });
      foreground = null;
      if (!preparing) return open();
      return new Promise((resolve, reject) => { foreground = { kind, open, resolve, reject }; });
    },
    cancelForeground(kind) {
      if (foreground?.kind !== kind) return;
      foreground.resolve({ ok: false, superseded: true });
      foreground = null;
    },
  };
}

module.exports = { createMusicDownloadQueue };
