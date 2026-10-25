import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { TacticalHook } from '../../src/app/tactical/tactical-hook.ts';
import type { InventoryItemView } from '../../src/protocol/view.ts';
import { showLatest } from './play-flow.ts';
import { capture, clickWidget, devicePoint, expectGolden, nextFrames } from './ui-capture.ts';

const SQUAD_SIZE = 4;
const HAND = 5;
const BIG_POCKET = 7;
const NEXT_BIG_POCKET = 8;
const SMALL_POCKET = 11;
const DROPPER = 3;
const STEPS_EAST = 4;
const BLINK_TIMEOUT_MS = 15_000;
const QUIET_SEED = 1;

async function newSandbox(request: APIRequestContext): Promise<string> {
  const created = (await (await request.post('/api/sessions', { data: { seed: QUIET_SEED } })).json()) as { session: string };
  return created.session;
}

async function openTactical(page: Page, session: string, extra = ''): Promise<void> {
  await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual${extra}`);
  await page.waitForFunction(() => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.tactical?.pendingImages === 0 && window.__ja2Ui.screen === 'tactical');
  await nextFrames(page, 4);
}

async function inventory(page: Page, soldier: number): Promise<readonly InventoryItemView[]> {
  return page.evaluate((id) => window.__ja2Ui.tactical?.inventory(id) ?? [], soldier);
}

async function lastCommand(page: Page): Promise<{ type: string; ok: boolean; reason: string | null } | null> {
  return page.evaluate(() => window.__ja2Ui.tactical?.commands.at(-1) ?? null);
}

async function clickAt(page: Page, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const at = await devicePoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await nextFrames(page);
  await page.mouse.down({ button });
  await nextFrames(page);
  await page.mouse.up({ button });
  await nextFrames(page);
}

async function rightClickWidget(page: Page, id: string): Promise<void> {
  const rect = await page.evaluate((wanted) => window.__ja2Ui.widgets.find((w) => w.id === wanted)?.rect ?? null, id);
  if (!rect) throw new Error(`no widget ${id}`);
  await clickAt(page, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2), 'right');
}

test.describe('the tactical HUD on the stub sandbox', () => {
  let session = '';

  test.beforeAll(async ({ request }) => {
    session = await newSandbox(request);
  });

  test.afterAll(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('loads the sandbox into the tactical screen with the team panel, faces and radar', async ({ page }) => {
    await openTactical(page, session, '&pinClock=1');
    const hook = await page.evaluate(() => window.__ja2Ui.tactical);
    expect(hook?.map).toBe('stubs/world/maps/village.dat');
    expect(hook?.panel).toBe('team');
    expect(hook?.slots.filter((s) => s !== null)).toHaveLength(SQUAD_SIZE);
    expect(hook?.faces).toHaveLength(SQUAD_SIZE);
    expect(hook?.drawnSoldiers).toBeGreaterThanOrEqual(SQUAD_SIZE);
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    await expectGolden('tactical-team-panel', await capture(page));
  });

  test('blinks the faces on the client clock', async ({ page }) => {
    await openTactical(page, session);
    await page.waitForFunction(() => window.__ja2Ui.tactical?.faces.some((f) => f.eye > 0) === true, null, { timeout: BLINK_TIMEOUT_MS });
  });

  test('selects a merc through the team panel and opens his single merc panel', async ({ page }) => {
    await openTactical(page, session);
    await clickWidget(page, 'teamFaceRegion1');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.selected)).toBe(1);
    await rightClickWidget(page, 'teamFaceRegion1');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.panel)).toBe('sm');
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.smMerc)).toBe(1);
    await page.keyboard.press('Backquote');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.panel)).toBe('team');
  });

  test('moves a magazine between pockets and attaches the silencer through the description box', async ({ page }) => {
    await openTactical(page, session);
    await clickWidget(page, 'teamFaceRegion0');
    await rightClickWidget(page, 'teamFaceRegion0');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.smMerc)).toBe(0);

    await clickWidget(page, `slot${BIG_POCKET}`);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.cursorItem)).toBe('CLIP9_15');
    await clickWidget(page, `slot${NEXT_BIG_POCKET}`);
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'moveItem', ok: true, reason: null });
    await expect.poll(async () => (await inventory(page, 0)).find((i) => i.slot === NEXT_BIG_POCKET)?.item).toBe('CLIP9_15');
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.cursorItem)).toBeNull();

    await clickWidget(page, `slot${SMALL_POCKET}`);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.cursorItem)).toBe('SILENCER');
    await rightClickWidget(page, `slot${HAND}`);
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.descriptionItem)).toBe('GLOCK_17');
    await clickWidget(page, 'itemDescriptionAttachment0');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'attach', ok: true, reason: null });
    const gun = (await inventory(page, 0)).find((i) => i.slot === HAND);
    expect(gun?.attachments?.map((a) => a.item)).toEqual(['SILENCER']);
    expect((await inventory(page, 0)).some((i) => i.slot === SMALL_POCKET)).toBe(false);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.descriptionOpen)).toBe(false);
  });

  test('opens the pickup menu with the hand cursor on a tile with two items and picks both up with one order', async ({ page }) => {
    await openTactical(page, session);
    const start = await soldierGridNo(page, DROPPER);
    if (start === null) throw new Error('the dropper is not in view');
    const dropTile = start + STEPS_EAST;
    await order(page, { type: 'move', soldier: DROPPER, to: dropTile });
    await order(page, { type: 'drop', soldier: DROPPER, slot: HAND });
    await order(page, { type: 'drop', soldier: DROPPER, slot: BIG_POCKET });
    await order(page, { type: 'move', soldier: DROPPER, to: dropTile + STEPS_EAST });
    await showLatest(page);
    expect(await soldierGridNo(page, DROPPER)).toBe(dropTile + STEPS_EAST);
    expect((await page.evaluate(() => window.__ja2Ui.tactical?.items() ?? [])).filter((i) => i.gridNo === dropTile)).toHaveLength(2);

    await clickWidget(page, 'teamFaceRegion0');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.selected)).toBe(0);
    await rightClickWidget(page, 'teamFaceRegion0');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.panel)).toBe('sm');
    await clickWidget(page, 'smHand');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.uiMode)).toBe('HANDCURSOR_MODE');
    const at = await page.evaluate((g) => window.__ja2Ui.tactical?.gridNoScreen(g) ?? null, dropTile);
    if (!at) throw new Error('no screen position for the drop tile');
    await clickAt(page, at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.pickupOpen)).toBe(true);
    await clickWidget(page, 'pickupAll');
    await clickWidget(page, 'pickupOk');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'pickUp', ok: true, reason: null });
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.pickupOpen)).toBe(false);
    await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
    await showLatest(page);
    expect((await inventory(page, 0)).filter((i) => i.item === 'GLOCK_17')).toHaveLength(2);
  });
});

async function order(page: Page, cmd: Parameters<TacticalHook['command']>[0]): Promise<void> {
  const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), cmd)) as { ok: boolean; reason?: string } | undefined;
  expect(reply?.ok, `${cmd.type}: ${reply?.reason ?? ''}`).toBe(true);
  await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
}

async function soldierGridNo(page: Page, id: number): Promise<number | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.soldiers().find((s) => s.id === wanted)?.gridNo ?? null, id);
}
