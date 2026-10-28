import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

const COLS = 160;
const MAX_ROUNDS = 40;
const STUB_SANDBOX_AMBIENT = 3;

interface WorldHook {
  readonly ready: boolean;
  readonly error: string | null;
  readonly framePolicy: string | null;
  readonly mercLightOrigin: string | null;
  readonly ambient: number | null;
  readonly corpses: number;
  readonly bloodPools: number;
  readonly drawnEffects: number;
}

const worldHook = () => (window as unknown as { __ja2Tactical?: WorldHook }).__ja2Tactical;

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly ap?: number;
  readonly life?: number;
}

interface View {
  readonly soldiers: readonly SoldierView[];
  readonly combat?: { readonly team: number } | null;
}

interface Report {
  readonly reason: string;
  readonly events: readonly { readonly type: string; readonly soldier?: number }[];
}

const distance = (a: number, b: number) => Math.hypot((a % COLS) - (b % COLS), Math.trunc(a / COLS) - Math.trunc(b / COLS));

test('an MCP agent fights the stub garrison through its own session; the renderer gets the corpses and the blood', async ({ page }) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-battle', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 7 })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };
  const events: Report['events'][number][] = [];
  const advance = async () => {
    const report = (await call('advance', { session, idle: true })) as Report;
    expect(report.reason).not.toBe('budget');
    events.push(...report.events);
    return report;
  };

  for (let step = 0; step < 12 && !(await observe()).combat; step++) {
    for (const s of (await observe()).soldiers.filter((x) => x.team === 0))
      await act({ type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' });
    await advance();
  }
  expect((await observe()).combat).toBeTruthy();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const view = await observe();
    if (!view.combat) break;
    const enemies = view.soldiers.filter((x) => x.team === 1 && (x.life ?? 1) > 0);
    for (const merc of view.soldiers.filter((x) => x.team === 0 && (x.life ?? 0) >= 15)) {
      const target = [...enemies].sort((a, b) => distance(merc.gridNo, a.gridNo) - distance(merc.gridNo, b.gridNo))[0];
      if (target) {
        for (let shot = 0; shot < 3; shot++) {
          if (!(await act({ type: 'attack', soldier: merc.id, target: target.gridNo, aimTime: 1 })).ok) break;
          await advance();
        }
      } else if ((await act({ type: 'move', soldier: merc.id, to: merc.gridNo + COLS * 2, mode: 'swat' })).ok) await advance();
    }
    if (!(await observe()).combat) break;
    await act({ type: 'endTurn' });
    await advance();
  }

  expect(events.some((e) => e.type === 'shotFired' && (e.soldier ?? 99) < 20)).toBe(true);
  expect(events.some((e) => e.type === 'soldierHit')).toBe(true);
  const after = (await observe()) as View & { readonly corpses?: readonly unknown[]; readonly blood?: readonly unknown[] };
  const corpses = after.corpses ?? [];
  const blood = after.blood ?? [];
  expect(corpses.length).toBeGreaterThan(0);
  expect(blood.length).toBeGreaterThan(0);
  await client.close();

  await page.goto(`/src/devtools/tactical/?session=${session}`);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __ja2Tactical?: WorldHook }).__ja2Tactical;
    return h?.ready || (h?.error ?? null) !== null;
  });
  const world = (await page.evaluate(worldHook)) as WorldHook;
  expect(world.error).toBeNull();
  expect(world.framePolicy).toBe('exact');
  expect(world.mercLightOrigin).toBe('data');
  expect(world.ambient).toBe(STUB_SANDBOX_AMBIENT);
  expect(world.corpses).toBe(corpses.length);
  expect(world.bloodPools).toBe(blood.length);
  await expect.poll(async () => (await page.evaluate(worldHook))?.drawnEffects).toBe(corpses.length);
});
