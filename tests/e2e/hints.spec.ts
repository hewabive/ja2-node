import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { MCP_CALL_OPTIONS, SERVER, TOKEN } from './env.ts';
import { openTacticalSession, waitShadowSettled } from './play-flow.ts';
import { devicePoint, nextFrames } from './ui-capture.ts';

const COLS = 160;
const REST_MS = 140;
const HOVER_REACH = 2;
const HOVER_STEP = 2;
const SPRITE_ABOVE_FEET = 15;
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

type HintWindow = Window & { __ja2Ui?: { hints?: HintHookView } };

async function battleSession(): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-hints', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
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

async function hover(page: Page, point: { readonly x: number; readonly y: number }): Promise<void> {
  const at = await devicePoint(page, point.x, point.y);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(REST_MS);
  await nextFrames(page);
}

async function hoverPoints(page: Page): Promise<{ readonly x: number; readonly y: number }[]> {
  return page.evaluate(
    ({ cols, reach, step, above }) => {
      const tactical = window.__ja2Ui.tactical;
      if (!tactical) return [];
      const soldiers = tactical.soldiers();
      const tiles = soldiers
        .filter((s) => s.team === 0)
        .flatMap((s) => {
          const around: number[] = [];
          for (let dy = -reach; dy <= reach; dy += step)
            for (let dx = -reach; dx <= reach; dx += step) around.push(s.gridNo + dx + dy * cols);
          return around;
        })
        .map((g) => tactical.gridNoScreen(g));
      const bodies = soldiers.map((s) => tactical.soldierScreen(s.id)).map((p) => (p ? { x: p.x, y: p.y - above } : null));
      return [...tiles, ...bodies].filter((p): p is { x: number; y: number } => p !== null);
    },
    { cols: COLS, reach: HOVER_REACH, step: HOVER_STEP, above: SPRITE_ABOVE_FEET },
  );
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
  await openTacticalSession(page, session, '&shadowHints=1');
  await page.waitForFunction(() => (window as unknown as HintWindow).__ja2Ui?.hints?.ready === true);
  const hook = await page.evaluate(() => (window as unknown as HintWindow).__ja2Ui?.hints as HintHookView);
  expect(hook.error).toBeNull();
  expect(hook.usable, 'the client rules and engine match the server').toBe(true);
  expect(hook.shadow).toBe(true);

  for (const point of await hoverPoints(page)) await hover(page, point);
  await waitShadowSettled(page, 'tactical');

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
