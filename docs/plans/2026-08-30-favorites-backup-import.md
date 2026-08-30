# Favorites Backup Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build a favorites-only ZIP backup that imports reliably across devices and refreshes the UI immediately.

**Architecture:** Move backup snapshot selection, attachment discovery, portable path encoding, legacy-package normalization, and merge reporting into a small Node module. Keep Electron dialogs and filesystem packaging in `src/main.js`, and make the renderer explicitly reload all user-data views after import.

**Tech Stack:** Electron, Node.js filesystem/path APIs, Windows tar/ZIP tooling, Node assertion tests.

---

### Task 1: Add backup-domain helpers and failing tests

**Files:**
- Create: `src/favorites-backup.js`
- Create: `tests/favorites-backup.js`
- Modify: `package.json`

1. Add tests for favorites-only snapshots, referenced attachments, portable asset paths, legacy package normalization, and merge counts.
2. Run `node tests/favorites-backup.js` and confirm the initial failure.
3. Implement the minimal pure helpers.
4. Add the test to `test:performance` and rerun it.

### Task 2: Replace full-data export with favorites-only packaging

**Files:**
- Modify: `src/main.js`

1. Localize favorite attachments before building the package.
2. Write `manifest.json` and `favorites-data.json` into the staging directory.
3. Copy only referenced attachments into `assets/` and rewrite their paths in the exported snapshot.
4. Create a `.part` archive, verify it is non-empty, and atomically rename it to the selected ZIP path.

### Task 3: Make ZIP import reliable and backward compatible

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `tests/performance-smoke.js`

1. Detect and validate the new manifest format.
2. Accept legacy packages containing `xuannian-data.json`, but discard records and device settings.
3. Copy package assets to the current storage root and rewrite paths.
4. Broadcast a full data refresh after durable save.
5. Replace the undefined renderer `loadData()` call with an explicit full state reload.
6. Show imported item counts and actionable validation errors.

### Task 4: Verify the end-to-end behavior

**Files:**
- Test: `tests/favorites-backup.js`
- Test: `tests/performance-smoke.js`

1. Run `node --check src/main.js` and `node --check src/favorites-backup.js`.
2. Run `npm run test:performance`.
3. Run `npm run test:runtime`.
4. Build the Windows installer in a unique temporary output directory and test installation against a backup copy of current user data.
