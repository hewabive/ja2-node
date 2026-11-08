import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { AUTO_BANDAGE_SAVE, writeAutoBandageSave } from '../support/e2e-auto-bandage-save.ts';
import { SAVE_DIR } from './env.ts';
import {
  clickAt,
  imagesLoaded,
  modalIs,
  openTacticalSession,
  pointAt,
  rightClickWidget,
  showLatest,
  tacticalOrder,
  waitWhileLoading,
  watchLoading,
} from './play-flow.ts';
import { capture, clickWidget, expectGolden } from './ui-capture.ts';

const COLS = 160;
const HAND = 5;
const BIG_POCKET = 7;
const DROPPER = 3;
const STEPS_EAST = 4;
const CAMPAIGN_SEED = 6;
const QUIET_SEED = 1;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const EDGE_INSET = 4;
const PINNED = '&pinClock=1';
const SHOT_ROWS_SOUTH = 10;
const SHOT_COLUMNS_EAST = 4;
const TICKS_INTO_FLIGHT = 1;
const MISS_ROWS_SOUTH = 6;
const MISS_COLUMNS_EAST = 2;
const TICKS_INTO_DUST = 40;
const TICKS_DOWN_THE_ROPE = 60;

interface CommandReply {
  readonly ok: boolean;
  readonly reason?: string;
}

async function newSession(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const created = (await (await request.post('/api/sessions', { data })).json()) as { session: string };
  return created.session;
}

async function soldierGridNo(page: Page, id: number): Promise<number | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.soldiers().find((s) => s.id === wanted)?.gridNo ?? null, id);
}

async function boxButtons(page: Page): Promise<(boolean | undefined)[]> {
  return page.evaluate(() =>
    ['autoBandageBox.done', 'autoBandageBox.cancel'].map((id) => window.__ja2Ui.widgets.find((w) => w.id === id)?.enabled),
  );
}

async function restPointer(page: Page): Promise<void> {
  const logical = await page.evaluate(() => window.__ja2Ui.logical);
  await pointAt(page, logical.width - 1, 0);
}

