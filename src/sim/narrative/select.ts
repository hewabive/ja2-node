// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.cc CalcThreateningEffectiveness, CalcDesireToTalk, ApproachedForFirstTime,
// @src NPCConsiderTalking, NPCConsiderQuote, UseQuote, NPCConsiderReceivingItemFromMerc, HandleNPCBeingGivenMoneyByPlayer;
// @src Strategic/Quests.cc gubQuest, gubFact (the out-of-bounds quest read).

import {
  ACCEPT_ANY_ITEM,
  ANY_RIFLE,
  FACT_NONE,
  IRRELEVANT,
  MUST_BE_NEW_DAY,
  NO_QUEST,
  type NpcRecord,
  NUM_NPC_QUOTE_RECORDS,
  QUEST_DONE_NUM,
  QUEST_NOT_STARTED_NUM,
  QuoteFlag,
  requiredGridNo,
} from '../../content/formats/npc.ts';
import {
  Approach,
  INITIATING_FACTOR,
  LARGE_AMOUNT_MONEY,
  MAX_QUESTS,
  NO_PROFILE,
  NpcAction,
  NUM_REAL_APPROACHES,
  QuestId,
  QuestStatusValue,
} from '../../content/narrative/npc-constants.ts';
import { i8, i32, idiv, u8, u32 } from '../../core/int.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { NarrativeFact, NarrativeProfile } from './narrative-ids.ts';

export const FIRST_APPROACH_FLAGS: readonly number[] = [0x01, 0x02, 0x04, 0x08];
const MERC_OPINIONS = 75;
const PERSONAL_BASE = 50;
const FULL_ATTACHMENT = 100;
const APPROACH_VALUE_DIVISOR = 50;
const PERCENT = 100;
const MAX_APPROACH_VALUE = 255;
const NO_WEAPON_DEADLINESS = -30;
const LAST_SPEAKABLE_DAY = 255;
const POOR_CONDITION = 50;
const FEMALE = 1;
const DARREN_MIN_BET = 1000;
const DARREN_MAX_BET = 5000;
const BIG_PAYMENT = 10000;

export const DarrenRecord = { BET_TOO_LOW: 15, BET_TOO_HIGH: 16, FIRST_FIGHT: 17, KINGPIN_COMES: 18, FOUGHT_BEFORE: 31 } as const;
export const AngelRecord = { TOO_LOW: 8, TOO_HIGH: 9, ACCEPTED: 10 } as const;
export const MadameRecord = { FEMALE_TALKER: 5, CARLA: 16, CINDY: 17, BAMBI: 18, MARIA: 19, DEFAULT: 25 } as const;
const MADAME_PRICES = {
  CARLA: { unit: 100, amounts: [100, 200] },
  CINDY: { unit: 500, amounts: [500, 1000] },
  BAMBI: { unit: 300, amounts: [300, 600] },
  MARIA: { unit: 400, amounts: [400, 800] },
} as const;
const JUST_ACCEPT_CASH_RECORD = { VINCE: 8, STEVE: 7 } as const;
const INDEX_NOT_UPDATED = 0;
const HospitalRecord = { WOUNDED_MERCS: 26, ONE_WOUNDED_MERC: 25, NEEDS_MORE: 27 } as const;
const KingpinRecord = { STILL_OWED: 9, PAID: 10 } as const;
const WalterRecord = { FIRST: 12, AGAIN: 13 } as const;
const GerardRecord = { PARTIAL: 11, PAID: 12 } as const;
const JoeRecord = { PARTIAL: 6, PAID: 7 } as const;

export interface SelectEnv {
  readonly day: number;
  profile(id: number): ProfileProgress | null;
  checkFact(fact: number, npc: number): boolean;
  questValue(index: number): number;
  townRating(town: number): number;
  npcGridNo(npc: number): number | null;
  threat(merc: number): number;
  hasItemInProfile(npc: number, item: number): boolean;
}

export interface ThreatInputs {
  readonly effectiveLeadership: number;
  readonly effectiveStrength: number;
  readonly deadliness: number;
}

