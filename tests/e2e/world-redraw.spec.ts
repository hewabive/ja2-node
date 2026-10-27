import { expect, type Page, test } from '@playwright/test';
import { openTacticalSession, tacticalOrder } from './play-flow.ts';

const QUIET_SEED = 1;
const MAP_MIDDLE = { x: 640, y: 300 };
const SCROLL_MS = 600;
const PLAYBACK_MS = 2_000;
const STEPS_EAST = 3;
const SHOT_ROWS_SOUTH = 10;
const COLS = 160;
const SCROLLS: readonly (readonly string[])[] = [
  ['ArrowDown'],
  ['ArrowLeft'],
  ['ArrowUp'],
  ['ArrowRight'],
  ['ArrowDown', 'ArrowRight'],
  ['ArrowUp', 'ArrowLeft'],
];

async function hold(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(SCROLL_MS);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

test.describe('partial redraws of the tactical world (docs/28 §16)', () => {
  test.use({ viewport: { width: 1280, height: 960 } });

  test('match a whole redraw while the squad breathes, walks and shoots and the camera scrolls', async ({ page, request }) => {
    const { session } = (await (await request.post('/api/sessions', { data: { seed: QUIET_SEED } })).json()) as { session: string };
    try {
      await openTacticalSession(page, session, '&worldCheck=1');
      const merc = await page.evaluate(() => window.__ja2Ui.tactical?.soldiers().find((s) => s.team === 0) ?? null);
      if (!merc) throw new Error('no merc in the sandbox');
      await page.evaluate((gridNo) => window.__ja2Ui.tactical?.centerOn(gridNo), merc.gridNo);
      await page.mouse.move(MAP_MIDDLE.x, MAP_MIDDLE.y);
      await tacticalOrder(page, { type: 'move', soldier: merc.id, to: merc.gridNo + STEPS_EAST, mode: 'walk' });
      await page.waitForTimeout(PLAYBACK_MS);
      await tacticalOrder(page, { type: 'attack', soldier: merc.id, target: merc.gridNo + STEPS_EAST + SHOT_ROWS_SOUTH * COLS });
      await page.waitForTimeout(PLAYBACK_MS);
      for (const keys of SCROLLS) await hold(page, keys);
      const checks = await page.evaluate(() => window.__ja2Ui.tactical?.worldChecks ?? null);
      console.log(`partial world redraws checked against whole ones: ${JSON.stringify(checks)}`);
      expect(checks?.frames ?? 0).toBeGreaterThan(SCROLLS.length);
      expect(checks?.mismatchedFrames, JSON.stringify(checks?.lastMismatch)).toBe(0);
    } finally {
      await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
    }
  });
});
