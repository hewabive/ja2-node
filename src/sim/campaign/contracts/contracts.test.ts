import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { type ContractCampaign, type ContractHire, createContractCampaign } from '../../../../tests/support/contracts.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { RestrictedScroll } from '../../../content/world/render-bounds.ts';
import type { SimEvent } from '../../events.ts';
import { createItem, emptyObject } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { factValue } from '../../strategic/narrative/facts.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { EventKind, NUM_MIN_IN_DAY, NUM_SEC_IN_MIN, Warp } from '../../strategic/time/constants.ts';
import { warpGameTime, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { Insertion } from '../../tactical/insertion.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { QUOTE_ACTION_CHECK_FOR_DEST } from '../../tactical/narrative/profile-insertion.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { FinanceCode } from '../finances.ts';
import { MercAccountStatus } from '../laptop/laptop-state.ts';
import { strategicHandlePlayerTeamMercDeath } from '../merc-fate.ts';
import { ProfileMiscFlag3 } from '../profiles.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import { sectorKey } from '../sector-diff.ts';
import { contractRefusal } from './contract-flow.ts';
import { RenewalQuoteCode } from './contract-state.ts';
import {
  checkIfMercGetsAnotherContract,
  dailyMoraleUpdate,
  mercDailyUpdate,
  profileDailyUpdate,
  soldierHasWorseEquipmentThanUsedTo,
} from './daily.ts';
import {
  beginRemoveMercFromContract,
  calculateMedicalDepositRefund,
  departureOptions,
  handleEquipmentLeft,
  handleLeavingOfEquipmentInCurrentSector,
  handleMercLeavingEquipment,
  PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO,
  primaryAirportSector,
  strategicRemoveMerc,
} from './departure.ts';
import { mercContractHandling } from './extension.ts';
import { dailyUpdateOfMercSite, mercsContractIsFinished } from './merc-account.ts';
import { HistoryCode } from './quotes.ts';
import { contractOptions, findOutIfAnyMercAboutToLeaveIsGonnaRenew, findRefusalReason, willMercRenew } from './renewal.ts';
import { rpcWhineAboutNoPay } from './rpc-pay.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const at = (day: number, hour: number, minute = 0) => day * NUM_MIN_IN_DAY + hour * 60 + minute;
const STUB = { kestrel: 0, vant: 1, moraga: 2, hollis: 3, tarrow: 4, brack: 42, hana: 59 } as const;
const AIM_TRIO: readonly ContractHire[] = [{ profile: STUB.kestrel }, { profile: STUB.moraga }, { profile: STUB.hollis }];

function landed(hires: readonly ContractHire[], seed = 3): ContractCampaign {
  const cc = createContractCampaign(kit, { seed, hires });
  landFirstSquad(cc.campaign);
  for (let i = 0; i < 20_000 && !cc.campaign.isIdle(); i++) cc.campaign.step();
  expect(cc.campaign.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  cc.campaign.drainEvents();
  return cc;
}

function merc(cc: ContractCampaign, id: number): RosterMerc {
  const m = cc.roster.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function profile(cc: ContractCampaign, id: number) {
  const p = cc.flow.profile(id);
  if (!p) throw new Error(`no profile ${id}`);
  return p;
}

function setTime(cc: ContractCampaign, minute: number): void {
  const now = worldTotalMinutes(cc.campaign.state.clock);
  warpGameTime(cc.campaign.clockContext, (minute - now) * NUM_SEC_IN_MIN, Warp.NO_PROCESSING);
}

function scripted(cc: ContractCampaign, main: readonly number[], pre: readonly number[] = []) {
  const rng = { main: new ScriptedStream(main), pre: new ScriptedStream(pre) };
  cc.flow.useRandom(rng);
  return rng;
}

function quotes(events: readonly SimEvent[]): (string | number)[][] {
  return events.flatMap((e) => (e.type === 'mercQuote' ? [[e.soldier, e.quote]] : []));
}

describe('contract fields at hire and arrival', () => {
  it('sets the opening squad on the 07:30 slot with a 07:00 end and the arrival as the last contract update', () => {
    const cc = landed([
      { profile: STUB.kestrel, length: 14 },
      { profile: STUB.brack, kind: MercKind.MERC, length: 1 },
    ]);
    const aim = merc(cc, 0).contract;
    expect(aim).toMatchObject({
      totalContractLength: 14,
      timeWillArrive: at(1, 7, 30),
      contractEnd: at(15, 7),
      lastContractUpdate: at(1, 7),
      typeOfLastContract: 2,
      timeCanSignElsewhere: at(15, 7),
      medicalDeposit: 1600,
    });
    expect(merc(cc, 1).contract.contractStartDay).toBe(1);
    expect(profile(cc, STUB.brack).mercMercContractLength).toBe(1);
    expect(profile(cc, STUB.kestrel).mercStatus).toBe(14);
  });
});

describe('refusals and willingness', () => {
  it('refuses over a hated merc whose tolerance is spent, wherever he is', () => {
    const cc = landed(AIM_TRIO);
    const moraga = merc(cc, 1);
    const p = profile(cc, STUB.moraga);
    p.hatedCount[0] = 2;
    expect(findRefusalReason(cc.flow, moraga)).toMatchObject({ quote: 'HATE_MERC_1_ON_TEAM_WONT_RENEW', subject: STUB.hollis });
    merc(cc, 2).sector = { x: 10, y: 1, z: 0 };
    expect(findRefusalReason(cc.flow, moraga)).toBeNull();
    p.hatedCount[0] = 0;
    expect(findRefusalReason(cc.flow, moraga)).toMatchObject({ quote: 'HATE_MERC_1_ON_TEAM_WONT_RENEW' });
    merc(cc, 2).assignment = Assignment.IN_TRANSIT;
    expect(findRefusalReason(cc.flow, moraga)).toBeNull();
  });

  it('learns to hate at half time in the same sector and at once when the count is spent', () => {
    const cc = landed([{ profile: STUB.moraga }, { profile: STUB.vant }]);
    const p = profile(cc, STUB.moraga);
    p.hated[0] = -1;
    p.learnToHateCount = 6;
    expect(findRefusalReason(cc.flow, merc(cc, 0))).toBeNull();
    p.learnToHateCount = 5;
    expect(findRefusalReason(cc.flow, merc(cc, 0))).toMatchObject({
      quote: 'LEARNED_TO_HATE_MERC_1_ON_TEAM_WONT_RENEW',
      subject: STUB.vant,
    });
    merc(cc, 1).sector = { x: 10, y: 1, z: 0 };
    expect(findRefusalReason(cc.flow, merc(cc, 0))).toBeNull();
    p.learnToHateCount = 0;
    expect(findRefusalReason(cc.flow, merc(cc, 0))).toMatchObject({ quote: 'LEARNED_TO_HATE_MERC_1_ON_TEAM_WONT_RENEW' });
  });

  it('refuses over the death rate before morale', () => {
    const cc = landed([{ profile: STUB.moraga }]);
    const m = merc(cc, 0);
    const status = cc.campaign.state.status;
    status.mercDeaths = 1;
    status.manDaysPlayed = 10;
    m.soldier.morale = 10;
    expect(findRefusalReason(cc.flow, m)).toMatchObject({ quote: 'DEATH_RATE_RENEWAL' });
    status.mercDeaths = 0;
    expect(findRefusalReason(cc.flow, m)).toMatchObject({ quote: 'REFUSAL_RENEW_DUE_TO_MORALE' });
  });

  it('renews for a buddy on the team, even one in transit, but not for a dead buddy or after signing elsewhere', () => {
    const cc = landed([{ profile: STUB.vant }, { profile: STUB.kestrel }]);
    const vant = merc(cc, 0);
    vant.soldier.morale = 0;
    expect(willMercRenew(cc.flow, vant, false)).toBe(true);
    merc(cc, 1).assignment = Assignment.IN_TRANSIT;
    expect(willMercRenew(cc.flow, vant, false)).toBe(true);
    profile(cc, STUB.kestrel).mercStatus = MercStatus.IS_DEAD;
    expect(willMercRenew(cc.flow, vant, false)).toBe(false);
    profile(cc, STUB.kestrel).mercStatus = MercStatus.OK;
    vant.contract.signedAnotherContract = true;
    expect(willMercRenew(cc.flow, vant, false)).toBe(false);
  });

  it('says the precedent line the second time and keeps buddy lines on bit 31', () => {
    const cc = landed([{ profile: STUB.moraga }, { profile: STUB.hollis }]);
    const moraga = merc(cc, 0);
    const p = profile(cc, STUB.moraga);
    p.hatedCount[0] = 0;
    willMercRenew(cc.flow, moraga, true);
    willMercRenew(cc.flow, moraga, true);
    expect(p.precedentQuoteSaid).toBe(512);
    expect(quotes(cc.flow.drainEvents())).toEqual([
      [0, 'hateMerc1OnTeamWontRenew'],
      [0, 'precedentToRepeatingOneselfRenew'],
      [0, 'hateMerc1OnTeamWontRenew'],
    ]);
    p.buddies[0] = STUB.hollis;
    expect(willMercRenew(cc.flow, moraga, true)).toBe(true);
    expect(p.precedentQuoteSaid >>> 0).toBe(0x80000200);
  });
});

describe('the two-hour warning and the renewal sequence', () => {
  it('lists every expiring A.I.M. merc and picks the speaker among the willing with Random(n)', () => {
    const cc = landed(AIM_TRIO);
    for (const id of [0, 1, 2]) merc(cc, id).contract.contractEnd = at(2, 7);
    profile(cc, STUB.moraga).hatedCount[0] = 0;
    setTime(cc, at(2, 5, 30));
    const rng = scripted(cc, [1]);
    findOutIfAnyMercAboutToLeaveIsGonnaRenew(cc.flow);
    expect(rng.main.requested).toEqual([2]);
    expect(cc.campaign.state.contracts.renewal.list).toEqual([STUB.kestrel, STUB.moraga, STUB.hollis]);
    expect(merc(cc, 2).contract.renewalQuoteCode).toBe(RenewalQuoteCode.CONTRACTS_OVER_USED);
    const events = cc.flow.drainEvents();
    expect(quotes(events)).toEqual([[2, 'contractsOver']]);
    expect(events.find((e) => e.type === 'contractsExpiringSoon')).toMatchObject({ soldiers: [0, 1, 2] });
  });

  it('keeps the list when no listed contract is expiring at the slot', () => {
    const cc = landed(AIM_TRIO);
    cc.campaign.state.contracts.renewal.list.push(STUB.kestrel);
    setTime(cc, at(2, 13, 30));
    cc.flow.beginRenewalSequence();
    expect(cc.campaign.state.contracts.renewal).toMatchObject({ on: false, list: [STUB.kestrel] });
  });
});

describe('the contract menu', () => {
  it('shades extensions by kind, life and money and dismissal by combat and bleeding', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.brack, kind: MercKind.MERC }]);
    const kestrel = merc(cc, 0);
    cc.campaign.state.finances.balance = 1000;
    expect(contractOptions(cc.flow, kestrel, false).map((o) => [o.choice, o.enabled, o.reason ?? null])).toEqual([
      ['day', true, null],
      ['week', false, 'notEnoughMoney'],
      ['twoWeeks', false, 'notEnoughMoney'],
      ['dismiss', true, null],
      ['letGo', true, null],
    ]);
    kestrel.soldier.life = 10;
    kestrel.soldier.bleeding = 13;
    expect(
      contractOptions(cc.flow, kestrel, false)
        .slice(0, 4)
        .map((o) => o.reason),
    ).toEqual(['tooBadlyHurt', 'tooBadlyHurt', 'tooBadlyHurt', 'bleeding']);
    expect(contractOptions(cc.flow, merc(cc, 1), false)[0]).toMatchObject({ enabled: false, reason: 'notAimMerc' });
  });

  it('books the extension, keeps the arrival as the last contract update and pins a two-week merc', () => {
    const cc = landed([{ profile: STUB.kestrel, length: 1 }]);
    const m = merc(cc, 0);
    const before = cc.campaign.state.finances.balance;
    expect(mercContractHandling(cc.flow, m, 'twoWeeks')).toMatchObject({ extended: true, days: 14, cost: 3600 });
    expect(cc.campaign.state.finances.balance).toBe(before - 3600);
    expect(cc.campaign.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.EXTENDED_CONTRACT_BY_2_WEEKS, secondCode: 0 });
    expect(m.contract).toMatchObject({
      totalContractLength: 15,
      contractEnd: at(16, 7),
      timeCanSignElsewhere: at(16, 7),
      lastContractUpdate: at(1, 7),
    });
    const history = cc.flow.drainEvents().find((e) => e.type === 'historyAdded');
    expect(history).toMatchObject({ code: HistoryCode.EXTENDED_CONTRACT_2_WEEK, profile: STUB.kestrel, sector: 'A9' });
  });

  it('asks about extending the insurance through the hooks', () => {
    const offered: number[] = [];
    const cc = createContractCampaign(kit, { seed: 5, hires: [{ profile: STUB.kestrel }] });
    Object.assign(cc.flow.hooks, {
      insuranceExtensionCost: (_: RosterMerc, days: number) => days * 100,
      purchaseOrExtendInsurance: (_: RosterMerc, days: number) => offered.push(days),
    });
    landFirstSquad(cc.campaign);
    for (let i = 0; i < 20_000 && !cc.campaign.isIdle(); i++) cc.campaign.step();
    cc.campaign.dispatch({ type: 'mapScreen' });
    merc(cc, 0).contract.lifeInsurance = 1;
    expect(cc.campaign.dispatch({ type: 'extendContract', soldier: 0, length: 'week' })).toMatchObject({ ok: true });
    expect(cc.campaign.state.battle.prompt).toMatchObject({ kind: 'insuranceExtension', soldier: 0, days: 7, cost: 700 });
    expect(cc.campaign.dispatch({ type: 'answer', choice: 'yes' }).ok).toBe(true);
    expect(offered).toEqual([7]);
  });
});

