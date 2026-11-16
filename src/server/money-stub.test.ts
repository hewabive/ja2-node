import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { ReloadingSession } from '../../tests/support/session-reload.ts';
import { STUB_DEALER, stubCampaignInA10, walkNextToProfile } from '../../tests/support/stub-shops.ts';
import { pythSpacesAway } from '../content/world/grid.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import { createItem, emptyObject } from '../sim/items/object.ts';
import { InvSlot, NUM_INV_SLOTS } from '../sim/tactical/inventory.ts';
import { Team } from '../sim/tactical/soldier.ts';
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

function fillPockets(session: CampaignSession, merc: number): () => void {
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
  return () => {
    for (const slot of emptied) inventoryOf(session, merc)[slot] = emptyObject();
    const restored = inventoryOf(session, merc)[InvSlot.SMALLPOCK3];
    if (restored) restored.money = kept;
  };
}

function expectNoRoomWhenPocketsAreFull(session: CampaignSession, merc: number): void {
  const empty = fillPockets(session, merc);
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT })).toBe('noRoom');
  empty();
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
  expect(session.dispatch({ type: 'splitMoney', soldier: merc, slot: 'smallPocket3', amount: SPLIT, to: 'smallPocket5' })).toEqual({
    ok: true,
    data: { amount: SPLIT },
  });
  expect(moneySlots(session, merc)).toEqual([
    [InvSlot.SMALLPOCK3, WITHDRAWN - DEPOSITED - SPLIT],
    [InvSlot.SMALLPOCK5, SPLIT],
  ]);
  const other = session.view().strategic?.mercs[1]?.id ?? 0;
  expect(
    session.dispatch({ type: 'splitMoney', soldier: merc, slot: 'smallPocket5', amount: SPLIT, to: 'smallPocket8', toSoldier: other }),
  ).toMatchObject({ ok: true });
  expect(moneySlots(session, merc)).toEqual([[InvSlot.SMALLPOCK3, WITHDRAWN - DEPOSITED - SPLIT]]);
  expect(moneySlots(session, other)).toContainEqual([InvSlot.SMALLPOCK8, SPLIT]);
  return session;
}

function soldierOf(session: CampaignSession, id: number) {
  const s = session.campaign.tactical?.state.soldiers[id];
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function moneyOnTheFloor(session: CampaignSession, gridNo: number): number[] {
  const money = kit.content.items.byName.get('MONEY')?.index;
  const t = session.campaign.tactical?.state;
  return (t?.worldItems ?? []).filter((wi) => wi.gridNo === gridNo && wi.object.item === money).map((wi) => wi.object.money);
}

const FAR_AWAY = 6;

async function withdrawElsewhere(mode?: RunMode): Promise<CampaignSession> {
  const session = await stubCampaignInA10(kit, 6, mode);
  const live = new ReloadingSession('t', session);
  const [merc, other] = (session.view().strategic?.mercs ?? []).map((m) => m.id);
  if (merc === undefined || other === undefined) throw new Error('two mercs expected');
  const finances = () => session.campaign.state.finances;
  const balance = finances().balance;
  session.drainEvents();

  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: WITHDRAWN, to: 'smallPocket3' })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, to: InvSlot.SMALLPOCK3 })).toMatchObject({ ok: true });
  expect(moneySlots(session, merc)).toEqual([[InvSlot.SMALLPOCK3, WITHDRAWN + SPLIT]]);
  expect(session.drainEvents().filter((e) => e.type === 'cashWithdrawn')).toMatchObject([
    { soldier: merc, amount: WITHDRAWN, to: InvSlot.SMALLPOCK3 },
    { soldier: merc, amount: SPLIT, to: InvSlot.SMALLPOCK3 },
  ]);
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'hand' })).toBe('doesNotFit');
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, toSoldier: other })).toBe('badSlot');
  expect(finances().balance).toBe(balance - WITHDRAWN - SPLIT);

  expect(pythSpacesAway(soldierOf(session, merc).gridNo, soldierOf(session, other).gridNo)).toBeLessThanOrEqual(3);
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'smallPocket8', toSoldier: other })).toEqual({
    ok: true,
    data: { amount: SPLIT, balance: balance - WITHDRAWN - 2 * SPLIT },
  });
  expect(moneySlots(session, other)).toContainEqual([InvSlot.SMALLPOCK8, SPLIT]);
  expect(session.drainEvents().find((e) => e.type === 'cashWithdrawn')).toMatchObject({
    soldier: merc,
    amount: SPLIT,
    to: InvSlot.SMALLPOCK8,
    toSoldier: other,
  });

  const empty = fillPockets(session, merc);
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT })).toBe('noRoom');
  const at = soldierOf(session, merc).gridNo;
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'ground', gridNo: at + FAR_AWAY })).toBe('tooFar');
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'ground' })).toEqual({
    ok: true,
    data: { amount: SPLIT, balance: balance - WITHDRAWN - 3 * SPLIT },
  });
  expect(finances().ledger.at(-1)).toMatchObject({ code: FinanceCode.TRANSFER_FUNDS_TO_MERC, amount: -SPLIT });
  live.advance({ idle: true });
  expect(moneyOnTheFloor(session, at)).toEqual([SPLIT]);
  empty();

  expect(session.dispatch({ type: 'move', soldier: other, to: at + FAR_AWAY, mode: 'walk' })).toMatchObject({ ok: true });
  live.advance({ idle: true });
  expect(pythSpacesAway(at, soldierOf(session, other).gridNo)).toBeGreaterThan(3);
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'smallPocket7', toSoldier: other })).toBe('tooFar');
  expect(finances().balance).toBe(balance - WITHDRAWN - 3 * SPLIT);
  return session;
}

