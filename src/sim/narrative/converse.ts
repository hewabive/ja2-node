// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.cc ConverseFull, Converse, NPCClosePanel, TalkingMenuGiveItem, ReturnItemToPlayer,
// @src NPCTriggerNPC, TriggerNPCRecord, TriggerNPCRecordImmediately, PCsNearNPC, PCDoesFirstAidOnNPC,
// @src TriggerClosestMercWhoCanSeeNPC, TriggerNPCWithIHateYouQuote, NPCHasUnusedRecordWithGivenApproach,
// @src NPCHasUnusedHostileRecord, NPCWillingToAcceptItem, GetInfoForAbandoningEPC, TriggerNPCWithGivenApproach,
// @src NPCReachedDestination, NPCConsiderInitiatingConv; Tactical/Interface_Dialogue.cc InitiateConversationFull,
// @src HandlePendingInitConv, InternalInitiateConversation, DeleteTalkingMenu, HandleTalkingMenuEscape,
// @src TalkPanelClickCallback, TalkPanelNameRegionClickCallback, NPCGotoGridNo, NPCDoAction,
// @src SourceSoldierPointerIsValidAndReachableForGive, HandleNPCTriggerNPC, HandleNPCTrigger,
// @src HandleWaitTimerForNPCTrigger, HandleNPCGotoGridNo; TacticalAI/AIUtils.cc ClosestPC; Dialogue_Control.cc
// @src HandleDialogue (face flags).

import {
  FACT_NONE,
  IRRELEVANT,
  NO_MOVE,
  NO_QUEST,
  NO_QUOTE,
  type NpcRecord,
  NUM_NPC_QUOTE_RECORDS,
  QuoteFlag,
  requiredGridNo,
  TRIGGER_CLOSEST_MERC,
  TRIGGER_SELF,
  UiCode,
} from '../../content/formats/npc.ts';
import { Approach, NO_PROFILE, NpcAction, StandardQuote } from '../../content/narrative/npc-constants.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { u8 } from '../../core/int.ts';
import { AiAction } from '../tactical/ai/actions.ts';
import { cancelAIAction } from '../tactical/ai/control.ts';
import { initNewSoldierAnim, states } from '../tactical/animation.ts';
import { findAdjacentGridEx } from '../tactical/combat/melee-reach.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from '../tactical/narrative/civ-hostility.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { AlertStatus, NOWHERE, OKBREATH, OKLIFE, Side, type Soldier, Team } from '../tactical/soldier.ts';
import { teamMembers, whoIsThere } from '../tactical/state.ts';
import {
  addDialogueEvent,
  cutTalkingFace,
  type DialogueHandlers,
  faceFinished,
  finishTalking,
  handleDialogue,
  soldierByProfile,
  tacticalCharacterDialogue,
  talkingMenuDialogue,
} from './dialogue-queue.ts';
import type { NarrativeHost } from './host.ts';
import {
  ASSASSIN_PROFILES,
  DARREN_RULES_RECORD,
  GET_LOST_ENEMIES,
  MIGUEL_LET_GO_RECORD,
  NarrativeFact,
  NarrativeProfile,
  ProfileFlag,
  ProfileFlag2,
  QUOTE_RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO,
} from './narrative-ids.ts';
import {
  actionIdForMovementRecord,
  ensureQuoteFileLoaded,
  isRpc,
  recordHasDialogue,
  resetOncePerConvoRecords,
  resetOncePerConvoRecordsForNpc,
} from './records.ts';
import {
  type GivenObject,
  npcConsiderQuote,
  npcConsiderReceivingItemFromMerc,
  npcConsiderTalking,
  type ReceiveEnv,
  type SelectEnv,
  type TalkingResult,
} from './select.ts';
import { dialogueQueueIsEmptyAndNobodyIsTalking, type GiftObject } from './talk-state.ts';

export const TRIGGER_WAIT_MS = 500;
const MAX_DISTANCE_VISIBLE = 26;
const UNSEEN_PC_DISTANCE_PENALTY = 10;
const WORLD_MAX_DISTANCE = 25600;
const GIVE_MENU_WAIT_MS = 10000;
const ON_DUTY = 20;

export function selectEnv(host: NarrativeHost): SelectEnv {
  return {
    day: host.day(),
    profile: (id) => host.profile(id),
    checkFact: (fact, npc) => host.facts.checkFact(fact, npc),
    questValue: (index) => host.questValue(index),
    townRating: (town) => host.townRating(town),
    npcGridNo: (npc) => soldierByProfile(host, npc)?.gridNo ?? null,
    threat: (merc) => host.threat(merc),
    hasItemInProfile: (npc, item) => {
      const p = host.profile(npc);
      return !!p && p.inventory.some((it, k) => it === item && (p.inventoryCount[k] ?? 0) !== 0);
    },
  };
}

