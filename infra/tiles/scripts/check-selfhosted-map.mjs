import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
const styleUrl = process.env.VITE_BASEMAP_STYLE_URL ??
  'http://localhost:8080/styles/thailand/style.json';
const styleOrigin = new URL(styleUrl).origin;
const stylePath = new URL(styleUrl).pathname;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const responses = [];
  page.on('response', (response) => responses.push(response));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.leaflet-container').waitFor();
  await page.locator('.maplibregl-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const styleResponse = responses.find((response) =>
    response.status() === 200 && new URL(response.url()).origin === styleOrigin &&
    new URL(response.url()).pathname === stylePath
  );
  const vectorTileResponses = responses.filter((response) =>
    response.status() === 200 && new URL(response.url()).origin === styleOrigin &&
    new URL(response.url()).pathname.endsWith('.pbf') &&
    !new URL(response.url()).pathname.includes('/fonts/')
  );
  const glyphResponses = responses.filter((response) =>
    response.status() === 200 && new URL(response.url()).origin === styleOrigin &&
    new URL(response.url()).pathname.includes('/fonts/') &&
    new URL(response.url()).pathname.endsWith('.pbf')
  );
  assert.ok(styleResponse, 'The self-hosted style JSON did not load');
  const style = await styleResponse.json();
  assert.ok(Array.isArray(style.layers) && style.layers.length > 0, 'Style has no map layers');
  assert.ok(vectorTileResponses.length > 0, 'No self-hosted vector tiles loaded');
  assert.ok(glyphResponses.length > 0, 'No local font glyph ranges loaded');
  assert.ok((await vectorTileResponses[0].body()).length > 0, 'Vector tile was empty');
  assert.ok((await glyphResponses[0].body()).length > 0, 'Glyph range was empty');

  const attribution = await page.getByTestId('map-attribution').innerText();
  assert.match(attribution, /OpenMapTiles/);
  assert.match(attribution, /OpenStreetMap contributors/);
  console.log(
    `Self-hosted style rendered with ${vectorTileResponses.length} vector tile(s) and ${glyphResponses.length} glyph range(s).`
  );
} finally {
  await browser.close();
}
