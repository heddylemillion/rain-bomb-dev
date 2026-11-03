#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TILES_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$TILES_DIR/build/planetiler-openmaptiles"
mkdir -p "$TILES_DIR/data"

if ! command -v java >/dev/null 2>&1; then
  echo "ไม่พบ Java 25+ / Java 25+ was not found." >&2
  exit 1
fi

if [[ ! -d "$BUILD_DIR/.git" ]]; then
  git clone --depth 1 https://github.com/openmaptiles/planetiler-openmaptiles.git "$BUILD_DIR"
fi

(
  cd "$BUILD_DIR"
  ./mvnw clean package
  shopt -s nullglob
  jars=(target/*with-deps.jar)
  if [[ "${#jars[@]}" -ne 1 ]]; then
    echo "Expected exactly one target/*with-deps.jar from the profile build." >&2
    exit 1
  fi
  java -jar "${jars[0]}" \
    --force --download --area=thailand \
    --output="$TILES_DIR/data/tiles.mbtiles"
)
