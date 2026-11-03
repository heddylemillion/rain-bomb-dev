#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
STYLE_ID="${STYLE_ID:-thailand}"
STYLE_URL="$BASE_URL/styles/$STYLE_ID/style.json"
TILE_URL="$BASE_URL/styles/$STYLE_ID/256/7/99/59.png"
GLYPH_URL="$BASE_URL/fonts/Noto%20Sans%20Regular/3584-3839.pbf"

check_type() {
  local url="$1"
  local expected="$2"
  local actual
  actual="$(curl --fail --silent --show-error -D - -o /dev/null "$url" | awk 'BEGIN{IGNORECASE=1} /^content-type:/ {gsub("\r", ""); print tolower($2)}' | tail -n 1)"
  [[ "$actual" == "$expected" ]] || {
    echo "Unexpected Content-Type for $url: $actual (expected $expected)." >&2
    return 1
  }
}

curl --fail --silent --show-error "$STYLE_URL" | node -e '
  let data = "";
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => {
    const style = JSON.parse(data);
    if (!style.sources?.openmaptiles || !style.glyphs) process.exit(1);
  });
'
check_type "$TILE_URL" "image/png"
check_type "$GLYPH_URL" "application/x-protobuf"

ALLOWED="$(curl --silent --show-error -D - -o /dev/null \
  -H 'Origin: http://localhost:5173' "$STYLE_URL" |
  awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {gsub("\r", ""); print $2}' | tail -n 1)"
[[ "$ALLOWED" == "http://localhost:5173" ]] || {
  echo "Local app origin was not allowed by the CORS proxy." >&2
  exit 1
}
DENIED="$(curl --silent --show-error -D - -o /dev/null \
  -H 'Origin: https://not-allowed.example' "$STYLE_URL" |
  awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {gsub("\r", ""); print $2}' | tail -n 1)"
[[ -z "$DENIED" ]] || {
  echo "Unexpected CORS access-control-allow-origin for a disallowed origin: $DENIED" >&2
  exit 1
}

echo "TileServer checks passed: style, Bangkok PNG tile, Thai glyph range, and CORS allow/deny."
