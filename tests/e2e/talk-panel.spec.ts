import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { TacticalHook } from '../../src/app/tactical/tactical-hook.ts';
import { SERVER, TOKEN } from './env.ts';
import { expectShadowClean } from './play-flow.ts';
import { capture, clickWidget, devicePoint, expectGolden, nextFrames } from './ui-capture.ts';

const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const STUB_NPC = 94;
const NEAR_NPC = 74 * COLS + 75;
const STUB_RPC = 65;
const NEAR_STUB_RPC = 72 * COLS + 81;
const LOAD_TIMEOUT_MS = 60_000;
const LINES_TIMEOUT_MS = 45_000;
const MONEY = 'MONEY';

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly profile?: number;
  readonly kind?: string;
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
}

type Act = (command: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;

async function mcp(): Promise<{ call: (name: string, args?: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-talk-panel', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return {
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
    },
    close: () => client.close(),
  };
}

async function squadInA10(seed: number, mercs: number, near: number): Promise<{ session: string; leader: number }> {
  const { call, close } = await mcp();
  const { session } = (await call('newSession', { seed, campaign: { difficulty: 1, mercs } })) as { session: string };
  const observe = async () => (await call('observe', { session })) as View;
  const act: Act = async (command) => (await call('act', { session, command })) as { ok: boolean; reason?: string };
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
  expect(await act({ type: 'move', soldier: leader.id, to: near, mode: 'walk' })).toMatchObject({ ok: true });
  await call('advance', { session, idle: true });
  await close();
  return { session, leader: leader.id };
}

async function openTactical(page: Page, session: string, extra = ''): Promise<void> {
  await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual&shadowHints=1${extra}`);
  await page.waitForFunction(() => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error, null, { timeout: LOAD_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
  await page.waitForFunction(() => window.__ja2Ui.tactical?.pendingImages === 0 && window.__ja2Ui.screen === 'tactical');
  await nextFrames(page, 4);
}

async function order(page: Page, cmd: Parameters<TacticalHook['command']>[0]): Promise<void> {
  const reply = (await page.evaluate((c) => window.__ja2Ui.tactical?.command(c), cmd)) as { ok: boolean; reason?: string } | undefined;
  expect(reply?.ok, `${cmd.type}: ${reply?.reason ?? ''}`).toBe(true);
}

async function lastCommand(page: Page): Promise<{ type: string; ok: boolean; reason: string | null } | null> {
  return page.evaluate(() => window.__ja2Ui.tactical?.commands.at(-1) ?? null);
}

async function talkOpenAndQuiet(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === true);
  await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.busy === false, null, { timeout: LINES_TIMEOUT_MS });
  await nextFrames(page, 2);
}

async function freeSession(page: Page, request: APIRequestContext, session: string): Promise<void> {
  await expectShadowClean(page);
  await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
}

test.describe('talking through the canvas talk panel on stubs', () => {
  test.describe.configure({ mode: 'parallel' });

  test('shows the panel of a conversation opened before the page, idle with Done enabled (golden with a pinned clock)', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const { session, leader } = await squadInA10(5, 3, NEAR_NPC);
    const agent = await mcp();
    const talk = (await agent.call('act', { session, command: { type: 'talk', soldier: leader, target: { npc: STUB_NPC } } })) as {
      ok: boolean;
      data?: { walking?: boolean };
    };
    expect(talk.ok).toBe(true);
    if (talk.data?.walking) await agent.call('advance', { session, idle: true });
    await agent.close();
    await openTactical(page, session, '&pinClock=1');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === true && window.__ja2Ui.tactical.pendingImages === 0);
    await nextFrames(page, 4);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.talk)).toMatchObject({ profile: STUB_NPC, busy: false, line: null });
    expect(await page.evaluate(() => window.__ja2Ui.widgets.find((w) => w.id === 'talkDone')?.enabled)).toBe(true);
    expect(await page.evaluate(() => window.__ja2Ui.widgets.find((w) => w.id === 'talkOptionText4')?.text)).toBe('Give');
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    await expectGolden('talk-panel', await capture(page));
    await order(page, { type: 'closeTalk' });
    await freeSession(page, request, session);
  });

  test('plays the lines out, sends Direct and closes with Done', async ({ page, request }) => {
    test.setTimeout(150_000);
    const { session, leader } = await squadInA10(5, 3, NEAR_NPC);
    await openTactical(page, session);
    await order(page, { type: 'talk', soldier: leader, target: { npc: STUB_NPC } });
    await talkOpenAndQuiet(page);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.talk.spoken)).toBeGreaterThanOrEqual(1);
    await clickWidget(page, 'talkOption2');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'approach', ok: true, reason: null });
    await talkOpenAndQuiet(page);
    await clickWidget(page, 'talkDone');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'closeTalk', ok: true, reason: null });
    await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === false);
    await freeSession(page, request, session);
  });

  test('recruits the stub R.P.C. with Recruit and the hire box, then withdraws money through the money region', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { session, leader } = await squadInA10(6, 3, NEAR_STUB_RPC);
    await openTactical(page, session);
    await order(page, { type: 'talk', soldier: leader, target: { npc: STUB_RPC } });
    await talkOpenAndQuiet(page);
    await clickWidget(page, 'talkOption5');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'approach', ok: true, reason: null });
    await page.waitForFunction(() => window.__ja2Ui.modal === 'npcRequestBox', null, { timeout: LINES_TIMEOUT_MS });
    await clickWidget(page, 'npcRequestBox.yes');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'answer', ok: true, reason: null });
    const agent = await mcp();
    const recruited = ((await agent.call('observe', { session })) as View).soldiers.find((s) => s.profile === STUB_RPC);
    await agent.close();
    expect(recruited).toMatchObject({ team: 0, kind: 'rpc' });
    if (await page.evaluate(() => window.__ja2Ui.tactical?.talk.open)) {
      await talkOpenAndQuiet(page);
      await clickWidget(page, 'talkDone');
      await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === false);
    }

    const face = await page.evaluate(() => window.__ja2Ui.widgets.find((w) => w.id === 'teamFaceRegion0')?.rect ?? null);
    if (!face) throw new Error('no team face');
    const at = await devicePoint(page, face.x + Math.floor(face.width / 2), face.y + Math.floor(face.height / 2));
    await page.mouse.move(at.x, at.y);
    await nextFrames(page);
    await page.mouse.down({ button: 'right' });
    await nextFrames(page);
    await page.mouse.up({ button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.panel)).toBe('sm');
    const merc = await page.evaluate(() => window.__ja2Ui.tactical?.smMerc ?? -1);
    await clickWidget(page, 'smMoney');
    await expect.poll(() => page.evaluate(() => window.__ja2Ui.tactical?.descriptionItem)).toBe(MONEY);
    await clickWidget(page, 'itemDescriptionMoney0');
    await clickWidget(page, 'itemDescriptionMoneyDone');
    await expect.poll(() => lastCommand(page)).toEqual({ type: 'withdrawCash', ok: true, reason: null });
    await expect
      .poll(
        async () => (await page.evaluate((id) => window.__ja2Ui.tactical?.inventory(id) ?? [], merc)).find((i) => i.item === MONEY)?.money,
      )
      .toBe(1000);
    await freeSession(page, request, session);
  });
});