function ledgerSince(session: CampaignSession, entries: number) {
  return session.campaign.state.finances.ledger.slice(entries).map(({ code, secondCode, amount }) => ({ code, secondCode, amount }));
}

function outOfTurnInCombat(session: CampaignSession, merc: number): () => void {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  t.inCombat = true;
  t.turn.currentTeam = Team.ENEMY;
  soldierOf(session, merc).actionPoints = 0;
  return () => {
    const back = session.campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    back.inCombat = false;
    back.turn.currentTeam = Team.OUR;
  };
}

async function cancelOrDepositAgain(mode?: RunMode): Promise<CampaignSession> {
  const session = await stubCampaignInA10(kit, 6, mode);
  const live = new ReloadingSession('t', session);
  const [merc, other] = (session.view().strategic?.mercs ?? []).map((m) => m.id);
  if (merc === undefined || other === undefined) throw new Error('two mercs expected');
  const profile = (id: number) => soldierOf(session, id).profile;
  const finances = () => session.campaign.state.finances;
  const balance = finances().balance;
  const pockets = moneySlots(session, merc);
  const at = soldierOf(session, merc).gridNo;
  session.drainEvents();

  let entries = finances().ledger.length;
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: WITHDRAWN, to: 'account', toSoldier: other })).toEqual({
    ok: true,
    data: { amount: WITHDRAWN, balance },
  });
  expect(ledgerSince(session, entries)).toEqual([
    { code: FinanceCode.TRANSFER_FUNDS_TO_MERC, secondCode: profile(merc), amount: -WITHDRAWN },
    { code: FinanceCode.MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT, secondCode: profile(other), amount: WITHDRAWN },
  ]);
  expect(session.drainEvents().filter((e) => e.type === 'cashWithdrawn' || e.type === 'cashDeposited')).toMatchObject([
    { type: 'cashWithdrawn', soldier: merc, amount: WITHDRAWN, to: 'account', toSoldier: other },
    { type: 'cashDeposited', soldier: other, amount: WITHDRAWN },
  ]);
  expect(moneySlots(session, merc)).toEqual(pockets);

  const outOfCombat = outOfTurnInCombat(session, merc);
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'ground' })).toBe('notYourTurn');
  entries = finances().ledger.length;
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'feet' })).toEqual({
    ok: true,
    data: { amount: SPLIT, balance: balance - SPLIT },
  });
  expect(moneyOnTheFloor(session, at)).toEqual([SPLIT]);
  expect(soldierOf(session, merc).actionPoints).toBe(0);
  expect(ledgerSince(session, entries)).toEqual([{ code: FinanceCode.TRANSFER_FUNDS_TO_MERC, secondCode: profile(merc), amount: -SPLIT }]);
  expect(session.drainEvents().find((e) => e.type === 'cashWithdrawn')).toMatchObject({ soldier: merc, amount: SPLIT, to: 'feet' });
  outOfCombat();

  walkNextToProfile(session, merc, STUB_DEALER);
  expect(session.dispatch({ type: 'talk', soldier: merc, target: { npc: STUB_DEALER } })).toMatchObject({ ok: true });
  live.advance({ idle: true });
  expect(session.view().conversation).toBeTruthy();
  const there = soldierOf(session, merc).gridNo;
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'ground' })).toBe('conversationOpen');
  expect(session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'feet' })).toMatchObject({ ok: true });
  expect(moneyOnTheFloor(session, there)).toContain(SPLIT);
  expect(finances().balance).toBe(balance - 2 * SPLIT);
  return session;
}

