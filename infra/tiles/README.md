# Optional Thailand self-hosted basemap

This directory is an **optional, separate tile pipeline**. The app defaults to
OpenFreeMap Liberty and uses this local style only when
`VITE_BASEMAP_PROVIDER=selfhosted` and `VITE_BASEMAP_STYLE_URL` are set. The
style and vector glyph/tile requests are rendered by MapLibre GL; the existing
Leaflet overlays stay synchronized with its map view. The fixed OpenStreetMap
raster URL is used only if the selected vector style fails.

## Requirements and capacity warning

- Docker Engine/Desktop with Docker Compose v2, Git, Bash, Node.js/npm (for Thai glyph generation), and `curl`.
- **Building Thailand tiles on a laptop is heavy.** The OpenMapTiles path downloads/imports a country extract into PostgreSQL and then generates vector tiles. Start at zoom 7; only move to 10 and then 14 after each earlier stage completes.
- **UNVERIFIED planning estimates, not measured requirements:** reserve roughly 100–300 GB free disk at zoom 7, 300–700 GB at zoom 10, and 1 TB or more at zoom 14. Budget 16–32 GB RAM for zoom 7 and 32–64 GB for zoom 10–14. Real requirements depend on the machine, data extract, temporary files, Docker image layers, and build settings.
- `build-tiles.sh` checks available disk before starting. Its default stop threshold is 100 GB (also an **UNVERIFIED safety threshold**); override with `MIN_FREE_GB` only after deciding how much space you can provide.
- **UNVERIFIED:** Apple Silicon support for the pinned OpenMapTiles v3.16 quickstart. The release's quickstart documents an x86_64 Linux path; Docker Desktop emulation may work but has not been validated here.

## OpenMapTiles build (Thailand)

The script pins the official `openmaptiles/openmaptiles` release tag **v3.16** and verifies commit `c33503af14926d68ea47f1ab7ca4d783ab544f37` and `TOOLS_VERSION=7.2`. The starting configuration is in [`env.thailand.example`](./env.thailand.example): `MIN_ZOOM=0`, stage-one `MAX_ZOOM=7`, `DIFF_MODE=false`, `COPY_CONCURRENCY=3`, and `MAX_PARALLEL_PSQL=3`. PostgreSQL credentials are local development defaults only.

```bash
# EN: Build the low-zoom Thailand tiles first.
# TH: เริ่มสร้างแผนที่ประเทศไทยที่ระดับซูมต่ำก่อน
MIN_FREE_GB=100 ./infra/tiles/scripts/build-tiles.sh 7

# EN: Only after stage 7 succeeds, regenerate at zoom 10.
# TH: เมื่อ stage 7 สำเร็จแล้ว จึงสร้างใหม่ที่ระดับซูม 10
MIN_FREE_GB=300 ./infra/tiles/scripts/build-tiles.sh 10

# EN: Only after stage 10 succeeds, generate zoom 14.
# TH: เมื่อ stage 10 สำเร็จแล้ว จึงสร้างระดับซูม 14
MIN_FREE_GB=1000 ./infra/tiles/scripts/build-tiles.sh 14

# EN/TH: To deliberately skip the stage-10 guard, pass --force.
./infra/tiles/scripts/build-tiles.sh 14 --force
```

The script requests `make download-geofabrik-list` first. That target is absent from the pinned v3.16 release, so it falls back to the release's documented `make list-geofabrik` command, checks that Thailand appears in the returned list, and uses the resolved area name for `./quickstart.sh <area> geofabrik`. It does not assume that an unlisted area is downloadable.

The script also patches the cloned OpenMapTiles Compose file to bind PostgreSQL only to `127.0.0.1`; its port is never published on all network interfaces. The separate serving Compose file below does not start PostgreSQL at all.

## Thai glyphs and local serving

