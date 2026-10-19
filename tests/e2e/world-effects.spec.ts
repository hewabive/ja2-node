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
  command(cmd: {
    readonly type: string;
    readonly [key: string]: unknown;
  }): Promise<{ ok: boolean; reason?: string; data?: { refusal?: string } }>;
}

const ORDER_PAUSE_MS = 400;
const OUR_TEAM = 0;
const KILL_TIMEOUT_MS = 90_000;

async function hook(page: Page): Promise<WorldEffectsHook> {
  return page.evaluate(() => (window as unknown as { __ja2Tactical: WorldEffectsHook }).__ja2Tactical);
}

test('follows the animation schedule, lights from the view and draws a corpse the server reports', async ({ page }) => {
  test.setTimeout(KILL_TIMEOUT_MS + 30_000);
  await page.goto('/');
  const created = await page.evaluate(async () => {
    const r = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return (await r.json()) as { session: string };
  });
  await page.goto(`/src/devtools/tactical/?session=${created.session}`);
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
  expect(start.soldierGridNos.filter((s) => s.team === OUR_TEAM).length).toBeGreaterThanOrEqual(2);
  await page.click('[data-speed="8"]');
  const refusals: string[] = [];
  const order = (cmd: { readonly type: string; readonly [key: string]: unknown }) =>
    page.evaluate((c) => (window as unknown as { __ja2Tactical: WorldEffectsHook }).__ja2Tactical.command(c), cmd);
  const deadline = Date.now() + KILL_TIMEOUT_MS;
  let turn = 0;
  let refused = 0;
  while (Date.now() < deadline && (await hook(page)).corpses === 0) {
    const squad = (await hook(page)).soldierGridNos.filter((s) => s.team === OUR_TEAM);
    const shooter = squad[turn % Math.max(1, squad.length)];
    const victim = squad.find((s) => s.id !== shooter?.id);
    turn++;
    if (!shooter || !victim) {
      await page.waitForTimeout(ORDER_PAUSE_MS);
      continue;
    }
    const result = await order({ type: 'attack', soldier: shooter.id, target: victim.gridNo, aimTime: 0 });
    const refusal = result.data?.refusal ?? (result.ok ? null : (result.reason ?? 'refused'));
    refused = refusal ? refused + 1 : 0;
    if (refusal) refusals.push(refusal);
    if (refusal === 'notEnoughAP' || refused > squad.length) {
      await order({ type: 'endTurn' });
      refused = 0;
    }
    await page.waitForTimeout(ORDER_PAUSE_MS);
  }
  await expect
    .poll(async () => (await hook(page)).corpses, { message: [...new Set(refusals)].join(', '), timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await hook(page)).drawnEffects, { timeout: 15_000 }).toBeGreaterThan(0);
});
