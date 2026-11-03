# Rain Burst

Rain Burst is an accessible, Thai-first decision-support map for rainfall and
flood risk. It is not an official warning service.

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
npm run dev:web
```

The API listens on port `3001`; Vite serves the dashboard on port `5173` and
proxies `/api/*` to the API. The server also starts with an empty `.env`.
`NOMINATIM_BASE_URL` is fixed in source code; only code and tests can override
it. Do not put backend-only settings in Vite variables.

The default basemap is OpenFreeMap Liberty. Set
`VITE_BASEMAP_PROVIDER=selfhosted` and
`VITE_BASEMAP_STYLE_URL=http://localhost:8080/styles/<id>/style.json` to use
the optional [self-hosted Thailand tile pipeline](./infra/tiles/README.md).
The app falls back to its fixed OpenStreetMap raster URL only when the selected
style fails to load.

## Data modes and providers

`DATA_MODE` defaults to `mock`; provider-specific `RADAR_MODE`,
`LIGHTNING_MODE`, and `STORM_TRACK_MODE` can override it with `live`, `mock`,
or `cache`. The provider defaults are RainViewer radar, no lightning provider,
and GDACS storm tracks. In mock mode, all provider adapters and server-side
weather data are local and make no outbound requests. Mock lightning is a
visual simulation and is not passed into live risk inputs. In live mode,
lightning is unavailable until a provider is configured; the map says
`ไม่มีผู้ให้บริการฟ้าผ่า`, and the risk model excludes that factor and
renormalizes the remaining weights, lowering confidence.

The system-status page reports provider mode, coverage test, last success,
quota use, attribution, and licence limits.

- **RainViewer** supplies historical radar frames only, to zoom 7; no
  nowcast/future or satellite frames are requested. The backend radar proxy
  caches tiles for at least five minutes and limits traffic to 100 requests per
  IP per minute. Empty Thailand coverage is reported as
  `ไม่มีข้อมูลเรดาร์ในพื้นที่นี้`; live radar is never fabricated. Keep linked
  attribution **Weather data by RainViewer**. Review the current
  [API documentation](https://rainviewer.com/api.html) and
  [terms](https://www.rainviewer.com/terms.html) before deployment. RainViewer
  free-tier use is non-commercial and limited to personal/community purposes;
  treat the feed as informational, not as an official warning source.
- **TMD** is a no-network stub. Do not scrape TMD websites. Request approved
  feeds and redistribution terms first; see [docs/tmd-request.md](./docs/tmd-request.md).
- **GDACS** provides active tropical-cyclone tracks and forecast cones, cached
  for 30 minutes. Retain the linked attribution **GDACS (EC-JRC / UN OCHA)**;
  it is situational-awareness information, not an official local warning.
- **Open-Meteo** provides live forecast, elevation, and marine context. Its
  free API tier is for non-commercial use; commercial use requires an
  appropriate plan. Review the
  [pricing and terms](https://open-meteo.com/en/pricing) before deployment.
  Open-Meteo marine values are model forecasts at configured reference points,
  not local tide observations. Elevation is static and is not flood depth.

## Risk model and local context

`GET /api/risk?lat=...&lon=...` accepts Thailand coordinates. The weighted
linear model and thresholds are in `config/risk.json`, marked **TO BE
CALIBRATED**; they have not been calibrated against Thai flood events. Missing
factors stay unavailable rather than being replaced with zero. When less than
40% of factor weight is available, the response is `INSUFFICIENT`; otherwise
the score renormalizes over available factors and confidence reflects missing
weight.

Mock scenarios (`calm`, `moderate`, and `burst`) are deterministic for the
scenario/date and drive only mock overlays and mock risk results. The scenario
selector and timeline are available in mock mode.

`GET /api/environment` supplies elevation and offshore marine context. Marine
datum is global mean sea level, not Thai รทก. or chart datum; inland values are
not representative of local water level and must not be used for navigation.
The `tideFactor` remains disabled until validated against observations.

The soil layer contains Land Development Department soil-series data for
Pathum Thani. It is area-level context, not a street-level survey or risk
input. Confirm the dataset's redistribution terms before republishing it.

## Attribution

The app credits OpenFreeMap/OpenMapTiles, OpenStreetMap contributors,
Open-Meteo, RainViewer, and GDACS where their data is used. Retain provider
attribution and review each provider's current licence and usage limits before
public or commercial deployment.

## Checks

```sh
npm run typecheck
npm test
npm run build:web
npm run test:layout
```
