class MediaDownloadCancelledError extends Error {
  constructor(message = 'media download cancelled') {
    super(message);
    this.name = 'MediaDownloadCancelledError';
    this.code = 'MEDIA_DOWNLOAD_CANCELLED';
  }
}

function createMediaDownloadControl() {
  let paused = false;
  let cancelled = false;
  const waiters = new Set();
  const listeners = new Set();
  const aborters = new Set();

  const snapshot = () => ({ paused, cancelled });
  const notify = () => {
    const state = snapshot();
    for (const listener of [...listeners]) {
      try { listener(state); } catch {}
    }
  };
  const releaseWaiters = () => {
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };

  return {
    get paused() { return paused; },
    get cancelled() { return cancelled; },
    pause() {
      if (cancelled || paused) return !cancelled;
      paused = true;
      notify();
      return true;
    },
    resume() {
      if (cancelled) return false;
      if (!paused) return true;
      paused = false;
      releaseWaiters();
      notify();
      return true;
    },
    cancel() {
      if (cancelled) return true;
      cancelled = true;
      paused = false;
      for (const abort of [...aborters]) {
        try { abort(); } catch {}
      }
      releaseWaiters();
      notify();
      return true;
    },
    async waitIfPaused() {
      if (cancelled) throw new MediaDownloadCancelledError();
      if (paused) await new Promise((resolve) => waiters.add(resolve));
      if (cancelled) throw new MediaDownloadCancelledError();
    },
    throwIfCancelled() {
      if (cancelled) throw new MediaDownloadCancelledError();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attachAbort(abort) {
      if (typeof abort !== 'function') return () => {};
      aborters.add(abort);
      if (cancelled) {
        try { abort(); } catch {}
      }
      return () => aborters.delete(abort);
    },
    snapshot,
  };
}

function isMediaDownloadCancelled(error, control) {
  return !!control?.cancelled
    || error?.code === 'MEDIA_DOWNLOAD_CANCELLED'
    || error?.name === 'MediaDownloadCancelledError';
}

module.exports = {
  MediaDownloadCancelledError,
  createMediaDownloadControl,
  isMediaDownloadCancelled,
};
