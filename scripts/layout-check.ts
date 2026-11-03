import { chromium } from '@playwright/test';

const baseUrl = process.env['LAYOUT_BASE_URL'] ?? 'http://localhost:5173';
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 812 },
  { width: 1280, height: 812 },
  { width: 1920, height: 1080 },
] as const;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.leaflet-container').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.status-card[aria-busy="false"]').waitFor({ state: 'visible', timeout: 15_000 });
    const mapBounds = await page.locator('.leaflet-container').boundingBox();
    if (!mapBounds || mapBounds.width < viewport.width * 0.8 || mapBounds.height < viewport.height * 0.7) {
      throw new Error(`Map does not fill the viewport at ${viewport.width}x${viewport.height}.`);
    }
  }

  if (pageErrors.length > 0) {
    throw new Error(`Browser console errors: ${pageErrors.join('; ')}`);
  }

  console.log(`Responsive map layout checks passed at ${baseUrl}`);
} finally {
  await browser.close();
}