Generate glyph ranges with the documented [OpenMapTiles fonts generator](https://github.com/openmaptiles/fonts), pinned to its v2.0 release. Its Noto Sans font stack includes Noto Sans Thai. The generator creates 256-code-point PBF ranges; Thai U+0E00–U+0EFF is served from `3584-3839.pbf`.

```bash
# EN: Generate and install the local Noto Sans glyph PBFs.
# TH: สร้างและติดตั้งไฟล์ฟอนต์ PBF สำหรับ Noto Sans ในเครื่อง
./infra/tiles/scripts/build-fonts.sh

# EN: Set the production web origin if needed, then serve on loopback only.
# TH: กำหนด origin ของเว็บจริง (ถ้ามี) แล้วเปิดเซิร์ฟเวอร์เฉพาะ localhost
TILE_CORS_PRODUCTION_ORIGIN=https://your-production.example \
  ./infra/tiles/scripts/serve-tiles.sh

# EN/TH: Check the style JSON, a Bangkok PNG tile, Thai glyph range, and CORS.
./infra/tiles/scripts/check-tileserver.sh
```

The exposed endpoint is `http://localhost:8080`; Compose binds it to `127.0.0.1`. The Nginx proxy permits only `http://localhost:5173` and `TILE_CORS_PRODUCTION_ORIGIN`. Change the example production origin before using it. For production HTTPS, put the service behind your HTTPS reverse proxy, set `TILESERVER_PUBLIC_URL` to the canonical public URL, and set `TILESERVER_ALLOWED_HOSTS` to the expected hostnames; keep the style's source and glyph paths relative so requests use the same origin as the style.

### App opt-in and fallback

Do not add these lines to the app's real `.env` unless you want to opt in. Put
these values in a local Vite environment file or export them before starting
Vite, then restart Vite:

```dotenv
VITE_BASEMAP_PROVIDER=selfhosted
VITE_BASEMAP_STYLE_URL=http://localhost:8080/styles/<id>/style.json
```

For this pipeline, `<id>` is `thailand`, so the URL is
`http://localhost:8080/styles/thailand/style.json`. MapLibre loads the local
vector source and Noto Sans Thai glyphs from the style's same origin. If the
style fails, the app switches to the fixed OpenStreetMap raster fallback and
shows a Thai notice; retry attempts the configured style again. Attribution
includes **OpenMapTiles** and **OpenStreetMap contributors**. Radar, storm,
lightning, and community overlays remain app-managed and synchronize to the
same map view.

Run the app with the values exported (no app `.env` edit required):

```bash
VITE_BASEMAP_PROVIDER=selfhosted \
VITE_BASEMAP_STYLE_URL=http://localhost:8080/styles/thailand/style.json \
  npm run dev:web
```

In another terminal, with the app and tile server running:

```bash
APP_URL=http://localhost:5173 \
VITE_BASEMAP_STYLE_URL=http://localhost:8080/styles/thailand/style.json \
  node infra/tiles/scripts/check-selfhosted-map.mjs
```

The Playwright check requires the app, generated tile data, glyphs, and a
Playwright Chromium installation. It verifies that the local style, vector
tiles, glyphs, and attribution load. **Visual verification around Bangkok,
Thai label coverage, and overlay alignment have not been performed in this
workspace.**

## Style and attribution

[`style/style.json`](./style/style.json) is a small OpenMapTiles-schema style with local, relative tile and glyph paths; it does not request `http://fonts.openmaptiles.org`. Labels use `coalesce(name:th, name:latin, name)` and the generated `Noto Sans Regular` font stack.

The style/schema's cartographic design follows OpenMapTiles' CC BY 4.0 attribution terms; OSM data attribution is also required. Keep visible links to [OpenMapTiles](https://openmaptiles.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Noto Sans fonts are distributed under their upstream open font license. See the [OpenMapTiles license](https://github.com/openmaptiles/openmaptiles/blob/v3.16/LICENSE.md) and the [font generator license notes](https://github.com/openmaptiles/fonts/blob/v2.0/README.md#font-license).

## Planetiler alternative

[Planetiler](https://github.com/onthegomap/planetiler) is a lighter alternative: its official OpenMapTiles profile builds MBTiles without PostgreSQL. The profile documents building a shaded `target/*with-deps.jar` and running `java -jar ... --force --download --area=monaco`; the script adapts the area to Thailand and supplies an output filename:

```bash
./infra/tiles/scripts/build-tiles-planetiler.sh
```

It clones the profile's mutable `main` branch, runs `./mvnw clean package`, then executes the resulting jar with `--force --download --area=thailand --output=...`. The profile's docs specify Java 25+ and no PostgreSQL. The command shape and Thailand area are verified from official documentation, but `main` is **not pinned to a verified profile release** and an actual Thailand build is **UNVERIFIED**. Use the pinned PostgreSQL-based script when reproducibility matters.

## Verification state

- **Verified from official source documentation:** OpenMapTiles v3.16 tag/commit, its `TOOLS_VERSION=7.2`, the `make list-geofabrik` target, Thai font files in the Noto Sans stack, OpenMapTiles attribution requirements, and the Planetiler OpenMapTiles profile's no-PostgreSQL command pattern.
- **Not run here:** Docker builds, tile serving, style/tile/glyph HTTP checks, Playwright rendering, Thai text visual review, or overlay alignment review. Docker is unavailable in the current environment.
- **UNVERIFIED:** the disk/RAM planning estimates above, Apple Silicon build support, coverage of Thai labels in the generated Thailand dataset, and visual label quality.
