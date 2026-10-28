import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { BattleHook } from '../../src/app/battle/battle-hook.ts';
import { ARRIVAL_WAIT_SECONDS, BATTLE_SECTOR, type BattleEntrySaves, writeBattleEntrySaves } from '../support/battle-entry.ts';
import { SAVE_DIR } from './env.ts';
import { expectShadowClean, imagesLoaded, waitWhileLoading, watchLoading } from './play-flow.ts';
import { capture, clickWidget, devicePoint, expectGolden, nextFrames } from './ui-capture.ts';

const OPENING_MS = 1000;
const LAPTOP_POWER_UP = 'sounds/laptop power up (8-11).wav';

let saves: BattleEntrySaves;

async function loadSession(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/sessions', { data: { load: name, reseed: false } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

async function openMap(page: Page, session: string, extra = ''): Promise<void> {
  watchLoading(page);
  await page.goto(`/play?session=${encodeURIComponent(session)}&shadowHints=1${extra}`);
  await waitWhileLoading(page, () => window.__ja2Ui?.map?.ready === true || window.__ja2Ui?.error);
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.screen === 'map' && window.__ja2Ui.modal === null);
  await nextFrames(page, 4);
}

async function battle(page: Page): Promise<BattleHook['state']> {
  return page.evaluate(() => window.__ja2Ui.battle?.state ?? null);
}

async function arrive(page: Page): Promise<void> {
  await page.evaluate((seconds) => window.__ja2Ui.map?.advance({ worldSeconds: seconds }), ARRIVAL_WAIT_SECONDS);
  await page.waitForFunction(() => window.__ja2Ui.battle?.state?.preBattle?.phase === 'shown');
  await nextFrames(page, 2);
}

async function autoresolve(page: Page): Promise<void> {
  await clickWidget(page, 'preBattleAutoresolve');
  await page.waitForFunction(() => window.__ja2Ui.screen === 'autoresolve' && window.__ja2Ui.battle?.state?.autoresolve?.opening === false);
}

async function finish(page: Page, status: string): Promise<void> {
  await clickWidget(page, 'arFinish');
  await page.waitForFunction((wanted) => {
    const ar = window.__ja2Ui.battle?.state?.autoresolve;
    return ar?.status === wanted && ar.interface === 'done';
  }, status);
  await nextFrames(page, 2);
}

async function visible(page: Page, id: string): Promise<boolean> {
  return page.evaluate((wanted) => window.__ja2Ui.widgets.some((w) => w.id === wanted && w.visible), id);
}

