# XuanNian full-disk search design

## Goal

Add a third primary workspace for instant local file and folder search without changing the existing clipboard, favorites, sticky-note, or persistence behavior.

## Architecture

- Windows uses the stable Everything 1.4 search engine. A small bundled .NET helper keeps one direct Query2 IPC connection alive, while the official ES client remains a compatibility fallback. The engine is copied from packaged resources to XuanNian's stable user-data directory so installed and portable upgrades share one index location. Initialization is explicit because installing the NTFS indexing service requires Windows elevation.
- macOS uses the system Spotlight index through `mdfind`; no additional daemon is shipped.
- The renderer talks only to narrow IPC handlers. Queries are length- and result-limited, launched with argument arrays rather than a shell, and superseded queries are terminated.
- Search results use a normalized shape: `path`, `name`, `directory`, `kind`, `size`, and `modifiedAt`.

## User experience

- A third primary navigation item opens `全盘查找`.
- The view provides input-as-you-type search, file/folder filters, sortable name/path/size/modified columns, result count, indexing/error states, keyboard navigation, double-click open, reveal-in-folder, and copy-path actions.
- The global shortcut defaults to `Ctrl+Alt+A` and is editable in Settings.
- Since 6.1.11 used `Ctrl+Alt+A` as the screenshot default, only users still on that exact old default are migrated to `Ctrl+Alt+D`. Existing custom screenshot shortcuts remain unchanged.

## Performance and safety

- Queries are debounced, superseded requests are canceled, and the IPC helper is reused instead of spawning one process per search.
- Initial results are capped at 300 and rendered through a 48-row virtual window so broad searches remain responsive and DOM size stays bounded.
- The helper is prewarmed in the background after startup only when a usable Everything index already exists. First-time service installation is never triggered automatically.
- Search never mutates XuanNian data. Opening and revealing paths reuse Electron's safe shell APIs.
- Everything license files are included with redistributed binaries.

## Verification

- Unit-test result parsing, query validation, native-helper startup, cancellation, and platform adapters.
- Extend the Electron runtime probe to verify the third view, large result virtualization, and shortcut settings.
- Build Windows installer and portable packages and inspect packaged resources.
- Let GitHub Actions build Intel and Apple silicon macOS artifacts and publish all platforms from the fixed repository.
