import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { Vfs } from '../content/vfs/vfs.ts';
import type { SoldierView } from '../protocol/view.ts';
import { createApp } from './app.ts';
import { Session, type SessionSim } from './session.ts';

const token = 'mcp-test-token-0123456789';

function counter(): SessionSim {
  let tick = 0;
  let target = 0;
  return {
    get tick() {
      return tick;
    },
    isIdle: () => tick >= target,
    hasPendingDecision: () => false,
    step: () => {
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

describe('MCP endpoint', () => {
  it('lets an MCP client observe, act and advance', async () => {
    const sessions = new Map([['sandbox', new Session('sandbox', counter())]]);
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
      const r = await client.callTool({ name, arguments: args });
      return JSON.parse((r.content as { text: string }[])[0]?.text ?? 'null');
    };
    expect(await call('status')).toMatchObject({ session: 'sandbox', tick: 0, map: 'maps/a9.dat', soldiers: 1 });
    expect(await call('act', { command: { type: 'dance' } })).toMatchObject({ ok: false });
    expect(await call('act', { command: { type: 'wait', ticks: 40 } })).toEqual({ ok: true });
    expect(await call('advance', { idle: true })).toMatchObject({ tick: 40, reason: 'idle' });
    expect((await call('observe')).soldiers[0].name).toBe('Ivan');
    await client.close();
  });

  it('requires the token', async () => {
    const app = createApp({ vfs: new Vfs([]), token, info: { originalData: false, slfCount: 0, stubs: false } });
    expect((await app.request('http://localhost/mcp', { method: 'POST' })).status).toBe(401);
  });
});
