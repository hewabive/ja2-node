import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { clickAt, imagesLoaded, openTacticalSession, pointAt, rightClickWidget, showLatest, tacticalOrder } from './play-flow.ts';
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
const STEP_TIMEOUT_MS = 60_000;

async function newSession(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const created = (await (await request.post('/api/sessions', { data })).json()) as { session: string };
  return created.session;
}

async function soldierGridNo(page: Page, id: number): Promise<number | null> {
  return page.evaluate((wanted) => window.__ja2Ui.tactical?.soldiers().find((s) => s.id === wanted)?.gridNo ?? null, id);
}

async function restPointer(page: Page): Promise<void> {
  const logical = await page.evaluate(() => window.__ja2Ui.logical);
  await pointAt(page, logical.width - 1, 0);
}

test.describe('goldens of the tactical screen on stubs', () => {
  test.use({ viewport: { width: 1280, height: 960 } });
  test.beforeEach(({ page }) => {
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
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

  test('the sector exit dialog of a stub campaign', async ({ page, request }) => {
    const session = await newSession(request, { seed: CAMPAIGN_SEED, campaign: { difficulty: 1, mercs: 4 } });
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
      await page.waitForFunction(() => /EXIT_EAST/.test(window.__ja2Ui.tactical?.uiCursor ?? ''));
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
