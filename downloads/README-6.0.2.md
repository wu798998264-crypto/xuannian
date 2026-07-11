# XuanNian 6.0.2 Download and Installation

Download page:

https://github.com/wu798998264-crypto/xuannian/releases/tag/xuannian-6.0.2-latest

## Fix in 6.0.2

- The Windows installer now uses a stable app identity and shortcut name, so installing a new version overwrites the old version instead of leaving old version desktop icons.
- Prompts, favorites, notes, inspirations, and attachments use a stable data directory that does not include the version number.
- If the user changed the storage path, future versions keep using that configured path.
- The Windows uninstaller keeps user data by default. Deleting prompts/favorites/documents is an optional unchecked component.

## Windows

Choose one:

- `XuanNian-6.0.2-Setup.exe`: installer version. Use this for normal installation and automatic replacement of older installed versions.
- `XuanNian-6.0.2-Portable.exe`: portable version. Use this when you do not want to install.

Installation:

1. Download the `.exe` file from the Release page.
2. If you downloaded the installer, double-click `XuanNian-6.0.2-Setup.exe` and follow the installer.
3. If you downloaded the portable version, put `XuanNian-6.0.2-Portable.exe` in a normal folder such as Desktop or `D:\Apps`, then double-click it.
4. Do not run the portable version from inside a zip archive.

Uninstall:

- Normal uninstall keeps prompts, favorites, documents, notes, inspirations, and attachments.
- Only tick the optional delete-data component if you intentionally want to remove user data.

## macOS

Choose the file for your Mac:

- Apple silicon Mac, including M1/M2/M3/M4: `XuanNian-6.0.2-arm64.dmg`
- Intel Mac: `XuanNian-6.0.2-x64.dmg`

Installation:

1. Download the matching `.dmg` file from the Release page.
2. Open the `.dmg`.
3. Drag `玄念.app` into `Applications`, replacing the old app if prompted.
4. Open `玄念` from `Applications`.

If macOS says the app is damaged because it is not notarized, open Terminal and run:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/玄念.app"
```

Then open the app again from `Applications`.
