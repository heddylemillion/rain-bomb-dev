# Request to the Thai Meteorological Department

The application currently has a TMD radar provider stub only. It does not
scrape `weather.tmd.go.th` or `satda.tmd.go.th`. Before implementing a live TMD
adapter, request written technical and redistribution guidance from TMD:

1. Is there an official radar composite feed suitable for public display in
   Thailand, and a 3-hour nowcast feed? Please provide the supported products,
   geographic coverage, and access method or API documentation.
2. What are the exact response formats, projections, coordinate reference
   systems, tile schemes, resolutions, and time/valid-time conventions?
   Are images, GeoTIFFs, CAPPI products, or vector/raster tiles available?
3. What attribution text and links are required? May the data be cached,
   transformed into tiles, redistributed through a public web application, or
   used in a community warning-support interface? Are there restrictions on
   commercial use or derived products?
4. What is the normal update interval, latency, retention period, and expected
   availability? Are there rate limits, credentials, or service-level terms?
5. How should no-coverage, stale, maintenance, and missing-frame conditions be
   represented? Is a coverage mask or station/coverage metadata available?
6. Is there a test endpoint or sample dataset, including Thai examples, that
   can be used to validate radar rendering and the 3-hour nowcast?

Do not enable a TMD live provider until the feed, licence, redistribution
rights, and request format have been verified in writing.