describe('leaving the team', () => {
  it('penalizes a dismissal within three hours of arrival and picks the 48-hour quote', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const m = merc(cc, 0);
    setTime(cc, at(1, 9, 59));
    scripted(cc, [2]);
    beginRemoveMercFromContract(cc.flow, m);
    expect(profile(cc, STUB.kestrel).daysOfMoraleHangover).toBe(5);
    expect(cc.campaign.state.status.badReputation).toBe(3);
    expect(quotes(cc.flow.drainEvents())).toEqual([[0, 'departCommetContractNotRenewedOrTerminatedUnder48']]);
    cc.campaign.state.contracts.pendingEndings.length = 0;
    setTime(cc, at(3, 7));
    scripted(cc, []);
    beginRemoveMercFromContract(cc.flow, m);
    expect(quotes(cc.flow.drainEvents())).toEqual([[0, 'departingCommentContractNotRenewedOr48OrMore']]);
  });

  it('offers the airport only when it is not the merc sector and RPCs only here', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    expect(departureOptions(cc.flow, merc(cc, 0), true)).toEqual({ choices: ['here', 'rehire'], elsewhere: null });
    const airport = cc.campaign.state.map.elements[strategicIndex(parseSectorString('B13'))];
    if (airport) airport.enemyControlled = false;
    expect(departureOptions(cc.flow, merc(cc, 0), true)).toEqual({ choices: ['here', 'elsewhere', 'rehire'], elsewhere: 28 });
    expect(departureOptions(cc.flow, merc(cc, 1), true)).toEqual({ choices: ['here'], elsewhere: null });
  });

  it('leaves the gear in an unloaded sector at a random tile of the visible area of the map loaded last, a basement too', () => {
    const tilesOutsideTheBasementThenInside = [60, 60, 80, 80];
    const dropTile = (restrictedScroll: number) => {
      const cc = landed([{ profile: STUB.kestrel }]);
      const m = merc(cc, 0);
      m.insertionCode = InsertionCode.CENTER;
      cc.campaign.state.sectorFlow.trashedMapRestrictedScroll = restrictedScroll;
      scripted(cc, tilesOutsideTheBasementThenInside);
      handleLeavingOfEquipmentInCurrentSector(cc.flow, m, null);
      return cc.campaign.state.sectorDiffs.get(sectorKey(m.sector))?.items?.find((i) => i.exists)?.gridNo;
    };
    expect(dropTile(RestrictedScroll.NONE)).toBe(60 * 160 + 60);
    expect(dropTile(RestrictedScroll.BASEMENT)).toBe(80 * 160 + 80);
  });

  it('sends the gear to a leave slot, zeroes the profile kit and delivers six hours later', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }]);
    handleMercLeavingEquipment(cc.flow, merc(cc, 0), true);
    expect(cc.campaign.state.contracts.leaveList[0]).toMatchObject({ owner: STUB.kestrel });
    expect(profile(cc, STUB.kestrel).inventory.every((item) => item === 0)).toBe(true);
    const event = cc.campaign.state.queue.events.find((e) => e.kind === EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN);
    expect(event).toMatchObject({ stamp: (worldTotalMinutes(cc.campaign.state.clock) + 360) * 60, param: 0 });
  });

  it('lets an empty-handed departure’s delivery carry the gear of the next merc who takes the same leave slot', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }]);
    const [emptyHanded, laden] = [merc(cc, 0), merc(cc, 1)];
    emptyHanded.soldier.inv.forEach((_, slot) => {
      emptyHanded.soldier.inv[slot] = emptyObject();
    });
    handleMercLeavingEquipment(cc.flow, emptyHanded, true);
    handleMercLeavingEquipment(cc.flow, laden, false);
    const leaveEvents: readonly number[] = [EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN, EventKind.MERC_LEAVE_EQUIP_IN_OMERTA];
    const deliveries = cc.campaign.state.queue.events.filter((e) => leaveEvents.includes(e.kind));
    expect(deliveries.map((e) => [e.kind, e.param])).toEqual([
      [EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN, 0],
      [EventKind.MERC_LEAVE_EQUIP_IN_OMERTA, 0],
    ]);
    cc.flow.drainEvents();
    handleEquipmentLeft(cc.flow, 0, primaryAirportSector(cc.flow), PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO, null);
    expect(cc.flow.drainEvents()).toEqual([expect.objectContaining({ type: 'equipmentDelivered', owner: STUB.vant })]);
    expect(cc.campaign.state.contracts.leaveList[0]?.items).toBeNull();
  });

  it('sends the merc home with the draws of StrategicRemoveMerc and refunds the deposit by remaining life', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const m = merc(cc, 0);
    m.contract.signedAnotherContract = true;
    m.contract.medicalDeposit = 2500;
    m.soldier.lifeMax = 80;
    m.soldier.life = 37;
    m.soldier.morale = 10;
    Object.assign(profile(cc, STUB.kestrel), { reputationTolerance: 50 });
    expect(calculateMedicalDepositRefund(cc.flow, m)).toBe(1156);
    const rng = scripted(cc, [1, 0, 4]);
    strategicRemoveMerc(cc.flow, m, 'none');
    expect(rng.main.requested).toEqual([2, 4, 7]);
    const p = profile(cc, STUB.kestrel);
    expect(p).toMatchObject({ mercStatus: MercStatus.WORKING_ELSEWHERE, dayBecomesAvailable: 7, daysOfMoraleHangover: 3 });
    expect(cc.roster.all()).toEqual([]);
    expect(cc.flow.drainEvents().find((e) => e.type === 'mercLeft')).toMatchObject({
      cause: 'contractExpired',
      history: 22,
      personnel: 'other',
      refund: 1156,
    });
  });

  it('keeps a POW out of A.I.M. for good and removes the dead without history', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }]);
    merc(cc, 0).assignment = Assignment.ASSIGNMENT_POW;
    scripted(cc, [0]);
    expect(cc.campaign.dispatch({ type: 'removeMerc', soldier: 0 }).ok).toBe(true);
    expect(profile(cc, STUB.kestrel).mercStatus).toBe(MercStatus.FIRED_AS_A_POW);
    expect(cc.campaign.dispatch({ type: 'removeMerc', soldier: 1 })).toEqual(contractRefusal('notDeadOrCaptured'));
  });

  it('hands an unpaid Iggy to the army when his contract-ending event runs, before the equipment prompt', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC, asProfile: Npc.IGGY }]);
    const narrative = cc.campaign.state.narrative;
    profile(cc, Npc.IGGY).balance = -90;
    beginRemoveMercFromContract(cc.flow, merc(cc, 1));
    expect(factValue(narrative, Fact.IGGY_AVAILABLE_TO_ARMY)).toBe(0);
    cc.flow.settle();
    expect(cc.campaign.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 1 });
    expect(factValue(narrative, Fact.IGGY_AVAILABLE_TO_ARMY)).toBe(1);
  });

  it('keeps Iggy from the army when he leaves paid or quits unpaid without the contract-ending event', () => {
    const paid = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC, asProfile: Npc.IGGY }]);
    beginRemoveMercFromContract(paid.flow, merc(paid, 1));
    paid.flow.settle();
    expect(paid.campaign.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 1 });
    expect(factValue(paid.campaign.state.narrative, Fact.IGGY_AVAILABLE_TO_ARMY)).toBe(0);
    const unpaid = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC, asProfile: Npc.IGGY }]);
    profile(unpaid, Npc.IGGY).balance = -270;
    mercsContractIsFinished(unpaid.flow, merc(unpaid, 1));
    unpaid.flow.settle();
    expect(unpaid.roster.get(1)).toBeUndefined();
    expect(factValue(unpaid.campaign.state.narrative, Fact.IGGY_AVAILABLE_TO_ARMY)).toBe(0);
  });

  it('writes a departing RPC profile insertion from his place in the loaded sector before he leaves the world', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    const hana = merc(cc, 1);
    const p = profile(cc, STUB.hana);
    p.useProfileInsertion = true;
    strategicRemoveMerc(cc.flow, hana, 'none');
    expect(p.useProfileInsertion).toBe(false);
    const again = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    const waiting = merc(again, 1).soldier;
    Object.assign(waiting, { quoteRecord: 7, quoteActionId: QUOTE_ACTION_CHECK_FOR_DEST, finalDestination: waiting.gridNo });
    strategicRemoveMerc(again.flow, merc(again, 1), 'none');
    expect(profile(again, STUB.hana)).toMatchObject({
      useProfileInsertion: true,
      insertionCode: Insertion.GRIDNO,
      insertionData: waiting.gridNo,
      quoteActionId: QUOTE_ACTION_CHECK_FOR_DEST,
      quoteRecord: QUOTE_ACTION_CHECK_FOR_DEST,
    });
  });

  it('gives an RPC away from the loaded sector his strategic insertion code and leaves other kinds alone', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    const [kestrel, hana] = [merc(cc, 0), merc(cc, 1)];
    for (const m of [kestrel, hana]) {
      cc.roster.removeFromTacticalSector(m.id);
      m.sector = { x: 10, y: 1, z: 0 };
      m.insertionCode = Insertion.WEST;
      Object.assign(profile(cc, m.profile), { useProfileInsertion: false, insertionCode: Insertion.NORTH, insertionData: 1234 });
    }
    strategicRemoveMerc(cc.flow, hana, 'none');
    strategicRemoveMerc(cc.flow, kestrel, 'none');
    expect(profile(cc, STUB.hana)).toMatchObject({ useProfileInsertion: true, insertionCode: Insertion.WEST, insertionData: 0 });
    expect(profile(cc, STUB.kestrel)).toMatchObject({ useProfileInsertion: false, insertionCode: Insertion.NORTH, insertionData: 1234 });
  });
});

