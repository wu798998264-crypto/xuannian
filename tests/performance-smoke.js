const assert = require('assert');
const Module = require('module');

const listeners = new Map();
const pendingLoads = [];
let exposedApi = null;

const ipcRenderer = {
  invoke(channel) {
    if (channel === 'data:load') {
      return new Promise((resolve) => pendingLoads.push(resolve));
    }
    if (channel === 'sticky:getPinnedIds') return Promise.resolve([]);
    return Promise.resolve(null);
  },
  on(channel, callback) {
    listeners.set(channel, callback);
  },
  once(channel, callback) {
    listeners.set(channel, callback);
  },
  send() {},
};

const electronMock = {
  contextBridge: {
    exposeInMainWorld(_name, api) {
      exposedApi = api;
    },
  },
  ipcRenderer,
  clipboard: { readText: () => '' },
  webUtils: { getPathForFile: () => '' },
};

const originalModuleLoad = Module._load;
Module._load = function mockModuleLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalModuleLoad.call(this, request, parent, isMain);
};

function snapshot(recordId) {
  return {
    records: [{ id: recordId }],
    noteProjects: [{ id: 'project-1' }],
    notes: [{ id: 'note-1' }],
    stickyProjects: [],
    stickyNotes: [],
    inspirationCategories: [],
    inspirations: [],
    settings: { theme: 'light' },
  };
}

async function nextMicrotask() {
  await Promise.resolve();
}

async function run() {
  require('../src/preload.js');
  Module._load = originalModuleLoad;
  assert(exposedApi, 'preload API was not exposed');
  exposedApi.onQuickRefresh(() => {});

  const initial = Promise.all([
    exposedApi.getRecords(),
    exposedApi.getNoteProjects(),
    exposedApi.getNotes(),
    exposedApi.getSettings(),
  ]);
  await nextMicrotask();
  assert.strictEqual(pendingLoads.length, 1, 'concurrent getters must share one data load');
  pendingLoads[0](snapshot('initial'));
  const [records, projects, notes, settings] = await initial;
  assert.strictEqual(records[0].id, 'initial');
  assert.strictEqual(projects[0].id, 'project-1');
  assert.strictEqual(notes[0].id, 'note-1');
  assert.strictEqual(settings.theme, 'light');

  listeners.get('quick:refresh')({});
  const staleRequest = exposedApi.getRecords();
  await nextMicrotask();
  listeners.get('quick:refresh')({});
  const freshRequest = exposedApi.getRecords();
  await nextMicrotask();
  assert.strictEqual(pendingLoads.length, 3, 'each invalidation should create at most one replacement load');
  pendingLoads[1](snapshot('stale'));
  await nextMicrotask();
  pendingLoads[2](snapshot('fresh'));
  assert.strictEqual((await staleRequest)[0].id, 'fresh', 'stale data must not replace a newer request');
  assert.strictEqual((await freshRequest)[0].id, 'fresh');

  console.log('performance smoke checks passed');
}

run().catch((error) => {
  Module._load = originalModuleLoad;
  console.error(error);
  process.exitCode = 1;
});
