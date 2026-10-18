import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const STUB_RPC = 65;
const STUB_ESCORT = 123;
const NEAR_STUB_RPC = 72 * COLS + 81;

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly profile?: number;
  readonly talkable?: string;
  readonly kind?: string;
}

interface StrategicMercView {
  readonly id: number;
  readonly kind?: string;
}

interface NpcRequestView {
  readonly id: string;
  readonly request: string;
  readonly amount?: number;
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
  readonly strategic?: { readonly mercs: readonly StrategicMercView[] };
  readonly npcRequest?: NpcRequestView | null;
  readonly conversation?: unknown;
}

interface ActResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: {
    readonly walking?: boolean;
    readonly refusal?: string;
    readonly triggered?: boolean;
    readonly released?: readonly { readonly profile: number; readonly quote: number | null }[];
    readonly lines?: readonly { readonly quote: number; readonly text?: string }[];
  };
}

test('an MCP agent hires the stub R.P.C., escorts the stub E.P.C. and releases her twice, the second time in the browser', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-recruit', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 6, campaign: { difficulty: 1, mercs: 3 } })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as ActResult;
  const squad = async () => (await observe()).soldiers.filter((s) => s.team === 0);
  const talkTo = async (soldier: number, npc: number) => {
    const talk = await act({ type: 'talk', soldier, target: { npc } });
    expect(talk.ok, talk.reason).toBe(true);
    if (talk.data?.walking) expect((await call('advance', { session, idle: true })).reason).toBe('decision');
  };
  const answerYes = async () => {
    const request = (await observe()).npcRequest;
    expect(request).toBeTruthy();
    const answered = await act({ type: 'answer', prompt: request?.id, choice: 'yes' });
    expect(answered.ok, answered.reason).toBe(true);
    return answered;
  };

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
  expect(await act({ type: 'move', soldier: leader.id, to: NEAR_STUB_RPC, mode: 'walk' })).toMatchObject({ ok: true });
  await call('advance', { session, idle: true });

  await talkTo(leader.id, STUB_RPC);
  expect(await act({ type: 'approach', kind: 'recruit' })).toMatchObject({ ok: true });
  expect((await observe()).npcRequest).toMatchObject({ request: 'hire', amount: 120 });
  await answerYes();
  const rpc = (await observe()).soldiers.find((s) => s.profile === STUB_RPC);
  expect(rpc).toMatchObject({ team: 0, kind: 'rpc' });
  expect((await observe()).strategic?.mercs.find((m) => m.id === rpc?.id)?.kind).toBe('rpc');

  await talkTo(leader.id, STUB_ESCORT);
  expect(await act({ type: 'approach', kind: 'recruit' })).toMatchObject({ ok: true });
  expect((await observe()).npcRequest).toMatchObject({ request: 'escort' });
  await answerYes();
  if ((await observe()).conversation) await act({ type: 'closeTalk' });
  const escort = (await observe()).soldiers.find((s) => s.profile === STUB_ESCORT && s.team === 0);
  expect(escort).toMatchObject({ kind: 'epc' });
  expect(await act({ type: 'unescort', soldier: leader.id })).toMatchObject({ ok: false, data: { refusal: 'notAnEpc' } });
  const released = await act({ type: 'unescort', soldier: escort?.id });
  expect(released).toMatchObject({ ok: true, data: { triggered: true } });
  expect((await observe()).soldiers.find((s) => s.profile === STUB_ESCORT)).toMatchObject({ team: 4, talkable: 'npc' });

  await talkTo(leader.id, STUB_ESCORT);
  expect(await act({ type: 'approach', kind: 'recruit' })).toMatchObject({ ok: true });
  await answerYes();
  if ((await observe()).conversation) await act({ type: 'closeTalk' });
  const again = (await observe()).soldiers.find((s) => s.profile === STUB_ESCORT && s.team === 0);
  expect(await act({ type: 'mapScreen' })).toMatchObject({ ok: true });
  await page.goto(`/src/devtools/strategic/?session=${session}`);
  await page.waitForFunction(() => window.__ja2Strategic?.ready || window.__ja2Strategic?.error !== null);
  await page.click(`[data-unescort="${again?.id}"]`);
  await expect(page.locator('#result')).toHaveText(/ released$/);
  expect((await observe()).strategic?.mercs.some((m) => m.id === again?.id)).toBe(false);
  await client.close();
});
