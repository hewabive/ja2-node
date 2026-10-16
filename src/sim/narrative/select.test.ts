import { describe, expect, it } from 'vitest';
import { recordArray, testProfile } from '../../../tests/support/narrative.ts';
import { QuoteFlag } from '../../content/formats/npc.ts';
import { Approach, NO_PROFILE, NpcAction } from '../../content/narrative/npc-constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { NarrativeFact, NarrativeProfile } from './narrative-ids.ts';
import {
  approachedForFirstTime,
  calcDesireToTalk,
  calcThreateningEffectiveness,
  handleNpcBeingGivenMoneyByPlayer,
  npcConsiderQuote,
  npcConsiderReceivingItemFromMerc,
  npcConsiderTalking,
  type ReceiveEnv,
  type SelectEnv,
} from './select.ts';

const NPC = 94;
const MERC = 3;
const MONEY = 6;

interface EnvOptions {
  readonly profiles?: Record<number, ProfileProgress>;
  readonly facts?: Record<number, boolean>;
  readonly quests?: Record<number, number>;
  readonly day?: number;
  readonly gridNo?: number | null;
  readonly threat?: number;
  readonly rating?: number;
}

function env(o: EnvOptions = {}): SelectEnv & { readonly facts: Map<number, boolean> } {
  const facts = new Map(Object.entries(o.facts ?? {}).map(([k, v]) => [Number(k), v]));
  return {
    facts,
    day: o.day ?? 3,
    profile: (id) => o.profiles?.[id] ?? null,
    checkFact: (fact) => facts.get(fact) ?? false,
    questValue: (i) => o.quests?.[i] ?? 0,
    townRating: () => o.rating ?? 0,
    npcGridNo: () => (o.gridNo === undefined ? 500 : o.gridNo),
    threat: () => o.threat ?? 0,
    hasItemInProfile: (npc, item) => {
      const p = o.profiles?.[npc];
      return !!p && p.inventory.some((it, k) => it === item && (p.inventoryCount[k] ?? 0) !== 0);
    },
  };
}

function receiveEnv(
  o: EnvOptions & { cost?: number },
): ReceiveEnv & { messages: unknown[]; triggers: [number, number][]; facts: Map<number, boolean> } {
  const base = env(o);
  const messages: unknown[] = [];
  const triggers: [number, number][] = [];
  return {
    ...base,
    messages,
    triggers,
    items: {
      ids: { HEAD_2: 1, HEAD_3: 2, HEAD_5: 3, HEAD_6: 4, HEAD_7: 5, MONEY, SILVER: 7, GOLD: 8, WINE: 9, BEER: 10, ALCOHOL: 11 },
      leatherJacketPrice: 950,
      isGunOfRifleClass: (item) => item === 20,
    },
    hospital: { tempBalance: 0, refund: 0 },
    setFact: (fact, value) => base.facts.set(fact, value),
    triggerNpcRecord: (npc, record) => triggers.push([npc, record]),
    message: (m) => messages.push(m),
    calcMedicalCost: () => o.cost ?? 0,
    frankCash: () => {},
    kingpinInHisHouse: () => false,
    isRpc: () => false,
    addProfileCost: () => {},
  };
}

describe('CalcDesireToTalk', () => {
  it('truncates every step and boosts the personal value for a weak town attachment', () => {
    const npc = testProfile(NPC, { townAttachment: 50, town: 2, approachVal: [40, 0, 0, 0] });
    npc.opinions[MERC] = 10;
    const merc = testProfile(MERC, { approachFactor: [90, 100, 100, 100] });
    merc.stats.leadership = 70;
    expect(calcDesireToTalk(env({ profiles: { [NPC]: npc, [MERC]: merc }, rating: 60 }), NPC, MERC, Approach.FRIENDLY)).toBe(30);
  });

  it('wraps as UINT8 and floors at zero', () => {
    const npc = testProfile(NPC, { approachVal: [255, 0, 0, 0] });
    npc.opinions[MERC] = 50;
    const merc = testProfile(MERC, { approachFactor: [255, 0, 0, 0] });
    merc.stats.leadership = 100;
    expect(calcDesireToTalk(env({ profiles: { [NPC]: npc, [MERC]: merc } }), NPC, MERC, Approach.FRIENDLY)).toBe(20);
    const calm = testProfile(NPC, { townAttachment: 100 });
    expect(calcDesireToTalk(env({ profiles: { [NPC]: calm } }), NPC, MERC, Approach.NPC_INITIATING_CONV)).toBe(0);
  });

  it('uses the soldier threat for threaten: an unarmed threat counts -30 and the sum is halved', () => {
    expect(calcThreateningEffectiveness({ effectiveLeadership: 50, effectiveStrength: 70, deadliness: 0 })).toBe(45);
    expect(calcThreateningEffectiveness({ effectiveLeadership: 0, effectiveStrength: 5, deadliness: 0 })).toBe(-12);
    expect(calcThreateningEffectiveness(null)).toBe(0);
    const npc = testProfile(NPC, { townAttachment: 100, approachVal: [0, 0, 50, 0] });
    const merc = testProfile(MERC, { approachFactor: [100, 100, 100, 100] });
    expect(calcDesireToTalk(env({ profiles: { [NPC]: npc, [MERC]: merc }, threat: 45 }), NPC, MERC, Approach.THREATEN)).toBe(11);
  });
});

