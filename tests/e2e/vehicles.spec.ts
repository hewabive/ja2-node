import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { type HummerSave, writeHummerSave } from '../support/e2e-vehicle-saves.ts';
import { SAVE_DIR } from './env.ts';
import { expectShadowClean, openTacticalSession } from './play-flow.ts';
import { clickWidget, devicePoint, nextFrames } from './ui-capture.ts';

const PICTURE_SEARCH_PX = 80;
const PICTURE_SEARCH_COLUMNS = [0, -6, 6, -12, 12];
const SETTLE_FRAMES = 6;

let save: HummerSave;

async function loadSession(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: name, reseed: false } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

async function soldierOn(page: Page, gridNo: number): Promise<number> {
  const id = await page.evaluate(
    (g) => window.__ja2Ui.tactical?.soldiers().find((s) => s.gridNo === g && s.vehicle === null)?.id ?? null,
    gridNo,
  );
  if (id === null) throw new Error(`nobody on ${gridNo}`);
  return id;
}

async function pointOnPicture(page: Page, id: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate(
    ({ id, rows, columns }) => {
      const t = window.__ja2Ui.tactical;
      const feet = t?.soldierScreen(id);
      if (!t || !feet) return null;
      for (let dy = 0; dy < rows; dy++)
        for (const dx of columns) if (t.soldierAt(feet.x + dx, feet.y - dy) === id) return { x: feet.x + dx, y: feet.y - dy };
      return null;
    },
    { id, rows: PICTURE_SEARCH_PX, columns: PICTURE_SEARCH_COLUMNS },
  );
  if (!at) throw new Error(`no point on the picture of ${id}`);
  return at;
}

async function commanded(page: Page, type: string): Promise<boolean | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.commands.findLast((c) => c.type === wanted)?.ok ?? null, type);
}

async function vehicleOf(page: Page, id: number): Promise<number | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.soldiers().find((s) => s.id === wanted)?.vehicle ?? null, id);
}

test.describe('ground vehicles on the stub L10 Hummer', () => {
  let session = '';

  test.beforeAll(async () => {
    save = await writeHummerSave(SAVE_DIR);
  });

  test.afterEach(async ({ page, request }) => {
    await expectShadowClean(page);
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    session = '';
  });

  test('boards the Hummer by a click under the enter cursor and leaves it by the Exit Vehicle hand of the team panel', async ({
    page,
    request,
  }) => {
    session = await loadSession(request, save.name);
    await openTacticalSession(page, session, '&shadowHints=1');
    const hummer = await soldierOn(page, save.hummerGridNo);
    const merc = await page.evaluate(() => window.__ja2Ui.tactical?.selected ?? null);
    if (merc === null) throw new Error('nobody selected');
    await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), save.hummerGridNo);
    await nextFrames(page, SETTLE_FRAMES);

    const on = await pointOnPicture(page, hummer);
    const at = await devicePoint(page, on.x, on.y);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.uiCursor)).toBe('ENTER_VEHICLE_UICURSOR');
    await page.mouse.down();
    await nextFrames(page);
    await page.mouse.up();
    await expect.poll(() => commanded(page, 'enterVehicle')).toBe(true);
    await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
    await expect.poll(() => vehicleOf(page, merc)).not.toBeNull();

    await clickWidget(page, 'teamSecondHand0');
    await expect.poll(() => commanded(page, 'exitVehicle')).toBe(true);
    await expect.poll(() => vehicleOf(page, merc)).toBeNull();
  });
});