describe('the daily update', () => {
  it('rolls for another contract only inside the last three days and after the signing gate', () => {
    const cc = landed([{ profile: STUB.kestrel, length: 7 }]);
    const m = merc(cc, 0);
    m.contract.timeCanSignElsewhere = worldTotalMinutes(cc.campaign.state.clock) + 10;
    const gated = scripted(cc, []);
    checkIfMercGetsAnotherContract(cc.flow, m);
    expect(gated.main.requested).toEqual([]);
    m.contract.timeCanSignElsewhere = 0;
    m.contract.contractEnd = worldTotalMinutes(cc.campaign.state.clock) + 3 * NUM_MIN_IN_DAY;
    checkIfMercGetsAnotherContract(cc.flow, m);
    expect(gated.main.requested).toEqual([]);
    m.contract.contractEnd = worldTotalMinutes(cc.campaign.state.clock) - 10;
    checkIfMercGetsAnotherContract(cc.flow, m);
    expect(gated.main.requested).toEqual([]);
    m.contract.contractEnd = worldTotalMinutes(cc.campaign.state.clock) + NUM_MIN_IN_DAY + 5;
    const roll = scripted(cc, [5]);
    checkIfMercGetsAnotherContract(cc.flow, m);
    expect(roll.main.requested).toEqual([100]);
    expect(m.contract.signedAnotherContract).toBe(true);
  });

  it('rates the best gun carried by morale against half the attractiveness of the profile kit', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const m = merc(cc, 0);
    const p = profile(cc, STUB.kestrel);
    expect(p.mainGunAttractiveness).toBe(8);
    p.mainGunAttractiveness = 50;
    m.soldier.morale = 74;
    expect(soldierHasWorseEquipmentThanUsedTo(cc.flow, m, p)).toBe(true);
    m.soldier.morale = 75;
    expect(soldierHasWorseEquipmentThanUsedTo(cc.flow, m, p)).toBe(false);
    const items = cc.content.items;
    const vest = items.byName.get('FLAK_JACKET');
    if (!vest) throw new Error('no flak jacket');
    m.soldier.inv[InvSlot.VEST] = createItem(items, vest.index, 100);
    p.armourAttractiveness = 127;
    expect(soldierHasWorseEquipmentThanUsedTo(cc.flow, m, p)).toBe(true);
  });

  it('wraps the morale-scaled gun rating as a signed byte, so a top gun at high morale makes its owner complain', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const m = merc(cc, 0);
    const p = profile(cc, STUB.kestrel);
    const items = cc.content.items;
    const rifle = items.byName.get('AUTO_ROCKET_RIFLE');
    if (!rifle) throw new Error('no auto rocket rifle');
    m.soldier.inv.forEach((_, slot) => {
      m.soldier.inv[slot] = emptyObject();
    });
    m.soldier.inv[InvSlot.HAND] = createItem(items, rifle.index, 100);
    p.mainGunAttractiveness = 100;
    m.soldier.morale = 81;
    expect(soldierHasWorseEquipmentThanUsedTo(cc.flow, m, p)).toBe(false);
    m.soldier.morale = 82;
    expect(soldierHasWorseEquipmentThanUsedTo(cc.flow, m, p)).toBe(true);
  });

  it('keeps a dead merc on the team in the update: he serves a day, an R.P.C. is paid and his gloom costs reputation', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    setTime(cc, at(2, 0));
    const s = cc.campaign.state;
    s.finances.balance = 10_000;
    const dead = [merc(cc, 0), merc(cc, 1)];
    for (const m of dead) {
      m.assignment = Assignment.ASSIGNMENT_DEAD;
      m.soldier.life = 0;
      m.soldier.morale = 10;
      Object.assign(profile(cc, m.profile), { mercStatus: MercStatus.IS_DEAD, deathRate: 101, reputationTolerance: 101 });
    }
    Object.assign(profile(cc, STUB.kestrel), { reputationTolerance: 50 });
    const served = dead.map((m) => profile(cc, m.profile).totalDaysServed);
    const manDays = s.status.manDaysPlayed;
    mercDailyUpdate(cc.flow);
    expect(dead.map((m) => profile(cc, m.profile).totalDaysServed)).toEqual(served.map((days) => days + 1));
    expect(s.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.PAYMENT_TO_NPC, amount: -90 });
    expect(s.status.badReputation).toBe(3);
    expect(s.status.manDaysPlayed).toBe(manDays);
  });

  it('lets a merc killed on another job take the same night’s new-job roll and come back alive', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const p = profile(cc, STUB.tarrow);
    Object.assign(p, { mercStatus: MercStatus.WORKING_ELSEWHERE, dayBecomesAvailable: 3 });
    p.stats.experience = 5;
    p.miscFlags3 |= ProfileMiscFlag3.PLAYER_HAD_CHANCE_TO_HIRE;
    const DULL_DAY = 0;
    const NEW_JOB = 0;
    const rng = scripted(cc, [DULL_DAY, NEW_JOB, 3], [0]);
    profileDailyUpdate(cc.flow, STUB.tarrow);
    expect(rng.pre.requested).toEqual([1000]);
    expect(rng.main.requested).toEqual([100, 100, 8]);
    expect(cc.campaign.state.status.unhiredMercDeaths).toBe(1);
    expect(cc.flow.drainEvents()).toContainEqual(expect.objectContaining({ mail: 'mercDiedOnOtherAssignment', profile: STUB.tarrow }));
    expect(p).toMatchObject({ mercStatus: MercStatus.WORKING_ELSEWHERE, dayBecomesAvailable: 4 });
  });

  it('lets a cheerful merc lift the morale of everyone in his sector, not of mercs on the road', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }, { profile: STUB.tarrow }]);
    const [a, b, c] = [merc(cc, 0), merc(cc, 1), merc(cc, 2)];
    a.soldier.morale = 80;
    c.betweenSectors = true;
    const before = [a, b, c].map((m) => m.soldier.strategicMoraleMod);
    dailyMoraleUpdate(cc.flow, a, profile(cc, STUB.kestrel));
    expect([a, b, c].map((m) => m.soldier.strategicMoraleMod - (before[[a, b, c].indexOf(m)] ?? 0))).toEqual([2, 3, 0]);
    expect(cc.campaign.state.status.badReputation).toBe(0);
  });

  it('pays an RPC every midnight and lets him quit on the third unpaid one', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    setTime(cc, at(2, 0));
    const hana = profile(cc, STUB.hana);
    const s = cc.campaign.state;
    s.finances.balance = 50;
    for (let day = 0; day < 2; day++) mercDailyUpdate(cc.flow);
    expect(hana.balance).toBe(-180);
    expect(merc(cc, 1).contract.leaveHistoryCode).toBe(0);
    s.finances.balance = 10_000;
    mercDailyUpdate(cc.flow);
    expect(hana.balance).toBe(0);
    expect(s.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.PAYMENT_TO_NPC, amount: -270 });
    s.finances.balance = 0;
    for (let day = 0; day < 3; day++) mercDailyUpdate(cc.flow);
    expect(merc(cc, 1).contract.leaveHistoryCode).toBe(HistoryCode.MERC_QUIT);
    expect(s.contracts.pendingEndings).toContainEqual({ kind: 'withoutEquipment', soldier: 1 });
  });

  it('pays an R.P.C. nothing unless the balance covers the arrears too, and has him quit with quote 55, not the whine 54', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.hana, kind: MercKind.NPC }]);
    setTime(cc, at(2, 0));
    const s = cc.campaign.state;
    const hana = profile(cc, STUB.hana);
    s.finances.balance = 50;
    mercDailyUpdate(cc.flow);
    expect(hana.balance).toBe(-90);
    const whine = s.queue.events.find((e) => e.kind === EventKind.RPC_WHINE_ABOUT_PAY);
    expect(whine).toMatchObject({ param: 1 });
    cc.flow.drainEvents();
    rpcWhineAboutNoPay(cc.flow, whine?.param ?? -1);
    expect(quotes(cc.flow.drainEvents())).toEqual([[1, 'notGettingPaid']]);
    s.finances.balance = 100;
    mercDailyUpdate(cc.flow);
    expect(hana.balance).toBe(-180);
    expect(s.finances.balance).toBe(100);
    mercDailyUpdate(cc.flow);
    const quit = cc.flow.drainEvents().filter((e) => e.type === 'mercQuote');
    expect(quit).toEqual([expect.objectContaining({ soldier: 1, quote: 'aimSeenMike', id: 55 })]);
    expect(merc(cc, 1).contract.leaveHistoryCode).toBe(HistoryCode.MERC_QUIT);
  });

  it('escalates the M.E.R.C. account after 7, 9 and 12 unpaid days', () => {
    const cc = landed([{ profile: STUB.brack, kind: MercKind.MERC, length: 1 }]);
    setTime(cc, at(2, 0));
    const statuses: number[] = [];
    for (let day = 0; day < 12; day++) {
      dailyUpdateOfMercSite(cc.flow);
      statuses.push(cc.campaign.state.laptop.merc.accountStatus);
    }
    expect(profile(cc, STUB.brack).mercMercContractLength).toBe(13);
    const S = MercAccountStatus;
    expect(statuses).toEqual([
      0,
      0,
      0,
      0,
      0,
      0,
      S.VALID_FIRST_WARNING,
      S.VALID_FIRST_WARNING,
      S.SUSPENDED,
      S.SUSPENDED,
      S.SUSPENDED,
      S.INVALID,
    ]);
  });
});