export function receiveEnv(host: NarrativeHost): ReceiveEnv {
  const r = host.receive;
  return {
    ...selectEnv(host),
    items: r.items,
    hospital: r.hospital,
    setFact: (fact, value) => host.setFact(fact, value),
    triggerNpcRecord: (npc, record) => triggerNpcRecord(host, npc, record),
    message: (m) => r.message(m),
    calcMedicalCost: (npc) => r.calcMedicalCost(npc),
    frankCash: (amount) => r.frankCash(amount),
    kingpinInHisHouse: () => r.kingpinInHisHouse(),
    isRpc: (profile) => isRpc(host, profile),
    addProfileCost: (profile, amount) => r.addProfileCost(profile, amount),
  };
}

function soldierById(host: NarrativeHost, id: number | null): Soldier | null {
  if (id === null) return null;
  const s = host.tactical()?.soldiers[id] ?? null;
  return s?.placed ? s : null;
}

export function panelSoldier(host: NarrativeHost): Soldier | null {
  return soldierById(host, host.context.dest);
}

export function talkerSoldier(host: NarrativeHost): Soldier | null {
  return soldierById(host, host.context.src);
}

export function npcClosePanel(host: NarrativeHost): void {
  addDialogueEvent(host, { kind: 'closePanel' });
}

export function npcDoAction(host: NarrativeHost, npc: number, code: number, record: number): void {
  addDialogueEvent(host, { kind: 'doAction', npc, code, record });
}

export function npcGotoGridNo(host: NarrativeHost, npc: number, gridNo: number, record: number): void {
  addDialogueEvent(host, { kind: 'goto', npc, gridNo, record });
}

function npcTriggerNpc(host: NarrativeHost, npc: number, record: number, approach: number, show: boolean): void {
  addDialogueEvent(host, { kind: 'triggerNpc', npc, record, approach, show });
}

function returnItemToPlayer(host: NarrativeHost, merc: number, object: GiftObject | null): void {
  if (object) host.give.returnItemToPlayer(merc, object);
}

function zapAiDelay(s: Soldier | null): void {
  if (!s) return;
  s.ai.counter = 0;
  if (s.ai.nextAction === AiAction.WAIT) {
    s.ai.nextAction = AiAction.NONE;
    s.ai.nextActionData = 0;
  }
}

function sectorNotSafeOverride(host: NarrativeHost, npc: number, approach: number): number {
  if (host.facts.checkFact(NarrativeFact.CURRENT_SECTOR_IS_SAFE, npc)) return approach;
  const exempt =
    approach === Approach.TRIGGER_NPC ||
    approach === Approach.GIVEFIRSTAID ||
    approach === Approach.DECLARATION_OF_HOSTILITY ||
    approach === Approach.ENEMY_NPC_QUOTE;
  if (exempt || !npcHasUnusedRecordWithGivenApproach(host, npc, Approach.SECTOR_NOT_SAFE)) return approach;
  return Approach.SECTOR_NOT_SAFE;
}

function considerTalking(host: NarrativeHost, npc: number, merc: number, approach: number, record: number, records: NpcRecord[]) {
  return npcConsiderTalking(selectEnv(host), npc, merc, approach, record, records);
}

function foundRecord(result: TalkingResult): boolean {
  return result.record !== null;
}

function initialQuote(host: NarrativeHost, npc: number, merc: number, records: NpcRecord[], object: GiftObject | null): boolean {
  const p = host.profile(npc);
  resetOncePerConvoRecords(records);
  const darrenRule = records[DARREN_RULES_RECORD];
  if (npc === NarrativeProfile.DARREN && darrenRule && !host.facts.checkFact(NarrativeFact.DARREN_EXPLAINED_RULES, npc))
    darrenRule.flags &= ~QuoteFlag.SAID;
  npcDoAction(host, npc, NpcAction.TURN_TO_FACE_NEAREST_MERC, 1);
  let quote: number;
  if ((p?.lastDateSpokenTo ?? 0) > 0) {
    if (host.day() <= (p?.lastDateSpokenTo ?? 0)) {
      returnItemToPlayer(host, merc, object);
      return false;
    }
    if (foundRecord(considerTalking(host, npc, merc, Approach.SPECIAL_INITIAL_QUOTE, 0, records))) {
      returnItemToPlayer(host, merc, object);
      converse(host, npc, merc, Approach.SPECIAL_INITIAL_QUOTE);
      return false;
    }
    quote = StandardQuote.SUBS_INTRO;
  } else {
    for (const approach of [Approach.SPECIAL_INITIAL_QUOTE, Approach.INITIAL_QUOTE]) {
      if (!foundRecord(considerTalking(host, npc, merc, approach, 0, records))) continue;
      returnItemToPlayer(host, merc, object);
      converse(host, npc, merc, approach);
      return false;
    }
    quote = StandardQuote.INTRO;
  }
  talkingMenuDialogue(host, quote);
  if (p) {
    p.lastQuoteSaid = quote;
    p.lastQuoteSaidWasSpecial = false;
  }
  return true;
}

function repeatQuote(host: NarrativeHost, npc: number, records: NpcRecord[]): void {
  const p = host.profile(npc);
  if (!p || p.lastQuoteSaid === NO_QUOTE) {
    talkingMenuDialogue(host, StandardQuote.INTRO);
    return;
  }
  if (!p.lastQuoteSaidWasSpecial) {
    talkingMenuDialogue(host, p.lastQuoteSaid);
    return;
  }
  const q = records[p.lastQuoteSaid];
  for (let k = 0; k < (q?.numQuotes ?? 0); k++) talkingMenuDialogue(host, u8((q?.quoteNum ?? 0) + k), p.lastQuoteSaid);
}

