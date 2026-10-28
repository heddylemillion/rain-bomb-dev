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
to `true`, a persistent Thai demo-mode banner is shown. Fixtures are used by
tests only.

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
