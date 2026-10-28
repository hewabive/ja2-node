import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { MapHook } from '../../src/app/map/map-hook.ts';
import { MAP_SCREEN_SAVE, type MapScreenSave, writeMapScreenSave } from '../support/e2e-campaign-saves.ts';
import { SAVE_DIR } from './env.ts';
import { waitWhileLoading, watchLoading } from './play-flow.ts';
import { capture, clickWidget, devicePoint, expectGolden, nextFrames } from './ui-capture.ts';

const PLOT_REST_MS = 400;
const HINT_POLL_MS = 500;
const ASSIGNMENT_TRAIN = 5;
const TRAIN_TOWN_LINE = 1;
const ASSIGNMENT_VEHICLE = 3;
const ASSIGNMENT_ON_DUTY = 0;
const SQUAD_LINE_2 = 1;
const DESTINATION = 4;
const ASSIGNMENT = 1;

let save: MapScreenSave;

async function loadSession(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: MAP_SCREEN_SAVE } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

async function openMap(page: Page, session: string, extra = ''): Promise<void> {
  watchLoading(page);
  await page.goto(`/play?session=${encodeURIComponent(session)}${extra}`);
  await waitWhileLoading(page, () => window.__ja2Ui?.map?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.screen === 'map' && window.__ja2Ui.modal === null);
  await nextFrames(page, 4);
}

async function mapHook(page: Page): Promise<MapHook['screen']> {
  return page.evaluate(() => window.__ja2Ui.map?.screen ?? null);
}

async function lastCommand(page: Page): Promise<{ type: string; ok: boolean; reason: string | null } | null> {
  return page.evaluate(() => window.__ja2Ui.map?.commands.at(-1) ?? null);
}

async function clickPoint(page: Page, point: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const at = await devicePoint(page, point.x, point.y);
  await page.mouse.move(at.x, at.y);
  await nextFrames(page);
  await page.mouse.down({ button });
  await nextFrames(page);
  await page.mouse.up({ button });
  await nextFrames(page);
}

async function sectorPoint(page: Page, sector: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((s) => window.__ja2Ui.map?.sectorPoint(s) ?? null, sector);
  if (!point) throw new Error(`no sector ${sector}`);
  return point;
}

async function restOn(page: Page, sector: string): Promise<void> {
  const point = await sectorPoint(page, sector);
  const at = await devicePoint(page, point.x, point.y);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(PLOT_REST_MS);
  await nextFrames(page, 4);
}

async function clickSector(page: Page, sector: string): Promise<void> {
  await clickPoint(page, await sectorPoint(page, sector));
}

async function clickRow(page: Page, row: number, column: number): Promise<void> {
  const point = await page.evaluate((at) => window.__ja2Ui.map?.rowPoint(at.row, at.column) ?? null, { row, column });
  if (!point) throw new Error(`no row ${row}`);
  await clickPoint(page, point);
}

async function rowOf(page: Page, soldier: number): Promise<number> {
  const rows = (await mapHook(page))?.rows ?? [];
  const row = rows.indexOf(soldier);
  if (row < 0) throw new Error(`merc ${soldier} is not listed`);
  return row;
}