function givingItemIntroduction(host: NarrativeHost, npc: number, merc: number, records: NpcRecord[]): boolean {
  const p = host.profile(npc);
  if ((p?.lastDateSpokenTo ?? 0) > 0) {
    if (
      host.day() > (p?.lastDateSpokenTo ?? 0) &&
      foundRecord(considerTalking(host, npc, merc, Approach.SPECIAL_INITIAL_QUOTE, 0, records))
    ) {
      converse(host, npc, merc, Approach.SPECIAL_INITIAL_QUOTE);
      if (npc === NarrativeProfile.DARREN) return false;
    }
  } else if (foundRecord(considerTalking(host, npc, merc, Approach.INITIAL_QUOTE, 0, records))) {
    converse(host, npc, merc, Approach.INITIAL_QUOTE);
  }
  return true;
}

function giftAsGiven(object: GiftObject): GivenObject {
  return { item: object.item, money: object.money, status: object.status[0] ?? 0, count: object.count };
}

function defaultQuote(host: NarrativeHost, npc: number, approach: number): number | null {
  const p = host.profile(npc);
  switch (approach) {
    case Approach.FRIENDLY:
    case Approach.DIRECT: {
      if (p?.friendlyOrDirectDefaultResponseUsedRecently) return StandardQuote.GETLOST;
      const quote = approach === Approach.FRIENDLY ? StandardQuote.FRIENDLY_DEFAULT1 + host.random(2) : StandardQuote.DIRECT_DEFAULT;
      if (p) p.friendlyOrDirectDefaultResponseUsedRecently = 1;
      return quote;
    }
    case Approach.THREATEN:
      if (p?.threatenDefaultResponseUsedRecently) return StandardQuote.GETLOST;
      if (p) p.threatenDefaultResponseUsedRecently = 1;
      return StandardQuote.THREATEN_DEFAULT;
    case Approach.RECRUIT:
      if (p?.recruitDefaultResponseUsedRecently) return StandardQuote.GETLOST;
      if (p) p.recruitDefaultResponseUsedRecently = 1;
      return StandardQuote.RECRUIT_NO;
    case Approach.GIVINGITEM:
      return StandardQuote.GIVEITEM_NO;
    case Approach.TRIGGER_NPC:
      return null;
    default:
      return StandardQuote.INTRO;
  }
}

function sayDefaultQuote(host: NarrativeHost, npc: number, quote: number): void {
  const p = host.profile(npc);
  talkingMenuDialogue(host, quote);
  if (p) {
    p.lastQuoteSaid = quote;
    p.lastQuoteSaidWasSpecial = false;
  }
  if (quote === StandardQuote.GETLOST) {
    if (GET_LOST_ENEMIES.has(npc)) npcDoAction(host, npc, NpcAction.BECOME_ENEMY, 0);
    npcClosePanel(host);
  } else if (quote === StandardQuote.GIVEITEM_NO) {
    npcClosePanel(host);
    const s = soldierByProfile(host, npc);
    const t = host.tactical();
    if (s && t && ASSASSIN_PROFILES.has(npc)) {
      cancelAIAction(t, s);
      addToShouldBecomeHostileOrSayQuoteList(t, s);
    }
  }
}

function applyUiCode(host: NarrativeHost, code: number): void {
  const talk = host.talk;
  const inCombat = host.tactical()?.inCombat === true;
  switch (code) {
    case UiCode.TURN_UI_OFF:
      if (inCombat) return;
      host.setEngaged(true);
      talk.referenceCount = 1;
      return;
    case UiCode.TURN_UI_ON:
      if (talk.specialReferenceCount !== 0) return;
      host.setEngaged(false);
      talk.referenceCount = 0;
      return;
    case UiCode.SPECIAL_TURN_UI_OFF:
      if (inCombat) return;
      host.setEngaged(true);
      talk.referenceCount = 1;
      if (talk.specialReferenceCount < 0) talk.specialReferenceCount = 0;
      talk.specialReferenceCount++;
      return;
    case UiCode.SPECIAL_TURN_UI_ON:
      talk.specialReferenceCount--;
      if (talk.specialReferenceCount === 0) {
        host.setEngaged(false);
        talk.referenceCount = 0;
      } else if (talk.specialReferenceCount < 0) talk.specialReferenceCount = 0;
      return;
  }
}

function giveGift(host: NarrativeHost, npc: number, item: number): void {
  const s = soldierByProfile(host, npc);
  if (!s) return;
  const slot = s.inv.findIndex((o) => o?.item === item && o.count > 0);
  if (slot >= 0) addDialogueEvent(host, { kind: 'giveItem', npc, slot });
}