export function calcThreateningEffectiveness(inputs: ThreatInputs | null): number {
  if (!inputs) return 0;
  const deadliness = inputs.deadliness === 0 ? NO_WEAPON_DEADLINESS : inputs.deadliness;
  return idiv(inputs.effectiveLeadership + inputs.effectiveStrength + deadliness, 2);
}

function opinionOf(npc: ProfileProgress, merc: number): number {
  return merc >= 0 && merc < MERC_OPINIONS ? (npc.opinions[merc] ?? 0) : 0;
}

export function calcDesireToTalk(env: SelectEnv, npc: number, merc: number, approach: number): number {
  const p = env.profile(npc);
  if (!p) return 0;
  const m = env.profile(merc);
  let personal = PERSONAL_BASE + opinionOf(p, merc);
  const town = idiv(env.townRating(p.town) * p.townAttachment, PERCENT);
  let approachValue: number;
  if (approach === Approach.NPC_INITIATING_CONV || approach === Approach.GIVINGITEM) approachValue = PERCENT;
  else {
    const factor = m?.approachFactor[approach - 1] ?? 0;
    const base = approach === Approach.THREATEN ? env.threat(merc) : (m?.stats.leadership ?? 0);
    const effective = idiv(base * factor, PERCENT);
    approachValue = idiv((p.approachVal[approach - 1] ?? 0) * effective, APPROACH_VALUE_DIVISOR);
  }
  if (p.townAttachment < FULL_ATTACHMENT) personal = idiv(personal * (PERCENT + (FULL_ATTACHMENT - p.townAttachment)), PERCENT);
  let willingness = idiv((idiv(personal, 2) + idiv(town, 2)) * approachValue, PERCENT);
  if (approach === Approach.NPC_INITIATING_CONV) willingness -= INITIATING_FACTOR;
  return u8(Math.max(willingness, 0));
}

export function approachedForFirstTime(p: ProfileProgress, approach: number): void {
  p.approached |= FIRST_APPROACH_FLAGS[approach - 1] ?? 0;
  const mods = p.approachMod[approach - 1] ?? [];
  for (let k = 0; k < NUM_REAL_APPROACHES; k++) {
    const scaled = u32((p.approachVal[k] ?? 0) * (mods[k] ?? 0));
    p.approachVal[k] = Math.min(MAX_APPROACH_VALUE, Math.trunc(scaled / PERCENT));
  }
}

function questPasses(env: SelectEnv, quest: number): boolean {
  if (quest === NO_QUEST) return true;
  if (quest % QUEST_NOT_STARTED_NUM >= MAX_QUESTS) throw new RangeError(`invalid quest index: ${quest}`);
  if (quest > QUEST_DONE_NUM) return env.questValue(quest - QUEST_DONE_NUM) === QuestStatusValue.DONE;
  if (quest > QUEST_NOT_STARTED_NUM) return env.questValue(quest - QUEST_NOT_STARTED_NUM) === QuestStatusValue.NOT_STARTED;
  return env.questValue(quest) === QuestStatusValue.IN_PROGRESS;
}

function approachMatches(required: number, approach: number): boolean {
  const freeApproach = approach === Approach.FRIENDLY || approach === Approach.DIRECT || approach === Approach.TRIGGER_NPC;
  if (!required && freeApproach) return true;
  if (required === Approach.ONE_OF_FOUR_STANDARD) return approach >= Approach.FRIENDLY && approach <= Approach.RECRUIT;
  if (required === Approach.FRIENDLY_DIRECT_OR_RECRUIT)
    return approach === Approach.FRIENDLY || approach === Approach.DIRECT || approach === Approach.RECRUIT;
  return approach === required;
}

function daysAllow(env: SelectEnv, npc: number, q: NpcRecord): boolean {
  const p = npc !== NO_PROFILE ? env.profile(npc) : null;
  if (p && q.firstDay === MUST_BE_NEW_DAY) {
    if (env.day <= p.lastDateSpokenTo) return false;
  } else if (env.day < q.firstDay) return false;
  return !(env.day > q.lastDay && env.day < LAST_SPEAKABLE_DAY);
}

