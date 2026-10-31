import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const baseUrl = process.env.LAYOUT_BASE_URL ?? 'http://localhost:5173';
const screenshotDir = path.resolve(process.env.LAYOUT_SCREENSHOT_DIR ?? 'artifacts/layout');

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 812 },
  { width: 1280, height: 812 },
  { width: 1920, height: 1080 },
] as const;

const QUOTA_LIMITED_HOSTS = [
  'api.xweather.com',
  'maps.aerisapi.com',
  'aerisapi.com',
  'open-meteo.com',
  'nominatim.openstreetmap.org',
  'tile.openstreetmap.org',
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function waitForDashboardReady(page: Page): Promise<void> {
  await page.locator('.leaflet-container').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.status-card[aria-busy="false"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const tiles = Array.from(document.querySelectorAll<HTMLImageElement>('img.leaflet-tile-loaded'));
      return tiles.length >= 4 && tiles.every((img) => img.complete && img.naturalWidth >= 256);
    },
    undefined,
    { timeout: 15_000 }
  );
  await page.waitForTimeout(250);
}

async function verifyRealOsmTiles(page: Page, contextLabel: string): Promise<{
  loadedTileCount: number;
  uniqueColors: number;
  lumaStdDev: number;
}> {
  const tileStats = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll<HTMLImageElement>('img.leaflet-tile-loaded')).filter(
      (img) =>
        img.src.includes('/api/map/tiles/') &&
        img.complete &&
        img.naturalWidth >= 256 &&
        img.getBoundingClientRect().width > 0
    );
    if (tiles.length === 0) {
      return { loadedTileCount: 0, uniqueColors: 0, lumaStdDev: 0 };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { loadedTileCount: tiles.length, uniqueColors: 0, lumaStdDev: 0 };
    }
    ctx.drawImage(tiles[0]!, 0, 0, 128, 128);
    const { data } = ctx.getImageData(0, 0, 128, 128);
    const colors = new Set<string>();
    const lumas: number[] = [];
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (a > 0) {
        colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
        lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }
    const mean = lumas.reduce((sum, v) => sum + v, 0) / Math.max(1, lumas.length);
    const variance =
      lumas.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / Math.max(1, lumas.length);
    return {
      loadedTileCount: tiles.length,
      uniqueColors: colors.size,
      lumaStdDev: Math.sqrt(variance),
    };
  });

  assert(
    tileStats.loadedTileCount >= 4,
    `[${contextLabel}] Expected >= 4 loaded OSM tiles, got ${tileStats.loadedTileCount}`
  );
  assert(
    tileStats.uniqueColors >= 12 && tileStats.lumaStdDev >= 4,
    `[${contextLabel}] OSM basemap looks flat/blank (uniqueColors=${tileStats.uniqueColors}, stdDev=${tileStats.lumaStdDev.toFixed(2)})`
  );
  return tileStats;
}