function recordMovement(host: NarrativeHost, npc: number, q: NpcRecord, index: number): void {
  if (q.goToGridNo === NO_MOVE) return;
  const s = soldierByProfile(host, npc);
  const t = host.tactical();
  if (s && npc === NarrativeProfile.KYLE) s.hasKeys = true;
  if (s && s.gridNo === q.goToGridNo) {
    s.quoteRecord = index + 1;
    npcReachedDestination(host, s, true);
    return;
  }
  if (s && t) {
    if (s.cowering) initNewSoldierAnim(t, s, states(t.content.animations).STANDING, 0, false);
    s.quoteRecord = index + 1;
  }
  if (s && q.actionData === NpcAction.TELEPORT_NPC) {
    host.teleport(s, q.goToGridNo);
    npcReachedDestination(host, s, false);
    return;
  }
  const p = host.profile(npc);
  if (q.actionData === NpcAction.REMOVE_NPC && p) {
    p.sectorX = 0;
    p.sectorY = 0;
    p.sectorZ = 0;
  }
  npcGotoGridNo(host, npc, q.goToGridNo, index);
}

function recordTriggers(host: NarrativeHost, npc: number, q: NpcRecord): void {
  if (q.triggerNpc === IRRELEVANT) return;
  if (q.triggerNpc === TRIGGER_CLOSEST_MERC) triggerClosestMercWhoCanSeeNpc(host, npc, q);
  else if (q.triggerNpc === TRIGGER_SELF) triggerNpcRecord(host, npc, q.triggerNpcRecord);
  else triggerNpcRecord(host, q.triggerNpc, q.triggerNpcRecord);
}

function applyRecord(host: NarrativeHost, npc: number, merc: number, approach: number, result: TalkingResult, object: GiftObject | null) {
  const q = result.record as NpcRecord;
  const index = result.index;
  const p = host.profile(npc);
  const s = soldierByProfile(host, npc);
  if (q.actionData <= -NpcAction.TURN_TO_FACE_NEAREST_MERC) {
    zapAiDelay(s);
    npcDoAction(host, npc, -q.actionData, index);
  }
  if (q.quoteNum !== NO_QUOTE) {
    for (let k = 0; k < q.numQuotes; k++) talkingMenuDialogue(host, u8(q.quoteNum + k), index);
    if (p) {
      p.lastQuoteSaid = index;
      p.lastQuoteSaidWasSpecial = true;
    }
  }
  if (q.flags & (QuoteFlag.ERASE_ONCE_SAID | QuoteFlag.SAY_ONCE_PER_CONVO)) q.flags |= QuoteFlag.SAID;
  if (approach === Approach.GIVINGITEM && q.actionData !== NpcAction.DONT_ACCEPT_ITEM && object)
    host.give.placeObjectInSoldierProfile(npc, object, merc);
  if (q.setFactTrue !== FACT_NONE) host.setFact(q.setFactTrue, true);
  if (q.endQuest !== NO_QUEST) host.quests.endQuest(q.endQuest, host.worldSector());
  if (q.startQuest !== NO_QUEST) host.quests.startQuest(q.startQuest, host.worldSector());
  if (q.giftItem >= UiCode.TURN_UI_OFF) applyUiCode(host, q.giftItem);
  else if (q.giftItem !== 0) giveGift(host, npc, q.giftItem);
  if (q.actionData < 0 && q.actionData > -NpcAction.TURN_TO_FACE_NEAREST_MERC) {
    zapAiDelay(s);
    npcDoAction(host, npc, -q.actionData, index);
  } else if (q.goToGridNo === NO_MOVE && q.actionData > 0) {
    zapAiDelay(s);
    npcDoAction(host, npc, q.actionData, index);
  }
  recordMovement(host, npc, q, index);
  recordTriggers(host, npc, q);
}

const LAST_DATE_APPROACHES: ReadonlySet<number> = new Set([
  Approach.FRIENDLY,
  Approach.DIRECT,
  Approach.THREATEN,
  Approach.RECRUIT,
  Approach.NPC_INITIATING_CONV,
  Approach.NPC_INITIAL_QUOTE,
  Approach.SPECIAL_INITIAL_QUOTE,
  Approach.DECLARATION_OF_HOSTILITY,
  Approach.INITIAL_QUOTE,
  Approach.GIVINGITEM,
]);

function chooseRecord(
  host: NarrativeHost,
  npc: number,
  merc: number,
  approach: number,
  record: number,
  object: GiftObject | null,
  records: NpcRecord[],
): TalkingResult | 'stop' {
  if (approach === Approach.GIVINGITEM) {
    if (!givingItemIntroduction(host, npc, merc, records)) {
      returnItemToPlayer(host, merc, object);
      return 'stop';
    }
    if (!object) return { opinion: 0, record: null, index: 0 };
    return npcConsiderReceivingItemFromMerc(receiveEnv(host), npc, merc, giftAsGiven(object), records);
  }
  return considerTalking(host, npc, merc, approach, approach === Approach.TRIGGER_NPC ? record : 0, records);
}

