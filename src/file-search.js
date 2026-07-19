const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const EVERYTHING_INSTANCE = 'XuanNianSearch';
const EVERYTHING_SERVICE_NAME = `Everything (${EVERYTHING_INSTANCE})`;
const MAX_QUERY_LENGTH = 240;
const MAX_RESULTS = 2000;
const DEFAULT_RESULTS = 300;
const WINDOWS_BINARY_HASHES = {
  'Everything.exe': 'f191f756996a14a11e5445fa7103d302efd510cf2fbf920e6c0c8ed51d512e36',
  'es.exe': '9a9b851f9da14a29626126d9b5f8ef71b569b3cf7e3e70bfbf57f4f00a9b9383',
};

function clampLimit(value) {
  const parsed = Number(value || DEFAULT_RESULTS);
  if (!Number.isFinite(parsed)) return DEFAULT_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS, Math.round(parsed)));
}

function normalizeQuery(value) {
  return String(value || '')
    .replace(/[\0\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function normalizeOptions(options = {}) {
  const type = ['all', 'file', 'folder'].includes(options.type) ? options.type : 'all';
  const sort = ['name', 'path', 'size', 'modified'].includes(options.sort) ? options.sort : 'name';
  const direction = options.direction === 'desc' ? 'desc' : 'asc';
  return { type, sort, direction, limit: clampLimit(options.limit) };
}

function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function normalizedHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function parseEverythingCsv(text) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizedHeader);
  const indexOf = (...names) => headers.findIndex((value) => names.includes(value));
  const nameIndex = indexOf('name', 'filename');
  const pathIndex = indexOf('path');
  const sizeIndex = indexOf('size');
  const modifiedIndex = indexOf('datemodified', 'modified');
  const attributesIndex = indexOf('attributes', 'attribs', 'attrib');
  if (nameIndex < 0) return [];
  const results = [];
  for (const columns of rows.slice(1)) {
    const name = String(columns[nameIndex] || '').trim();
    const directory = pathIndex >= 0 ? String(columns[pathIndex] || '').trim() : '';
    if (!name) continue;
    const fullPath = directory ? path.win32.join(directory, name) : name;
    const attributes = attributesIndex >= 0 ? String(columns[attributesIndex] || '') : '';
    const rawSize = sizeIndex >= 0 ? String(columns[sizeIndex] || '').replace(/,/g, '').trim() : '';
    const size = rawSize !== '' && Number.isFinite(Number(rawSize)) ? Number(rawSize) : null;
    const modifiedText = modifiedIndex >= 0 ? String(columns[modifiedIndex] || '').trim() : '';
    const modifiedAt = modifiedText && !Number.isNaN(Date.parse(modifiedText)) ? Date.parse(modifiedText) : null;
    results.push({
      path: fullPath,
      name,
      directory,
      kind: /d/i.test(attributes) ? 'folder' : 'file',
      size,
      modifiedAt,
    });
  }
  return results;
}

function compareResults(a, b, sort, direction) {
  let result = 0;
  if (sort === 'size') result = Number(a.size ?? -1) - Number(b.size ?? -1);
  else if (sort === 'modified') result = Number(a.modifiedAt || 0) - Number(b.modifiedAt || 0);
  else if (sort === 'path') result = String(a.directory || '').localeCompare(String(b.directory || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
  else result = String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
  if (result === 0) result = String(a.path || '').localeCompare(String(b.path || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
  return direction === 'desc' ? -result : result;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function runCapture(executable, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options.spawnOptions,
    });
    options.onChild?.(child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: -1, stdout, stderr, timedOut: true });
    }, Math.max(250, Number(options.timeout || 5000)));
    child.on('error', (error) => finish({ code: -1, stdout, stderr: error.message, error }));
    child.on('close', (code) => finish({ code: Number(code ?? -1), stdout, stderr }));
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

class FileSearchService {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.userDataPath = options.userDataPath || '';
    this.resourcesPath = options.resourcesPath || process.resourcesPath || '';
    this.appPath = options.appPath || process.cwd();
    this.isPackaged = !!options.isPackaged;
    this.activeQuery = null;
    this.queryGeneration = 0;
    this.managedClientStarted = false;
    this.activeWindowsInstance = null;
    this.lastWindowsStatus = null;
    this.lastWindowsStatusAt = 0;
    this.windowsEngine = null;
    this.helperProcess = null;
    this.helperStartPromise = null;
    this.helperStartResolve = null;
    this.helperStartReject = null;
    this.helperStartTimer = null;
    this.helperStdoutBuffer = '';
    this.helperPending = new Map();
    this.helperRequestId = 0;
  }

  windowsResourceDirectory() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'search-engine', 'windows')
      : path.join(this.appPath, 'vendor', 'everything', 'windows');
  }

  windowsEngineDirectory() {
    return path.join(this.userDataPath, 'search-engine');
  }

  windowsHelperSource() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'native', 'XuanNianFileSearchHelper.exe')
      : path.join(this.appPath, 'src', 'native', 'XuanNianFileSearchHelper.exe');
  }

  ensureWindowsEngineFiles() {
    if (this.platform !== 'win32') return null;
    if (this.windowsEngine && Object.values(this.windowsEngine).every((file) => fs.existsSync(file))) {
      return this.windowsEngine;
    }
    const sourceDirectory = this.windowsResourceDirectory();
    const targetDirectory = this.windowsEngineDirectory();
    fs.mkdirSync(targetDirectory, { recursive: true });
    for (const fileName of ['Everything.exe', 'es.exe', 'LICENSE-Everything.txt', 'LICENSE-ES.txt']) {
      const source = path.join(sourceDirectory, fileName);
      const target = path.join(targetDirectory, fileName);
      if (!fs.existsSync(source)) throw new Error(`搜索引擎资源缺失：${fileName}`);
      const expectedHash = WINDOWS_BINARY_HASHES[fileName];
      const currentMatches = fs.existsSync(target) && (!expectedHash || sha256File(target) === expectedHash);
      if (!currentMatches) fs.copyFileSync(source, target);
    }
    const helperSource = this.windowsHelperSource();
    const helperTarget = path.join(targetDirectory, 'XuanNianFileSearchHelper.exe');
    if (!fs.existsSync(helperSource)) throw new Error('搜索助手资源缺失');
    const helperMatches = fs.existsSync(helperTarget) && sha256File(helperTarget) === sha256File(helperSource);
    if (!helperMatches) fs.copyFileSync(helperSource, helperTarget);
    const configPath = path.join(targetDirectory, 'XuanNianSearch.ini');
    const config = [
      '[Everything]',
      'run_as_admin=0',
      'show_tray_icon=0',
      'minimize_to_tray=0',
      'check_for_updates_on_startup=0',
      'allow_multiple_windows=0',
      'language=2052',
      '',
    ].join('\r\n');
    if (!fs.existsSync(configPath) || fs.readFileSync(configPath, 'utf8') !== config) {
      fs.writeFileSync(configPath, config, 'utf8');
    }
    this.windowsEngine = {
      directory: targetDirectory,
      everything: path.join(targetDirectory, 'Everything.exe'),
      es: path.join(targetDirectory, 'es.exe'),
      helper: helperTarget,
      config: configPath,
    };
    return this.windowsEngine;
  }

  finishHelperStartup(error) {
    if (this.helperStartTimer) clearTimeout(this.helperStartTimer);
    this.helperStartTimer = null;
    const resolve = this.helperStartResolve;
    const reject = this.helperStartReject;
    this.helperStartResolve = null;
    this.helperStartReject = null;
    if (error) reject?.(error);
    else resolve?.();
  }

  failHelperRequests(error) {
    for (const pending of this.helperPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.helperPending.clear();
  }

  handleHelperExit(error = new Error('搜索助手已退出')) {
    this.finishHelperStartup(error);
    this.failHelperRequests(error);
    this.helperProcess = null;
    this.helperStartPromise = null;
    this.helperStdoutBuffer = '';
  }

  handleHelperLine(line) {
    if (line === 'READY') {
      this.finishHelperStartup();
      return;
    }
    const fields = String(line || '').split('\t');
    if (fields.length < 3 || (fields[0] !== 'R' && fields[0] !== 'E')) return;
    const requestId = Number(fields[1]);
    const pending = this.helperPending.get(requestId);
    if (!pending) return;
    this.helperPending.delete(requestId);
    clearTimeout(pending.timer);
    let decoded = '';
    try {
      decoded = Buffer.from(fields[2], 'base64').toString('utf8');
    } catch {
      pending.reject(new Error('搜索助手返回了无效数据'));
      return;
    }
    if (fields[0] === 'E') {
      pending.reject(new Error(decoded || '文件索引查询失败'));
      return;
    }
    try {
      pending.resolve(JSON.parse(decoded));
    } catch {
      pending.reject(new Error('搜索助手返回了无效结果'));
    }
  }

  async startWindowsHelper(engine) {
    if (this.helperStartPromise) return this.helperStartPromise;
    this.helperStartPromise = new Promise((resolve, reject) => {
      this.helperStartResolve = resolve;
      this.helperStartReject = reject;
      let child;
      try {
        child = spawn(engine.helper, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        this.handleHelperExit(error);
        return;
      }
      this.helperProcess = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        this.helperStdoutBuffer += chunk;
        const lines = this.helperStdoutBuffer.split(/\r?\n/);
        this.helperStdoutBuffer = lines.pop() || '';
        for (const line of lines) this.handleHelperLine(line);
      });
      child.stderr.on('data', () => {});
      child.on('error', (error) => this.handleHelperExit(error));
      child.on('close', () => this.handleHelperExit());
      this.helperStartTimer = setTimeout(() => {
        const error = new Error('搜索助手启动超时');
        try { child.kill(); } catch {}
        this.handleHelperExit(error);
      }, 3000);
    });
    return this.helperStartPromise;
  }

  cancelHelperQueries() {
    const error = new Error('搜索已取消');
    error.code = 'SEARCH_CANCELED';
    this.failHelperRequests(error);
  }

  stopWindowsHelper() {
    const child = this.helperProcess;
    if (!child) return;
    try { child.stdin.write('EXIT\n'); } catch {}
    setTimeout(() => {
      if (this.helperProcess === child) {
        try { child.kill(); } catch {}
      }
    }, 300).unref?.();
  }

  async queryWindowsHelper(engine, instance, query, options, generation) {
    await this.startWindowsHelper(engine);
    if (generation !== this.queryGeneration) {
      const error = new Error('搜索已取消');
      error.code = 'SEARCH_CANCELED';
      throw error;
    }
    const child = this.helperProcess;
    if (!child?.stdin?.writable) throw new Error('搜索助手不可用');
    this.helperRequestId = (this.helperRequestId + 1) >>> 0;
    if (!this.helperRequestId) this.helperRequestId = 1;
    const requestId = this.helperRequestId;
    const encode = (value) => Buffer.from(String(value || ''), 'utf8').toString('base64');
    const command = [
      'Q', requestId, encode(instance), encode(query), options.type,
      options.sort, options.direction, options.limit,
    ].join('\t');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.helperPending.delete(requestId);
        reject(new Error('文件索引查询超时'));
        this.stopWindowsHelper();
      }, 5500);
      this.helperPending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${command}\n`, (error) => {
        if (!error) return;
        const pending = this.helperPending.get(requestId);
        if (!pending) return;
        this.helperPending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  windowsArgs(instance, args = []) {
    return instance ? ['-instance', instance, ...args] : args;
  }

  async windowsResultCount(engine, instance) {
    const result = await runCapture(engine.es, this.windowsArgs(instance, [
      '-timeout', '2000', '-get-result-count', '*',
    ]), { timeout: 3500 });
    if (result.code !== 0) return { connected: false, count: 0, code: result.code };
    const count = Number(String(result.stdout || '').replace(/[^0-9]/g, ''));
    return { connected: true, count: Number.isFinite(count) ? count : 0, code: 0 };
  }

  async isManagedServiceInstalled() {
    return new Promise((resolve) => {
      execFile('sc.exe', ['query', EVERYTHING_SERVICE_NAME], { windowsHide: true, timeout: 2500 }, (error) => {
        resolve(!error);
      });
    });
  }

  startManagedClient(engine) {
    if (this.managedClientStarted) return;
    this.managedClientStarted = true;
    try {
      const child = spawn(engine.everything, [
        '-instance', EVERYTHING_INSTANCE,
        '-config', engine.config,
        '-startup',
      ], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.unref();
    } catch {
      this.managedClientStarted = false;
    }
  }

  async getWindowsStatus(options = {}) {
    const now = Date.now();
    if (!options.force && this.lastWindowsStatus && now - this.lastWindowsStatusAt < 1200) return this.lastWindowsStatus;
    let engine;
    try {
      engine = this.ensureWindowsEngineFiles();
    } catch (error) {
      return { platform: 'win32', engine: 'everything', status: 'error', ready: false, message: error.message };
    }

    if (this.activeWindowsInstance !== EVERYTHING_INSTANCE) {
      const existing = await this.windowsResultCount(engine, '');
      if (existing.connected && existing.count > 0) {
        this.activeWindowsInstance = '';
        this.lastWindowsStatus = {
          platform: 'win32', engine: 'everything', status: 'ready', ready: true,
          managed: false, indexedItems: existing.count, message: '已连接本机文件索引',
        };
        this.lastWindowsStatusAt = Date.now();
        return this.lastWindowsStatus;
      }
    }

    const serviceInstalled = await this.isManagedServiceInstalled();
    if (!serviceInstalled) {
      this.lastWindowsStatus = {
        platform: 'win32', engine: 'everything', status: 'needs-initialization', ready: false,
        managed: true, indexedItems: 0, message: '首次使用需要初始化极速文件索引',
      };
      this.lastWindowsStatusAt = Date.now();
      return this.lastWindowsStatus;
    }

    this.startManagedClient(engine);
    await new Promise((resolve) => setTimeout(resolve, options.force ? 500 : 120));
    const managed = await this.windowsResultCount(engine, EVERYTHING_INSTANCE);
    this.activeWindowsInstance = EVERYTHING_INSTANCE;
    this.lastWindowsStatus = managed.connected && managed.count > 0
      ? {
          platform: 'win32', engine: 'everything', status: 'ready', ready: true,
          managed: true, indexedItems: managed.count, message: '全盘索引已就绪',
        }
      : {
          platform: 'win32', engine: 'everything', status: 'indexing', ready: false,
          managed: true, indexedItems: managed.count, message: '正在建立首次索引，请稍候',
        };
    this.lastWindowsStatusAt = Date.now();
    return this.lastWindowsStatus;
  }

  async getStatus(options = {}) {
    if (this.platform === 'win32') return this.getWindowsStatus(options);
    if (this.platform === 'darwin') {
      return fs.existsSync('/usr/bin/mdfind')
        ? { platform: 'darwin', engine: 'spotlight', status: 'ready', ready: true, managed: false, message: 'Spotlight 索引已就绪' }
        : { platform: 'darwin', engine: 'spotlight', status: 'error', ready: false, managed: false, message: '系统 Spotlight 搜索不可用' };
    }
    return { platform: this.platform, engine: 'none', status: 'unsupported', ready: false, message: '当前系统暂不支持全盘查找' };
  }

  async initialize() {
    if (this.platform !== 'win32') return this.getStatus({ force: true });
    const engine = this.ensureWindowsEngineFiles();
    const existing = await this.getWindowsStatus({ force: true });
    if (existing.ready || existing.status === 'indexing') return existing;

    const installCode = await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (code = null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(code);
      };
      try {
        const script = [
          `$process = Start-Process -FilePath '${engine.everything.replace(/'/g, "''")}'`,
          `-ArgumentList @('-instance','${EVERYTHING_INSTANCE}','-install-service')`,
          '-Verb RunAs -WindowStyle Hidden -Wait -PassThru;',
          'if ($process) { exit $process.ExitCode } else { exit 1 }',
        ].join(' ');
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const child = spawn('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
        ], { windowsHide: true, stdio: 'ignore' });
        child.on('error', () => finish(-1));
        child.on('close', (code) => finish(Number(code ?? -1)));
        timer = setTimeout(() => finish(null), 30000);
      } catch {
        finish(-1);
      }
    });

    if (installCode !== 0 && !(await this.isManagedServiceInstalled())) {
      this.lastWindowsStatus = null;
      return this.getWindowsStatus({ force: true });
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await this.isManagedServiceInstalled()) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.managedClientStarted = false;
    this.lastWindowsStatus = null;
    return this.getWindowsStatus({ force: true });
  }

  async prewarm() {
    if (this.platform !== 'win32') return this.getStatus();
    const status = await this.getWindowsStatus();
    if (status.ready) {
      const engine = this.ensureWindowsEngineFiles();
      await this.startWindowsHelper(engine);
    }
    return status;
  }

  cancel() {
    this.queryGeneration += 1;
    this.cancelHelperQueries();
    if (this.activeQuery) {
      try { this.activeQuery.kill(); } catch {}
      this.activeQuery = null;
    }
    return true;
  }

  async searchWindows(query, options) {
    const status = this.lastWindowsStatus?.ready
      ? this.lastWindowsStatus
      : await this.getWindowsStatus({ force: true });
    if (!status.ready) return { ...status, query, results: [], truncated: false, elapsedMs: 0 };
    const engine = this.ensureWindowsEngineFiles();
    const instance = this.activeWindowsInstance ?? EVERYTHING_INSTANCE;
    const startedAt = Date.now();
    const generation = ++this.queryGeneration;
    this.cancelHelperQueries();
    if (this.activeQuery) {
      try { this.activeQuery.kill(); } catch {}
      this.activeQuery = null;
    }
    try {
      const payload = await this.queryWindowsHelper(engine, instance, query, options, generation);
      if (generation !== this.queryGeneration) {
        return { platform: 'win32', engine: 'everything', status: 'canceled', ready: true, query, results: [], truncated: false, elapsedMs: Date.now() - startedAt };
      }
      const results = Array.isArray(payload.results) ? payload.results.slice(0, options.limit) : [];
      return {
        platform: 'win32', engine: 'everything', status: 'ready', ready: true, query, results,
        truncated: Number(payload.total || 0) > results.length,
        elapsedMs: Number(payload.elapsedMs || 0),
      };
    } catch {
      if (generation !== this.queryGeneration) {
        return { platform: 'win32', engine: 'everything', status: 'canceled', ready: true, query, results: [], truncated: false, elapsedMs: Date.now() - startedAt };
      }
    }
    const sortNames = { name: 'name', path: 'path', size: 'size', modified: 'date-modified' };
    const args = this.windowsArgs(instance, [
      '-timeout', '5000',
      '-n', String(options.limit),
      '-csv', '-utf8-bom',
      '-name', '-path-column', '-size', '-dm', '-attributes',
      '-date-format', '1', '-size-format', '1', '-no-digit-grouping',
      '-sort', `${sortNames[options.sort]}-${options.direction === 'desc' ? 'descending' : 'ascending'}`,
    ]);
    if (options.type === 'file') args.push('/a-d');
    if (options.type === 'folder') args.push('/ad');
    args.push(query);
    const result = await runCapture(engine.es, args, {
      timeout: 8000,
      onChild: (child) => { this.activeQuery = child; },
    });
    if (generation !== this.queryGeneration) {
      return { platform: 'win32', engine: 'everything', status: 'canceled', ready: true, query, results: [], truncated: false, elapsedMs: Date.now() - startedAt };
    }
    this.activeQuery = null;
    if (result.code !== 0 && result.code !== 9) {
      this.lastWindowsStatus = null;
      this.activeWindowsInstance = null;
      return {
        platform: 'win32', engine: 'everything', status: 'error', ready: false, query, results: [], truncated: false,
        elapsedMs: Date.now() - startedAt,
        message: result.timedOut ? '搜索超时，请缩小关键词范围' : '文件索引暂时不可用，请稍后重试',
      };
    }
    const results = parseEverythingCsv(result.stdout).slice(0, options.limit);
    return {
      platform: 'win32', engine: 'everything', status: 'ready', ready: true, query, results,
      truncated: results.length >= options.limit, elapsedMs: Date.now() - startedAt,
    };
  }

  async collectSpotlightPaths(query, limit, generation) {
    return new Promise((resolve) => {
      const paths = [];
      let buffer = '';
      let child;
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.activeQuery === child) this.activeQuery = null;
        resolve(paths);
      };
      try {
        child = spawn('/usr/bin/mdfind', ['-0', '-name', query], { stdio: ['ignore', 'pipe', 'pipe'] });
        this.activeQuery = child;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          buffer += chunk;
          const parts = buffer.split('\0');
          buffer = parts.pop() || '';
          for (const item of parts) {
            if (item && paths.length < limit * 4) paths.push(item);
          }
          if (paths.length >= limit * 4 || generation !== this.queryGeneration) {
            try { child.kill(); } catch {}
          }
        });
        child.on('error', finish);
        child.on('close', finish);
      } catch {
        finish();
      }
      timer = setTimeout(() => {
        try { child?.kill(); } catch {}
        finish();
      }, 8000);
    });
  }

  async searchMac(query, options) {
    const startedAt = Date.now();
    const generation = ++this.queryGeneration;
    if (this.activeQuery) {
      try { this.activeQuery.kill(); } catch {}
    }
    const candidates = await this.collectSpotlightPaths(query, options.limit, generation);
    if (generation !== this.queryGeneration) {
      return { platform: 'darwin', engine: 'spotlight', status: 'canceled', ready: true, query, results: [], truncated: false, elapsedMs: Date.now() - startedAt };
    }
    const normalized = await mapWithConcurrency(candidates, 32, async (filePath) => {
      if (generation !== this.queryGeneration) return null;
      try {
        const stat = await fs.promises.lstat(filePath);
        if (generation !== this.queryGeneration) return null;
        const kind = stat.isDirectory() ? 'folder' : 'file';
        if (options.type !== 'all' && options.type !== kind) return null;
        return {
          path: filePath,
          name: path.basename(filePath) || filePath,
          directory: path.dirname(filePath),
          kind,
          size: stat.isFile() ? stat.size : null,
          modifiedAt: Number(stat.mtimeMs || 0) || null,
        };
      } catch {
        return null;
      }
    });
    if (generation !== this.queryGeneration) {
      return { platform: 'darwin', engine: 'spotlight', status: 'canceled', ready: true, query, results: [], truncated: false, elapsedMs: Date.now() - startedAt };
    }
    const results = normalized.filter(Boolean).sort((a, b) => compareResults(a, b, options.sort, options.direction)).slice(0, options.limit);
    return {
      platform: 'darwin', engine: 'spotlight', status: 'ready', ready: true, query, results,
      truncated: candidates.length >= options.limit * 4 || results.length >= options.limit,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async search(rawQuery, rawOptions = {}) {
    const query = normalizeQuery(rawQuery);
    const options = normalizeOptions(rawOptions);
    if (!query) {
      this.cancel();
      return { platform: this.platform, engine: this.platform === 'darwin' ? 'spotlight' : 'everything', status: 'idle', ready: true, query: '', results: [], truncated: false, elapsedMs: 0 };
    }
    if (this.platform === 'win32') return this.searchWindows(query, options);
    if (this.platform === 'darwin') return this.searchMac(query, options);
    return { platform: this.platform, engine: 'none', status: 'unsupported', ready: false, query, results: [], truncated: false, elapsedMs: 0, message: '当前系统暂不支持全盘查找' };
  }

  shutdown() {
    this.cancel();
    this.stopWindowsHelper();
    if (this.platform !== 'win32' || !this.managedClientStarted) return;
    try {
      const engine = this.ensureWindowsEngineFiles();
      const child = spawn(engine.everything, ['-instance', EVERYTHING_INSTANCE, '-exit'], {
        detached: true, windowsHide: true, stdio: 'ignore',
      });
      child.unref();
    } catch {}
    this.managedClientStarted = false;
  }
}

module.exports = {
  FileSearchService,
  parseDelimited,
  parseEverythingCsv,
  normalizeQuery,
  normalizeOptions,
  compareResults,
  constants: {
    EVERYTHING_INSTANCE,
    EVERYTHING_SERVICE_NAME,
    MAX_QUERY_LENGTH,
    MAX_RESULTS,
    DEFAULT_RESULTS,
  },
};