async function setAllLayers(page: Page, targetOn: boolean): Promise<void> {
  for (const id of ['radar', 'lightning', 'storm'] as const) {
    const btn = page.locator(`#map-side-bar button[data-layer-id="${id}"]`);
    const pressed = (await btn.getAttribute('aria-pressed')) === 'true';
    if (pressed !== targetOn) {
      await btn.click();
    }
    await page.waitForFunction(
      ({ layerId, expected }) => {
        const el = document.querySelector(`#map-side-bar button[data-layer-id="${layerId}"]`);
        return el?.getAttribute('aria-pressed') === String(expected);
      },
      { layerId: id, expected: targetOn }
    );
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(200);
}

async function setHighContrastViaPopover(page: Page, enable: boolean): Promise<void> {
  const current = await page.evaluate(
    () => document.documentElement.dataset['contrast'] === 'high'
  );
  if (current === enable) return;
  const trigger = page.locator('#display-settings-trigger');
  await trigger.click();
  const popover = page.locator('#display-settings-popover');
  await popover.waitFor({ state: 'visible' });
  const hcBtn = popover.locator('button[aria-pressed]').nth(3);
  await hcBtn.click();
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden' });
  const after = await page.evaluate(
    () => document.documentElement.dataset['contrast'] === 'high'
  );
  assert(after === enable, `High-contrast state did not become ${enable}`);
}

async function verifyLayoutGeometry(
  page: Page,
  width: number,
  height: number,
  label: string
): Promise<{
  visibleMapHeightRatio: number;
  panelAreaRatio: number;
  leftDockWidthRatio: number;
}> {
  const result = await page.evaluate(
    ({ vw, vh }) => {
      interface NamedBox {
        name: string;
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      }

      const pickVisible = (selector: string): HTMLElement | null => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
        return (
          nodes.find((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            );
          }) ?? null
        );
      };

      const entries: Array<[string, HTMLElement | null]> = [
        ['brand-chip', pickVisible('[aria-label^="Rain Burst"]')],
        ['search-pill', pickVisible('section[aria-label*="ค้นหา"], section[aria-label*="Search"]')],
        ['data-mode-pill', pickVisible('[data-testid="data-mode-pill"]')],
        ['display-aa-btn', pickVisible('#display-settings-trigger')],
        ['sidebar', pickVisible('#map-side-bar')],
        ['status-card', pickVisible('.status-card')],
        ['map-controls', pickVisible('.map-controls')],
        ['timeline', pickVisible('.slider-panel')],
        ['disclaimer', pickVisible('[data-testid="map-disclaimer"]')],
        ['attribution', pickVisible('[data-testid="map-attribution"]')],
      ];

      const missing = entries.filter(([, el]) => !el).map(([name]) => name);
      const boxes: NamedBox[] = entries.flatMap(([name, el]) => {
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [
          {
            name,
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          },
        ];
      });

      const outOfBounds = boxes
        .filter((b) => b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1)
        .map(
          (b) =>
            `${b.name}(${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)})`
        );

      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 1 && iy > 1) {
            overlaps.push(`${a.name} <-> ${b.name} (${ix.toFixed(1)}x${iy.toFixed(1)}px)`);
          }
        }
      }

      // Check unobstructed map height on mobile & panel footprint on desktop
      const topControlsBottom = Math.max(
        ...boxes
          .filter((b) => ['brand-chip', 'search-pill', 'data-mode-pill', 'display-aa-btn'].includes(b.name))
          .map((b) => b.bottom),
        0
      );
      const bottomControlsTop = Math.min(
        ...boxes
          .filter((b) =>
            vw < 768
              ? ['status-card', 'timeline', 'disclaimer', 'attribution'].includes(b.name)
              : ['timeline', 'disclaimer', 'attribution'].includes(b.name)
          )
          .map((b) => b.top),
        vh
      );
      const visibleMapHeightRatio = Math.max(0, bottomControlsTop - topControlsBottom) / vh;

      const totalPanelArea = boxes.reduce((sum, b) => sum + b.width * b.height, 0);
      const panelAreaRatio = totalPanelArea / (vw * vh);

      const sidebarBox = boxes.find((b) => b.name === 'sidebar');
      const cardBox = boxes.find((b) => b.name === 'status-card');
      const leftDockRight = Math.max(sidebarBox?.right ?? 0, vw >= 768 ? (cardBox?.right ?? 0) : 0);
      const leftDockWidthRatio = leftDockRight / vw;

      const centerHit = document.elementFromPoint(vw * 0.5, vh * 0.5);
      const centerIsMap = Boolean(centerHit?.closest('.leaflet-container'));

      return {
        missing,
        outOfBounds,
        overlaps,
        visibleMapHeightRatio,
        panelAreaRatio,
        leftDockWidthRatio,
        centerIsMap,
        cardWidth: cardBox?.width ?? 0,
      };
    },
    { vw: width, vh: height }
  );

  assert(result.missing.length === 0, `[${label}] Missing floating controls: ${result.missing.join(', ')}`);
  assert(result.outOfBounds.length === 0, `[${label}] Controls out of viewport: ${result.outOfBounds.join(', ')}`);
  assert(result.overlaps.length === 0, `[${label}] Overlapping controls: ${result.overlaps.join(', ')}`);
  assert(result.centerIsMap, `[${label}] Map centre is blocked by a non-map element`);
  if (width >= 1024) {
    assert(
      result.cardWidth >= 299 && result.cardWidth <= 361,
      `[${label}] Desktop status card width out of clamp(300px,26vw,360px): ${result.cardWidth.toFixed(1)}px`
    );
  }
  if (width < 768) {
    assert(
      result.visibleMapHeightRatio >= 0.5,
      `[${label}] Mobile visible map height ratio ${result.visibleMapHeightRatio.toFixed(2)} < 0.50`
    );
  }
  if (width >= 1280) {
    assert(
      result.panelAreaRatio <= 0.3,
      `[${label}] Desktop panel area footprint ${result.panelAreaRatio.toFixed(2)} > 0.30`
    );
  }

  return {
    visibleMapHeightRatio: result.visibleMapHeightRatio,
    panelAreaRatio: result.panelAreaRatio,
    leftDockWidthRatio: result.leftDockWidthRatio,
  };
}