export function converseFull(
  host: NarrativeHost,
  npc: number,
  merc: number,
  approachIn: number,
  record = 0,
  object: GiftObject | null = null,
): void {
  const s = soldierByProfile(host, npc);
  let approach = approachIn;
  if (s) {
    s.timeSinceLastSpoke = host.tactical()?.clockMs ?? 0;
    approach = sectorNotSafeOverride(host, npc, approach);
    s.ai.asleep = false;
  }
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) {
    returnItemToPlayer(host, merc, object);
    return;
  }
  let accepted: TalkingResult | null = null;
  switch (approach) {
    case Approach.NPC_INITIAL_QUOTE:
      if (!initialQuote(host, npc, merc, records, object)) return;
      break;
    case Approach.NPC_WHOAREYOU:
      talkingMenuDialogue(host, StandardQuote.INTRO);
      break;
    case Approach.REPEAT:
      repeatQuote(host, npc, records);
      break;
    default: {
      const result = chooseRecord(host, npc, merc, approach, record, object, records);
      if (result === 'stop') return;
      if (result.record === null) {
        const quote = defaultQuote(host, npc, approach);
        if (quote === null) return;
        sayDefaultQuote(host, npc, quote);
      } else {
        accepted = result;
        applyRecord(host, npc, merc, approach, result, object);
      }
    }
  }
  const p = host.profile(npc);
  if (p && LAST_DATE_APPROACHES.has(approach)) p.lastDateSpokenTo = u8(host.day());
  if (approach !== Approach.GIVINGITEM || !accepted || accepted.record?.actionData === NpcAction.DONT_ACCEPT_ITEM)
    returnItemToPlayer(host, merc, object);
}

export function converse(host: NarrativeHost, npc: number, merc: number, approach: number): void {
  converseFull(host, npc, merc, approach, 0, null);
}

export function triggerNpcRecord(host: NarrativeHost, npc: number, record: number): void {
  const records = ensureQuoteFileLoaded(host, npc);
  const q = records?.[record];
  if (!records || !q) return;
  if (npcConsiderQuote(selectEnv(host), npc, Approach.TRIGGER_NPC, record, 0, records))
    npcTriggerNpc(host, npc, record, Approach.TRIGGER_NPC, q.quoteNum !== IRRELEVANT);
}

export function triggerNpcRecordImmediately(host: NarrativeHost, npc: number, record: number): void {
  const records = ensureQuoteFileLoaded(host, npc);
  const q = records?.[record];
  if (!records || !q) return;
  if (npcConsiderQuote(selectEnv(host), npc, Approach.TRIGGER_NPC, record, 0, records))
    handleNpcTriggerNpc(host, npc, record, q.quoteNum !== IRRELEVANT, Approach.TRIGGER_NPC);
}

function firstRecordWithApproach(host: NarrativeHost, npc: number, approach: number): { records: NpcRecord[]; index: number } | null {
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) return null;
  const env = selectEnv(host);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) if (npcConsiderQuote(env, npc, approach, i, 0, records)) return { records, index: i };
  return null;
}

export function npcHasUnusedRecordWithGivenApproach(host: NarrativeHost, npc: number, approach: number): boolean {
  return firstRecordWithApproach(host, npc, approach) !== null;
}

export function npcHasUnusedHostileRecord(host: NarrativeHost, npc: number): boolean {
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) return false;
  const env = selectEnv(host);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) {
    if (!npcConsiderQuote(env, npc, Approach.DECLARATION_OF_HOSTILITY, i, 0, records)) continue;
    if (records[i]?.factMustBeTrue === NarrativeFact.NPC_HOSTILE_OR_PISSED_OFF) continue;
    return true;
  }
  return false;
}

export function triggerNpcWithIHateYouQuote(host: NarrativeHost, npc: number): boolean {
  const found = firstRecordWithApproach(host, npc, Approach.DECLARATION_OF_HOSTILITY);
  if (!found) return false;
  npcTriggerNpc(host, npc, found.index, Approach.DECLARATION_OF_HOSTILITY, true);
  const p = host.profile(npc);
  if (p) p.miscFlags |= ProfileFlag.SAID_HOSTILE_QUOTE;
  return true;
}

export function triggerNpcWithGivenApproach(host: NarrativeHost, npc: number, approach: number): boolean {
  const found = firstRecordWithApproach(host, npc, approach);
  if (!found) return false;
  npcTriggerNpc(host, npc, found.index, approach, found.records[found.index]?.quoteNum !== IRRELEVANT);
  return true;
}

export function getInfoForAbandoningEpc(host: NarrativeHost, npc: number): { quote: number; fact: number } | null {
  const found = firstRecordWithApproach(host, npc, Approach.EPC_IN_WRONG_SECTOR);
  const q = found?.records[found.index];
  return q ? { quote: q.quoteNum, fact: q.setFactTrue } : null;
}

export function npcWillingToAcceptItem(host: NarrativeHost, npc: number, merc: number, object: GiftObject): boolean {
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) return false;
  return npcConsiderReceivingItemFromMerc(receiveEnv(host), npc, merc, giftAsGiven(object), records).record !== null;
}

function triggerFirstTileRecord(host: NarrativeHost, npc: number, s: Soldier, records: NpcRecord[], already: boolean): boolean {
  const env = selectEnv(host);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) {
    const q = records[i];
    if (!q || s.gridNo !== requiredGridNo(q)) continue;
    if (!npcConsiderQuote(env, npc, Approach.TRIGGER_NPC, i, 0, records)) continue;
    if (already) triggerNpcRecord(host, npc, i);
    else triggerNpcRecordImmediately(host, npc, i);
    return true;
  }
  return false;
}

