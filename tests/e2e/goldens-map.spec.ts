import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { type MapScreenSave, writeMapScreenSave } from '../support/e2e-campaign-saves.ts';
import { SAVE_DIR } from './env.ts';
import { clickAt, pointAt, waitVisible, waitWhileLoading, watchLoading } from './play-flow.ts';
import { capture, clickWidget, expectGolden, nextFrames } from './ui-capture.ts';

const GOLDEN_SAVE = 'u14-map-goldens';
const LOAD_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 60_000;
const ASSIGNMENT_COLUMN = 1;
const ROUTE_TO = 'C13';
const HELI_TO = 'B13';
const MILITIA_FILTER = 3;
const AIRSPACE_FILTER = 4;
const ITEMS_FILTER = 5;
const VEHICLE_LINE = 3;
const AN_HOUR = 3600;

let save: MapScreenSave;

async function loadSession(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: GOLDEN_SAVE } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

const PINNED = 'pinClock=1&holdTime=1';
const FIRST_RULE_READ = '**/ja2set.dat';

async function openMap(page: Page, session: string): Promise<void> {
  watchLoading(page);
  await page.goto(`/play?session=${encodeURIComponent(session)}&${PINNED}`);
  await waitWhileLoading(page, () => window.__ja2Ui?.map?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.screen === 'map' && window.__ja2Ui.modal === null);
  await nextFrames(page, 4);
}

async function sectorPoint(page: Page, sector: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((s) => window.__ja2Ui.map?.sectorPoint(s) ?? null, sector);
  if (!point) throw new Error(`no sector ${sector}`);
  return point;
}

async function clickRow(page: Page, row: number, column: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const point = await page.evaluate((at) => window.__ja2Ui.map?.rowPoint(at.row, at.column) ?? null, { row, column });
  if (!point) throw new Error(`no row ${row}`);
  await clickAt(page, point.x, point.y, button);
}

async function rowOf(page: Page, soldier: number): Promise<number> {
  const row = ((await page.evaluate(() => window.__ja2Ui.map?.screen?.rows)) ?? []).indexOf(soldier);
  if (row < 0) throw new Error(`merc ${soldier} is not listed`);
  return row;
}

async function restPointer(page: Page): Promise<void> {
  const logical = await page.evaluate(() => window.__ja2Ui.logical);
  await pointAt(page, logical.width - 1, logical.height - 1);
}

async function golden(page: Page, name: string): Promise<void> {
  await nextFrames(page, 2);
  expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
  await expectGolden(name, await capture(page));
}

test.describe('goldens of the map screen on the stub map-screen campaign', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  let session = '';

  test.beforeAll(async () => {
    test.setTimeout(SAVE_TIMEOUT_MS);
    save = await writeMapScreenSave(SAVE_DIR, { name: GOLDEN_SAVE, tired: true });
  });

  test.beforeEach(async ({ page, request }) => {
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    session = await loadSession(request);
  });

  test.afterEach(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    session = '';
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/saves/${encodeURIComponent(GOLDEN_SAVE)}`);
  });

  test('the loading screen while the map screen loads its rules', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(FIRST_RULE_READ, async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto(`/play?session=${encodeURIComponent(session)}&${PINNED}`);
    await page.waitForFunction(() => window.__ja2Ui?.screen === 'loading', null, { timeout: LOAD_TIMEOUT_MS });
    await nextFrames(page, 4);
    await golden(page, 'front-end-loading');
    release();
    await waitWhileLoading(page, () => window.__ja2Ui.screen === 'map' && window.__ja2Ui.map?.ready === true);
  });

  test('the assignment popup and a confirmed route', async ({ page }) => {
    await openMap(page, session);
    await clickRow(page, await rowOf(page, save.trainer), ASSIGNMENT_COLUMN);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.menu === 'assignment');
    await restPointer(page);
    await golden(page, 'map-assignment-popup');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.menu === null);

    const soldier = save.trainer;
    const routed = await page.evaluate(([s, to]) => window.__ja2Ui.map?.command({ type: 'route', soldier: s, to }), [
      soldier,
      ROUTE_TO,
    ] as const);
    expect(routed, JSON.stringify(routed)).toMatchObject({ ok: true });
    await page.waitForFunction(() => window.__ja2Ui.lagTicks === 0);
    await restPointer(page);
    await golden(page, 'map-route');
  });

  test('the town box, the militia popup and the sector inventory of Drassen', async ({ page }) => {
    await openMap(page, session);
    const town = await sectorPoint(page, save.sector);
    await clickAt(page, town.x, town.y);
    await page.waitForFunction((s) => window.__ja2Ui.map?.screen?.selectedSector === s, save.sector);
    await clickAt(page, town.x, town.y, 'right');
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.townBox !== null);
    await restPointer(page);
    await golden(page, 'map-town-box');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.townBox === null);

    await clickWidget(page, `filter${MILITIA_FILTER}`);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.filters.militia === true);
    if (await page.evaluate(() => window.__ja2Ui.map?.screen?.uiMessage !== null)) {
      await clickAt(page, town.x, town.y, 'right');
      await page.waitForFunction(() => window.__ja2Ui.map?.screen?.uiMessage === null);
    }
    await clickAt(page, town.x, town.y, 'right');
    await page.waitForFunction(() => (window.__ja2Ui.map?.screen?.militiaTown ?? 0) > 0);
    await restPointer(page);
    await golden(page, 'map-militia-popup');
    await clickWidget(page, `filter${MILITIA_FILTER}`);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.militiaTown === 0);

    await clickWidget(page, `filter${ITEMS_FILTER}`);
    await clickAt(page, town.x, town.y);
    await waitVisible(page, 'poolDone');
    await restPointer(page);
    await golden(page, 'map-sector-inventory');
  });

  test('the helicopter route over the airspace filter', async ({ page }) => {
    await openMap(page, session);
    const passenger = save.mercs.find((id) => id !== save.trainer && id !== save.tired) ?? save.trainer;
    await clickRow(page, await rowOf(page, passenger), ASSIGNMENT_COLUMN);
    await clickWidget(page, `assignmentMenu.line${VEHICLE_LINE}`);
    await clickWidget(page, 'vehicleMenu.line0');
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.some((c) => c.type === 'boardVehicle' && c.ok) === true);
    await clickWidget(page, `filter${AIRSPACE_FILTER}`);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.filters.airspace === true);
    const routed = await page.evaluate((to) => window.__ja2Ui.map?.command({ type: 'heliRoute', to }), HELI_TO);
    expect(routed, JSON.stringify(routed)).toMatchObject({ ok: true });
    await page.waitForFunction(() => window.__ja2Ui.lagTicks === 0);
    await restPointer(page);
    await golden(page, 'map-helicopter');
  });

  test('the update box after a tired merc off duty falls asleep', async ({ page }) => {
    await openMap(page, session);
    await page.evaluate((seconds) => window.__ja2Ui.map?.advance({ worldSeconds: seconds }), AN_HOUR);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.updateBox !== null, null, { timeout: LOAD_TIMEOUT_MS });
    await restPointer(page);
    await golden(page, 'map-update-box');
  });
});
