import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

const COLS = 160;
const REST_MS = 140;
const READY_PATIENCE_MS = 30_000;
const GRID_STEPS = 6;
const MAX_LOCAL_P95_MS = 250;

interface HintStatsView {
  readonly local: number;
  readonly server: number;
  readonly shadowCompared: number;
  readonly shadowStale: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly unknown[];
  readonly latency: { readonly count: number; readonly p50: number; readonly p95: number; readonly max: number };
  readonly projection: { readonly count: number; readonly p50: number; readonly p95: number; readonly max: number };
}

interface HintHookView {
  readonly ready: boolean;
  readonly usable: boolean;
  readonly error: string | null;
  readonly shadow: boolean;
  readonly stats: HintStatsView;
  readonly last: { readonly reply: { readonly state: string } } | null;
}

interface TacticalHookView {
  readonly ready: boolean;
  readonly error: string | null;
  readonly zoom: number;
  readonly soldierBoxes: readonly { id: number; x: number; y: number; width: number; height: number }[];
  readonly soldierTeams: readonly number[];
}

type HintWindow = Window & { __ja2Ui?: { hints?: HintHookView }; __ja2Tactical?: TacticalHookView };

async function battleSession(): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-hints', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 7 })) as { session: string };
  type View = { soldiers: { id: number; team: number; gridNo: number }[]; combat?: unknown };
  const observe = async () => (await call('observe', { session })) as View;
  for (let step = 0; step < 12 && !(await observe()).combat; step++) {
    for (const s of (await observe()).soldiers.filter((x) => x.team === 0))
      await call('act', { session, command: { type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' } });
    await call('advance', { session, idle: true });
  }
  await call('advance', { session, idle: true });
  await client.close();
  return session;
}

async function restedHint(page: Page): Promise<void> {
  await page.waitForTimeout(REST_MS);
  await page
    .waitForFunction(() => (window as unknown as HintWindow).__ja2Ui?.hints?.last?.reply.state === 'ready', null, {
      timeout: READY_PATIENCE_MS,
    })
    .catch(() => undefined);
}

async function hover(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await restedHint(page);
}

test('the shadow mode computes cursor hints in the browser and finds no difference with the server', async ({ page }) => {
  const session = await battleSession();
  try {
    await shadowHover(page, session);
  } finally {
    await fetch(`${SERVER}/api/sessions/${encodeURIComponent(session)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  }
});

async function shadowHover(page: Page, session: string): Promise<void> {
  await page.goto(`/src/devtools/tactical/?session=${encodeURIComponent(session)}&shadowHints=1`);
  await page.waitForFunction(() => (window as unknown as HintWindow).__ja2Tactical?.ready);
  await page.waitForFunction(() => (window as unknown as HintWindow).__ja2Ui?.hints?.ready === true);
  const hook = await page.evaluate(() => (window as unknown as HintWindow).__ja2Ui?.hints as HintHookView);
  expect(hook.error).toBeNull();
  expect(hook.usable, 'the client rules and engine match the server').toBe(true);
  expect(hook.shadow).toBe(true);

  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  for (let i = 1; i < GRID_STEPS; i++)
    for (let j = 1; j < GRID_STEPS; j++) await hover(page, box.x + (box.width * i) / GRID_STEPS, box.y + (box.height * j) / GRID_STEPS);

  const tactical = await page.evaluate(() => (window as unknown as HintWindow).__ja2Tactical as TacticalHookView);
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const scale = tactical.zoom / dpr;
  for (const s of tactical.soldierBoxes) await hover(page, box.x + (s.x + s.width / 2) * scale, box.y + (s.y + s.height / 2) * scale);

  const slots = page.locator('#hints .hint-slots button');
  const count = await slots.count();
  for (let k = 0; k < count; k++) {
    await slots.nth(k).hover();
    await restedHint(page);
  }

  await expect
    .poll(() => page.evaluate(() => (window as unknown as HintWindow).__ja2Ui?.hints?.stats.shadowCompared ?? 0))
    .toBeGreaterThan(10);
  const stats = await page.evaluate(() => (window as unknown as HintWindow).__ja2Ui?.hints?.stats as HintStatsView);
  console.log(
    `hint latency in the browser (stubs): hints ${JSON.stringify(stats.latency)}, projection ${JSON.stringify(stats.projection)}; ${stats.local} local, ${stats.shadowCompared} compared`,
  );
  expect(stats.mismatches, 'local hints equal the server answers').toEqual([]);
  expect(stats.mismatchCount).toBe(0);
  expect(stats.local).toBeGreaterThan(10);
  expect(stats.latency.p95).toBeLessThan(MAX_LOCAL_P95_MS);
}