export function pcsNearNpc(host: NarrativeHost, npc: number): void {
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) return;
  host.setFact(NarrativeFact.PC_NEAR, true);
  const s = soldierByProfile(host, npc);
  if (!s) return;
  s.quoteRecord = 0;
  triggerFirstTileRecord(host, npc, s, records, false);
  host.setFact(NarrativeFact.PC_NEAR, false);
}

export function pcDoesFirstAidOnNpc(host: NarrativeHost, npc: number): boolean {
  const records = ensureQuoteFileLoaded(host, npc);
  const s = soldierByProfile(host, npc);
  if (!records || !s) return false;
  s.quoteRecord = 0;
  const p = host.profile(npc);
  if (p) p.miscFlags2 |= ProfileFlag2.BANDAGED_TODAY;
  const env = selectEnv(host);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) {
    if (records[i]?.approachRequired !== Approach.GIVEFIRSTAID) continue;
    if (!npcConsiderQuote(env, npc, Approach.TRIGGER_NPC, i, 0, records)) continue;
    triggerNpcRecordImmediately(host, npc, i);
    return true;
  }
  return false;
}

function triggerClosestMercWhoCanSeeNpc(host: NarrativeHost, npc: number, q: NpcRecord): void {
  const s = soldierByProfile(host, npc);
  const t = host.tactical();
  if (!s || !t) return;
  const candidates = teamMembers(t, Team.OUR).filter((m) => m.life >= OKLIFE && host.onSquad(m) && m.oppList[s.id] === Opp.SEEN_CURRENTLY);
  if (candidates.length === 0) return;
  const chosen = candidates[host.talk.fx.int(candidates.length)] as Soldier;
  npcClosePanel(host);
  if (q.triggerNpcRecord === QUOTE_RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO) {
    addDialogueEvent(host, {
      kind: 'pcTriggerNpc',
      speaker: chosen.profile,
      quote: QUOTE_RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO,
      npc: NarrativeProfile.MIGUEL,
      record: MIGUEL_LET_GO_RECORD,
    });
    host.talk.referenceCount++;
  } else tacticalCharacterDialogue(host, chosen, q.triggerNpcRecord);
}

export function closestPC(host: NarrativeHost, s: Soldier): number {
  const t = host.tactical();
  if (!t) return NOWHERE;
  let best = WORLD_MAX_DISTANCE;
  let gridNo = NOWHERE;
  for (const m of teamMembers(t, Team.OUR)) {
    if (!m.placed || m.life < OKLIFE || host.isEpc(m)) continue;
    let d = pythSpacesAway(s.gridNo, m.gridNo);
    if (m.team !== s.team && s.oppList[m.id] !== Opp.SEEN_CURRENTLY) d += UNSEEN_PC_DISTANCE_PENALTY;
    if (d < best) {
      best = d;
      gridNo = m.gridNo;
    }
  }
  return gridNo;
}

export function sourceSoldierValidAndReachableForGive(host: NarrativeHost, giver: Soldier | null): boolean {
  const src = talkerSoldier(host);
  const t = host.tactical();
  if (!src || !giver || !t) return false;
  if (src.life < OKLIFE || (src.breath < OKBREATH && src.collapsed)) return false;
  if (pythSpacesAway(giver.gridNo, src.gridNo) > MAX_DISTANCE_VISIBLE) return false;
  return findAdjacentGridEx(t, giver, src.gridNo, false) !== null;
}

export function handleNpcTriggerNpc(host: NarrativeHost, npc: number, record: number, show: boolean, approach: number): void {
  const s = soldierByProfile(host, npc);
  if (!s) return;
  const talk = host.talk;
  talk.trigger = { npc, record, approach, show };
  if (s.team === Team.OUR) {
    s.ai.alertStatus = AlertStatus.GREEN;
    s.engagedInAction = false;
  }
  if (talk.inPanel && host.context.dest === s.id && show) {
    handleNpcTrigger(host);
    return;
  }
  if (show) {
    talk.waitingForTrigger = true;
    talk.triggerWaitStart = host.tactical()?.clockMs ?? 0;
  } else handleNpcTrigger(host);
  if (recordHasDialogue(host, npc, record)) deleteTalkingMenu(host, 'script');
}

function handleNpcTrigger(host: NarrativeHost): void {
  const target = host.talk.trigger;
  if (!target) return;
  const s = soldierByProfile(host, target.npc);
  if (!s) return;
  const { npc, record, approach, show } = target;
  if (host.talk.inPanel) {
    if (host.context.dest !== s.id) converseFull(host, npc, NO_PROFILE, approach, record);
    else if (show) converseFull(host, npc, NO_PROFILE, approach, record);
    else {
      const src = talkerSoldier(host);
      if (src) initiateConversationFull(host, s, src, approach, record, null, host.talk.initiatedBy);
    }
    return;
  }
  if (!show) {
    converseFull(host, npc, NO_PROFILE, approach, record);
    return;
  }
  if (sourceSoldierValidAndReachableForGive(host, s)) {
    initiateConversationFull(host, s, talkerSoldier(host), approach, record, null, 'npc');
    return;
  }
  const g = closestPC(host, s);
  const t = host.tactical();
  const player = g !== NOWHERE && t ? whoIsThere(t, g, 0) : null;
  initiateConversationFull(host, s, player ?? s, approach, record, null, 'npc');
}

