import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

const SERVER = 'http://127.0.0.1:7431';
const TOKEN = 'e2e-token-not-secret-0123456789';
const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const STUB_NPC = 94;
const STUB_NPC_TILE = 74 * COLS + 72;
const NEAR_NPC = STUB_NPC_TILE + 3;

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly profile?: number;
  readonly talkable?: string;
}

interface LineView {
  readonly quote: number;
  readonly text?: string;
}

interface ConversationView {
  readonly profile: number;
  readonly initiatedBy: string;
  readonly menu: readonly string[];
  readonly lastQuotes: readonly LineView[];
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
  readonly conversation?: ConversationView | null;
}

interface ActResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: { readonly walking?: boolean; readonly lines?: readonly LineView[]; readonly refusal?: string };
}

test('an MCP agent walks a stub squad to A10 and talks to the stub NPC', async () => {
  test.setTimeout(120_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-talk', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 5, campaign: { difficulty: 1, mercs: 4 } })) as { session: string };
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
  expect((await observe()).soldiers.find((s) => s.profile === STUB_NPC)?.talkable).toBe('npc');

  const talk = await act({ type: 'talk', soldier: leader.id, target: { npc: STUB_NPC } });
  expect(talk.ok, talk.reason).toBe(true);
  if (talk.data?.walking) expect((await call('advance', { session, idle: true })).reason).toBe('decision');
  const opened = (await observe()).conversation;
  expect(opened).toMatchObject({ profile: STUB_NPC, initiatedBy: 'player' });
  expect(opened?.menu).toContain('direct');
  expect(opened?.lastQuotes.length).toBeGreaterThan(0);
  expect(opened?.lastQuotes[0]?.text?.length).toBeGreaterThan(0);
  expect((await call('advance', { session, ticks: 10 })).reason).toBe('refused');

  const direct = await act({ type: 'approach', kind: 'direct' });
  expect(direct.ok, direct.reason).toBe(true);
  expect(direct.data?.lines?.length).toBeGreaterThan(0);
  expect(direct.data?.lines?.every((l) => typeof l.text === 'string')).toBe(true);
  expect(await act({ type: 'move', soldier: leader.id, to: 0 })).toMatchObject({ ok: false, data: { refusal: 'conversationOpen' } });
  expect(await act({ type: 'closeTalk' })).toMatchObject({ ok: true });
  expect((await observe()).conversation).toBeNull();
  await client.close();
});
