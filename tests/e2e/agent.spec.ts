import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

const SERVER = 'http://127.0.0.1:7431';
const TOKEN = 'e2e-token-not-secret-0123456789';

interface Soldier {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
}

test('an MCP agent observes the stub sandbox, orders a move and advances time until idle', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-agent', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const status = await call('status');
  expect(status.map).toBe('stubs/world/maps/village.dat');
  const before = (await call('observe')).soldiers as Soldier[];
  const merc = before.find((s) => s.team === 0);
  if (!merc) throw new Error('no merc in the sandbox');
  const target = merc.gridNo + 160 * 3;
  expect(await call('act', { command: { type: 'move', soldier: merc.id, to: target } })).toMatchObject({ ok: true });
  const report = await call('advance', { idle: true });
  expect(report.reason).toBe('idle');
  const after = (await call('observe')).soldiers as Soldier[];
  expect(after.find((s) => s.id === merc.id)?.gridNo).toBe(target);
  await client.close();
});
