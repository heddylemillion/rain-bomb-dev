#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -s "$SCRIPT_DIR/data/tiles.mbtiles" ]]; then
  echo "ไม่พบ infra/tiles/data/tiles.mbtiles; สร้าง tiles ก่อน / Missing data/tiles.mbtiles; build tiles first." >&2
  exit 1
fi
if [[ ! -d "$SCRIPT_DIR/fonts/Noto Sans Regular" ]]; then
  echo "ไม่พบฟอนต์ Noto Sans; เรียก scripts/build-fonts.sh ก่อน / Noto Sans glyphs are missing; run scripts/build-fonts.sh first." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
docker compose up -d --remove-orphans
echo "TileServer GL (CORS proxy) is listening on http://localhost:8080."
