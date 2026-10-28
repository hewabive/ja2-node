import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';

interface AudioCounters {
  readonly cuesResolved: number;
  readonly voicesStarted: number;
  readonly voicesSilent: number;
  readonly filesMissing: number;
  readonly decodeErrors: number;
}

declare global {
  interface Window {
    __ja2Audio: {
      ready: boolean;
      unlocked: boolean;
      error: string | null;
      counters: AudioCounters;
      played: string[];
    };
  }
}

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly life?: number;
}

interface View {
  readonly soldiers: readonly SoldierView[];
  readonly combat?: { readonly team: number } | null;
}

const COLS = 160;
const ROUNDS = 6;
const distance = (a: number, b: number) => Math.hypot((a % COLS) - (b % COLS), Math.trunc(a / COLS) - Math.trunc(b / COLS));
const counters = (page: Page) => page.evaluate(() => ({ ...window.__ja2Audio.counters }));

test('the tactical page plays a stub firefight with sound after the first gesture, and nothing at master volume 0', async ({ page }) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-sound', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 7 })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act = async (command: Record<string, unknown>) => (await call('act', { session, command })) as { ok: boolean };

  await page.goto(`/src/devtools/tactical/?session=${session}`);
  await page.waitForFunction(() => (window.__ja2Tactical?.ready && window.__ja2Audio?.ready) || window.__ja2Audio?.error);
  expect(await page.evaluate(() => window.__ja2Audio.error)).toBeNull();
  expect(await page.evaluate(() => window.__ja2Audio.unlocked)).toBe(false);
  await page.click('#status');
  expect(await page.evaluate(() => window.__ja2Audio.unlocked)).toBe(true);
  await page.click('[data-speed="instant"]');
  await page.click('[data-playback="16"]');

  for (let step = 0; step < 12 && !(await observe()).combat; step++)
    for (const s of (await observe()).soldiers.filter((x) => x.team === 0))
      await act({ type: 'move', soldier: s.id, to: s.gridNo + COLS * 3, mode: 'swat' });
  expect((await observe()).combat).toBeTruthy();
  for (let round = 0; round < ROUNDS && (await observe()).combat; round++) {
    const view = await observe();
    const enemies = view.soldiers.filter((x) => x.team === 1 && (x.life ?? 1) > 0);
    for (const merc of view.soldiers.filter((x) => x.team === 0 && (x.life ?? 0) >= 15)) {
      const target = [...enemies].sort((a, b) => distance(merc.gridNo, a.gridNo) - distance(merc.gridNo, b.gridNo))[0];
      if (target)
        for (let shot = 0; shot < 2; shot++) if (!(await act({ type: 'attack', soldier: merc.id, target: target.gridNo })).ok) break;
    }
    if ((await observe()).combat) await act({ type: 'endTurn' });
  }

  await expect.poll(() => page.evaluate(() => window.__ja2Audio.played.some((f) => f.startsWith('sounds/weapons/')))).toBe(true);
  const fought = await counters(page);
  expect(fought.voicesStarted).toBeGreaterThan(0);
  expect(fought.filesMissing).toBe(0);
  expect(fought.decodeErrors).toBe(0);

  await page.locator('#volume').evaluate((el) => {
    const slider = el as HTMLInputElement;
    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  const muted = await counters(page);
  for (const s of (await observe()).soldiers.filter((x) => x.team === 0 && (x.life ?? 0) >= 15))
    await act({ type: 'stance', soldier: s.id, stance: 'crouch' });
  if ((await observe()).combat) await act({ type: 'endTurn' });
  await expect.poll(async () => (await counters(page)).cuesResolved).toBeGreaterThan(muted.cuesResolved);
  await page.waitForTimeout(1500);
  const after = await counters(page);
  expect(after.voicesStarted).toBe(muted.voicesStarted);
  expect(after.voicesSilent).toBeGreaterThan(muted.voicesSilent);
  await client.close();
  await fetch(`${SERVER}/api/sessions/${encodeURIComponent(session)}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });
});
