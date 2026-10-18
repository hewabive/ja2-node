import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

interface MusicHook {
  readonly ready: boolean;
  readonly serverMode: string | null;
  readonly mode: string | null;
  readonly track: string | null;
  readonly tracks: readonly string[];
  readonly error: string | null;
}

interface MusicWindow {
  readonly __ja2Audio?: { readonly ready: boolean; readonly error: string | null; readonly music: MusicHook };
  readonly __ja2Tactical?: { readonly ready: boolean };
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
const music = (page: Page) => page.evaluate(() => ({ ...(window as unknown as MusicWindow).__ja2Audio?.music }) as MusicHook);

test('the tactical page plays the music of the session mode after the first gesture and switches to battle music in combat', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-music', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 7 })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };

  await page.goto(`/src/devtools/tactical/?session=${session}`);
  await page.waitForFunction(() => {
    const w = window as unknown as MusicWindow;
    return (w.__ja2Tactical?.ready && w.__ja2Audio?.ready) || w.__ja2Audio?.error;
  });
  const before = await music(page);
  expect(before.error).toBeNull();
  expect(before.ready).toBe(true);
  expect(before.serverMode).toBe('tacticalEnemyPresent');
  expect(before.track).toBeNull();

  await page.click('#status');
  await expect.poll(async () => (await music(page)).track, { timeout: 15_000 }).toMatch(/^music\/tensor /);

  await page.click('[data-speed="instant"]');
  await page.click('[data-playback="16"]');
  for (let step = 0; step < 12 && !(await observe()).combat; step++)
    for (const s of (await observe()).soldiers.filter((x) => x.team === 0))
      await act({ type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' });
  expect((await observe()).combat).toBeTruthy();

  await expect.poll(async () => (await music(page)).serverMode, { timeout: 30_000 }).toBe('tacticalBattle');
  await expect.poll(async () => (await music(page)).track, { timeout: 15_000 }).toMatch(/^music\/battle /);
  const heard = await music(page);
  expect(heard.mode).toBe('tacticalBattle');
  expect(heard.tracks.some((t) => t.startsWith('music/tensor '))).toBe(true);
  await client.close();
});
