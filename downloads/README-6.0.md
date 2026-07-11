# XuanNian 6.0 Download and Installation

Download page:

https://github.com/wu798998264-crypto/xuannian/releases/tag/xuannian-6.0-latest

## Windows

Choose one:

- `XuanNian-6.0.0-Setup.exe`: installer version. Use this for normal installation.
- `XuanNian-6.0.0-Portable.exe`: portable version. Use this when you do not want to install.

Installation:

1. Download the `.exe` file from the Release page.
2. If you downloaded the installer, double-click `XuanNian-6.0.0-Setup.exe` and follow the installer.
3. If you downloaded the portable version, put `XuanNian-6.0.0-Portable.exe` in a normal folder such as Desktop or `D:\Apps`, then double-click it.
4. Do not run the portable version from inside a zip archive.

Note: the Windows package is not signed with a paid code signing certificate. Some Windows PCs may show Smart App Control or publisher warnings.

## macOS

Choose the file for your Mac:

- Apple silicon Mac, including M1/M2/M3/M4: `XuanNian-6.0.0-arm64.dmg`
- Intel Mac: `XuanNian-6.0.0-x64.dmg`

Installation:

1. Download the matching `.dmg` file from the Release page.
2. Open the `.dmg`.
3. Drag `玄念6.0.app` into `Applications`.
4. Open `玄念6.0` from `Applications`.

If macOS says the app is damaged because it is not notarized, open Terminal and run:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/玄念6.0.app"
```

Then open the app again from `Applications`.
