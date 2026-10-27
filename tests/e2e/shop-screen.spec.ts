import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { SERVER, TOKEN } from './env.ts';
import { expectShadowClean } from './play-flow.ts';
import { capture, clickWidget, expectGolden, nextFrames } from './ui-capture.ts';

const COLS = 160;
const EAST_EDGE_ROW = 75;
const EAST_EDGE_COLUMN = 150;
const DEALER = 91;
const DEALER_TILE = 74 * COLS + 69;
const STEPS_FROM_DEALER = 2;
const PAGE_SLOTS = 15;

interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly profile?: number;
}

interface ShopBox {
  readonly item: string;
  readonly unitPrice?: number;
}

interface View {
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
  readonly shop?: { readonly balance: number; readonly boxes: readonly ShopBox[] } | null;
}

test('talks to the stub dealer, opens the canvas shop from Buy/Sell, buys one box and leaves with Done', async ({ page, request }) => {
  test.setTimeout(180_000);
  const transport = new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'e2e-shop-screen', version: '1' });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? 'null');
  };
  const { session } = (await call('newSession', { seed: 3, campaign: { difficulty: 1, mercs: 4 } })) as { session: string };
  try {
    const observe = async () => (await call('observe', { session })) as View;
    const act = async (command: Record<string, unknown>) =>
      (await call('act', { session, command })) as { ok: boolean; data?: { walking?: boolean; pending?: boolean } };
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
    expect(await act({ type: 'move', soldier: leader.id, to: DEALER_TILE + STEPS_FROM_DEALER, mode: 'walk' })).toMatchObject({
      ok: true,
    });
    await call('advance', { session, idle: true });
    const dealer = (await observe()).soldiers.find((s) => s.profile === DEALER);
    if (!dealer) throw new Error('no stub dealer in sight');

    const talk = await act({ type: 'talk', soldier: leader.id, target: dealer.id });
    expect(talk.ok).toBe(true);
    if (talk.data?.walking || talk.data?.pending)
      expect(((await call('advance', { session, idle: true })) as { reason: string }).reason).toBe('decision');

    await page.goto(`/play?session=${encodeURIComponent(session)}&drive=manual&shadowHints=1&pinClock=1&fixed640=1&scale=1`);
    await page.waitForFunction(() => window.__ja2Ui?.tactical?.ready === true || window.__ja2Ui?.error, null, { timeout: 60_000 });
    expect(await page.evaluate(() => window.__ja2Ui.error)).toBeNull();
    await page.waitForFunction(() => window.__ja2Ui.tactical?.pendingImages === 0 && window.__ja2Ui.screen === 'tactical');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === true);
    await clickWidget(page, 'talkOption4');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.shop.open === true && window.__ja2Ui.tactical.shop.totals !== null);
    await page.waitForFunction(() => window.__ja2Ui.tactical?.pendingImages === 0);
    await nextFrames(page, 4);
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.panel)).toBe('sm');
    await expectGolden('shop-screen', await capture(page));

    const shop = (await observe()).shop;
    if (!shop) throw new Error('no shop in the view');
    const affordable = shop.boxes.findIndex((b) => (b.unitPrice ?? 0) > 0 && (b.unitPrice ?? 0) <= shop.balance);
    expect(affordable).toBeGreaterThanOrEqual(0);
    expect(affordable).toBeLessThan(PAGE_SLOTS);
    await clickWidget(page, `shopDealerSlot${affordable}`);
    await page.waitForFunction(
      () => (window.__ja2Ui.tactical?.shop.totals?.cost ?? 0) > 0 && window.__ja2Ui.tactical?.shop.transactionEnabled === true,
    );
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.shop.doa[0]?.count)).toBe(1);
    await clickWidget(page, 'shopTransaction');
    await page.waitForFunction(
      () =>
        window.__ja2Ui.widgets.some((w) => w.id === 'messageBox.yes') ||
        window.__ja2Ui.tactical?.commands.some((c) => c.type === 'trade' && c.ok) === true,
    );
    if (await page.evaluate(() => window.__ja2Ui.widgets.some((w) => w.id === 'messageBox.yes'))) await clickWidget(page, 'messageBox.yes');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.commands.some((c) => c.type === 'trade' && c.ok) === true);
    await page.waitForFunction(() => window.__ja2Ui.tactical?.shop.doa.every((s) => s === null) === true);

    await clickWidget(page, 'shopDone');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.commands.at(-1)?.type === 'closeShop');
    for (let k = 0; k < 4 && (await page.evaluate(() => window.__ja2Ui.tactical?.shop.open)); k++) {
      await page.keyboard.press('Backspace');
      await nextFrames(page, 2);
    }
    await page.waitForFunction(() => window.__ja2Ui.tactical?.shop.open === false);
    expect((await observe()).shop ?? null).toBeNull();
    await expectShadowClean(page);
  } finally {
    await client.close();
    await request.delete(`/api/sessions/${encodeURIComponent(session)}`);
  }
});
