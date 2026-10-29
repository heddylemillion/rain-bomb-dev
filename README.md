# Rain Burst

Rain Burst is an accessible, Thai-first decision-support map for rainfall and
flood risk. It is not an official warning service.

## Run the API and dashboard

Install dependencies with `npm install`, then start the API and dashboard in
separate terminals:

```sh
npm run dev
npm run dev:web
```

The API listens on port `3001` by default. Vite serves the dashboard on port
`5173` and proxies `/api/*` requests to that API. Xweather credentials are
server-only; never add them to frontend configuration.

Set `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` in `.env`. An optional
`XWEATHER_NAMESPACE` may be required by your account. Configure a valid
`NOMINATIM_USER_AGENT` with a contact address before using public
OpenStreetMap Nominatim geocoding. `DEMO_MODE` defaults to `false`; when set
to `true`, a persistent Thai demo-mode banner is shown. Saved Xweather
responses are used as test fixtures.

Open-Meteo providers are controlled on the backend by `DATA_MODE=mock|live|cache`
(default `mock`). Mock mode returns deterministic, visibly simulated provider
data and makes no Open-Meteo requests. Live mode queries providers, while cache
mode never makes an upstream request. Elevation values are stored permanently
in the ignored `data/elevation-cache.json` file by ~100 m coordinate cell;
Marine forecasts are cached for 45 minutes in `data/marine-cache.json`. Missing,
invalid, and failed values remain missing rather than being replaced with
estimates. `OPEN_METEO_API_KEY` is a backend-only optional key for commercial
use; `OPEN_METEO_COMMERCIAL` defaults to `false`.

**Open-Meteo's free API is for non-commercial use only.** Commercial use requires
an appropriate Open-Meteo commercial plan and credentials. Review the current
[Open-Meteo pricing and terms](https://open-meteo.com/en/pricing) before
deployment.

## Live data, availability, and risk

`GET /api/capabilities` probes Xweather endpoints and raster tiles using the
configured account. `available` means that the request was authorized; it
does not prove that a raster tile contains data over Thailand. `no_plan`,
`no_coverage`, and `error` are reported separately where the provider response
allows that distinction. The map disables unavailable layers and displays the
reason.

`GET /api/risk?lat=...&lon=...` accepts points within Thailand and rounds
coordinates to two decimal places for cache keys. It gathers conditions,
observations, hourly forecasts, archive observations, lightning, and alerts
independently. Failed sources remain unavailable; the service never fills
missing inputs with zero. Successful per-source responses are cached according
to source refresh intervals and may be shown as stale for at most 30 minutes.
The response includes the inputs, normalized factors, weights, confidence,
missing-source reasons, and fetch/observation times.

The weighted linear risk model and thresholds are in `config/risk.json`.
They are explicitly marked **TO BE CALIBRATED** and are not calibrated against
Thai flood events. Site-specific elevation, soil, drainage, and canal factors
are not configured and are not inferred. When fewer than 40% of factor weights
are available, the API returns `INSUFFICIENT` rather than a score.

`GET /api/environment?lat=...&lon=...` returns approximate Copernicus DEM GLO-90
elevation and Marine forecast context. Elevation is static and is not flood
depth. Marine data is modeled forecast data from an explicit offshore reference
point, not an observation at the selected location. Its datum is global mean
sea level, not Thai รทก. or chart datum; coastal accuracy is limited, inland
points are unreliable, and it is not for navigation. Sea level is not
subtracted from elevation and is not an input to the risk score. The
`tideFactor` remains at weight 0 until validated against observed data. Marine
refreshes are paused while the browser tab is hidden.

The backend's existing shared API limiter allows 120 `/api` requests per
15-minute window. Open-Meteo publishes free-tier limits of 600 requests/minute,
5,000/hour, 10,000/day, and 300,000/month; upstream limits were not
load-tested by this application.

The official Xweather plan probe currently reports `no_plan` for observations,
forecasts, archive history, lightning, alerts, radar tiles, and tropical
cyclone tiles. Xweather documents `radar-global` as global and updated every
two minutes; `radar` does not list Thailand among its regions. A successful
raster authorization probe still would not prove pixels are present over
Thailand. The time-offset documentation supports `current` and relative
negative hours, but the selected frames and actual frame timestamps have not
been verified against this account. The radar UI is available only when the
capability endpoint reports access.

The browser uses the backend tile proxy at `/api/tiles/*`; Xweather map
credentials are added only by the server. OpenStreetMap and Xweather
attributions are displayed in the dashboard. Data polling pauses while the
tab is hidden.

## Open-Meteo verification and attribution

The official [Elevation API documentation](https://open-meteo.com/en/docs/elevation-api)
confirms comma-separated latitude/longitude arrays, a maximum of 100 locations
per request, and an always-array `elevation` response based on Copernicus DEM
GLO-90 (~90 m). The official
[Marine API documentation](https://open-meteo.com/en/docs/marine-weather-api)
confirms `/v1/marine`, `hourly=sea_level_height_msl,wave_height`,
`forecast_days=3`, and `timezone=Asia/Bangkok`.

Live Marine API requests were checked on 2026-10-29 using those parameters.
Each candidate returned non-null `sea_level_height_msl` values:

| Configured reference point | Requested coordinate | Result |
|---|---:|---|
| อ่าวไทยตอนบน ใกล้ปากแม่น้ำเจ้าพระยา | 13.45, 100.60 | Returned non-null forecast |
| อ่าวไทย ใกล้ชายฝั่งชลบุรี | 13.20, 100.55 | Returned non-null forecast |
| อ่าวไทย ใกล้ชายฝั่งพัทยา | 12.90, 100.75 | Returned non-null forecast |
| อ่าวไทย ใกล้สัตหีบ | 12.50, 100.50 | Returned non-null forecast |

The Open-Meteo Elevation endpoint was also checked live at 14.065, 100.6186
and returned `{"elevation":[9.0]}`. These checks verify endpoint behavior and
that these specific Marine coordinates returned data at that time. They do
**not** verify Thailand sea-coverage accuracy, agreement with observed tide
gauges, fitness of a reference point for any particular community, or
free-tier rate-limit enforcement under load. The four Marine points are
illustrative water reference points; inland locations, including Khlong Luang,
query a configured offshore reference point instead of their own coordinates.

The footer and area details panel attribute elevation to **Copernicus Programme
(DEM)** and **Open-Meteo**, and marine data to **Open-Meteo** and **DWD**.