describe('first approach', () => {
  it('scales all four values by the row of the approach and sets its bit', () => {
    const p = testProfile(NPC, {
      approachVal: [100, 200, 50, 10],
      approachMod: [
        [100, 100, 100, 100],
        [150, 200, 100, 50],
        [100, 100, 100, 100],
      ],
    });
    approachedForFirstTime(p, Approach.DIRECT);
    expect(p.approachVal).toEqual([150, 255, 50, 5]);
    expect(p.approached).toBe(0x02);
  });

  it('computes the desire before scaling, never scales for recruit and inverts Pablo’s test', () => {
    const mods = [
      [200, 200, 200, 200],
      [200, 200, 200, 200],
      [200, 200, 200, 200],
    ];
    const npc = testProfile(NPC, { townAttachment: 100, approachVal: [50, 50, 50, 50], approachMod: mods });
    const merc = testProfile(MERC, { approachFactor: [100, 100, 100, 100] });
    merc.stats.leadership = 100;
    const e = env({ profiles: { [NPC]: npc, [MERC]: merc } });
    const records = recordArray({ 0: { approachRequired: Approach.FRIENDLY, opinionRequired: 25 } });
    expect(npcConsiderTalking(e, NPC, MERC, Approach.FRIENDLY, 0, records).index).toBe(0);
    expect(npc.approachVal).toEqual([100, 100, 100, 100]);
    npcConsiderTalking(e, NPC, MERC, Approach.RECRUIT, 0, records);
    expect(npc.approachVal).toEqual([100, 100, 100, 100]);
    const pablo = testProfile(NarrativeProfile.PABLO, { approachVal: [50, 50, 50, 50], approachMod: mods });
    const pe = env({ profiles: { [NarrativeProfile.PABLO]: pablo, [MERC]: merc } });
    npcConsiderTalking(pe, NarrativeProfile.PABLO, MERC, Approach.SECTOR_NOT_SAFE, 0, records);
    expect(pablo.approachVal).toEqual([50, 50, 50, 50]);
    pablo.approached = 0x04;
    npcConsiderTalking(pe, NarrativeProfile.PABLO, MERC, Approach.SECTOR_NOT_SAFE, 0, records);
    expect(pablo.approachVal).toEqual([100, 100, 100, 100]);
  });
});

