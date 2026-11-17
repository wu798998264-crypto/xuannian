#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <extracted-yunx-directory> <new-resources-directory> <arm64|x64>" >&2
  exit 1
fi

source_yunx="$1"
resources="$2"
arch="$3"
case "$arch" in
  arm64) macho_arch=arm64 ;;
  x64) macho_arch=x86_64 ;;
  *) echo "Unsupported Mac architecture: $arch" >&2; exit 1 ;;
esac
[[ "$(uname -s)" == Darwin ]] || { echo 'This script requires macOS.' >&2; exit 1; }
[[ ! -e "$resources" ]] || { echo "Resources directory must be new: $resources" >&2; exit 1; }
: "${JAVA_HOME:?Set JAVA_HOME to the matching architecture JDK 17.}"
[[ -x "$JAVA_HOME/bin/jlink" ]] || { echo 'JDK jlink is missing.' >&2; exit 1; }
"$JAVA_HOME/bin/java" -version 2>&1 | grep -Eq 'version "17\.' || {
  echo 'The media bridge requires JDK 17.' >&2
  exit 1
}
lipo -verify_arch "$macho_arch" "$JAVA_HOME/bin/java"

for entry in bridge classes runtime/app LICENSE UPSTREAM.json BUILD.md yunx-corresponding-source.zip; do
  [[ -e "$source_yunx/$entry" ]] || { echo "Missing Yunx resource: $entry" >&2; exit 1; }
done
[[ -f "$source_yunx/classes/YunxBridge.class" ]] || { echo 'YunxBridge.class is missing.' >&2; exit 1; }

mkdir -p "$resources/yunx/runtime" "$resources/ffmpeg"
for entry in bridge classes LICENSE UPSTREAM.json BUILD.md yunx-corresponding-source.zip; do
  cp -R "$source_yunx/$entry" "$resources/yunx/$entry"
done
cp -R "$source_yunx/runtime/app" "$resources/yunx/runtime/app"

"$JAVA_HOME/bin/jlink" \
  --add-modules java.se,jdk.crypto.ec,jdk.httpserver,jdk.unsupported,jdk.unsupported.desktop \
  --strip-debug --no-header-files --no-man-pages --compress=2 \
  --output "$resources/yunx/runtime/runtime"
java="$resources/yunx/runtime/runtime/bin/java"
chmod +x "$java"
file "$java"
lipo -verify_arch "$macho_arch" "$java"
"$java" -version

ffmpeg_release='https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
for tool in ffmpeg ffprobe; do
  curl --fail --location --silent --show-error --retry 3 \
    "$ffmpeg_release/$tool-darwin-$arch.gz" -o "$resources/ffmpeg/$tool.gz"
  gzip -d "$resources/ffmpeg/$tool.gz"
  chmod +x "$resources/ffmpeg/$tool"
  file "$resources/ffmpeg/$tool"
  lipo -verify_arch "$macho_arch" "$resources/ffmpeg/$tool"
  "$resources/ffmpeg/$tool" -version
done
for entry in LICENSE README; do
  curl --fail --location --silent --show-error --retry 3 \
    "$ffmpeg_release/darwin-$arch.$entry" -o "$resources/ffmpeg/$entry"
done

# Exercise the packaged binaries through a real local encode and media probe.
test_media="$resources/ffmpeg/packaging-smoke.mp4"
"$resources/ffmpeg/ffmpeg" -hide_banner -loglevel error -nostdin \
  -f lavfi -i 'color=c=black:s=64x64:r=10:d=1' \
  -f lavfi -i 'anullsrc=r=44100:cl=mono' -t 1 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$test_media"
"$resources/ffmpeg/ffprobe" -v error -show_entries stream=codec_type \
  -of json "$test_media" > "$resources/ffmpeg/packaging-smoke.json"
node - "$resources/ffmpeg/packaging-smoke.json" <<'NODE'
const fs = require('node:fs');
const probe = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const type of ['video', 'audio']) {
  if (!probe.streams?.some(stream => stream.codec_type === type)) {
    throw new Error(`Packaged FFmpeg smoke test did not produce ${type}.`);
  }
}
NODE
rm -f "$test_media" "$resources/ffmpeg/packaging-smoke.json"

node - "$resources/yunx" "$arch" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2];
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative === 'runtime-manifest.json') continue;
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile()) {
      const contents = fs.readFileSync(absolute);
      files.push({ path: relative, size: contents.length, sha256: crypto.createHash('sha256').update(contents).digest('hex') });
    }
  }
}
visit(root);
fs.writeFileSync(path.join(root, 'runtime-manifest.json'), JSON.stringify({ platform: 'darwin', arch: process.argv[3], files }, null, 2) + '\n');
console.log(`Prepared ${process.argv[3]} macOS media runtime; Yunx manifest covers ${files.length} files.`);
NODE