test.describe('goldens of the tactical screen on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  test.beforeAll(async () => {
    await writeAutoBandageSave(SAVE_DIR);
  });

  test('the auto-bandage box over the shadowed screen, from the a key through the question to Done', async ({ page, request }) => {
    const response = await request.post('/api/sessions', { data: { load: AUTO_BANDAGE_SAVE } });
    expect(response.ok()).toBe(true);
    const { session } = (await response.json()) as { session: string };
    try {
      await openTacticalSession(page, session, PINNED);
      await page.keyboard.press('KeyA');
      await modalIs(page, 'itemPromptBox');
      await clickWidget(page, 'itemPromptBox.yes');
      await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'autoBandageBox' && w.state === 'running'));
      expect(await boxButtons(page)).toEqual([false, true]);
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
      await showLatest(page);
      await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'autoBandageBox' && w.state === 'complete'));
      expect(await boxButtons(page)).toEqual([true, false]);
      await restPointer(page);
      await imagesLoaded(page);
      expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
      await expectGolden('tactical-auto-bandage', await capture(page));
      await clickWidget(page, 'autoBandageBox.done');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.commands.at(-1)?.type === 'endAutoBandage');
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.commands.at(-1))).toEqual({
        type: 'endAutoBandage',
        ok: true,
        reason: null,
      });
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ ticks: 1 }));
      await showLatest(page);
      await page.waitForFunction(() => !window.__ja2Ui.widgets.some((w) => w.id.startsWith('autoBandageBox')));
      expect(await page.evaluate(() => window.__ja2Ui.modal)).toBeNull();
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
  test('the single merc panel, the item description box and the overhead map of the sandbox', async ({ page, request }) => {
    const session = await newSession(request, { seed: QUIET_SEED });
    try {
      await openTacticalSession(page, session, PINNED);
      await clickWidget(page, 'teamFaceRegion0');
      await rightClickWidget(page, 'teamFaceRegion0');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.panel === 'sm' && window.__ja2Ui.tactical.smMerc === 0);
      await restPointer(page);
      await imagesLoaded(page);
      expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
      await expectGolden('tactical-sm-panel', await capture(page));

      await rightClickWidget(page, `slot${HAND}`);
      await page.waitForFunction(() => window.__ja2Ui.tactical?.descriptionOpen === true);
      await restPointer(page);
      await imagesLoaded(page);
      await expectGolden('tactical-item-description', await capture(page));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.descriptionOpen === false);

      await page.keyboard.press('Insert');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.overheadOpen === true);
      await restPointer(page);
      await expectGolden('tactical-overhead-map', await capture(page));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.overheadOpen === false);
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });

  test('the pickup menu of a tile with two items', async ({ page, request }) => {
    const session = await newSession(request, { seed: QUIET_SEED });
    try {
      await openTacticalSession(page, session, PINNED);
      const start = await soldierGridNo(page, DROPPER);
      if (start === null) throw new Error('the dropper is not in view');
      const dropTile = start + STEPS_EAST;
      await tacticalOrder(page, { type: 'move', soldier: DROPPER, to: dropTile });
      await tacticalOrder(page, { type: 'drop', soldier: DROPPER, slot: HAND });
      await tacticalOrder(page, { type: 'drop', soldier: DROPPER, slot: BIG_POCKET });
      await tacticalOrder(page, { type: 'move', soldier: DROPPER, to: dropTile + STEPS_EAST });
      await showLatest(page);
      expect(await soldierGridNo(page, DROPPER)).toBe(dropTile + STEPS_EAST);
      await clickWidget(page, 'teamFaceRegion0');
      await rightClickWidget(page, 'teamFaceRegion0');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.panel === 'sm');
      await clickWidget(page, 'smHand');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.uiMode === 'HANDCURSOR_MODE');
      const at = await page.evaluate((g) => window.__ja2Ui.tactical?.gridNoScreen(g) ?? null, dropTile);
      if (!at) throw new Error('no screen position for the drop tile');
      await clickAt(page, at.x, at.y);
      await page.waitForFunction(() => window.__ja2Ui.tactical?.pickupOpen === true);
      await restPointer(page);
      await imagesLoaded(page);
      await expectGolden('tactical-pickup-menu', await capture(page));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.pickupOpen === false);
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });

  test('a bullet in flight above its shadow', async ({ page, request }) => {
    const session = await newSession(request, { seed: QUIET_SEED });
    try {
      await openTacticalSession(page, session, PINNED);
      const merc = await page.evaluate(() => window.__ja2Ui.tactical?.soldiers().find((s) => s.team === 0) ?? null);
      if (!merc) throw new Error('no merc in the sandbox');
      const target = merc.gridNo + SHOT_ROWS_SOUTH * COLS + SHOT_COLUMNS_EAST;
      const attack = { type: 'attack', soldier: merc.id, target };
      const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), attack)) as CommandReply | undefined;
      expect(reply?.ok, reply?.reason).toBe(true);
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ events: ['shotFired'] }));
      await page.evaluate((ticks) => window.__ja2Ui.tactical?.advance({ ticks }), TICKS_INTO_FLIGHT);
      await showLatest(page);
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.drawnBullets)).toBe(1);
      await restPointer(page);
      await imagesLoaded(page);
      await expectGolden('tactical-bullet-in-flight', await capture(page));
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });

  test('the dust of a miss on the ground', async ({ page, request }) => {
    const session = await newSession(request, { seed: QUIET_SEED });
    try {
      await openTacticalSession(page, session, PINNED);
      const merc = await page.evaluate(() => window.__ja2Ui.tactical?.soldiers().find((s) => s.team === 0) ?? null);
      if (!merc) throw new Error('no merc in the sandbox');
      const attack = { type: 'attack', soldier: merc.id, target: merc.gridNo + MISS_ROWS_SOUTH * COLS + MISS_COLUMNS_EAST };
      const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), attack)) as CommandReply | undefined;
      expect(reply?.ok, reply?.reason).toBe(true);
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ events: ['bulletImpact'] }));
      await page.evaluate((ticks) => window.__ja2Ui.tactical?.advance({ ticks }), TICKS_INTO_DUST);
      await showLatest(page);
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.drawnImpacts)).toBe(1);
      await restPointer(page);
      await imagesLoaded(page);
      await expectGolden('tactical-miss-dust', await capture(page));
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });

  test('the helicopter shadow over the drop zone and the first merc on his way down, under the wait cursor', async ({ page, request }) => {
    const session = await newSession(request, { seed: CAMPAIGN_SEED, campaign: { difficulty: 1, mercs: 4, land: false } });
    try {
      watchLoading(page);
      await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual${PINNED}`);
      await waitWhileLoading(page, () => (window.__ja2Ui?.screen === 'map' && window.__ja2Ui.map?.ready === true) || window.__ja2Ui?.error);
      expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
      const landed = (await page.evaluate(() => window.__ja2Ui.map?.command({ type: 'compressTime', mode: 2 }))) as CommandReply;
      expect(landed.ok, landed.reason).toBe(true);
      await waitWhileLoading(page, () => window.__ja2Ui.screen === 'tactical' && window.__ja2Ui.tactical?.ready === true);
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ events: ['mercDropped'] }));
      await page.evaluate((ticks) => window.__ja2Ui.tactical?.advance({ ticks }), TICKS_DOWN_THE_ROPE);
      await showLatest(page);
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.uiLock)).toBe('helicopterDrop');
      await restPointer(page);
      await imagesLoaded(page);
      expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
      expect(await page.evaluate(() => window.__ja2Ui.tactical?.drawnEffects)).toBe(1);
      await expectGolden('tactical-helicopter-drop', await capture(page));
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });

  test('the sector exit dialog of a stub campaign', async ({ page, request }) => {
    const session = await newSession(request, { seed: CAMPAIGN_SEED, campaign: { difficulty: 1, mercs: 4, land: 'skip' } });
    try {
      await openTacticalSession(page, session, PINNED);
      const mercs = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).filter((s) => s.team === 0);
      for (const [k, m] of mercs.entries())
        await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), {
          type: 'move',
          soldier: m.id,
          to: (EAST_EDGE_ROW + k) * COLS + EAST_EDGE_COLUMN + k,
          mode: 'run',
        });
      await page.evaluate(() => window.__ja2Ui.tactical?.advance({ idle: true }));
      await showLatest(page);
      await clickWidget(page, 'teamFaceRegion0');
      await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), EAST_EDGE_ROW * COLS + COLS - 1);
      const logical = await page.evaluate(() => window.__ja2Ui.logical);
      await pointAt(page, logical.width - EDGE_INSET, Math.floor(logical.height / 3));
      await page.waitForFunction(() => /^EXIT_EAST/.test(window.__ja2Ui.tactical?.uiCursor ?? ''));
      await clickAt(page, logical.width - EDGE_INSET, Math.floor(logical.height / 3));
      await page.waitForFunction(() => window.__ja2Ui.tactical?.exitDialogOpen === true);
      await restPointer(page);
      await imagesLoaded(page);
      await expectGolden('tactical-exit-dialog', await capture(page));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.exitDialogOpen === false);
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
});
