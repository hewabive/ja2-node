import { type APIRequestContext, expect, test } from '@playwright/test';
import { openTacticalSession } from './play-flow.ts';

const SQUAD_SIZE = 4;
const MAX_WORLD_DRAW_CALLS = 60;
const TILE_CENTRE = 5;
const TILE_STEP = 10;
const SPRITE_ABOVE_FEET = 15;
const SANDBOX_SEED = 11;

async function newSandbox(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/sessions', { data: { seed: SANDBOX_SEED } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

test('draws the stub sandbox in few batches on a tile-centred camera and picks a merc by his sprite', async ({ page, request }) => {
  const session = await newSandbox(request);
  try {
    await openTacticalSession(page, session);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.map)).toBe('stubs/world/maps/village.dat');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.drawnSoldiers ?? 0)).toBeGreaterThanOrEqual(SQUAD_SIZE);
    const drawn = await page.evaluate(() => ({
      drawCalls: window.__ja2Ui.tactical?.drawCalls ?? 0,
      camera: window.__ja2Ui.tactical?.camera,
    }));
    expect(drawn.drawCalls).toBeGreaterThan(0);
    expect(drawn.drawCalls).toBeLessThanOrEqual(MAX_WORLD_DRAW_CALLS);
    expect((drawn.camera?.centerX ?? 0) % TILE_STEP).toBe(TILE_CENTRE);
    expect((drawn.camera?.centerY ?? 0) % TILE_STEP).toBe(TILE_CENTRE);

    const picked = await page.evaluate((above) => {
      const tactical = window.__ja2Ui.tactical;
      const merc = tactical?.soldiers().find((s) => s.team === 0);
      const at = merc ? tactical?.soldierScreen(merc.id) : null;
      return merc && at ? { merc: merc.id, hit: tactical?.soldierAt(at.x, at.y - above) ?? null } : null;
    }, SPRITE_ABOVE_FEET);
    expect(picked).not.toBeNull();
    expect(picked?.hit).toBe(picked?.merc);
  } finally {
    await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  }
});