export function handleWaitTimerForNpcTrigger(host: NarrativeHost): void {
  const talk = host.talk;
  if (!talk.waitingForTrigger) return;
  if ((host.tactical()?.clockMs ?? 0) - talk.triggerWaitStart <= TRIGGER_WAIT_MS) return;
  handleNpcTrigger(host);
  talk.waitingForTrigger = false;
}

export function handleNpcGotoGridNo(host: NarrativeHost, npc: number, gridNo: number, record: number): void {
  deleteTalkingMenu(host, 'script');
  const s = soldierByProfile(host, npc);
  const t = host.tactical();
  if (!s || !t) return;
  zapAiDelay(s);
  if (s.team === Team.OUR) s.underAiControl = true;
  s.ai.nextAction = AiAction.WALK;
  s.ai.nextActionData = gridNo;
  if (s.ai.action !== AiAction.PENDING_ACTION) cancelAIAction(t, s);
  s.quoteRecord = record + 1;
  s.quoteActionId = actionIdForMovementRecord(host, npc, record);
  s.absoluteFinalDestination = gridNo;
  s.ai.handleEveryFrame = true;
}

function keepOnlyHandleEveryFrameAiFlag(s: Soldier): void {
  s.ai.cautious = false;
  s.ai.asleep = false;
  s.ai.lockDoorIncludesClose = false;
  s.ai.checkSchedule = false;
}

export function npcReachedDestination(host: NarrativeHost, s: Soldier, already: boolean): void {
  const record = s.quoteRecord === 0 ? 0 : s.quoteRecord - 1;
  s.quoteRecord = 0;
  if (s.team === Team.OUR) {
    s.underAiControl = false;
    keepOnlyHandleEveryFrameAiFlag(s);
  }
  const npc = s.profile;
  const records = ensureQuoteFileLoaded(host, npc);
  if (!records) return;
  const q = records[record];
  if (q && s.gridNo === q.goToGridNo && q.actionData > 0) npcDoAction(host, npc, q.actionData, record);
  triggerFirstTileRecord(host, npc, s, records, already);
}

function assignedBelowDuty(host: NarrativeHost, s: Soldier): boolean {
  return s.team !== Team.OUR || host.onSquad(s);
}

export function npcConsiderInitiatingConv(host: NarrativeHost, npcSoldier: Soldier): number {
  const npc = npcSoldier.profile;
  const records = ensureQuoteFileLoaded(host, npc);
  const t = host.tactical();
  if (!records || !t) return NOWHERE;
  let best = 0;
  let bestDistance = 100;
  let target: Soldier | null = null;
  for (const m of t.mercSlots) {
    if (!m || m.side !== Side.FRIENDLY || !assignedBelowDuty(host, m)) continue;
    if (npcSoldier.oppList[m.id] !== Opp.SEEN_CURRENTLY) continue;
    const desire = npcConsiderTalking(selectEnv(host), npc, m.profile, Approach.NPC_INITIATING_CONV, 0, records).opinion;
    if (desire === 0) continue;
    const d = pythSpacesAway(npcSoldier.gridNo, m.gridNo);
    if (desire > best) {
      best = desire;
      target = m;
      bestDistance = d;
    } else if (desire === best && d < bestDistance) {
      target = m;
      bestDistance = d;
    }
  }
  return target ? target.gridNo : NOWHERE;
}

export function initiateConversationFull(
  host: NarrativeHost,
  dest: Soldier,
  src: Soldier | null,
  approach: number,
  record: number,
  object: GiftObject | null,
  initiatedBy: 'player' | 'npc',
): boolean {
  const talk = host.talk;
  if (dialogueQueueIsEmptyAndNobodyIsTalking(talk)) {
    internalInitiateConversation(host, dest, src, approach, record, object, initiatedBy, false);
    return true;
  }
  talk.pending = { dest: dest.id, src: src?.id ?? null, approach, record, object, initiatedBy };
  host.setEngaged(true);
  return false;
}

export function handlePendingInitConv(host: NarrativeHost): void {
  const pending = host.talk.pending;
  if (!pending) return;
  const dest = soldierById(host, pending.dest);
  if (!dest) {
    host.talk.pending = null;
    return;
  }
  internalInitiateConversation(
    host,
    dest,
    soldierById(host, pending.src),
    pending.approach,
    pending.record,
    pending.object,
    pending.initiatedBy,
    true,
  );
}