const STUB_NPC = 94;
const THROW_ROWS = 6;
const COLS = 160;

function moneyLying(session: CampaignSession): number[] {
  const money = kit.content.items.byName.get('MONEY')?.index;
  return (session.campaign.tactical?.state.worldItems ?? []).filter((wi) => wi.object.item === money).map((wi) => wi.object.money);
}

async function throwPassOrGive(mode?: RunMode): Promise<CampaignSession> {
  const session = await stubCampaignInA10(kit, 6, mode);
  const live = new ReloadingSession('t', session);
  const [merc, other] = (session.view().strategic?.mercs ?? []).map((m) => m.id);
  if (merc === undefined || other === undefined) throw new Error('two mercs expected');
  const finances = () => session.campaign.state.finances;
  const balance = finances().balance;
  const withdraw = (extra: Record<string, unknown>) => session.dispatch({ type: 'withdrawCash', soldier: merc, amount: SPLIT, ...extra });
  session.drainEvents();

  const empty = fillPockets(session, other);
  expect(withdraw({ to: 'pass', target: other })).toEqual({ ok: true, data: { passed: false, amount: SPLIT, balance } });
  expect(session.drainEvents().some((e) => e.type === 'cashWithdrawn')).toBe(false);
  empty();
  live.advance({ idle: true });
  expect(withdraw({ to: 'pass', target: other })).toEqual({ ok: true, data: { passed: true, amount: SPLIT, balance: balance - SPLIT } });
  expect(moneySlots(session, other).map(([, amount]) => amount)).toContain(SPLIT);
  expect(session.drainEvents().find((e) => e.type === 'cashWithdrawn')).toMatchObject({ soldier: merc, to: 'pass', target: other });
  live.advance({ idle: true });

  const at = soldierOf(session, merc).gridNo;
  expect(refusalOf(session, { type: 'withdrawCash', soldier: merc, amount: SPLIT, to: 'toss', gridNo: at + 1 })).toBe('tooClose');
  expect(finances().balance).toBe(balance - SPLIT);
  expect(withdraw({ to: 'toss', gridNo: at - THROW_ROWS * COLS })).toMatchObject({ ok: true, data: { balance: balance - 2 * SPLIT } });
  live.advance({ idle: true });
  expect(moneyLying(session)).toContain(SPLIT);

  const given = withdraw({ to: 'give', target: { npc: STUB_NPC } });
  expect(given, given.reason).toMatchObject({ ok: true, data: { balance: balance - 3 * SPLIT } });
  const report = live.advance({ idle: true });
  expect(report.events).toContainEqual(
    expect.objectContaining({ type: 'npcTookItem', profile: STUB_NPC, from: merc, item: 'MONEY', money: SPLIT }),
  );
  expect(finances().balance).toBe(balance - 3 * SPLIT);
  return session;
}

describe('the money region and the money box on the stub campaign', () => {
  it('withdraws money as it is passed, thrown or given like any cursor item, a pass with no room withdrawing nothing (HandleItemPointerClick)', async () => {
    await expectReloadsInvisible(throwPassOrGive);
  });

  it('drops a cancelled withdrawal at the feet for no APs, out of turn and in a conversation too, and books both entries for one deposited again (CancelItemPointer, ConfirmationToDepositMoneyToPlayersAccount)', async () => {
    await expectReloadsInvisible(cancelOrDepositAgain);
  });

  it('withdraws, splits and deposits money with the ledger entries of the original, the same across reloads', async () => {
    await expectReloadsInvisible(moveMoney);
  });

  it('drops withdrawn money into a pocket, onto another merc in passing range or onto the floor, full pockets or not', async () => {
    await expectReloadsInvisible(withdrawElsewhere);
  });
});
