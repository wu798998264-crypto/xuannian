const fs = require('fs');
const path = require('path');

function uniqueTargets(targets = []) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target) return false;
    const resolved = path.resolve(target);
    const key = process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function temporaryPath(file, label = 'tmp') {
  return `${file}.${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function replaceFile(source, target) {
  try {
    await fs.promises.rename(source, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
    await fs.promises.unlink(target).catch((unlinkError) => {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    });
    await fs.promises.rename(source, target);
  }
}

function replaceFileSync(source, target) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
    try {
      fs.unlinkSync(target);
    } catch (unlinkError) {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    }
    fs.renameSync(source, target);
  }
}

async function createBackup(file) {
  try {
    await fs.promises.access(file, fs.constants.F_OK);
  } catch {
    return;
  }
  const backup = `${file}.bak`;
  const backupTemp = temporaryPath(backup, 'tmp');
  try {
    await fs.promises.copyFile(file, backupTemp);
    await replaceFile(backupTemp, backup);
  } finally {
    await fs.promises.unlink(backupTemp).catch(() => {});
  }
}

function createBackupSync(file) {
  if (!fs.existsSync(file)) return;
  const backup = `${file}.bak`;
  const backupTemp = temporaryPath(backup, 'tmp');
  try {
    fs.copyFileSync(file, backupTemp);
    replaceFileSync(backupTemp, backup);
  } finally {
    try {
      fs.unlinkSync(backupTemp);
    } catch {}
  }
}

async function writeJsonAtomic(file, serialized, options = {}) {
  const target = path.resolve(file);
  const temp = temporaryPath(target);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  let handle;
  try {
    handle = await fs.promises.open(temp, 'wx');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.backup !== false) await createBackup(target);
    await replaceFile(temp, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.unlink(temp).catch(() => {});
  }
}

function writeJsonAtomicSync(file, serialized, options = {}) {
  const target = path.resolve(file);
  const temp = temporaryPath(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx');
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (options.backup !== false) createBackupSync(target);
    replaceFileSync(temp, target);
  } finally {
    if (descriptor !== undefined && descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}

function parseJsonFileSync(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

function readJsonWithRecoverySync(file, fallback, options = {}) {
  const primary = parseJsonFileSync(file);
  if (primary.ok) return primary.value;
  const backupFile = `${file}.bak`;
  const backup = parseJsonFileSync(backupFile);
  if (!backup.ok) return fallback;
  if (options.restore !== false) {
    try {
      writeJsonAtomicSync(file, JSON.stringify(backup.value), { backup: false });
    } catch {}
  }
  options.onRecover?.({ file, backupFile, primaryError: primary.error });
  return backup.value;
}

class CoalescedAtomicJsonWriter {
  constructor(options = {}) {
    this.pending = null;
    this.running = false;
    this.sequence = 0;
    this.persistedSequence = 0;
    this.waiters = [];
    this.writeCount = 0;
    this.lastFailure = null;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
  }

  enqueue(targets, serialized) {
    const sequence = ++this.sequence;
    this.lastFailure = null;
    const promise = new Promise((resolve, reject) => {
      this.waiters.push({ sequence, resolve, reject });
    });
    this.pending = { sequence, targets: uniqueTargets(targets), serialized };
    queueMicrotask(() => this.drain());
    return promise;
  }

  flush() {
    const sequence = this.sequence;
    if (!sequence || this.persistedSequence >= sequence) return Promise.resolve();
    if (this.lastFailure?.sequence >= sequence) return Promise.reject(this.lastFailure.error);
    return new Promise((resolve, reject) => {
      this.waiters.push({ sequence, resolve, reject });
      queueMicrotask(() => this.drain());
    });
  }

  hasPending() {
    return this.running || !!this.pending || this.persistedSequence < this.sequence;
  }

  resolveWaiters(sequence) {
    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.sequence <= sequence) waiter.resolve();
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }

  rejectWaiters(sequence, error) {
    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.sequence <= sequence) waiter.reject(error);
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        try {
          await Promise.all(job.targets.map((target) => writeJsonAtomic(target, job.serialized)));
          this.writeCount += 1;
          this.persistedSequence = job.sequence;
          this.lastFailure = null;
          this.resolveWaiters(job.sequence);
        } catch (error) {
          this.onError?.(error);
          if (!this.pending) {
            this.lastFailure = { sequence: job.sequence, error };
            this.rejectWaiters(job.sequence, error);
          }
        }
      }
    } finally {
      this.running = false;
      if (this.pending) queueMicrotask(() => this.drain());
    }
  }
}

module.exports = {
  CoalescedAtomicJsonWriter,
  readJsonWithRecoverySync,
  writeJsonAtomic,
  writeJsonAtomicSync,
};
