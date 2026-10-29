import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.LAYOUT_BASE_URL ?? 'http://localhost:5173';
const screenshotDir = path.resolve(process.env.LAYOUT_SCREENSHOT_DIR ?? 'artifacts/layout');
const capabilityIds = [
  'overview-map',
  'risk-summary',
  'current-conditions',
  'observations',
  'hourly-forecast',
  'daily-forecast',
  'lightning',
  'lightning-strikes',
  'lightning-threats',
  'official-alerts',
  'tropical-cyclones',
  'air-quality',
  'history-calibration',
  'alert-history',
  'radar-layer',
  'satellite-layer',
  'canal-level',
  'tide',
  'dem',
] as const;
const blankPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const viewports = [375, 768, 1280, 1920] as const;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const checkedAt = new Date().toISOString();
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      checkedAt,
      isMock: false,
      demoMode: false,
      capabilities: capabilityIds.map((id) => {
        const available = id === 'overview-map' || id === 'risk-summary' || id === 'radar-layer';
        return { id, available, reason: available ? 'ok' : 'no_plan', checkedAt };
      }),
    }),
  }));
  await page.route('**/api/map/tiles/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: blankPng,
  }));
  await page.route('**/api/tiles/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: blankPng,
  }));
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.goto(`${baseUrl}/?lat=13.7563&lon=100.5018&name=เขตมีนบุรี`);
  await page.locator('.status-card[aria-busy="false"]').waitFor({ state: 'visible' });

  const inspectorToggle = page.locator('.map-inspector-collapse');
  if (await inspectorToggle.getAttribute('aria-expanded') === 'true') await inspectorToggle.click();
  const layerToggle = page.getByRole('button', { name: /ชั้นข้อมูลบนแผนที่/ });
  if (await layerToggle.getAttribute('aria-expanded') !== 'true') await layerToggle.click();
  const radarToggle = page.locator('.layer-button').nth(1);
  const overlays = ['.layer-panel', '.legend-panel', '.map-controls-row'];

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(screenshotDir, `radar-off-${width}.png`) });
    assert(await radarToggle.getAttribute('aria-pressed') === 'false', `Radar should be off at ${width}px`);

    await radarToggle.click();
    await page.locator('.slider-panel').waitFor({ state: 'visible' });
    await page.waitForTimeout(100);
    const measurements = await page.evaluate((panelSelectors) => {
      const cardElement = document.querySelector('.map-inspector') ??
        document.querySelector('.status-card');
      const timelineElement = document.querySelector('.slider-panel');
      const card = cardElement?.getBoundingClientRect();
      const timeline = timelineElement?.getBoundingClientRect();
      return {
        cardWidth: card?.width ?? 0,
        cardTimelineOverlap: Boolean(
          card && timeline &&
          card.left < timeline.right && card.right > timeline.left &&
          card.top < timeline.bottom && card.bottom > timeline.top
        ),
        panelCardOverlap: panelSelectors.filter((selector) => {
          const element = document.querySelector(selector);
          if (!element || !card || getComputedStyle(element).visibility === 'hidden') return false;
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.left < card.right && box.right > card.left &&
            box.top < card.bottom && box.bottom > card.top;
        }),
        panelTimelineOverlap: panelSelectors.filter((selector) => {
          const element = document.querySelector(selector);
          if (!element || !timeline || getComputedStyle(element).visibility === 'hidden') return false;
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.left < timeline.right && box.right > timeline.left &&
            box.top < timeline.bottom && box.bottom > timeline.top;
        }),
      };
    }, overlays);
    assert(measurements.cardWidth >= 300, `Status card is narrower than 300px at ${width}px`);
    assert(!measurements.cardTimelineOverlap, `Status card overlaps radar timeline at ${width}px`);
    assert(
      measurements.panelCardOverlap.length === 0,
      `Map controls overlap the card at ${width}px: ${measurements.panelCardOverlap.join(', ')}`
    );
    assert(
      measurements.panelTimelineOverlap.length === 0,
      `Map controls overlap the timeline at ${width}px: ${measurements.panelTimelineOverlap.join(', ')}`
    );
    await page.screenshot({ path: path.join(screenshotDir, `radar-on-${width}.png`) });
    await radarToggle.click();
    await page.locator('.slider-panel').waitFor({ state: 'hidden' });
  }

  await page.setViewportSize({ width: 1366, height: 812 });
  if (await inspectorToggle.getAttribute('aria-expanded') !== 'true') await inspectorToggle.click();
  const inspectorPosition = await page.locator('.map-inspector').evaluate((element) => {
    const { top, left } = element.getBoundingClientRect();
    return { top, left };
  });
  await radarToggle.click();
  await page.locator('.slider-panel').waitFor({ state: 'visible' });
  const inspectorPositionWithRadar = await page.locator('.map-inspector').evaluate((element) => {
    const { top, left } = element.getBoundingClientRect();
    return { top, left };
  });
  assert(
    Math.abs(inspectorPosition.top - inspectorPositionWithRadar.top) < 1 &&
      Math.abs(inspectorPosition.left - inspectorPositionWithRadar.left) < 1,
    'Inspector should remain in the same position when radar is enabled'
  );
  await radarToggle.click();
  await page.locator('.slider-panel').waitFor({ state: 'hidden' });
} finally {
  await browser.close();
}

console.log(`Responsive radar screenshots and layout checks saved to ${screenshotDir}`);