function internalInitiateConversation(
  host: NarrativeHost,
  dest: Soldier,
  src: Soldier | null,
  approach: number,
  record: number,
  object: GiftObject | null,
  initiatedBy: 'player' | 'npc',
  fromPending: boolean,
): void {
  const talk = host.talk;
  talk.pending = null;
  if (talk.inPanel) deleteTalkingMenu(host, 'script');
  talk.inPanel = true;
  talk.charNum = dest.profile;
  talk.initiatedBy = initiatedBy;
  talk.lines.length = 0;
  host.context.src = src?.id ?? null;
  host.context.dest = dest.id;
  host.context.srcProfile = src ? src.profile : NO_PROFILE;
  const t = host.tactical();
  if (src && src.team === Team.OUR && t && t.turn.currentTeam === Team.OUR) host.selectTalker(src);
  host.emit({ type: 'conversationOpened', npc: dest.id, profile: dest.profile, talker: src?.id ?? null, initiatedBy });
  converseFull(host, talk.charNum, host.context.srcProfile, approach, record, object);
  if (!fromPending) host.setEngaged(true);
}

function sayLaterAtPanelClose(host: NarrativeHost): void {
  const talk = host.talk;
  if (!host.facts.checkFact(NarrativeFact.NEED_TO_SAY_SOMETHING, 0)) return;
  if (talk.queue.length > 0 || talk.waitingForTrigger) return;
  const nice = talk.niceNpc !== NO_PROFILE;
  const npc = nice ? talk.niceNpc : talk.nastyNpc;
  if (npc === NO_PROFILE) return;
  const s = soldierByProfile(host, npc);
  if (!s) return;
  host.mercLines.sayLater(s, nice);
  talk.niceNpc = NO_PROFILE;
  talk.nastyNpc = NO_PROFILE;
  host.setFact(NarrativeFact.NEED_TO_SAY_SOMETHING, false);
}

export function deleteTalkingMenu(host: NarrativeHost, by: 'player' | 'script'): void {
  const talk = host.talk;
  if (!talk.inPanel) return;
  talk.inPanel = false;
  const dest = panelSoldier(host);
  if (dest) dest.engagedInAction = false;
  if (talk.referenceCount === 0) host.setEngaged(false);
  sayLaterAtPanelClose(host);
  host.emit({ type: 'conversationClosed', npc: dest?.id ?? null, profile: talk.charNum, by });
}

export function handleTalkingMenuEscape(host: NarrativeHost): boolean {
  const talk = host.talk;
  if (!talk.inPanel || talk.queue.length > 0) return false;
  const profile = panelSoldier(host)?.profile ?? talk.charNum;
  deleteTalkingMenu(host, 'player');
  resetOncePerConvoRecordsForNpc(host, profile);
  return true;
}

export function talkMenuBuySell(host: NarrativeHost): 'record' | 'shop' {
  const npc = host.talk.charNum;
  if (npcHasUnusedRecordWithGivenApproach(host, npc, Approach.BUYSELL)) {
    triggerNpcWithGivenApproach(host, npc, Approach.BUYSELL);
    return 'record';
  }
  deleteTalkingMenu(host, 'script');
  host.openShop(npc);
  return 'shop';
}

export function talkMenuGive(host: NarrativeHost): void {
  const dest = panelSoldier(host);
  const t = host.tactical();
  if (!handleTalkingMenuEscape(host) || !dest || !t) return;
  dest.ai.nextAction = AiAction.WAIT;
  dest.ai.nextActionData = GIVE_MENU_WAIT_MS;
  if (dest.ai.action !== AiAction.PENDING_ACTION) cancelAIAction(t, dest);
}

export function talkMenuApproach(host: NarrativeHost, approach: number): void {
  converse(host, host.talk.charNum, host.context.srcProfile, approach);
}

export function onSquadBelowDuty(assignment: number): boolean {
  return assignment < ON_DUTY;
}

export function dialogueHandlers(host: NarrativeHost): DialogueHandlers {
  return {
    handlePendingInitConv: () => handlePendingInitConv(host),
    deleteTalkingMenu: () => deleteTalkingMenu(host, 'script'),
    handleNpcItemGiven: (npc, slot) => host.give.handleNpcItemGiven(npc, slot),
    handleNpcTriggerNpc: (npc, record, show, approach) => handleNpcTriggerNpc(host, npc, record, show, approach),
    handleNpcGotoGridNo: (npc, gridNo, record) => handleNpcGotoGridNo(host, npc, gridNo, record),
    handleNpcDoAction: (npc, code, record) => host.actions.handleNpcDoAction(npc, code, record),
    triggerNpcRecord: (npc, record) => triggerNpcRecord(host, npc, record),
    mikeCheck: () => host.mercLines.mikeSaysHi(),
    autoBandage: () => false,
    removeEpc: (npc) => host.releaseEscort?.(npc),
    callback: (name) => host.dialogueCallback?.(name),
  };
}

export function stepDialogue(host: NarrativeHost): void {
  handleDialogue(host, dialogueHandlers(host));
}

export function shutUpTalkingFace(host: NarrativeHost): boolean {
  const face = host.talk.face;
  if (!face || !cutTalkingFace(host.talk, host.tick())) return false;
  host.emit({ type: 'lineCut', profile: face.speaker, saidAt: face.saidAt, tail: false });
  faceFinished(host, dialogueHandlers(host));
  return true;
}

export function finishTalkingFace(host: NarrativeHost): boolean {
  const face = host.talk.face;
  if (!face || !finishTalking(host.talk, host.tick())) return false;
  host.emit({ type: 'lineCut', profile: face.speaker, saidAt: face.saidAt, tail: true });
  return true;
}
