# Douyin Preview And Download Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Douyin/DLPanda parsing resilient when preview capture fails, reuse temporary parsed media for final downloads, and expose four deduplicated download actions (video, backup download, audio, cover image) with download and favorite support.

**Architecture:** Keep parsing publication independent from preview capture. The parser will return typed, deduplicated media actions while retaining the existing quality options for non-Douyin providers. The main process will cache preview media in the existing temporary directory, prefer a native preview URL, and atomically move cached files into the selected media-library destination instead of downloading them again. The renderer will show a compact action selector for Douyin and keep the current quality selector for other providers.

**Tech Stack:** Electron, Node.js, vanilla HTML/CSS/JavaScript renderer, existing media-library module, Node test scripts, npm packaging, GitHub Actions releases.

---

### Task 1: Record current contracts and add failing regression coverage

**Files:**
- Modify: `tests/media-portal-automation.js`
- Modify: `tests/media-library.js`
- Modify: `tests/electron-runtime-probe.js`
- Modify: `tests/performance-smoke.js`

**Step 1: Add parser assertions for typed, deduplicated media actions.**

Assert that the generated portal script exposes video, backup, audio, and cover-image actions, filters marketing links, and deduplicates equivalent URLs without removing audio/image candidates.

**Step 2: Add media-library assertions for image extensions and folders.**

Assert that common cover extensions resolve to `image`, image collection paths use the `图片` directory, and unsupported files remain rejected.

**Step 3: Add runtime assertions for the Douyin action selector and button labels.**

Use a synthetic parsed payload with `mediaActions` and assert the UI renders `视频`, `备用下载`, `音频`, `封面图片`, plus `下载` and `收藏`; retain a separate quality-options assertion for non-Douyin payloads.

**Step 4: Run the focused tests and confirm they fail before implementation.**

Run: `node tests/media-portal-automation.js`; `node tests/media-library.js`; `node tests/electron-runtime-probe.js`; `node tests/performance-smoke.js`

Expected: failures identify the missing action contract, image kind, and new renderer labels.

### Task 2: Implement typed media actions in portal automation

**Files:**
- Modify: `src/media-portal-automation.js`
- Test: `tests/media-portal-automation.js`

**Step 1: Classify candidate links by media kind.**

Extend candidate metadata with `kind` (`video`, `audio`, `image`, or `backup`) using URL extension, download attributes, media elements, and labels. Keep direct video candidates eligible for preview capture.

**Step 2: Deduplicate and order actions.**

Normalize URLs and emit at most one primary video, one backup video, one audio, and one cover image action. Use plain labels `视频`, `备用下载`, `音频`, and `封面图片`; preserve the existing quality option list for providers that are not DLPanda/Douyin.

**Step 3: Return `mediaActions` without making preview a prerequisite.**

Include action URLs and candidate indexes in the result payload even when no preview URL is available. Keep `downloadReady` true when a valid action exists.

**Step 4: Run the parser test.**

Run: `node tests/media-portal-automation.js`

Expected: PASS.

### Task 3: Add image media-library support and move semantics

**Files:**
- Modify: `src/media-library.js`
- Modify: `src/main.js`
- Test: `tests/media-library.js`

**Step 1: Add first-class image kind support.**

Add common image extensions, map them to `image`, create the `图片` media directory, and include image entries in collection listing/move operations while preserving video/audio behavior.

**Step 2: Add a cross-volume-safe move helper in the main process.**

Move a completed temporary preview with `rename`; on `EXDEV`, copy then unlink so the source is not retained after successful promotion. Preserve unique filename allocation and history/notifications.

**Step 3: Generalize direct parsed downloads.**

Accept an action id instead of a quality index, route video/audio/image URLs through tracked downloads, and promote the cached video by moving it when the selected action is the cached preview.

**Step 4: Run media-library tests.**

Run: `node tests/media-library.js`

Expected: PASS.

### Task 4: Prefer native preview and preserve parse success

**Files:**
- Modify: `src/main.js`
- Test: `tests/performance-smoke.js`

**Step 1: Try the native parsed video URL first.**

Capture the current `<video>` source or trusted preview URL before selecting a download candidate; continue to publish the parsed result even if capture fails.

**Step 2: Fall back to an available direct video action.**

Use a typed video/backup action to populate the existing temporary cache when native preview is unavailable, without introducing a lowest-quality requirement.

**Step 3: Keep preview failure non-blocking.**

Return parsed metadata and action URLs regardless of preview capture errors; only the preview element reports the failure state.

**Step 4: Run performance/source regression tests.**

Run: `node tests/performance-smoke.js`

Expected: PASS.

### Task 5: Update the renderer interaction model

**Files:**
- Modify: `index.html`
- Test: `tests/electron-runtime-probe.js`
- Test: `tests/video-first-use-probe.js`

**Step 1: Replace the Douyin quality label with a download-item selector.**

Render the four plain action labels, hide the old `清晰度` text for Douyin, and keep the old quality selector for other providers.

**Step 2: Rename action buttons.**

Use `下载` and `收藏`; both act on the currently selected media action. Open the existing collection picker with the selected kind for favorite operations.

**Step 3: Handle backup action explicitly.**

If the selected backup action has no direct URL, open the existing DLPanda portal route for manual fallback while leaving the parsed result intact.

**Step 4: Run the renderer probes.**

Run: `node tests/electron-runtime-probe.js`; `node tests/video-first-use-probe.js`

Expected: PASS.

### Task 6: Version, package, install, publish, and verify update detection

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `quick.html`
- Create: `docs/release-notes/v9.1.3.md`

**Step 1: Bump the application version to `9.1.3`.**

Update package metadata and visible version strings without touching unrelated release assets.

**Step 2: Run the complete test suite and build Windows artifacts.**

Run: `npm test`; then set `XUANNIAN_BUILD_OUTPUT` to a temporary directory and run `npm run dist:all`.

**Step 3: Install and smoke-test the new Windows build.**

Stop the installed app, run the generated setup executable silently, verify `app.asar` contains the new version and behavior, then restart the app.

**Step 4: Commit source changes and push `main`.**

Stage only implementation, tests, plan, release notes, and version files; preserve unrelated untracked workspace files.

**Step 5: Tag and publish `v9.1.3`.**

Push the tag, wait for the GitHub release workflow to complete, verify Windows/macOS assets and `latest.yml`, and confirm the GitHub latest release is newer than `9.1.2` so old clients can detect it.
