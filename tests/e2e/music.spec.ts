import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { MCP_CALL_OPTIONS, SERVER, TOKEN } from './env.ts';
import { openTacticalSession, showLatest } from './play-flow.ts';

interface MusicHook {
  readonly ready: boolean;
  readonly serverMode: string | null;
  readonly mode: string | null;
  readonly track: string | null;
  readonly tracks: readonly string[];
  readonly error: string | null;
}

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
}

interface View {
  readonly soldiers: readonly SoldierView[];
  readonly combat?: { readonly team: number } | null;
}

const COLS = 160;
const music = (page: Page) => page.evaluate(() => ({ ...window.__ja2Ui.music }) as MusicHook);

test('the game page plays the music of the session mode after the first gesture and switches to battle music in combat', async ({
  page,
}) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-music', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, MCP_CALL_OPTIONS);
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 7 })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };

  await openTacticalSession(page, session);
  await page.waitForFunction(() => window.__ja2Ui.music?.ready || window.__ja2Ui.music?.error);
  await page.keyboard.press('Shift');
  const before = await music(page);
  expect(before.error).toBeNull();
  expect(before.serverMode).toBe('tacticalEnemyPresent');
  await expect.poll(async () => (await music(page)).track).toMatch(/^music\/tensor /);

  for (let step = 0; step < 12 && !(await observe()).combat; step++) {
    for (const s of (await observe()).soldiers.filter((x) => x.team === 0))
      await act({ type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' });
    await call('advance', { session, idle: true });
  }
  expect((await observe()).combat).toBeTruthy();
  await showLatest(page);

  await expect.poll(async () => (await music(page)).serverMode).toBe('tacticalBattle');
  await expect.poll(async () => (await music(page)).track).toMatch(/^music\/battle /);
  const heard = await music(page);
  expect(heard.mode).toBe('tacticalBattle');
  expect(heard.tracks.some((t) => t.startsWith('music/tensor '))).toBe(true);
  await client.close();
  await fetch(`${SERVER}/api/sessions/${encodeURIComponent(session)}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });
});
