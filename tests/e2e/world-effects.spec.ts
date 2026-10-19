import { expect, type Page, test } from '@playwright/test';

interface WorldEffectsHook {
  ready: boolean;
  error: string | null;
  framePolicy: string | null;
  mercLightOrigin: string | null;
  corpses: number;
  drawnEffects: number;
  ambient: number | null;
  dynamicLights: number;
  soldierGridNos: { readonly id: number; readonly team: number; readonly gridNo: number }[];
  command(cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<{ ok: boolean; reason?: string }>;
}

const MAX_SHOTS = 40;
const OUR_TEAM = 0;

async function hook(page: Page): Promise<WorldEffectsHook> {
  return page.evaluate(() => (window as unknown as { __ja2Tactical: WorldEffectsHook }).__ja2Tactical);
}

test('follows the animation schedule, lights from the view and draws a corpse the server reports', async ({ page }) => {
  await page.goto('/src/devtools/tactical/');
  await page.waitForFunction(() => {
    const h = (window as unknown as { __ja2Tactical?: WorldEffectsHook }).__ja2Tactical;
    return h?.ready || (h?.error ?? null) !== null;
  });
  const start = await hook(page);
  expect(start.error).toBeNull();
  expect(start.framePolicy).toBe('exact');
  expect(start.mercLightOrigin).toBe('standIn');
  expect(start.ambient).toBe(3);
  expect(start.dynamicLights).toBe(0);
  expect(start.corpses).toBe(0);
  const squad = start.soldierGridNos.filter((s) => s.team === OUR_TEAM);
  const [shooter, victim] = squad;
  if (!shooter || !victim) throw new Error('the stub squad has fewer than two mercs');
  await page.click('[data-speed="instant"]');
  for (let shot = 0; shot < MAX_SHOTS && (await hook(page)).corpses === 0; shot++) {
    await page.evaluate(
      ([s, g]) =>
        (window as unknown as { __ja2Tactical: WorldEffectsHook }).__ja2Tactical.command({
          type: 'attack',
          soldier: s,
          target: g,
          aimTime: 4,
        }),
      [shooter.id, victim.gridNo] as const,
    );
    await page.click('#skip');
    await page.waitForTimeout(100);
  }
  await expect.poll(async () => (await hook(page)).corpses, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await hook(page)).drawnEffects, { timeout: 15_000 }).toBeGreaterThan(0);
});