async function verifyGlassContrast(
  page: Page,
  modeLabel: string
): Promise<{ checkedCount: number; minLightRatio: number; minDarkRatio: number }> {
  const report = await page.evaluate(() => {
    interface Rgba {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const parseRgba = (raw: string): Rgba | null => {
      const match = raw.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] !== undefined ? Number(match[4]) : 1,
      };
    };

    const composite = (fg: Rgba, bg: Rgba): Rgba => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };

    const srgbChannel = (c: number): number => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };

    const luminance = (rgb: Rgba): number =>
      0.2126 * srgbChannel(rgb.r) + 0.7152 * srgbChannel(rgb.g) + 0.0722 * srgbChannel(rgb.b);

    const contrastRatio = (c1: Rgba, c2: Rgba): number => {
      const l1 = luminance(c1);
      const l2 = luminance(c2);
      const bright = Math.max(l1, l2);
      const dark = Math.min(l1, l2);
      return (bright + 0.05) / (dark + 0.05);
    };

    const roots = Array.from(
      document.querySelectorAll<HTMLElement>('.glass-panel, .glass-watermark')
    ).filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);

    const lightMapBackdrop: Rgba = { r: 248, g: 246, b: 240, a: 1 };
    const darkMapBackdrop: Rgba = { r: 11, g: 23, b: 38, a: 1 };

    let minLightRatio = Infinity;
    let minDarkRatio = Infinity;
    let checkedCount = 0;
    const failures: string[] = [];

    for (const root of roots) {
      const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
      for (const el of candidates) {
        if (el.classList.contains('sr-only')) continue;
        const hasDirectText = Array.from(el.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0
        );
        if (!hasDirectText) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const fgRaw = parseRgba(style.color);
        if (!fgRaw) continue;

        // Collect background layers from element up to root (inclusive)
        const chain: Rgba[] = [];
        let cursor: HTMLElement | null = el;
        while (cursor) {
          const bg = parseRgba(window.getComputedStyle(cursor).backgroundColor);
          if (bg && bg.a > 0) chain.unshift(bg);
          if (cursor === root) break;
          cursor = cursor.parentElement;
        }

        let bgOverLight = lightMapBackdrop;
        let bgOverDark = darkMapBackdrop;
        for (const layer of chain) {
          bgOverLight = composite(layer, bgOverLight);
          bgOverDark = composite(layer, bgOverDark);
        }

        const fgOverLight = composite(fgRaw, bgOverLight);
        const fgOverDark = composite(fgRaw, bgOverDark);
        const ratioLight = contrastRatio(fgOverLight, bgOverLight);
        const ratioDark = contrastRatio(fgOverDark, bgOverDark);

        checkedCount += 1;
        minLightRatio = Math.min(minLightRatio, ratioLight);
        minDarkRatio = Math.min(minDarkRatio, ratioDark);

        if (ratioLight < 4.5 || ratioDark < 4.5) {
          failures.push(
            `"${(el.textContent ?? '').trim().slice(0, 28)}" light=${ratioLight.toFixed(2)} dark=${ratioDark.toFixed(2)}`
          );
        }
      }
    }

    return { checkedCount, minLightRatio, minDarkRatio, failures };
  });

  assert(
    report.checkedCount >= 12,
    `[${modeLabel}] Expected >= 12 glass text nodes checked, got ${report.checkedCount}`
  );
  assert(
    report.failures.length === 0,
    `[${modeLabel}] WCAG AA contrast failures (<4.5:1): ${report.failures.join('; ')}`
  );

  return {
    checkedCount: report.checkedCount,
    minLightRatio: report.minLightRatio,
    minDarkRatio: report.minDarkRatio,
  };
}

