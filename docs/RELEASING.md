# XuanNian release process

The production updater reads the latest published GitHub Release from:

`wu798998264-crypto/xuannian`

Do not move the update repository without first shipping a transition release that changes the embedded provider configuration.

## Publish a stable version

1. Update `version` in both `package.json` and `package-lock.json`. Use an `x.y.z` stable version such as `6.2.0`.
2. Build and test the Windows packages locally.
3. Commit and push the version change to `main`.
4. Create a new tag that exactly matches the package version, for example `v6.2.0`.
5. Push the new tag. The `Release XuanNian` workflow performs all remaining build and publish work.

Example:

```powershell
npm version 6.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release XuanNian 6.2.0"
git push origin main
git tag -a v6.2.0 -m "XuanNian 6.2.0"
git push origin v6.2.0
```

## Release safety rules

- Never reuse or force-move an already published version tag.
- Never upload update metadata from one build together with binaries from another build.
- Never publish Windows and macOS assets in separate Releases for the same version.
- Never make a new Release public before all Windows, Intel Mac, and Apple silicon assets have passed validation.
- If a released version is faulty, fix it and publish a higher version. Do not replace the existing version in place.

The workflow enforces these rules by checking that the Git tag matches `package.json`, validating all 13 platform assets and their metadata, uploading to a draft Release, and only then marking the complete Release as latest.

## macOS signing

Unsigned/ad-hoc macOS builds download the DMG matching the current Mac architecture. A trusted Apple Developer ID certificate is required before macOS can use fully automatic in-app installation.

## macOS packaging and native checks

The initial macOS 9.1.11 recovery restored the application from the published Windows portable package, checked both download and ASAR SHA-256 values, and applied the platform-specific Java/FFmpeg filenames. Version 9.2.0 restores those application sources to this repository and resumes the complete tagged release process above.

The release workflow calls `.github/workflows/build-macos.yml`. Each architecture runs on a matching Mac, bundles native Java 17 and FFmpeg, and verifies favorites archives, window controls, the quick panel, Java bridge, media tools, application startup, signature, runtime file hashes and DMG. After both architectures pass, their update metadata and binaries become one `release-macos` artifact for the complete release publisher. Manually running the Mac workflow produces verified artifacts without publishing a separate release.

Starting with 9.2.1, Windows and both Mac runners also exercise music search through the production main process with controlled provider pages: late DOM results, short song titles, query changes, automatic checks and user-operated embedded verification. The test requires no extra native browser windows and checks result synchronization and main-view resizing. A separate renderer test checks full-width parsing/download progress and music request ordering at desktop and compact window sizes.

Media runtimes are prepared from the verified 9.1.11 distribution, with native Java and FFmpeg replacements on Mac. Keep the pinned download digest when changing application code; update it only when deliberately replacing the bundled third-party runtime source.

For a local Windows build, `npm run dist:all` prepares and verifies the media resources before packaging. GitHub CLI authentication and 7-Zip are required for the first preparation; later builds verify and reuse the local cache. `build/media-resources` and download/staging folders are generated build output and must not be committed.