export function npcConsiderQuote(
  env: SelectEnv,
  npc: number,
  approach: number,
  index: number,
  desire: number,
  records: readonly NpcRecord[],
): boolean {
  const q = records[index];
  if (!q || q.flags & QuoteFlag.SAID) return false;
  if (!questPasses(env, q.quest)) return false;
  if (q.factMustBeTrue !== FACT_NONE && !env.checkFact(q.factMustBeTrue, npc)) return false;
  if (q.factMustBeFalse !== FACT_NONE && env.checkFact(q.factMustBeFalse, npc)) return false;
  if (!approachMatches(q.approachRequired, approach)) return false;
  if (!daysAllow(env, npc, q)) return false;
  if (q.opinionRequired !== IRRELEVANT && approach !== Approach.TRIGGER_NPC && desire < q.opinionRequired) return false;
  return true;
}

export interface TalkingResult {
  readonly opinion: number;
  readonly record: NpcRecord | null;
  readonly index: number;
}

export const NO_SOLDIER_RESULT: TalkingResult = { opinion: 0, record: null, index: -1 };

function approachedBefore(p: ProfileProgress, approach: number): boolean {
  return (p.approached & (FIRST_APPROACH_FLAGS[approach - 1] ?? 0)) !== 0;
}

function desireBeforeScan(env: SelectEnv, npc: number, merc: number, approach: number): number {
  const p = env.profile(npc);
  if (approach >= Approach.FRIENDLY && approach <= NUM_REAL_APPROACHES) {
    const desire = calcDesireToTalk(env, npc, merc, approach);
    const scalesOnFirstUse = approach !== Approach.RECRUIT;
    if (p && scalesOnFirstUse && !approachedBefore(p, approach)) approachedForFirstTime(p, approach);
    return desire;
  }
  if (npc === NarrativeProfile.PABLO && approach === Approach.SECTOR_NOT_SAFE) {
    const desire = calcDesireToTalk(env, npc, merc, Approach.THREATEN);
    if (p && approachedBefore(p, Approach.THREATEN)) approachedForFirstTime(p, Approach.THREATEN);
    return desire;
  }
  return 0;
}

function requirementMet(env: SelectEnv, npc: number, gridNo: number, q: NpcRecord): boolean {
  if (q.requirement > 0) return env.hasItemInProfile(npc, q.requirement);
  if (q.requirement < 0) return gridNo === requiredGridNo(q);
  return true;
}

export function npcConsiderTalking(
  env: SelectEnv,
  npc: number,
  merc: number,
  approach: number,
  record: number,
  records: readonly NpcRecord[],
): TalkingResult {
  const gridNo = env.npcGridNo(npc);
  if (gridNo === null) return NO_SOLDIER_RESULT;
  const desire = desireBeforeScan(env, npc, merc, approach);
  const first = approach === Approach.TRIGGER_NPC ? record : 0;
  const last = approach === Approach.TRIGGER_NPC ? record : NUM_NPC_QUOTE_RECORDS - 1;
  let highest = 0;
  let found = false;
  let lastScanned: NpcRecord | null = null;
  let quote = 0;
  for (let i = first; i <= last; i++) {
    const q = records[i];
    if (!q) continue;
    lastScanned = q;
    if (!requirementMet(env, npc, gridNo, q)) continue;
    if (!npcConsiderQuote(env, npc, approach, i, desire, records)) continue;
    if (approach !== Approach.NPC_INITIATING_CONV) return { opinion: q.opinionRequired, record: q, index: i };
    if (q.opinionRequired > highest) {
      found = true;
      highest = q.opinionRequired;
      quote = q.quoteNum;
    }
  }
  return found ? { opinion: highest, record: lastScanned, index: quote } : { opinion: 0, record: null, index: 0 };
}

export interface GivenObject {
  readonly item: number;
  readonly money: number;
  readonly status: number;
  readonly count: number;
}