describe('NPCConsiderQuote', () => {
  const consider = (e: SelectEnv, fields: Parameters<typeof recordArray>[0][number], approach: number = Approach.FRIENDLY, desire = 0) =>
    npcConsiderQuote(e, NPC, approach, 0, desire, recordArray({ 0: fields }));

  it('rejects said records and decodes the quest states', () => {
    const e = env({ quests: { 5: 1, 6: 2, 100: 1 } });
    expect(consider(e, { flags: QuoteFlag.SAID })).toBe(false);
    expect(consider(e, { quest: 5 })).toBe(true);
    expect(consider(e, { quest: 105 })).toBe(false);
    expect(consider(e, { quest: 106 })).toBe(false);
    expect(consider(e, { quest: 206 })).toBe(true);
    expect(consider(e, { quest: 100 })).toBe(true);
    expect(consider(e, { quest: 200 })).toBe(false);
    expect(consider(env(), { quest: 200 })).toBe(true);
    expect(() => consider(e, { quest: 30 })).toThrow(RangeError);
  });

  it('checks the facts, then the approach matrix', () => {
    const e = env({ facts: { 12: true } });
    expect(consider(e, { factMustBeTrue: 12 })).toBe(true);
    expect(consider(e, { factMustBeTrue: 13 })).toBe(false);
    expect(consider(e, { factMustBeFalse: 12 })).toBe(false);
    for (const [required, approach, ok] of [
      [0, Approach.FRIENDLY, true],
      [0, Approach.DIRECT, true],
      [0, Approach.TRIGGER_NPC, true],
      [0, Approach.THREATEN, false],
      [0, Approach.GIVINGITEM, false],
      [Approach.ONE_OF_FOUR_STANDARD, Approach.RECRUIT, true],
      [Approach.ONE_OF_FOUR_STANDARD, Approach.REPEAT, false],
      [Approach.FRIENDLY_DIRECT_OR_RECRUIT, Approach.RECRUIT, true],
      [Approach.FRIENDLY_DIRECT_OR_RECRUIT, Approach.THREATEN, false],
      [Approach.GIVINGITEM, Approach.GIVINGITEM, true],
    ] as const)
      expect(consider(e, { approachRequired: required }, approach), `${required}/${approach}`).toBe(ok);
  });

  it('applies the day window, the new-day rule and the opinion', () => {
    const p = testProfile(NPC, { lastDateSpokenTo: 3 });
    expect(consider(env({ profiles: { [NPC]: p }, day: 3 }), { firstDay: 254 })).toBe(false);
    expect(consider(env({ profiles: { [NPC]: p }, day: 4 }), { firstDay: 254 })).toBe(true);
    expect(npcConsiderQuote(env({ day: 4 }), NO_PROFILE, 0, 0, 0, recordArray({ 0: { firstDay: 254 } }))).toBe(false);
    expect(consider(env({ day: 3 }), { firstDay: 4 })).toBe(false);
    expect(consider(env({ day: 3 }), { lastDay: 2 })).toBe(false);
    expect(consider(env({ day: 255 }), { lastDay: 2 })).toBe(true);
    expect(consider(env(), { opinionRequired: 30 }, Approach.FRIENDLY, 29)).toBe(false);
    expect(consider(env(), { opinionRequired: 30 }, Approach.FRIENDLY, 30)).toBe(true);
    expect(consider(env(), { opinionRequired: 255 }, Approach.FRIENDLY, 0)).toBe(true);
    expect(consider(env(), { opinionRequired: 30 }, Approach.TRIGGER_NPC, 0)).toBe(true);
  });
});

describe('NPCConsiderTalking', () => {
  it('needs the item in the profile inventory or the NPC on the tile; the first match wins', () => {
    const npc = testProfile(NPC);
    npc.inventory[3] = 50;
    npc.inventoryCount[3] = 1;
    const records = recordArray({
      0: { requirement: 1000 },
      1: { requirement: 51 },
      2: { requirement: -501 },
      3: { requirement: -500 },
      4: { requirement: 50 },
    });
    expect(npcConsiderTalking(env({ profiles: { [NPC]: npc } }), NPC, MERC, Approach.FRIENDLY, 0, records).index).toBe(3);
    expect(npcConsiderTalking(env({ profiles: { [NPC]: npc }, gridNo: 7 }), NPC, MERC, Approach.FRIENDLY, 0, records).index).toBe(4);
    expect(npcConsiderTalking(env({ gridNo: null }), NPC, MERC, Approach.FRIENDLY, 0, records).record).toBeNull();
  });

  it('only looks at the given record for triggers', () => {
    const records = recordArray({ 0: {}, 4: { approachRequired: Approach.TRIGGER_NPC } });
    expect(npcConsiderTalking(env(), NPC, NO_PROFILE, Approach.TRIGGER_NPC, 4, records).index).toBe(4);
    expect(npcConsiderTalking(env(), NPC, NO_PROFILE, Approach.TRIGGER_NPC, 3, records).record).toBeNull();
  });

  it('finds the highest opinion for NPC-initiated talk and returns the last scanned record and a quote number', () => {
    const records = recordArray({
      2: { approachRequired: Approach.NPC_INITIATING_CONV, opinionRequired: 255, quoteNum: 40 },
      5: { approachRequired: Approach.NPC_INITIATING_CONV, opinionRequired: 0, quoteNum: 41 },
    });
    const result = npcConsiderTalking(env(), NPC, MERC, Approach.NPC_INITIATING_CONV, 0, records);
    expect(result.opinion).toBe(255);
    expect(result.index).toBe(40);
    expect(result.record).toBe(records[49]);
  });
});

