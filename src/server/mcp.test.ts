import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { MCP_CALL_OPTIONS } from '../../tests/support/patience.ts';
import { Vfs } from '../content/vfs/vfs.ts';
import type { SoldierView } from '../protocol/view.ts';
import { createApp } from './app.ts';
import { Session, type SessionSim } from './session.ts';
import { InProcessHost, type SessionHost } from './session-host.ts';
import { SliceScheduler, TimeSlicer } from './slicing.ts';

const token = 'mcp-test-token-0123456789';

const SLOW_TICK_MS = 2;
const LONG_TURN_TICKS = 120;

function counter(tickCostMs = 0): SessionSim {
  let tick = 0;
  let target = 0;
  return {
    get tick() {
      return tick;
    },
    isIdle: () => tick >= target,
    hasPendingDecision: () => false,
    step: () => {
      const until = performance.now() + tickCostMs;
      while (performance.now() < until);
      tick++;
    },
    drainEvents: () => [],
    dispatch: (cmd) => {
      if (cmd.type !== 'wait') return { ok: false, reason: `unknown command ${cmd.type}` };
      target = Number(cmd.ticks);
      return { ok: true };
    },
    view: () => ({ tick, mapPath: 'maps/a9.dat', soldiers: [{ id: 1, name: 'Ivan' } as SoldierView] }),
  };
}

async function mcpClient(app: ReturnType<typeof createApp>) {
  const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: fetchViaApp,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
    return JSON.parse((r.content as { text: string }[])[0]?.text ?? 'null');
  };
  return { client, call };
}

describe('MCP endpoint', () => {
  it('lets an MCP client observe, act and advance', async () => {
    const sessions = new Map<string, SessionHost>([['sandbox', new InProcessHost(new Session('sandbox', counter()))]]);
    const app = createApp({
      vfs: new Vfs([]),
      token,
      info: { originalData: false, slfCount: 0, stubs: false },
      sessions,
      defaultSession: 'sandbox',
    });
    const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: fetchViaApp,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['act', 'advance', 'observe', 'status']);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
      return JSON.parse((r.content as { text: string }[])[0]?.text ?? 'null');
    };
    expect(await call('status')).toMatchObject({ session: 'sandbox', tick: 0, map: 'maps/a9.dat', soldiers: 1 });
    expect(await call('act', { command: { type: 'dance' } })).toMatchObject({ ok: false });
    expect(await call('act', { command: { type: 'wait', ticks: 40 } })).toEqual({ ok: true });
    expect(await call('advance', { idle: true })).toMatchObject({ tick: 40, reason: 'idle' });
    expect((await call('observe')).soldiers[0].name).toBe('Ivan');
    await client.close();
  });

  it('answers a second session while the first runs a long instant turn', async () => {
    const scheduler = new SliceScheduler();
    const slow = new TimeSlicer(scheduler);
    const battle = new InProcessHost(new Session('battle', counter(SLOW_TICK_MS)), { slicer: slow });
    const viewer = new InProcessHost(new Session('viewer', counter()), { slicer: new TimeSlicer(scheduler) });
    await battle.setDriver({ mode: 'instant' });
    const sessions = new Map<string, SessionHost>([
      ['battle', battle],
      ['viewer', viewer],
    ]);
    const app = createApp({
      vfs: new Vfs([]),
      token,
      info: { originalData: false, slfCount: 0, stubs: false },
      sessions,
      defaultSession: 'viewer',
    });
    const agents = [await mcpClient(app), await mcpClient(app)];
    const order: string[] = [];
    const turn = agents[0]?.call('act', { session: 'battle', command: { type: 'wait', ticks: LONG_TURN_TICKS } }).then((r) => {
      order.push('battle');
      return r;
    });
    const look = await agents[1]?.call('observe', { session: 'viewer' });
    order.push('viewer');
    expect(await turn).toEqual({ ok: true });
    expect(order).toEqual(['viewer', 'battle']);
    expect(look.soldiers[0].name).toBe('Ivan');
    expect(await agents[1]?.call('status', { session: 'battle' })).toMatchObject({ tick: LONG_TURN_TICKS, idle: true });
    expect(slow.slices).toBeGreaterThan(1);
    for (const agent of agents) await agent?.client.close();
  });

  it('requires the token', async () => {
    const app = createApp({ vfs: new Vfs([]), token, info: { originalData: false, slfCount: 0, stubs: false } });
    expect((await app.request('http://localhost/mcp', { method: 'POST' })).status).toBe(401);
  });
});