export interface ItemFacts {
  isGunOfRifleClass(item: number): boolean;
  readonly ids: {
    readonly HEAD_2: number;
    readonly HEAD_3: number;
    readonly HEAD_5: number;
    readonly HEAD_6: number;
    readonly HEAD_7: number;
    readonly MONEY: number;
    readonly SILVER: number;
    readonly GOLD: number;
    readonly WINE: number;
    readonly BEER: number;
    readonly ALCOHOL: number;
  };
  readonly leatherJacketPrice: number;
}

export interface HospitalBalance {
  tempBalance: number;
  refund: number;
}

export type NpcMoneyMessage =
  | { readonly kind: 'balanceOwed'; readonly profile: number; readonly amount: number }
  | { readonly kind: 'needsMoney'; readonly profile: number; readonly amount: number };

export interface ReceiveEnv extends SelectEnv {
  readonly items: ItemFacts;
  readonly hospital: HospitalBalance;
  setFact(fact: number, value: boolean): void;
  triggerNpcRecord(npc: number, record: number): void;
  message(m: NpcMoneyMessage): void;
  calcMedicalCost(npc: number): number;
  frankCash(amount: number): void;
  kingpinInHisHouse(): boolean;
  isRpc(profile: number): boolean;
  addProfileCost(profile: number, amount: number): void;
}

function useQuote(records: readonly NpcRecord[], index: number): TalkingResult {
  const q = records[index] ?? null;
  return { opinion: q?.opinionRequired ?? 0, record: q, index };
}

function normalizedItem(env: ReceiveEnv, o: GivenObject): number {
  const ids = env.items.ids;
  const item = env.items.isGunOfRifleClass(o.item) ? ANY_RIFLE : o.item;
  if (item === ids.HEAD_2 || item === ids.HEAD_3 || item === ids.HEAD_5 || item === ids.HEAD_6 || item === ids.HEAD_7) return ids.HEAD_2;
  if (item === ids.MONEY || item === ids.SILVER || item === ids.GOLD) {
    env.setFact(o.money < LARGE_AMOUNT_MONEY ? NarrativeFact.SMALL_AMOUNT_OF_MONEY : NarrativeFact.LARGE_AMOUNT_OF_MONEY, true);
    return ids.MONEY;
  }
  if (item === ids.WINE || item === ids.BEER) return ids.ALCOHOL;
  return item;
}

function payDebt(env: ReceiveEnv, npc: number, amount: number): void {
  const p = env.profile(npc);
  if (!p) return;
  p.balance = i32(p.balance + amount);
  env.addProfileCost(npc, amount);
  if (p.balance > 0) p.balance = 0;
  env.message({ kind: 'balanceOwed', profile: npc, amount: -p.balance });
}

function darrenGivenCash(env: ReceiveEnv, o: GivenObject, records: readonly NpcRecord[]): TalkingResult {
  if (o.money < DARREN_MIN_BET) return useQuote(records, DarrenRecord.BET_TOO_LOW);
  if (o.money > DARREN_MAX_BET) return useQuote(records, DarrenRecord.BET_TOO_HIGH);
  const darren = env.profile(NarrativeProfile.DARREN);
  if (darren) darren.balance = o.money;
  env.setFact(NarrativeFact.DARREN_EXPECTING_MONEY, false);
  if (!((records[DarrenRecord.FIRST_FIGHT]?.flags ?? 0) & QuoteFlag.SAID)) return useQuote(records, DarrenRecord.FIRST_FIGHT);
  return useQuote(records, env.kingpinInHisHouse() ? DarrenRecord.KINGPIN_COMES : DarrenRecord.FOUGHT_BEFORE);
}

function angelGivenCash(env: ReceiveEnv, o: GivenObject, records: readonly NpcRecord[]): TalkingResult {
  const price = env.items.leatherJacketPrice;
  if (o.money < price) return useQuote(records, AngelRecord.TOO_LOW);
  if (o.money > price) return useQuote(records, AngelRecord.TOO_HIGH);
  return useQuote(records, AngelRecord.ACCEPTED);
}