test.describe('the map screen on the stub map-screen campaign', () => {
  let session = '';

  test.beforeAll(async () => {
    save = await writeMapScreenSave(SAVE_DIR);
  });

  test.beforeEach(async ({ request }) => {
    session = await loadSession(request);
  });

  test.afterEach(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    session = '';
  });

  test('opens on the loaded sector with the squad listed', async ({ page }) => {
    await openMap(page, session, '&pinClock=1');
    const hook = await mapHook(page);
    expect(hook?.rows.filter((r) => r !== null)).toHaveLength(save.mercs.length);
    expect(hook?.flow).toBe('strategic');
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    await expectGolden('map-screen', await capture(page));
  });

  test('moves the squad by plotting a route from the destination column, the client hints agreeing with the server', async ({ page }) => {
    await openMap(page, session);
    await clickRow(page, 0, DESTINATION);
    expect((await mapHook(page))?.plotting).toMatchObject({ mode: 'merc' });
    const soldier = (await mapHook(page))?.plotting?.soldier ?? -1;
    await page.waitForFunction(
      async (q) => {
        const hints = window.__ja2Ui.map?.hints;
        if (!hints) return false;
        const before = hints.stats.local;
        await hints.hintNow(q);
        return hints.stats.local > before;
      },
      { type: 'canEnterSector', sector: save.sector },
      { polling: HINT_POLL_MS },
    );
    for (const request of [
      { type: 'previewRoute', soldier, to: 'B13', extend: true },
      { type: 'previewRoute', soldier, to: 'C13', via: ['C14'], shortest: true, extend: true },
      { type: 'canEnterSector', sector: save.sector },
      { type: 'assignmentOptions', soldier },
      { type: 'previewHeliRoute', to: 'B13', extend: true },
    ]) {
      const answers = await page.evaluate(async (q) => {
        const hints = window.__ja2Ui.map?.hints;
        return hints ? { local: await hints.hintNow(q), server: await hints.query(q) } : null;
      }, request);
      expect(answers?.local, JSON.stringify(request)).toEqual(answers?.server);
    }
    await restOn(page, 'C13');
    await clickSector(page, 'C13');
    expect((await mapHook(page))?.plotting?.legs).toEqual(['C13']);
    await clickSector(page, 'C13');
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.at(-1)?.type === 'route');
    expect(await lastCommand(page)).toMatchObject({ type: 'route', ok: true });
    expect((await mapHook(page))?.plotting).toBeNull();
    await clickWidget(page, 'compressMore');
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.messages.some((m) => m.includes('C13')) === true);
  });

  test('trains militia through the assignment popup and the payment box', async ({ page }) => {
    await openMap(page, session);
    await clickRow(page, await rowOf(page, save.trainer), ASSIGNMENT);
    await clickWidget(page, `assignmentMenu.line${ASSIGNMENT_TRAIN}`);
    await clickWidget(page, `trainingMenu.line${TRAIN_TOWN_LINE}`);
    await page.waitForFunction(() => window.__ja2Ui.modal === 'messageBox');
    await clickWidget(page, 'messageBox.yes');
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.at(-1)?.type === 'answer');
    expect(await lastCommand(page)).toMatchObject({ type: 'answer', ok: true });
    const assigned = await page.evaluate(() => window.__ja2Ui.map?.commands.find((c) => c.type === 'assign') ?? null);
    expect(assigned).toMatchObject({ ok: true });
  });

  test('moves a merc to another squad through the assignment popup', async ({ page }) => {
    await openMap(page, session);
    const merc = save.mercs.find((id) => id !== save.trainer) ?? save.mercs[0] ?? 0;
    await clickRow(page, await rowOf(page, merc), ASSIGNMENT);
    await clickWidget(page, `assignmentMenu.line${ASSIGNMENT_ON_DUTY}`);
    await clickWidget(page, `squadMenu.line${SQUAD_LINE_2}`);
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.some((c) => c.type === 'assignSquad') === true);
    expect(await page.evaluate(() => window.__ja2Ui.map?.commands.find((c) => c.type === 'assignSquad') ?? null)).toMatchObject({
      ok: true,
    });
  });

  test('boards the helicopter and flies it with airspace plotting', async ({ page }) => {
    await openMap(page, session);
    const passenger = save.mercs.find((id) => id !== save.trainer) ?? save.mercs[0] ?? 0;
    await clickRow(page, await rowOf(page, passenger), ASSIGNMENT);
    await clickWidget(page, `assignmentMenu.line${ASSIGNMENT_VEHICLE}`);
    await clickWidget(page, 'vehicleMenu.line0');
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.some((c) => c.type === 'boardVehicle' && c.ok) === true);
    await clickWidget(page, 'filter4');
    expect((await mapHook(page))?.filters.airspace).toBe(true);
    const heli = await page.evaluate(() => window.__ja2Ui.map?.helicopterPoint() ?? null);
    if (!heli) throw new Error('no helicopter on the map');
    await clickPoint(page, { x: heli.x + 8, y: heli.y + 8 });
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.plotting?.mode === 'heli');
    await restOn(page, 'B13');
    await clickSector(page, 'B13');
    await clickSector(page, 'B13');
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.at(-1)?.type === 'heliRoute');
    expect(await lastCommand(page)).toMatchObject({ type: 'heliRoute', ok: true });
    await clickWidget(page, 'compressMore');
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.rows !== undefined && window.__ja2Ui.map.helicopterPoint() !== null);
    const start = heli;
    await page.waitForFunction((from) => {
      const p = window.__ja2Ui.map?.helicopterPoint();
      return p !== null && p !== undefined && p.y < from.y;
    }, start);
  });

  test('opens the laptop from the map and comes back to it', async ({ page }) => {
    await openMap(page, session);
    await clickWidget(page, 'laptopButton');
    await waitWhileLoading(page, () => window.__ja2Ui.screen === 'laptop');
    await nextFrames(page, 4);
    if (await page.evaluate(() => window.__ja2Ui.widgets.some((w) => w.id === 'newMailOk' && w.visible)))
      await clickWidget(page, 'newMailOk');
    await clickWidget(page, 'powerButton');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'map');
    expect((await mapHook(page))?.flow).toBe('strategic');
  });

  test('goes to tactical in the squad sector and back to the map', async ({ page }) => {
    await openMap(page, session);
    await clickSector(page, save.sector);
    expect((await mapHook(page))?.selectedSector).toBe(save.sector);
    await clickWidget(page, 'tacticalButton');
    await waitWhileLoading(page, () => window.__ja2Ui.tactical?.ready === true && window.__ja2Ui.screen === 'tactical');
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.map ?? null)).toContain('d13');
    await clickWidget(page, 'teamMapScreen');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'map');
    expect((await mapHook(page))?.flow).toBe('strategic');
    await clickWidget(page, 'tacticalButton');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.ready === true && window.__ja2Ui.screen === 'tactical');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.driver === 'realtime');
  });
});