describe('receiving items and money', () => {
  const give = (approach: number) => ({ approachRequired: approach });

  it('normalises items, keeps the money facts and records the condition', () => {
    const e = receiveEnv({});
    const records = recordArray({
      0: { ...give(Approach.GIVINGITEM), requirement: 1001 },
      1: { ...give(Approach.GIVINGITEM), requirement: 1 },
    });
    expect(npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: 20, money: 0, status: 40, count: 1 }, records).index).toBe(0);
    expect(e.facts.get(NarrativeFact.ITEM_POOR_CONDITION)).toBe(true);
    expect(npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: 3, money: 0, status: 90, count: 1 }, records).index).toBe(1);
    expect(e.facts.get(NarrativeFact.ITEM_POOR_CONDITION)).toBe(false);
    npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: MONEY, money: 999, status: 100, count: 1 }, records);
    npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: 7, money: 1000, status: 100, count: 1 }, records);
    expect(e.facts.get(NarrativeFact.SMALL_AMOUNT_OF_MONEY)).toBe(true);
    expect(e.facts.get(NarrativeFact.LARGE_AMOUNT_OF_MONEY)).toBe(true);
  });

  it('only takes items with records requiring the giving approach, and nothing while hostile', () => {
    const e = receiveEnv({ facts: { [NarrativeFact.NPC_IS_ENEMY]: false } });
    const loose = recordArray({ 0: { requirement: 1000 } });
    expect(npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: 30, money: 0, status: 90, count: 1 }, loose).record).toBeNull();
    const strict = recordArray({ 0: { ...give(Approach.GIVINGITEM), requirement: 1000 } });
    e.facts.set(NarrativeFact.NPC_IS_ENEMY, true);
    expect(npcConsiderReceivingItemFromMerc(e, NPC, MERC, { item: 30, money: 0, status: 90, count: 1 }, strict).record).toBeNull();
  });

  it('handles Darren’s bets at the boundaries', () => {
    const darren = NarrativeProfile.DARREN;
    const cash = { ...give(Approach.GIVINGITEM), requirement: MONEY, actionData: NpcAction.DARREN_GIVEN_CASH };
    const run = (money: number, said = false) => {
      const profile = testProfile(darren);
      const e = receiveEnv({ profiles: { [darren]: profile } });
      const records = recordArray({ 0: cash, 15: {}, 16: {}, 17: { flags: said ? QuoteFlag.SAID : 0 }, 31: {} });
      return {
        index: npcConsiderReceivingItemFromMerc(e, darren, MERC, { item: MONEY, money, status: 100, count: 1 }, records).index,
        profile,
      };
    };
    expect(run(999).index).toBe(15);
    const placed = run(1000);
    expect(placed.index).toBe(17);
    expect(placed.profile.balance).toBe(1000);
    expect(run(5000).index).toBe(17);
    expect(run(5001).index).toBe(16);
    expect(run(2000, true).index).toBe(31);
  });

  it('pays Gerard and Joe up to the big payment and keeps index 0 for Vince’s plain cash', () => {
    const gerard = NarrativeProfile.GERARD;
    const cash = { ...give(Approach.GIVINGITEM), requirement: MONEY, actionData: NpcAction.GERARD_GIVEN_CASH };
    const g = testProfile(gerard);
    const e = receiveEnv({ profiles: { [gerard]: g } });
    const records = recordArray({ 0: cash, 11: {}, 12: {} });
    expect(npcConsiderReceivingItemFromMerc(e, gerard, MERC, { item: MONEY, money: 9999, status: 100, count: 1 }, records).index).toBe(11);
    expect(npcConsiderReceivingItemFromMerc(e, gerard, MERC, { item: MONEY, money: 1, status: 100, count: 1 }, records).index).toBe(12);
    const vince = NarrativeProfile.VINCE;
    const ve = receiveEnv({ profiles: { [vince]: testProfile(vince) } });
    const vr = recordArray({ 0: { ...give(Approach.GIVINGITEM), requirement: MONEY }, 8: { quoteNum: 77 } });
    const result = npcConsiderReceivingItemFromMerc(ve, vince, MERC, { item: MONEY, money: 50, status: 100, count: 1 }, vr);
    expect(result.index).toBe(0);
    expect(result.record?.quoteNum).toBe(77);
  });

  it('keeps a negative hospital refund because the clamp is unsigned', () => {
    const steve = NarrativeProfile.STEVE;
    const e = receiveEnv({ profiles: { [steve]: testProfile(steve) }, cost: 100 });
    e.hospital.tempBalance = 50;
    e.hospital.refund = 10;
    expect(handleNpcBeingGivenMoneyByPlayer(e, steve, 50)).toBe(0);
    expect(e.hospital.refund).toBe(-40);
    expect(e.hospital.tempBalance).toBe(0);
    expect(handleNpcBeingGivenMoneyByPlayer(e, steve, 30)).toBe(27);
    expect(e.hospital.tempBalance).toBe(30);
  });
});