describe('contract commands', () => {
  it('are map screen only, check the merc and refuse while a prompt is open', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.brack, kind: MercKind.MERC }]);
    const c = cc.campaign;
    expect(c.dispatch({ type: 'extendContract', soldier: 1, length: 'day' })).toEqual(contractRefusal('notAimMerc'));
    merc(cc, 0).soldier.bleeding = 20;
    expect(c.dispatch({ type: 'dismiss', soldier: 0 })).toEqual(contractRefusal('bleeding'));
    merc(cc, 0).soldier.bleeding = 0;
    expect(c.dispatch({ type: 'contractOptions', soldier: 0 })).toMatchObject({ ok: true, data: { options: expect.any(Array) } });
    expect(c.dispatch({ type: 'dismiss', soldier: 0 }).ok).toBe(true);
    expect(c.state.battle.prompt).toMatchObject({ kind: 'mercDeparture', soldier: 0, choices: ['here', 'rehire'] });
    expect(c.dispatch({ type: 'extendContract', soldier: 1, length: 'day' })).toMatchObject({ ok: false });
    expect(c.dispatch({ type: 'answer', choice: 'here' }).ok).toBe(true);
    const left = c.drainEvents().find((e) => e.type === 'mercLeft');
    expect(left).toMatchObject({ soldier: 0, cause: 'fired', history: HistoryCode.MERC_FIRED, personnel: 'fired', equipment: 'here' });
    expect(c.dispatch({ type: 'tacticalScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'dismiss', soldier: 1 })).toEqual(contractRefusal('mapScreenOnly'));
  });
});

