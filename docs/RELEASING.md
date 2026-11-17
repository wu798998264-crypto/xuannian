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

## Complete the macOS packages for 9.1.11

The published Windows 9.1.11 application contains newer video integration code than the current main branch. The `Build XuanNian 9.1.11 for macOS` workflow restores that exact application from the published portable package, checks both the download and ASAR SHA-256 values, and applies the three platform-specific Java/FFmpeg filename changes. It preserves the published JavaScript dependencies and the application identity.

Run `.github/workflows/build-macos.yml` manually, or push changes to its packaging scripts on main. Each architecture runs on a matching Mac, bundles Java 17 and FFmpeg, and verifies the Java bridge, media tools, application startup, signature, runtime file hashes and DMG. Once both architectures pass, the workflow adds the missing Mac files and combined updater metadata to the existing 9.1.11 Release. It refuses to replace existing download assets.

This recovery workflow is pinned to 9.1.11 and its verified source hashes. Future releases should commit the current application sources and use the complete tagged release process above.
