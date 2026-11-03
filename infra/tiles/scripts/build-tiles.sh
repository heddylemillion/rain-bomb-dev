#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TILES_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$TILES_DIR/build"
WORKTREE="$BUILD_DIR/openmaptiles"
RELEASE=v3.16
RELEASE_COMMIT=c33503af14926d68ea47f1ab7ca4d783ab544f37
EXPECTED_TOOLS_VERSION=7.2
STAGE="${1:-7}"
FORCE=false

if [[ "${1:-}" != "" ]]; then
  shift
fi
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    *) echo "Usage: $0 [7|10|14] [--force]" >&2; exit 2 ;;
  esac
done

case "$STAGE" in
  7|10|14) ;;
  *) echo "Invalid stage '$STAGE'. ใช้ 7, 10 หรือ 14 เท่านั้น / Use 7, 10, or 14." >&2; exit 2 ;;
esac

mkdir -p "$BUILD_DIR" "$TILES_DIR/data"
MIN_FREE_GB="${MIN_FREE_GB:-100}"
FREE_KB="$(df -Pk "$TILES_DIR" | awk 'NR == 2 { print $4 }')"
if [[ ! "$FREE_KB" =~ ^[0-9]+$ ]]; then
  echo "อ่านพื้นที่ว่างไม่สำเร็จ / Could not determine free disk space." >&2
  exit 1
fi
FREE_GB=$((FREE_KB / 1024 / 1024))
if (( FREE_GB < MIN_FREE_GB )); then
  echo "พื้นที่ว่างไม่พอ: มี ${FREE_GB} GB ต้องการอย่างน้อย ${MIN_FREE_GB} GB (ตั้งค่า MIN_FREE_GB เพื่อเปลี่ยนเกณฑ์) / Insufficient free disk: ${FREE_GB} GB available; at least ${MIN_FREE_GB} GB required (override with MIN_FREE_GB)." >&2
  exit 1
fi

if [[ "$STAGE" == 14 && "$FORCE" != true ]]; then
  PREVIOUS_STAGE_FILE="$BUILD_DIR/completed-max-zoom"
  if [[ ! -f "$PREVIOUS_STAGE_FILE" ]] || [[ "$(cat "$PREVIOUS_STAGE_FILE")" != 10 ]]; then
    echo "ห้ามข้ามไป zoom 14 โดยตรง: สร้าง stage 10 ให้สำเร็จก่อน หรือระบุ --force / Refusing to jump directly to zoom 14: complete stage 10 first or pass --force." >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ไม่พบ Docker; ติดตั้ง Docker ก่อนเริ่มสร้างแผนที่ / Docker was not found; install Docker before building tiles." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "ไม่พบ Git / Git was not found." >&2
  exit 1
fi

if [[ ! -d "$WORKTREE/.git" ]]; then
  git clone --depth 1 --branch "$RELEASE" \
    https://github.com/openmaptiles/openmaptiles.git "$WORKTREE"
fi
git -C "$WORKTREE" fetch --depth 1 origin \
  "refs/tags/$RELEASE:refs/tags/$RELEASE"
ACTUAL_COMMIT="$(git -C "$WORKTREE" rev-parse "refs/tags/$RELEASE^{commit}")"
if [[ "$ACTUAL_COMMIT" != "$RELEASE_COMMIT" ]]; then
  echo "OpenMapTiles tag mismatch: expected $RELEASE_COMMIT, got $ACTUAL_COMMIT." >&2
  exit 1
fi
if ! grep -Fxq "TOOLS_VERSION=$EXPECTED_TOOLS_VERSION" "$WORKTREE/.env"; then
  echo "TOOLS_VERSION in the pinned release does not match $EXPECTED_TOOLS_VERSION." >&2
  exit 1
fi

cp "$TILES_DIR/env.thailand.example" "$WORKTREE/.env"
sed -i.bak -E "s/^MAX_ZOOM=.*/MAX_ZOOM=$STAGE/" "$WORKTREE/.env"
rm -f "$WORKTREE/.env.bak"
sed -i.bak -E 's#- "\$\{PGPORT:-5432\}:\$\{PGPORT:-5432\}"#- "127.0.0.1:${PGPORT:-5432}:${PGPORT:-5432}"#' "$WORKTREE/docker-compose.yml"
rm -f "$WORKTREE/docker-compose.yml.bak"
if ! grep -Fq '127.0.0.1:${PGPORT:-5432}:${PGPORT:-5432}' "$WORKTREE/docker-compose.yml"; then
  echo "Could not restrict the PostgreSQL host binding to localhost; refusing to build." >&2
  exit 1
fi

GEOfABRIK_OUTPUT="$BUILD_DIR/geofabrik-list.txt"
if ! (cd "$WORKTREE" && make download-geofabrik-list) >"$GEOfABRIK_OUTPUT" 2>&1; then
  echo "Pinned v3.16 has no download-geofabrik-list target; using its documented make list-geofabrik target."
  (cd "$WORKTREE" && make list-geofabrik) >"$GEOfABRIK_OUTPUT" 2>&1
fi
if ! grep -qiE '(^|[^[:alnum:]_])thailand([^[:alnum:]_]|$)' "$GEOfABRIK_OUTPUT"; then
  echo "Thailand was not found in the Geofabrik area list. See $GEOfABRIK_OUTPUT." >&2
  exit 1
fi
AREA_ID="$(grep -iE -m 1 '(^|[^[:alnum:]_])thailand([^[:alnum:]_]|$)' "$GEOfABRIK_OUTPUT" | grep -Eoi 'thailand' | tr '[:upper:]' '[:lower:]')"
if [[ -z "$AREA_ID" ]]; then
  echo "Could not resolve a Thailand area identifier from the Geofabrik list." >&2
  exit 1
fi

echo "Building Thailand at MAX_ZOOM=$STAGE with OpenMapTiles $RELEASE ($ACTUAL_COMMIT)."
(cd "$WORKTREE" && ./quickstart.sh "$AREA_ID" geofabrik)

SOURCE_TILES="$WORKTREE/data/tiles.mbtiles"
if [[ ! -s "$SOURCE_TILES" ]]; then
  echo "Build finished without $SOURCE_TILES; refusing to publish an empty tileset." >&2
  exit 1
fi
cp "$SOURCE_TILES" "$TILES_DIR/data/tiles.mbtiles"
printf '%s\n' "$STAGE" > "$BUILD_DIR/completed-max-zoom"
echo "Tiles saved to $TILES_DIR/data/tiles.mbtiles."
