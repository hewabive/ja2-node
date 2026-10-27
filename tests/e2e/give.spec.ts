import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const STUB_NPC = 94;
const NEAR_NPC = 74 * COLS + 75;
const ROUNDS_LINE = 25;
const NO_GUNS_LINE = 27;

interface InventoryView {
  readonly slot: number;
  readonly item: string;
  readonly count: number;
}

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly profile?: number;
  readonly inventory?: readonly InventoryView[];
}

interface LineView {
  readonly quote: number;
  readonly text?: string;
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
  readonly conversation?: { readonly profile: number; readonly talker: number | null } | null;
}

interface ActResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: {
    readonly walking?: boolean;
    readonly refusal?: string;
  };
}

interface AdvanceReport {
  readonly reason: string;
  readonly events: readonly ({ readonly type: string } & Partial<LineView>)[];
}

test('an MCP agent gives the stub NPC a magazine he keeps and a pistol he hands back', async () => {
  test.setTimeout(120_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-give', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 6, campaign: { difficulty: 1, mercs: 4 } })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as ActResult;
  const squad = async () => (await observe()).soldiers.filter((s) => s.team === 0);

  for (const [k, s] of (await squad()).entries())
    expect(await act({ type: 'move', soldier: s.id, to: (EAST_EDGE_ROW + k) * COLS + EAST_EDGE_COLUMN + k, mode: 'run' })).toMatchObject({
      ok: true,
    });
  await call('advance', { session, idle: true });
  const leader = (await squad())[0];
  if (!leader) throw new Error('no squad');
  expect(await act({ type: 'exitSector', soldier: leader.id, direction: 'east', who: 'squad', load: true })).toMatchObject({ ok: true });
  await call('advance', { session, idle: true });
  expect((await observe()).mapPath).toBe('stubs/world/maps/a10.dat');
  expect(await act({ type: 'move', soldier: leader.id, to: NEAR_NPC, mode: 'walk' })).toMatchObject({ ok: true });
  await call('advance', { session, idle: true });

  const armed = (await squad()).find((s) => s.id === leader.id);
  const sidearm = armed?.inventory?.find((o) => o.item === 'GLOCK_17');
  if (!sidearm) throw new Error('no sidearm');
  expect(await act({ type: 'moveItem', soldier: leader.id, from: sidearm.slot, to: 'hand' })).toMatchObject({ ok: true });
  const me = (await squad()).find((s) => s.id === leader.id);
  const clips = me?.inventory?.find((o) => o.item === 'CLIP9_15');
  if (!clips) throw new Error('no magazines');
  expect(await act({ type: 'give', soldier: leader.id, target: { npc: STUB_NPC } })).toMatchObject({
    ok: false,
    data: { refusal: 'needItemOrMoney' },
  });
  const giveThrough = async (command: Record<string, unknown>) => {
    const given = await act({ type: 'give', soldier: leader.id, target: { npc: STUB_NPC }, ...command });
    expect(given.ok, given.reason).toBe(true);
    const report = (await call('advance', { session, idle: true })) as AdvanceReport;
    return { types: report.events.map((e) => e.type), lines: report.events.filter((e) => e.type === 'npcQuote') };
  };
  const rounds = await giveThrough({ slot: clips.slot, count: 1 });
  expect(rounds.types).toContain('npcTookItem');
  expect(rounds.lines.at(-1)?.quote).toBe(ROUNDS_LINE);
  expect(rounds.lines.every((l) => typeof l.text === 'string')).toBe(true);
  expect((await observe()).conversation).toMatchObject({ profile: STUB_NPC, talker: leader.id });
  expect(await act({ type: 'closeTalk' })).toMatchObject({ ok: true });

  const pistol = await giveThrough({ slot: 'hand' });
  expect(pistol.types).toContain('itemReturned');
  expect(pistol.lines.map((l) => l.quote)).toEqual([NO_GUNS_LINE]);
  expect(await act({ type: 'closeTalk' })).toMatchObject({ ok: true });
  const after = (await squad()).find((s) => s.id === leader.id);
  expect(after?.inventory?.find((o) => o.slot === 5)?.item).toBe('GLOCK_17');
  expect(after?.inventory?.find((o) => o.slot === clips.slot)?.count).toBe(clips.count - 1);
  await client.close();
  await fetch(`${SERVER}/api/sessions/${encodeURIComponent(session)}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });
});