describe('level-ups', () => {
  it('raise A.I.M. salaries and flag the price, and post the M.E.R.C. email one to two hours later', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.brack, kind: MercKind.MERC }]);
    const kestrel = profile(cc, STUB.kestrel);
    cc.flow.experienceHooks.levelGained(kestrel, merc(cc, 0).soldier, 1);
    expect(merc(cc, 0).contract.contractPriceIncreased).toBe(true);
    expect([kestrel.salary, kestrel.weeklySalary, kestrel.biWeeklySalary, kestrel.medicalDepositAmount]).toEqual([390, 2400, 4500, 2000]);
    const rng = scripted(cc, [30]);
    cc.flow.experienceHooks.levelGained(profile(cc, STUB.brack), merc(cc, 1).soldier, 1);
    expect(rng.main.requested).toEqual([60]);
    const event = cc.campaign.state.queue.events.find((e) => e.kind === EventKind.MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY);
    expect(event).toMatchObject({ stamp: (worldTotalMinutes(cc.campaign.state.clock) + 90) * 60, param: 2 });
  });
});

describe('death bookkeeping', () => {
  it('logs the death, counts it as an unsigned byte, ends a M.E.R.C. contract and makes buddies speak', () => {
    const cc = landed([{ profile: STUB.vant }, { profile: STUB.kestrel }, { profile: STUB.brack, kind: MercKind.MERC }]);
    const battle = cc.campaign.battle;
    if (!battle) throw new Error('no battle flow');
    const status = cc.campaign.state.status;
    status.mercDeaths = 255;
    const kestrel = merc(cc, 1);
    kestrel.soldier.life = 0;
    strategicHandlePlayerTeamMercDeath(battle, kestrel);
    expect(status.mercDeaths).toBe(0);
    expect(profile(cc, STUB.kestrel).mercStatus).toBe(MercStatus.IS_DEAD);
    const events = cc.campaign.drainEvents();
    expect(events.find((e) => e.type === 'historyAdded')).toMatchObject({
      code: HistoryCode.MERC_KILLED,
      profile: STUB.kestrel,
      sector: 'A9',
    });
    expect(quotes(events)).toEqual([
      [0, 'startingToWhine'],
      [0, 'buddyOneKilled'],
    ]);
    const brack = merc(cc, 2);
    brack.soldier.life = 0;
    strategicHandlePlayerTeamMercDeath(battle, brack);
    expect(brack.contract.contractEnd).toBe(worldTotalMinutes(cc.campaign.state.clock));
    expect(cc.roster.all().map((m) => [m.id, m.assignment])).toEqual([
      [0, 0],
      [1, Assignment.ASSIGNMENT_DEAD],
      [2, Assignment.ASSIGNMENT_DEAD],
    ]);
  });
});