test.describe('battle entry on the stub map-screen campaign', () => {
  let session = '';

  test.beforeAll(async () => {
    saves = await writeBattleEntrySaves(SAVE_DIR);
  });

  test.afterEach(async ({ page, request }) => {
    await expectShadowClean(page);
    if (session) await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    session = '';
  });

  test('shows the persistent pre-battle interface of an invasion', async ({ page, request }) => {
    session = await loadSession(request, saves.names.retreat);
    await openMap(page, session, '&pinClock=1');
    await arrive(page);
    expect((await battle(page))?.preBattle).toMatchObject({ persistent: true, encounter: 'enemyInvasion', autoStart: false });
    for (const id of ['preBattleAutoresolve', 'preBattleGoToSector', 'preBattleRetreat'])
      expect(await page.evaluate((wanted) => window.__ja2Ui.widgets.find((w) => w.id === wanted)?.enabled, id)).toBe(true);
    expect(await page.evaluate(() => window.__ja2Ui.battle?.sounds ?? [])).toContain(LAPTOP_POWER_UP);
    await imagesLoaded(page);
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    await expectGolden('pre-battle', await capture(page));
  });

  test('autoresolves over the shaded map screen', async ({ page, request }) => {
    session = await loadSession(request, saves.names.victory);
    await openMap(page, session, '&pinClock=1');
    await arrive(page);
    await autoresolve(page);
    expect((await battle(page))?.autoresolve).toMatchObject({ interface: 'battle', speed: 'play', status: 'inProgress' });
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    await expectGolden('autoresolve', await capture(page));
  });

  test('wins at Finish speed, offers Bandage and Done, and returns to the map', async ({ page, request }) => {
    session = await loadSession(request, saves.names.victory);
    await openMap(page, session);
    await arrive(page);
    await autoresolve(page);
    await finish(page, 'victory');
    expect(await visible(page, 'arDoneWin')).toBe(true);
    expect(await visible(page, 'arBandage')).toBe(true);
    expect((await battle(page))?.autoresolve?.elapsed).toMatch(/\d/);
    await clickWidget(page, 'arDoneWin');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'map' && window.__ja2Ui.battle?.state?.screen === null);
    expect((await page.evaluate(() => window.__ja2Ui.map?.screen?.flow)) ?? null).toBe('strategic');
  });

  test('loses a hopeless battle and offers the lone Done', async ({ page, request }) => {
    session = await loadSession(request, saves.names.defeat);
    await openMap(page, session);
    await arrive(page);
    await autoresolve(page);
    await finish(page, 'defeat');
    expect(await visible(page, 'arDoneLose')).toBe(true);
    expect(await visible(page, 'arDoneWin')).toBe(false);
    await clickWidget(page, 'arDoneLose');
    await page.waitForFunction(() => window.__ja2Ui.screen === 'map');
  });

  test('plays at Fast, pauses, retreats with the Retreat button and ends RETREATED', async ({ page, request }) => {
    session = await loadSession(request, saves.names.retreat);
    await openMap(page, session);
    await arrive(page);
    await autoresolve(page);
    await clickWidget(page, 'arPause');
    expect((await battle(page))?.autoresolve).toMatchObject({ status: 'inProgress', paused: true, speed: 'play' });
    await clickWidget(page, 'arFast');
    expect(await page.evaluate(() => window.__ja2Ui.battle?.drives.at(-1))).toBe('realtime:4');
    expect((await battle(page))?.autoresolve).toMatchObject({ paused: false, speed: 'fast' });
    await clickWidget(page, 'arPause');
    expect(await page.evaluate(() => window.__ja2Ui.battle?.drives.at(-1))).toBe('manual');
    expect((await battle(page))?.autoresolve).toMatchObject({ status: 'inProgress', paused: true, speed: 'fast' });
    await clickWidget(page, 'arRetreat');
    await page.waitForFunction(() => window.__ja2Ui.battle?.commands.includes('autoresolveRetreat:ok') === true);
    await finish(page, 'retreat');
    expect(await visible(page, 'arDoneLose')).toBe(true);
  });

  test('opens BATTLE IN PROGRESS from the battle locator during the tactical battle and closes it with Esc', async ({ page, request }) => {
    session = await loadSession(request, saves.names.retreat);
    await openMap(page, session);
    await arrive(page);
    await clickWidget(page, 'preBattleGoToSector');
    await waitWhileLoading(page, () => window.__ja2Ui.tactical?.ready === true && window.__ja2Ui.screen === 'tactical');
    await page.evaluate(() => window.__ja2Ui.map?.command({ type: 'mapScreen' }));
    await waitWhileLoading(page, () => window.__ja2Ui.screen === 'map' && window.__ja2Ui.map?.ready === true);
    await nextFrames(page, 4);
    const point = await page.evaluate((s) => window.__ja2Ui.map?.sectorPoint(s) ?? null, BATTLE_SECTOR);
    if (!point) throw new Error('no battle sector');
    const at = await devicePoint(page, point.x, point.y);
    await page.mouse.move(at.x, at.y);
    await nextFrames(page);
    await page.mouse.down();
    await nextFrames(page);
    await page.mouse.up();
    await page.waitForFunction(() => window.__ja2Ui.battle?.state?.preBattle?.phase === 'shown');
    expect((await battle(page))?.preBattle).toMatchObject({ persistent: false });
    expect(await page.evaluate(() => window.__ja2Ui.widgets.find((w) => w.id === 'preBattleRetreat')?.enabled)).toBe(false);
    await page.waitForTimeout(OPENING_MS / 4);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__ja2Ui.battle?.state?.preBattle === null && window.__ja2Ui.battle.state.commands.at(-1)?.type === 'answer',
    );
    expect((await battle(page))?.commands.at(-1)).toMatchObject({ type: 'answer', choice: 'close', ok: true });
    await clickWidget(page, 'compressMore');
    await page.waitForFunction(() => window.__ja2Ui.battle?.state?.preBattle?.phase === 'shown');
    expect((await battle(page))?.commands.at(-1)).toMatchObject({ type: 'showBattle', ok: true });
  });
});
