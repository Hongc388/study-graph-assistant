#!/bin/sh
# Builds build/icon.icns from build/icon.svg (macOS only — uses sips/iconutil).
# electron-builder picks up build/icon.icns automatically.
set -e
cd "$(dirname "$0")/.."

npx electron scripts/render-icon.js

ICONSET=build/icon.iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" build/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" build/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o build/icon.icns
rm -rf "$ICONSET" build/icon-1024.png
echo "ICNS_OK $(du -h build/icon.icns | cut -f1)"
