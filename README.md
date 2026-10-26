# rain-bomb-dev

## Run the API and dashboard

Install dependencies with `npm install`, then start the API and dashboard in
separate terminals:

```sh
npm run dev
npm run dev:web
```

The API listens on port `3001` by default. Vite serves the dashboard on port
`5173` and proxies `/api/*` requests to that API. Weather credentials remain
on the server.

If Xweather credentials are unavailable, `GET /api/capabilities` returns a
deliberately marked `isMock: true` fallback. Do not treat it as confirmation
of Xweather plan access or Thailand coverage.

The overview probes the configured Xweather credentials against the first
community in `config/communities.json`. Forecast, observation, conditions,
alerts, lightning and lightning-threat endpoints are checked independently.
An endpoint is marked `no_plan` or `no_coverage` only when the provider's
response explicitly identifies that case; ambiguous failures remain `error`.
The risk-summary endpoint currently serves an illustrative result from
`mocks/risk-results.json`, with `isMock: true` and a `TO BE CALIBRATED` marker.
It is not a computed flood-risk warning.

Leaflet map tiles are proxied by `/api/map/tiles/*`, so the browser's map data
requests stay under `/api/*`. Map attribution identifies OpenStreetMap.