function madameGivenCash(env: ReceiveEnv, merc: number, o: GivenObject, records: readonly NpcRecord[]): TalkingResult | null {
  if (env.profile(merc)?.sex === FEMALE) return useQuote(records, MadameRecord.FEMALE_TALKER);
  const madame = env.profile(NarrativeProfile.MADAME);
  const offers = [
    { price: MADAME_PRICES.CARLA, ok: () => env.checkFact(NarrativeFact.CARLA_AVAILABLE, 0), record: MadameRecord.CARLA },
    { price: MADAME_PRICES.CINDY, ok: () => env.checkFact(NarrativeFact.CINDY_AVAILABLE, 0), record: MadameRecord.CINDY },
    { price: MADAME_PRICES.BAMBI, ok: () => env.checkFact(NarrativeFact.BAMBI_AVAILABLE, 0), record: MadameRecord.BAMBI },
    {
      price: MADAME_PRICES.MARIA,
      ok: () => env.questValue(QuestId.RESCUE_MARIA) === QuestStatusValue.IN_PROGRESS,
      record: MadameRecord.MARIA,
    },
  ];
  const offer = offers.find((x) => (x.price.amounts as readonly number[]).includes(o.money));
  if (!offer?.ok()) return useQuote(records, MadameRecord.DEFAULT);
  if (madame) madame.npcData = i8(madame.npcData + i8(idiv(o.money, offer.price.unit)));
  env.triggerNpcRecord(NarrativeProfile.MADAME, offer.record);
  return null;
}

function vinceOrSteveGivenCash(env: ReceiveEnv, npc: number, o: GivenObject, q: NpcRecord, records: readonly NpcRecord[]) {
  const notExpecting = () => !env.checkFact(NarrativeFact.VINCE_EXPECTING_MONEY, npc);
  const p = env.profile(npc);
  if (notExpecting() && (p?.balance ?? 0) < 0 && q.actionData !== NpcAction.DONT_ACCEPT_ITEM) {
    payDebt(env, npc, o.money);
    return null;
  }
  if (notExpecting() && q.actionData !== NpcAction.DONT_ACCEPT_ITEM) {
    const justAccept = npc === NarrativeProfile.VINCE ? JUST_ACCEPT_CASH_RECORD.VINCE : JUST_ACCEPT_CASH_RECORD.STEVE;
    const record = records[justAccept] ?? null;
    return { opinion: record?.opinionRequired ?? 0, record, index: INDEX_NOT_UPDATED };
  }
  return useQuote(records, handleNpcBeingGivenMoneyByPlayer(env, npc, o.money));
}

function receivingCase(
  env: ReceiveEnv,
  npc: number,
  merc: number,
  item: number,
  o: GivenObject,
  q: NpcRecord,
  records: readonly NpcRecord[],
): TalkingResult | null {
  const money = item === env.items.ids.MONEY;
  switch (npc) {
    case NarrativeProfile.DARREN:
      return money && q.actionData === NpcAction.DARREN_GIVEN_CASH ? darrenGivenCash(env, o, records) : null;
    case NarrativeProfile.ANGEL:
      return money && q.actionData === NpcAction.ANGEL_GIVEN_CASH ? angelGivenCash(env, o, records) : null;
    case NarrativeProfile.MADAME:
      return money ? madameGivenCash(env, merc, o, records) : null;
    case NarrativeProfile.JOE:
    case NarrativeProfile.GERARD: {
      const cashAction = npc === NarrativeProfile.JOE ? NpcAction.JOE_GIVEN_CASH : NpcAction.GERARD_GIVEN_CASH;
      if (money && q.actionData !== cashAction) return null;
      return money ? useQuote(records, handleNpcBeingGivenMoneyByPlayer(env, npc, o.money)) : null;
    }
    case NarrativeProfile.STEVE:
    case NarrativeProfile.VINCE:
      return money ? vinceOrSteveGivenCash(env, npc, o, q, records) : null;
    case NarrativeProfile.WALTER:
    case NarrativeProfile.FRANK:
      return money ? useQuote(records, handleNpcBeingGivenMoneyByPlayer(env, npc, o.money)) : null;
    case NarrativeProfile.KINGPIN:
      return money && env.questValue(QuestId.KINGPIN_MONEY) === QuestStatusValue.IN_PROGRESS
        ? useQuote(records, handleNpcBeingGivenMoneyByPlayer(env, npc, o.money))
        : null;
    default: {
      const debtor = npc === NarrativeProfile.SKYRIDER || (npc !== NO_PROFILE && env.isRpc(npc));
      if (money && debtor && (env.profile(npc)?.balance ?? 0) < 0 && q.actionData !== NpcAction.DONT_ACCEPT_ITEM)
        payDebt(env, npc, o.money);
      return null;
    }
  }
}

