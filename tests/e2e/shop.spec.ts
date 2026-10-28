import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { MCP_CALL_OPTIONS, SERVER, TOKEN } from './env.ts';

const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const DEALER_TILE = 74 * COLS + 69;
const DEALER = 91;

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly profile?: number;
  readonly merchant?: string;
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
}

test('walks a campaign squad out of A9 to the stub dealer and buys from the tactical shop panel', async ({ page }) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-shop', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 3, campaign: { difficulty: 1, mercs: 4 } })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };
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
  expect(await act({ type: 'move', soldier: leader.id, to: DEALER_TILE + 2, mode: 'walk' })).toMatchObject({ ok: true });
  await call('advance', { session, idle: true });
  expect((await observe()).soldiers.find((s) => s.profile === DEALER)?.merchant).toBe('buySell');
  await client.close();

  await page.goto(`/src/devtools/tactical/?session=${session}`);
  await page.waitForFunction(() => window.__ja2Tactical?.ready || window.__ja2Tactical?.error !== null);
  expect(await page.evaluate(() => window.__ja2Tactical.selected)).toBe(leader.id);
  await expect(page.locator('#trade')).toBeEnabled();
  await page.click('#trade');
  await expect(page.locator('#shop')).toBeVisible();
  await expect(page.locator('#shopTitle')).toContainText('buySell');
  await page.locator('#shopBoxes button', { hasText: 'buy' }).first().click();
  await expect(page.locator('#shopResult')).toHaveText(/^done: cost \$\d+/);
  await page.click('#closeShop');
  await expect(page.locator('#shop')).toBeHidden();
});
