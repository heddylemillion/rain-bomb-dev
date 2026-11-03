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

`DATA_MODE` defaults to `live` (`live` or `cache`); provider-specific
`RADAR_MODE`, `LIGHTNING_MODE`, and `STORM_TRACK_MODE` can override it with
`live` or `cache`. The provider defaults are RainViewer radar, Open-Meteo CAPE
lightning potential (`open-meteo-cape`), and GDACS storm tracks. In `cache`
mode, weather adapters use only already-cached data and make no outbound
requests.

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
- **Open-Meteo** (`openmeteo` SDK) provides live hourly forecast
  (`api.open-meteo.com/v1/forecast`), 5-hour CAPE lightning potential
  (`hourly=cape`, warning threshold `> 1,000 J/kg`), terrain elevation, and
  marine forecast (`marine-api.open-meteo.com/v1/marine`). Its free API tier is
  for non-commercial use; commercial use requires an appropriate plan. Review
  the [pricing and terms](https://open-meteo.com/en/pricing) before deployment.
  Open-Meteo marine values are model forecasts at configured reference points,
  not local tide observations. CAPE indicates convective lightning potential,
  not observed lightning strike sensor counts. Elevation is static and is not
  flood depth.

## Risk model and local context

`GET /api/risk?lat=...&lon=...` accepts Thailand coordinates, and
`GET /api/forecast?lat=...&lon=...` supplies the 24-hour hourly forecast. The
weighted linear model and thresholds are in `config/risk.json`, marked **TO BE
CALIBRATED**; they have not been calibrated against Thai flood events. Missing
factors stay unavailable rather than being replaced with zero. When less than
40% of factor weight is available, the response is `INSUFFICIENT`; otherwise
the score renormalizes over available factors and confidence reflects missing
weight.

`GET /api/environment` supplies elevation and offshore marine context. Marine
datum is global mean sea level, not Thai รทก. or chart datum; inland values are
not representative of local water level and must not be used for navigation.
The `tideFactor` remains disabled until validated against observations.

The soil layer contains Land Development Department soil-series data for
Pathum Thani. It is area-level context, not a street-level survey or risk
input. Confirm the dataset's redistribution terms before republishing it.

## Disaster preparedness assistant

The map sidebar's **ถามผู้ช่วย** drawer sends the currently selected area,
coordinates, the latest question, and up to six recent conversation messages
to `POST /api/chat`. The backend validates the area, recomputes context using
the existing rule-based risk service, and adds available elevation/marine,
radar-coverage, storm-track, and provider information. Missing historical
rainfall, satellite imagery, IoT readings, and observed local water levels are
identified as unavailable; they are never synthesized. The model cannot
change the risk score, level, or alert type.

The assistant is deterministic/off by default. `CHAT_PROVIDER=none` returns a
rule-based response without an AI call. To enable OpenRouter, set these
backend-only variables in your local `.env`:

```dotenv
DATA_MODE=live
CHAT_PROVIDER=openrouter
OPENROUTER_API_KEY=your_api_key
OPENROUTER_MODEL=your_selected_model
CHAT_DAILY_BUDGET_REQUESTS=20
```

Choose any model slug supported by OpenRouter for `OPENROUTER_MODEL`; optional
comma-separated backup slugs go in `OPENROUTER_FALLBACK_MODELS`. Requests use
the [official Chat Completions API](https://openrouter.ai/docs/api-reference/overview),
a 15-second timeout, and provider privacy routing with
[`data_collection: "deny"`](https://openrouter.ai/docs/guides/routing/provider-selection);
if no provider matches, the app uses its deterministic fallback
instead of weakening privacy. OpenRouter documents `models` as a supported
request field for model routing and `zdr` for strict zero-data-retention
routing. Compatibility of individual `:free` model endpoints with the
no-collection setting is **UNVERIFIED**; check the provider/model details
before enabling them. The key stays in backend environment
configuration and is never returned by runtime-config or sent to the browser.
The current frontend/API architecture uses complete JSON responses rather
than streaming. The selected area name and rounded coordinates, risk context,
conversation messages, and the OpenRouter prompt are sent through the backend;
do not enter personal information. Conversation text is not logged or stored
as a conversation history on the server; a validated answer may remain in an
in-memory cache for up to ten minutes.

Emergency phrases trigger a deterministic response before any model request.
No emergency phone numbers are configured. The Thai knowledge base contains
draft guidance only; a live deployment with
`REQUIRE_APPROVED_ADVISORIES=true` uses only reviewed entries. Verify every
topic and official emergency contact before approval with `npm run kb:check`.
See [chatbot review guidance](./docs/chatbot-review.md). This assistant is not
an official alerting or emergency-dispatch service.

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
npm run kb:check
```