export function npcConsiderReceivingItemFromMerc(
  env: ReceiveEnv,
  npc: number,
  merc: number,
  o: GivenObject,
  records: readonly NpcRecord[],
): TalkingResult {
  const none: TalkingResult = { opinion: 0, record: null, index: 0 };
  if (env.checkFact(NarrativeFact.NPC_IS_ENEMY, npc) && npc !== NarrativeProfile.JOE) return none;
  const desire = calcDesireToTalk(env, npc, merc, Approach.GIVINGITEM);
  const item = normalizedItem(env, o);
  env.setFact(NarrativeFact.ITEM_POOR_CONDITION, o.status < POOR_CONDITION);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) {
    const q = records[i];
    if (!q || q.requirement <= 0) continue;
    if (q.requirement !== item && q.requirement !== ACCEPT_ANY_ITEM) continue;
    if (!npcConsiderQuote(env, npc, Approach.GIVINGITEM, i, desire, records)) continue;
    return receivingCase(env, npc, merc, item, o, q, records) ?? useQuote(records, i);
  }
  return none;
}

function hospitalPayment(env: ReceiveEnv, npc: number, amount: number): number {
  const cost = env.calcMedicalCost(npc);
  const h = env.hospital;
  if (amount + h.tempBalance + h.refund >= cost) {
    let record = 0;
    if (env.checkFact(NarrativeFact.WOUNDED_MERCS_NEARBY, npc)) record = HospitalRecord.WOUNDED_MERCS;
    else if (env.checkFact(NarrativeFact.ONE_WOUNDED_MERC_NEARBY, npc)) record = HospitalRecord.ONE_WOUNDED_MERC;
    if (h.refund > 0) h.refund = i32(h.refund - cost + amount);
    h.tempBalance = 0;
    return record;
  }
  env.message({ kind: 'needsMoney', profile: npc, amount: u32(cost - amount - h.tempBalance) });
  h.tempBalance += amount;
  return HospitalRecord.NEEDS_MORE;
}

function addToBalance(env: ReceiveEnv, npc: number, amount: number): ProfileProgress | null {
  const p = env.profile(npc);
  if (p) p.balance = i32(p.balance + amount);
  return p;
}

export function handleNpcBeingGivenMoneyByPlayer(env: ReceiveEnv, npc: number, amount: number): number {
  switch (npc) {
    case NarrativeProfile.STEVE:
    case NarrativeProfile.VINCE:
      return hospitalPayment(env, npc, amount);
    case NarrativeProfile.KINGPIN: {
      const owed = -(env.profile(npc)?.balance ?? 0);
      addToBalance(env, npc, amount);
      return amount < owed ? KingpinRecord.STILL_OWED : KingpinRecord.PAID;
    }
    case NarrativeProfile.WALTER: {
      const first = (env.profile(npc)?.balance ?? 0) === 0;
      addToBalance(env, npc, amount);
      return first ? WalterRecord.FIRST : WalterRecord.AGAIN;
    }
    case NarrativeProfile.FRANK:
      env.frankCash(amount);
      return 0;
    case NarrativeProfile.GERARD:
      return (addToBalance(env, npc, amount)?.balance ?? 0) >= BIG_PAYMENT ? GerardRecord.PAID : GerardRecord.PARTIAL;
    case NarrativeProfile.JOE:
      return (addToBalance(env, npc, amount)?.balance ?? 0) >= BIG_PAYMENT ? JoeRecord.PAID : JoeRecord.PARTIAL;
    default:
      return 0;
  }
}
