import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

const COLS = 160;
const SAVE_NAME = 'e2e-battle';
const ROUNDS_AFTER_LOAD = 3;
const SESSION_EVENTS = new Set(['gameSaved', 'gameLoaded']);

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly life?: number;
}

interface View {
  readonly soldiers: readonly SoldierView[];
  readonly combat?: { readonly team: number } | null;
  readonly [key: string]: unknown;
}

interface Report {
  readonly reason: string;
  readonly tick: number;
  readonly events: readonly { readonly type: string }[];
}

const distance = (a: number, b: number) => Math.hypot((a % COLS) - (b % COLS), Math.trunc(a / COLS) - Math.trunc(b / COLS));

test('an MCP agent saves in the middle of a battle and an exact load continues identically', async () => {
  test.setTimeout(120_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-saves', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session: original } = (await call('newSession', { seed: 7 })) as { session: string };
  const observe = async (session: string) => (await call('observe', { session })) as View;
  const act = async (session: string, command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };
  const advance = async (session: string) => (await call('advance', { session, idle: true })) as Report;

  for (let step = 0; step < 12 && !(await observe(original)).combat; step++) {
    for (const s of (await observe(original)).soldiers.filter((x) => x.team === 0))
      await act(original, { type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' });
    await advance(original);
  }
  expect((await observe(original)).combat).toBeTruthy();
  await advance(original);

  const saved = await call('save', { session: original, name: SAVE_NAME, description: 'in the middle of a battle' });
  expect(saved).toMatchObject({ ok: true, name: SAVE_NAME, header: { session: 'sandbox', description: 'in the middle of a battle' } });
  expect((await call('listSaves')).some((s: { name: string }) => s.name === SAVE_NAME)).toBe(true);
  const loaded = await call('load', { name: SAVE_NAME, reseed: false });
  expect(loaded).toMatchObject({ ok: true, name: SAVE_NAME, seed: null });
  const copy = loaded.session as string;
  expect(copy).not.toBe(original);

  const comparable = (view: View) => ({ ...view, language: undefined, dataVersion: undefined });
  const withoutSessionEvents = (report: Report) => ({ ...report, events: report.events.filter((e) => !SESSION_EVENTS.has(e.type)) });
  expect(comparable(await observe(copy))).toEqual(comparable(await observe(original)));

  let accepted = 0;
  let rounds = 0;
  for (let round = 0; round < ROUNDS_AFTER_LOAD; round++) {
    const view = await observe(original);
    if (!view.combat) break;
    const enemies = view.soldiers.filter((x) => x.team === 1 && (x.life ?? 1) > 0);
    for (const merc of view.soldiers.filter((x) => x.team === 0 && (x.life ?? 0) >= 15)) {
      const target = [...enemies].sort((a, b) => distance(merc.gridNo, a.gridNo) - distance(merc.gridNo, b.gridNo))[0];
      const command = target
        ? { type: 'attack', soldier: merc.id, target: target.gridNo, aimTime: 1 }
        : { type: 'stance', soldier: merc.id, stance: 'crouch' };
      const results = [await act(original, command), await act(copy, command)];
      expect(results[1]).toEqual(results[0]);
      if (results[0]?.ok) accepted++;
      if (results[0]?.ok) expect(withoutSessionEvents(await advance(copy))).toEqual(withoutSessionEvents(await advance(original)));
    }
    expect(await act(copy, { type: 'endTurn' })).toEqual(await act(original, { type: 'endTurn' }));
    expect(withoutSessionEvents(await advance(copy))).toEqual(withoutSessionEvents(await advance(original)));
    expect(comparable(await observe(copy))).toEqual(comparable(await observe(original)));
    rounds++;
  }
  expect(rounds).toBeGreaterThan(0);
  expect(accepted).toBeGreaterThan(0);

  expect(await call('deleteSave', { name: SAVE_NAME })).toEqual({ deleted: true });
  for (const auto of ['Auto01', 'Auto02']) await call('deleteSave', { name: auto });
  await client.close();
});