const consoleErrors: string[] = [];
const externalQuotaCalls: string[] = [];

const browser = await chromium.launch();
try {
  await fs.mkdir(screenshotDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 812 } });
  await context.addInitScript('window.__name = (fn) => fn;');
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });
  page.on('request', (req) => {
    const url = req.url();
    if (QUOTA_LIMITED_HOSTS.some((host) => url.includes(host))) {
      externalQuotaCalls.push(url);
    }
  });

  // 1. Verify Mock Scenario Consistency (burst -> HIGH, moderate -> MEDIUM, calm -> LOW + "ณ ตอนนี้")
  await page.goto(`${baseUrl}/?scenario=burst`);
  await waitForDashboardReady(page);

  const switchScenarioViaPopover = async (
    scenario: 'burst' | 'moderate' | 'calm',
    expectedWord?: string
  ): Promise<void> => {
    await page.locator('#radar-options-trigger').click();
    await page.locator('#radar-options-popover').waitFor({ state: 'visible' });
    await page.locator('#mock-scenario').selectOption(scenario);
    await page.keyboard.press('Escape');
    await page.locator('#radar-options-popover').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      ({ expectedScenario, word }) => {
        const currentScenario = new URL(window.location.href).searchParams.get('scenario');
        const card = document.querySelector('.status-card');
        const text = card?.textContent ?? '';
        return (
          currentScenario === expectedScenario &&
          card?.getAttribute('aria-busy') === 'false' &&
          !text.includes('กำลังโหลดระดับความเสี่ยง') &&
          (!word || text.includes(word))
        );
      },
      { expectedScenario: scenario, word: expectedWord ?? '' },
      { timeout: 10_000 }
    );
  };

  for (const [scenario, expectedRiskWord] of [
    ['burst', 'ความเสี่ยงสูง'],
    ['moderate', 'ความเสี่ยงปานกลาง'],
    ['calm', 'ความเสี่ยงต่ำ'],
  ] as const) {
    if (scenario !== 'burst') {
      await switchScenarioViaPopover(scenario, expectedRiskWord);
    }
    const cardText = (await page.locator('.status-card').textContent()) ?? '';
    assert(
      cardText.includes(expectedRiskWord),
      `scenario=${scenario} expected "${expectedRiskWord}" in status card, got: ${cardText.slice(0, 160)}`
    );
    assert(
      cardText.includes('ความเสี่ยง ณ ตอนนี้'),
      `scenario=${scenario} status card must state risk refers to now ("ความเสี่ยง ณ ตอนนี้")`
    );
  }

  // Switch back to burst for full overlay visual checks & assert old top nav is gone
  await switchScenarioViaPopover('burst', 'ความเสี่ยงสูง');
  assert((await page.locator('.site-header, .site-navigation').count()) === 0, 'Old top header/nav still exists');
  for (const oldLinkLabel of ['พยากรณ์', 'แจ้งเตือน', 'เพิ่มเติม']) {
    assert(
      (await page.locator(`header a:has-text("${oldLinkLabel}"), nav.site-navigation a:has-text("${oldLinkLabel}")`).count()) === 0,
      `Old top nav link "${oldLinkLabel}" still rendered`
    );
  }

  const attributionLinks = await page.locator('[data-testid="map-attribution"] a').allTextContents();
  assert(
    attributionLinks.includes('OpenStreetMap contributors') &&
      attributionLinks.includes('Open-Meteo') &&
      attributionLinks.includes('DWD') &&
      attributionLinks.includes('Copernicus') &&
      !attributionLinks.includes('Xweather'),
    `Unexpected mock-mode attribution links: ${attributionLinks.join(', ')}`
  );

  // 3. Screenshot & Layout Matrix: 375, 768, 1280, 1920 x (default, high-contrast) x (layers ON, layers OFF)
  let osmSampleReport = { loadedTileCount: 0, uniqueColors: 0, lumaStdDev: 0 };
  let contrastDefault = { checkedCount: 0, minLightRatio: 0, minDarkRatio: 0 };
  let contrastHigh = { checkedCount: 0, minLightRatio: 0, minDarkRatio: 0 };

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(220);

    for (const hc of [false, true]) {
      await setHighContrastViaPopover(page, hc);
      const themeTag = hc ? 'hc' : 'default';

      // All 3 layers ON
      await setAllLayers(page, true);
      osmSampleReport = await verifyRealOsmTiles(page, `${vp.width}-${themeTag}-on`);
      await verifyLayoutGeometry(page, vp.width, vp.height, `${vp.width}-${themeTag}-layers-on`);

      // Verify storm track + cone of uncertainty + lightning + visible radar canvas exist when layers ON
      const overlayCounts = await page.evaluate(() => {
        const loadedCanvases = Array.from(
          document.querySelectorAll<HTMLCanvasElement>('canvas.leaflet-tile.leaflet-tile-loaded')
        ).filter((canvas) => {
          const style = window.getComputedStyle(canvas);
          return style.visibility !== 'hidden' && Number(style.opacity) > 0;
        });
        let coloredRadarPixels = 0;
        for (const canvas of loadedCanvases) {
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 3; i < data.length; i += 64) {
            if ((data[i] ?? 0) > 20) coloredRadarPixels += 1;
          }
        }
        return {
          radarCanvases: loadedCanvases.length,
          coloredRadarPixels,
          stormDots: document.querySelectorAll('.mock-storm-dot').length,
          lightningChips: document.querySelectorAll('.mock-lightning-chip').length,
          svgPaths: document.querySelectorAll('.leaflet-overlay-pane svg path').length,
        };
      });
      assert(
        overlayCounts.radarCanvases > 0 && overlayCounts.coloredRadarPixels > 10,
        `[${vp.width}] Visible radar heatmap canvas tiles missing when ON (canvases=${overlayCounts.radarCanvases}, pixels=${overlayCounts.coloredRadarPixels})`
      );
      assert(overlayCounts.stormDots > 0, `[${vp.width}] Storm cell markers missing when ON`);
      assert(overlayCounts.lightningChips > 0, `[${vp.width}] Lightning markers missing when ON`);
      assert(overlayCounts.svgPaths >= 6, `[${vp.width}] Storm cone/centreline SVG paths missing when ON`);

      if (vp.width === 1280 && !hc) {
        contrastDefault = await verifyGlassContrast(page, '1280-default');
      }
      if (vp.width === 1280 && hc) {
        contrastHigh = await verifyGlassContrast(page, '1280-high-contrast');
      }

      await page.screenshot({
        path: path.join(screenshotDir, `${vp.width}-${themeTag}-layers-on.png`),
      });

      // All 3 layers OFF
      await setAllLayers(page, false);
      await verifyRealOsmTiles(page, `${vp.width}-${themeTag}-off`);
      await verifyLayoutGeometry(page, vp.width, vp.height, `${vp.width}-${themeTag}-layers-off`);
      const offCounts = await page.evaluate(() => ({
        stormDots: document.querySelectorAll('.mock-storm-dot').length,
        lightningChips: document.querySelectorAll('.mock-lightning-chip').length,
      }));
      assert(
        offCounts.stormDots === 0 && offCounts.lightningChips === 0,
        `[${vp.width}] Storm/lightning markers remained visible when layers OFF`
      );

      await page.screenshot({
        path: path.join(screenshotDir, `${vp.width}-${themeTag}-layers-off.png`),
      });
    }
  }

  // Restore 1280 default + layers ON for interactive & keyboard tests
  await page.setViewportSize({ width: 1280, height: 812 });
  await setHighContrastViaPopover(page, false);
  await setAllLayers(page, true);

  // Verify radar options popover (opacity slider + scenario selector + mm/h legend)
  await page.locator('#radar-options-trigger').click();
  await page.locator('#radar-options-popover').waitFor({ state: 'visible' });
  assert(await page.locator('#mock-radar-opacity').isVisible(), 'Opacity slider missing in radar popover');
  assert(await page.locator('#mock-scenario').isVisible(), 'Scenario selector missing in radar popover');
  await page.screenshot({ path: path.join(screenshotDir, '1280-radar-popover.png') });
  await page.keyboard.press('Escape');
  await page.locator('#radar-options-popover').waitFor({ state: 'hidden' });

  // 4. Keyboard test: Tab through sidebar + tooltip on focus, timeline arrow keys, drawer focus trap + Esc + focus restore
  const sidebarButtons = page.locator('#map-side-bar button');
  const sidebarBtnCount = await sidebarButtons.count();
  assert(sidebarBtnCount >= 6, `Expected >= 6 buttons in sidebar, got ${sidebarBtnCount}`);
  await sidebarButtons.first().focus();

  for (let idx = 0; idx < sidebarBtnCount; idx += 1) {
    if (idx > 0) await page.keyboard.press('Tab');
    await page.waitForTimeout(160);
    const tooltipState = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.closest('#map-side-bar')) {
        return { inSidebar: false, tooltipVisible: false, role: '' };
      }
      const tipId = active.getAttribute('aria-describedby');
      const tip = tipId ? document.getElementById(tipId) : null;
      if (!tip) return { inSidebar: true, tooltipVisible: false, role: '' };
      const style = window.getComputedStyle(tip);
      const rect = tip.getBoundingClientRect();
      return {
        inSidebar: true,
        tooltipVisible:
          tip.getAttribute('data-open') === 'true' &&
          style.visibility === 'visible' &&
          Number(style.opacity) > 0.9 &&
          rect.width > 0 &&
          rect.height > 0,
        role: tip.getAttribute('role') ?? '',
      };
    });
    assert(tooltipState.inSidebar, `Tab step ${idx} left #map-side-bar unexpectedly`);
    assert(
      tooltipState.tooltipVisible && tooltipState.role === 'tooltip',
      `Sidebar button ${idx} did not show accessible role="tooltip" on keyboard focus`
    );
  }

  // Timeline slider arrow keys (10-min step)
  const slider = page.locator('#radar-time');
  await slider.focus();
  const initialSliderVal = Number(await slider.inputValue());
  await page.keyboard.press('ArrowRight');
  assert(Number(await slider.inputValue()) === initialSliderVal + 10, 'Timeline ArrowRight did not step +10 min');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert(Number(await slider.inputValue()) === initialSliderVal - 10, 'Timeline ArrowLeft did not step -10 min');
  await page.keyboard.press('ArrowRight');

  // Menu drawer focus trap + Escape close + focus restoration + every former page reachable
  const menuTrigger = page.locator('[data-menu-trigger="true"]');
  await menuTrigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.locator('#app-drawer[role="dialog"][aria-modal="true"]');
  await drawer.waitFor({ state: 'visible' });
  assert(new URL(page.url()).pathname === '/more', 'Menu button did not navigate to /more');
  await page.screenshot({ path: path.join(screenshotDir, '1280-menu-drawer.png') });

  // Tab & Shift+Tab focus trap check inside drawer
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('#app-drawer'))
    );
    assert(inside, `Tab escaped #app-drawer focus trap on step ${step}`);
  }
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Shift+Tab');
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('#app-drawer'))
    );
    assert(inside, `Shift+Tab escaped #app-drawer focus trap on step ${step}`);
  }

  // Escape closes drawer and restores focus to menu trigger
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert(new URL(page.url()).pathname === '/', 'Escape did not close drawer back to /');
  await page.waitForTimeout(80);
  const restoredToMenu = await page.evaluate(
    () => document.activeElement?.getAttribute('data-menu-trigger') === 'true'
  );
  assert(restoredToMenu, 'Focus was not restored to [data-menu-trigger="true"] after closing drawer');

  // Verify every former route via Menu Drawer click AND via direct URL
  const routes = [
    '/forecast',
    '/alerts',
    '/history',
    '/system-status',
    '/method',
    '/settings',
  ] as const;

  for (const routePath of routes) {
    await menuTrigger.click();
    await drawer.waitFor({ state: 'visible' });
    await drawer.locator(`a[href^="${routePath}"]`).click();
    await page.waitForURL((url) => url.pathname === routePath);
    assert(await drawer.isVisible(), `Drawer not visible after clicking ${routePath}`);
    assert(await page.locator('.leaflet-container').isVisible(), `Map hidden beneath drawer on ${routePath}`);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
  }

  for (const routePath of routes) {
    await page.goto(`${baseUrl}${routePath}?scenario=burst`);
    await drawer.waitFor({ state: 'visible' });
    assert(new URL(page.url()).pathname === routePath, `Direct link failed for ${routePath}`);
    assert(await page.locator('.leaflet-container').isVisible(), `Map not rendered under direct link ${routePath}`);
  }

  assert(
    externalQuotaCalls.length === 0,
    `Mock mode made outbound browser calls to quota-limited hosts: ${externalQuotaCalls.join(', ')}`
  );

  // 5. Verify live-mode timeline hides future segment & shows "ไม่มีเรดาร์พยากรณ์" when forecast frames unavailable
  const liveContext = await browser.newContext({ viewport: { width: 1280, height: 812 } });
  await liveContext.addInitScript('window.__name = (fn) => fn;');
  const livePage = await liveContext.newPage();
  await livePage.route('**/api/runtime-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ demoMode: false, dataMode: 'live', stormConeKmPer30Min: 2.5 }),
    })
  );
  await livePage.route('**/api/capabilities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkedAt: new Date().toISOString(),
        isMock: false,
        demoMode: false,
        capabilities: [
          { id: 'overview-map', available: true, reason: 'ok', checkedAt: new Date().toISOString() },
          { id: 'risk-summary', available: true, reason: 'ok', checkedAt: new Date().toISOString() },
          { id: 'radar-layer', available: false, reason: 'no_plan', checkedAt: new Date().toISOString() },
        ],
      }),
    })
  );
  await livePage.goto(`${baseUrl}/`);
  await livePage.locator('.slider-panel').waitFor({ state: 'visible' });
  const liveTimelineText = (await livePage.locator('.slider-panel').textContent()) ?? '';
  const liveMax = await livePage.locator('#radar-time').getAttribute('max');
  assert(
    liveMax === '0' && liveTimelineText.includes('ไม่มีเรดาร์พยากรณ์'),
    `Live mode without forecast frames should set max=0 and show "ไม่มีเรดาร์พยากรณ์", got max=${liveMax}, text=${liveTimelineText}`
  );
  const liveAttrLinks = await livePage.locator('[data-testid="map-attribution"] a').allTextContents();
  assert(
    liveAttrLinks.includes('Xweather'),
    `Expected Xweather attribution when DATA_MODE=live uses Xweather, got: ${liveAttrLinks.join(', ')}`
  );
  await liveContext.close();

  assert(consoleErrors.length === 0, `Browser console/page errors detected: ${consoleErrors.join(' | ')}`);

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        screenshotDir,
        osmTiles: osmSampleReport,
        contrastDefault,
        contrastHigh,
        consoleErrors: consoleErrors.length,
        externalQuotaCalls: externalQuotaCalls.length,
      },
      null,
      2
    )
  );

  await context.close();
} finally {
  await browser.close();
}
