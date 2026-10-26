import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { TacticalHook } from '../../src/app/tactical/tactical-hook.ts';
import { clickWidget, devicePoint, nextFrames } from './ui-capture.ts';

const COLS = 160;
const LOCKED_DOOR = 11429;
const BATTLE_SEED = 7;
const QUIET_SEED = 1;
const SOUTH_STEP = COLS * 3;
const APPROACH_STEPS = 16;
const CAMPAIGN_SEED = 6;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const EDGE_INSET = 4;
const SETTLE_FRAMES = 6;
const PLAYBACK_TIMEOUT_MS = 30_000;

async function newSession(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const created = (await (await request.post('/api/sessions', { data })).json()) as { session: string };
  return created.session;
}

async function openTactical(page: Page, session: string): Promise<void> {
  await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual`);
  await page.waitForFunction(() => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.tactical?.pendingImages === 0 && window.__ja2Ui.screen === 'tactical');
  await nextFrames(page, 4);
}

type HookField = 'uiMode' | 'uiCursor' | 'markers' | 'overheadOpen' | 'doorMenuOpen' | 'exitDialogOpen' | 'topMessage' | 'feedback';

async function field<K extends HookField>(page: Page, key: K): Promise<TacticalHook[K] | undefined> {
  return page.evaluate((k) => window.__ja2Ui.tactical?.[k] as TacticalHook[K] | undefined, key);
}

async function lastCommand(page: Page): Promise<{ type: string; ok: boolean; reason: string | null } | null> {
  return page.evaluate(() => window.__ja2Ui.tactical?.commands.at(-1) ?? null);
}

async function order(page: Page, cmd: Parameters<TacticalHook['command']>[0]): Promise<void> {
  const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), cmd)) as { ok: boolean; reason?: string } | undefined;
  expect(reply?.ok, `${cmd.type}: ${reply?.reason ?? ''}`).toBe(true);
  await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
}

async function soldierGridNo(page: Page, id: number): Promise<number | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.soldiers().find((s) => s.id === wanted)?.gridNo ?? null, id);
}

async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const at = await devicePoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await nextFrames(page, SETTLE_FRAMES);
}

async function clickHere(page: Page): Promise<void> {
  await page.mouse.down();
  await nextFrames(page);
  await page.mouse.up();
  await nextFrames(page, SETTLE_FRAMES);
}

async function screenOf(page: Page, gridNo: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((g) => window.__ja2Ui.tactical?.gridNoScreen(g) ?? null, gridNo);
  if (!at) throw new Error(`no screen position for ${gridNo}`);
  return at;
}

test.describe('the tactical input on the stub sandbox', () => {
  let session = '';

  test.beforeAll(async ({ request }) => {
    session = await newSession(request, { seed: QUIET_SEED });
  });

  test.afterAll(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('walks the selected merc to a clicked tile, crouches him with c and opens the overhead map with INSERT', async ({ page }) => {
    await openTactical(page, session);
    expect(await field(page, 'uiMode')).toBe('MOVE_MODE');
    const start = await soldierGridNo(page, 0);
    if (start === null) throw new Error('merc 0 is not in view');
    const tile = start - 2;
    const at = await screenOf(page, tile);
    await pointAt(page, at.x, at.y);
    await expect.poll(async () => (await field(page, 'markers'))?.some((m) => m.startsWith(`${tile}:`))).toBe(true);
    await clickHere(page);
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'move', ok: true, reason: null });
    await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
    await expect.poll(() => soldierGridNo(page, 0), { timeout: PLAYBACK_TIMEOUT_MS }).toBe(tile);

    await page.keyboard.press('c');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'stance', ok: true, reason: null });

    await page.keyboard.press('Insert');
    await expect.poll(() => field(page, 'overheadOpen')).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => field(page, 'overheadOpen')).toBe(false);
  });
});

test.describe('the door menu on the stub sandbox', () => {
  let session = '';

  test.beforeAll(async ({ request }) => {
    session = await newSession(request, { seed: QUIET_SEED });
  });

  test.afterAll(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('opens the door menu when the merc reaches the locked door and examines it', async ({ page }) => {
    await openTactical(page, session);
    await order(page, { type: 'door', soldier: 1, gridNo: LOCKED_DOOR, action: 'open' });
    await expect.poll(() => field(page, 'doorMenuOpen'), { timeout: PLAYBACK_TIMEOUT_MS }).toBe(true);
    expect(await field(page, 'uiMode')).toBe('OPENDOOR_MENU_MODE');
    await clickWidget(page, 'doorExamine');
    await expect.poll(() => field(page, 'doorMenuOpen')).toBe(false);
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'door', ok: true, reason: null });
  });
});

test.describe('the tactical input in a stub battle', () => {
  let session = '';

  test.beforeAll(async ({ request }) => {
    session = await newSession(request, { seed: BATTLE_SEED });
  });

  test.afterAll(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('aims at a seen enemy under the resting pointer and fires with a click', async ({ page }) => {
    await openTactical(page, session);
    for (let step = 0; step < APPROACH_STEPS && !(await field(page, 'topMessage')); step++) {
      const mercs = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).filter((s) => s.team === 0);
      for (const m of mercs)
        await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), {
          type: 'move',
          soldier: m.id,
          to: m.gridNo + SOUTH_STEP,
          mode: 'swat',
        });
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true, events: ['combatStarted'] }));
      await nextFrames(page, 2);
    }
    await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
    await expect.poll(() => field(page, 'topMessage')).toBe('playerTurn');
    await clickWidget(page, 'teamFaceRegion0');
    const enemy = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).find((s) => s.team !== 0);
    if (!enemy) throw new Error('no enemy in view');
    await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), enemy.gridNo);
    await nextFrames(page, 2);
    const at = await page.evaluate((id) => window.__ja2Ui.tactical?.soldierScreen(id) ?? null, enemy.id);
    if (!at) throw new Error('no screen position for the enemy');
    await pointAt(page, at.x, at.y - 15);
    await expect.poll(() => field(page, 'uiMode'), { timeout: 10_000 }).toBe('CONFIRM_ACTION_MODE');
    await expect.poll(() => field(page, 'feedback')).toBeNull();
    await clickHere(page);
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'attack', ok: true, reason: null });
  });
});

test.describe('the sector exit dialog in a stub campaign', () => {
  let session = '';

  test.beforeAll(async ({ request }) => {
    session = await newSession(request, { seed: CAMPAIGN_SEED, campaign: { difficulty: 1, mercs: 4 } });
  });

  test.afterAll(async ({ request }) => {
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  });

  test('offers the exit at the east edge and leaves with the whole squad', async ({ page }) => {
    await openTactical(page, session);
    const mercs = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).filter((s) => s.team === 0);
    for (const [k, m] of mercs.entries())
      await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), {
        type: 'move',
        soldier: m.id,
        to: (EAST_EDGE_ROW + k) * COLS + EAST_EDGE_COLUMN + k,
        mode: 'run',
      });
    await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
    await clickWidget(page, 'teamFaceRegion0');
    await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), EAST_EDGE_ROW * COLS + COLS - 1);
    await nextFrames(page, 2);
    const logical = await page.evaluate(() => window.__ja2Ui.logical);
    await pointAt(page, logical.width - EDGE_INSET, Math.floor(logical.height / 3));
    await expect.poll(() => field(page, 'uiCursor'), { timeout: 10_000 }).toMatch(/EXIT_EAST/);
    await clickHere(page);
    await expect.poll(() => field(page, 'exitDialogOpen'), { timeout: 10_000 }).toBe(true);
    await clickWidget(page, 'exitOk');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'exitSector', ok: true, reason: null });
  });
});
