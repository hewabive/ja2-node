import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, RELOAD_TEST_TIMEOUT_MS, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { STUB_DEALER, stubCampaignInA10, walkNextToProfile } from '../../tests/support/stub-shops.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import { createItem, emptyObject } from '../sim/items/object.ts';
import { InvSlot, NUM_INV_SLOTS } from '../sim/tactical/inventory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const WITHDRAWN = 1500;
const DEPOSITED = 500;
const SPLIT = 100;
const MAX_MONEY_PER_SLOT = 20000;

function refusalOf(session: CampaignSession, cmd: Record<string, unknown> & { type: string }): string | undefined {
  const result = session.dispatch(cmd);
  expect(result.ok, JSON.stringify(cmd)).toBe(false);
  return (result.data as { refusal?: string } | undefined)?.refusal;
}

function inventoryOf(session: CampaignSession, merc: number) {
  return session.campaign.tactical?.state.soldiers[merc]?.inv ?? [];
}

function moneySlots(session: CampaignSession, merc: number): [number, number][] {
  const money = kit.content.items.byName.get('MONEY')?.index;
  return inventoryOf(session, merc).flatMap((o, slot) => (o.item === money ? [[slot, o.money] as [number, number]] : []));
}

function expectNoRoomWhenPocketsAreFull(session: CampaignSession, merc: number): void {
  const filler = kit.content.items.byName.get('CLIP9_15')?.index ?? 0;
  const emptied: number[] = [];
  for (let slot = InvSlot.HAND; slot < NUM_INV_SLOTS; slot++) {
    if (inventoryOf(session, merc)[slot]?.item) continue;
    inventoryOf(session, merc)[slot] = createItem(kit.content.items, filler, 100);
    emptied.push(slot);
  }
  const kept = inventoryOf(session, merc)[InvSlot.SMALLPOCK3]?.money ?? 0;
  const full = inventoryOf(session, merc)[InvSlot.SMALLPOCK3];
  if (full) full.money = MAX_MONEY_PER_SLOT / 2;
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT })).toBe('noRoom');
  for (const slot of emptied) inventoryOf(session, merc)[slot] = emptyObject();
  const restored = inventoryOf(session, merc)[InvSlot.SMALLPOCK3];
  if (restored) restored.money = kept;
}

async function moveMoney(mode?: RunMode): Promise<CampaignSession> {
  const session = await stubCampaignInA10(kit, 6, mode);
  const merc = session.view().strategic?.mercs[0]?.id ?? 0;
  const finances = () => session.campaign.state.finances;
  const balance = finances().balance;
  session.drainEvents();

  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: WITHDRAWN })).toEqual({
    ok: true,
    data: { amount: WITHDRAWN, balance: balance - WITHDRAWN },
  });
  expect(finances().ledger.at(-1)).toMatchObject({ code: FinanceCode.TRANSFER_FUNDS_TO_MERC, amount: -WITHDRAWN });
  expect(moneySlots(session, merc)).toEqual([[InvSlot.SMALLPOCK3, WITHDRAWN]]);
  const withdrawn = session.drainEvents();
  expect(withdrawn.find((e) => e.type === 'moneyChanged')).toMatchObject({ code: FinanceCode.TRANSFER_FUNDS_TO_MERC, amount: -WITHDRAWN });
  expect(withdrawn.find((e) => e.type === 'cashWithdrawn')).toMatchObject({ soldier: merc, amount: WITHDRAWN });

  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT })).toMatchObject({ ok: true });
  expect(moneySlots(session, merc)).toEqual([[InvSlot.SMALLPOCK3, WITHDRAWN + SPLIT]]);

  expect(session.dispatch({ type: 'splitMoney', soldier: merc, slot: 'smallPocket3', amount: SPLIT, to: 'smallPocket4' })).toMatchObject({
    ok: true,
  });
  expect(moneySlots(session, merc)).toEqual([
    [InvSlot.SMALLPOCK3, WITHDRAWN],
    [InvSlot.SMALLPOCK4, SPLIT],
  ]);

  expect(session.dispatch({ type: 'depositCash', soldier: merc, slot: 'smallPocket3', amount: DEPOSITED })).toEqual({
    ok: true,
    data: { amount: DEPOSITED, balance: balance - WITHDRAWN - SPLIT + DEPOSITED },
  });
  expect(finances().ledger.at(-1)).toMatchObject({ code: FinanceCode.MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT, amount: DEPOSITED });
  expect(session.drainEvents().find((e) => e.type === 'cashDeposited')).toMatchObject({ soldier: merc, amount: DEPOSITED });
  expect(session.dispatch({ type: 'depositCash', soldier: merc, slot: 'smallPocket4' })).toMatchObject({
    ok: true,
    data: { amount: SPLIT },
  });
  expect(moneySlots(session, merc)).toEqual([[InvSlot.SMALLPOCK3, WITHDRAWN - DEPOSITED]]);

  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: 0 })).toBe('badAmount');
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: MAX_MONEY_PER_SLOT + 10 })).toBe('badAmount');
  const overdraft = finances().balance + 10;
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: overdraft })).toBe(
    overdraft > MAX_MONEY_PER_SLOT ? 'badAmount' : 'notEnoughMoney',
  );
  expect(refusalOf(session, { type: 'withdrawCash', soldier: 999, amount: 10 })).toBe('noSuchSoldier');
  expect(refusalOf(session, { type: 'depositCash', soldier: merc, slot: 'hand' })).toBe('notMoney');
  expect(refusalOf(session, { type: 'depositCash', soldier: merc, slot: 'smallPocket8' })).toBe('emptySlot');
  expect(refusalOf(session, { type: 'depositCash', soldier: merc, slot: 'pocket' })).toBe('badSlot');
  expect(refusalOf(session, { type: 'depositCash', soldier: merc, slot: 'smallPocket3', amount: WITHDRAWN })).toBe('notEnoughMoney');
  expect(refusalOf(session, { type: 'splitMoney', soldier: merc, slot: 'smallPocket3', amount: -5, to: 'smallPocket5' })).toBe('badAmount');
  expectNoRoomWhenPocketsAreFull(session, merc);

  walkNextToProfile(session, merc, STUB_DEALER);
  expect(session.dispatch({ type: 'openShop', dealer: STUB_DEALER, soldier: merc })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT })).toMatchObject({ ok: false });
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });

  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT })).toBe('notInTactical');
  expect(refusalOf(session, { type: 'splitMoney', soldier: merc, slot: 'smallPocket3', amount: SPLIT, to: 'smallPocket5' })).toBe(
    'notInTactical',
  );
  return session;
}

describe('the money region and the money box on the stub campaign', () => {
  it(
    'withdraws, splits and deposits money with the ledger entries of the original, the same across reloads',
    async () => {
      await expectReloadsInvisible(moveMoney);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});
