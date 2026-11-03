#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TILES_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
FONT_SOURCE="$TILES_DIR/build/openmaptiles-fonts"

mkdir -p "$TILES_DIR/build"
if [[ ! -d "$FONT_SOURCE/.git" ]]; then
  git clone --depth 1 --branch v2.0 \
    https://github.com/openmaptiles/fonts.git "$FONT_SOURCE"
fi
if [[ "$(git -C "$FONT_SOURCE" describe --tags --exact-match 2>/dev/null || true)" != v2.0 ]]; then
  echo "Expected the OpenMapTiles fonts v2.0 tag." >&2
  exit 1
fi

cd "$FONT_SOURCE"
npm install
node ./generate.js
mkdir -p "$TILES_DIR/fonts"
cp -R "$FONT_SOURCE/_output/." "$TILES_DIR/fonts/"
echo "Generated font PBF ranges copied to $TILES_DIR/fonts."
