// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (Kingpin, Darren and the boxing actions, Madame and the
// @src girls, Angel and Maria, Kyle's money, Joey, Carmen and the terrorists), CarmenLeavesSectorCallback, carmenSector;
// @src JAScreens.cc SexScreenHandle (its WarpGameTime of 5 + Random(20) minutes, simulated at the action).

import { ItemClass, NOTHING } from '../../../../content/items/items.ts';
import { i8, u32 } from '../../../../core/int.ts';
import { createMoney, deleteObject, swapObjects } from '../../../items/object.ts';
import { closestPC, npcDoAction } from '../../../narrative/converse.ts';
import { Fact, Quest } from '../../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../../strategic/narrative/facts.ts';
import { NarrativeHistory } from '../../../strategic/narrative/history-codes.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { setProfileSector } from '../../../strategic/narrative/presence.ts';
import type { SectorPosition } from '../../../strategic/state.ts';
import { AiAction } from '../../ai/actions.ts';
import { cancelAIAction } from '../../ai/control.ts';
import { findObjClass } from '../../combat/reload.ts';
import { updateDoor } from '../../doors/door-table.ts';
import { findObj } from '../../doors/lock-attempts.ts';
import { soldierPickupItem } from '../../item-actions.ts';
import { NOWHERE } from '../../soldier.ts';
import { whoIsThere } from '../../state.ts';
import { addItemToPool, Visibility } from '../../world-items.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS } from './codes.ts';
import { closeMenu, npcSoldier, ProfileMiscFlag2, profileOf, roomAt, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';

export const CARMEN_SECTOR: SectorPosition = { x: 13, y: 3, z: 0 };
const CARMEN_SECTOR_2: SectorPosition = { x: 9, y: 7, z: 0 };
const CARMEN_SECTOR_3: SectorPosition = { x: 5, y: 3, z: 0 };
const JOEY_CAVE: SectorPosition = { x: 4, y: 4, z: 1 };
const CLUB_ROOMS = { FIRST: 1, LAST: 3 } as const;
const DOOR_FALLBACK_GRIDNO = 10852;
const DEED_GRIDNO = 12541;
const KYLE_MONEY_GRIDNO = 14952;
const KYLE_MONEY_AMOUNT = 10000;
const CARMEN_TIMER_MS = 10000;
const SEX_SCENE_BASE_MINUTES = 5;
const SEX_SCENE_SPREAD_MINUTES = 20;
const SECONDS_PER_MINUTE = 60;

export function sexSceneWarpSeconds(random: (n: number) => number): number {
  return (SEX_SCENE_BASE_MINUTES + random(SEX_SCENE_SPREAD_MINUTES)) * SECONDS_PER_MINUTE;
}
const ITEM_IGNORE_Z_LEVEL = -1;
const DAYS_TILL_JOEY_MOVES = 3;
const CARLA_CHANCE_DIE = 3;
const COIN = 2;
const GIRLS_DELAY_SPREAD = 2;
const DOOR_CODES: ReadonlySet<number> = new Set([A.OPEN_CARLAS_DOOR, A.OPEN_CINDYS_DOOR, A.OPEN_BAMBIS_DOOR, A.OPEN_MARIAS_DOOR]);

function sameSector(a: SectorPosition | null, b: SectorPosition): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.z === b.z;
}

function triggerSpikeOrDarren(env: NpcActionEnv): void {
  const t = tactical(env);
  const kingpin = npcSoldier(env, Npc.KINGPIN);
  if (t && kingpin) {
    const room = roomAt(t, kingpin.gridNo);
    if (room >= CLUB_ROOMS.FIRST && room <= CLUB_ROOMS.LAST) {
      trigger(env, Npc.DARREN, 31);
      return;
    }
  }
  trigger(env, Npc.SPIKE, 11);
}

function kingpinImpressed(env: NpcActionEnv): void {
  if (env.boxing.lastMatchWonByPlayer() && !env.boxing.boxerAvailable()) trigger(env, Npc.KINGPIN, 15);
}

function darrenPaysPlayer(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const darren = npcSoldier(env, npc);
  if (!t || !darren) return;
  const g = closestPC(env.host, darren);
  const pc = g !== NOWHERE ? whoIsThere(t, g, 0) : null;
  if (!pc) return;
  const moneySlot = findObjClass(t.content.items, darren, ItemClass.MONEY);
  const emptySlot = findObj(darren, NOTHING);
  const stash = darren.inv[moneySlot];
  const empty = darren.inv[emptySlot];
  if (moneySlot < 0 || emptySlot < 0 || !stash || !empty) return;
  const payout = u32((profileOf(env, npc)?.balance ?? 0) * 2);
  Object.assign(empty, createMoney(t.content.items, payout));
  stash.money = u32(stash.money - payout);
  if (moneySlot < emptySlot) {
    swapObjects(empty, stash);
    env.giveItem(darren, pc, moneySlot);
  } else env.giveItem(darren, pc, emptySlot);
}

function setGirlsAvailable(env: NpcActionEnv): void {
  env.setFactTrue(Fact.NO_GIRLS_AVAILABLE);
  const girls: readonly [number, number][] = [
    [Fact.CARLA_AVAILABLE, CARLA_CHANCE_DIE],
    [Fact.CINDY_AVAILABLE, COIN],
    [Fact.BAMBI_AVAILABLE, COIN],
  ];
  for (const [girl, die] of girls) {
    if (env.random(die)) {
      env.setFactTrue(girl);
      env.setFactFalse(Fact.NO_GIRLS_AVAILABLE);
    } else env.setFactFalse(girl);
  }
}

function triggerLayla(env: NpcActionEnv): void {
  if (env.checkFact(Fact.CARLA_AVAILABLE, 0)) trigger(env, Npc.MADAME, 13);
  else if (env.checkFact(Fact.CINDY_AVAILABLE, 0)) trigger(env, Npc.MADAME, 14);
  else if (env.checkFact(Fact.BAMBI_AVAILABLE, 0)) trigger(env, Npc.MADAME, 15);
}

function unlockGirlsDoor(env: NpcActionEnv, code: number): void {
  const t = tactical(env);
  if (t) updateDoor(t, env.params.gridNo(code, DOOR_FALLBACK_GRIDNO), { locked: false });
}

function laylasNextLine(env: NpcActionEnv, code: number): void {
  if (code === A.LAYLA_GIVEN_WRONG_AMOUNT_OF_CASH) {
    if (env.checkFact(Fact.NO_GIRLS_AVAILABLE, 0)) trigger(env, Npc.MADAME, 27);
    else if (env.checkFact(Fact.CARLA_AVAILABLE, 0)) {
      trigger(env, Npc.MADAME, 28);
      return;
    }
  }
  if (code <= A.LAYLAS_NEXT_LINE_AFTER_CARLA) {
    if (env.checkFact(Fact.CINDY_AVAILABLE, 0)) {
      trigger(env, Npc.MADAME, 29);
      return;
    }
  }
  if (code <= A.LAYLAS_NEXT_LINE_AFTER_CINDY) {
    if (env.checkFact(Fact.BAMBI_AVAILABLE, 0)) {
      trigger(env, Npc.MADAME, 30);
      return;
    }
  }
  if (code <= A.LAYLAS_NEXT_LINE_AFTER_BAMBI) {
    if (env.questStatus(Quest.RESCUE_MARIA) === QuestStatus.IN_PROGRESS) {
      trigger(env, Npc.MADAME, 31);
      return;
    }
  }
  if (env.checkFact(Fact.MULTIPLE_MERCS_CLOSE, Npc.MADAME)) trigger(env, Npc.MADAME, 32);
}

function angelLeavesDeed(env: NpcActionEnv, npc: number, code: number): void {
  const t = tactical(env);
  const angel = npcSoldier(env, npc);
  if (t && angel) {
    const deed = t.content.items.byName.get('DEED')?.index ?? -1;
    const slot = findObj(angel, deed);
    const o = angel.inv[slot];
    if (slot >= 0 && o) {
      addItemToPool(t, env.params.gridNo(code, DEED_GRIDNO), o, Visibility.INVISIBLE, 0, 0, 0);
      deleteObject(o);
      env.removeObjectFromProfile(npc, deed);
    }
  }
  closeMenu(env);
  npcDoAction(env.host, npc, A.UN_RECRUIT_EPC, 0);
  npcDoAction(env.host, npc, A.GRANT_EXPERIENCE_3, 0);
  trigger(env, Npc.ANGEL, 24);
}

function kyleGetsMoney(env: NpcActionEnv, npc: number, code: number): void {
  const t = tactical(env);
  const kyle = npcSoldier(env, npc);
  if (!t || !kyle) return;
  const gridNo = env.params.gridNo(code, KYLE_MONEY_GRIDNO);
  const money = createMoney(t.content.items, env.params.amount(code, KYLE_MONEY_AMOUNT));
  const item = addItemToPool(t, gridNo, money, Visibility.INVISIBLE, kyle.level, 0, 0);
  cancelAIAction(t, kyle);
  kyle.ai.action = AiAction.PENDING_ACTION;
  kyle.quoteRecord = A.KYLE_GETS_MONEY;
  soldierPickupItem(t, kyle, gridNo, ITEM_IGNORE_Z_LEVEL, item ? [item] : []);
}

function triggerMaria(env: NpcActionEnv): void {
  if (!env.checkFact(Fact.MARIA_ESCAPE_NOTICED, Npc.MARIA)) trigger(env, Npc.MARIA, 8);
  else trigger(env, Npc.MARIA, env.checkFact(Fact.PLAYER_IN_SAME_ROOM, Npc.MARIA) ? 9 : 10);
}

function checkLastTerroristHead(env: NpcActionEnv): void {
  const carmen = profileOf(env, Npc.CARMEN);
  if (carmen) {
    carmen.npcData = i8(carmen.npcData - 1);
    carmen.npcData2 = i8(carmen.npcData2 + 1);
  }
  trigger(env, Npc.CARMEN, sameSector(env.worldSector(), CARMEN_SECTOR) ? 20 : 21);
  env.history(NarrativeHistory.GAVE_CARMEN_HEAD, env.worldSector());
}

function carmenLeaves(env: NpcActionEnv, npc: number, code: number): void {
  const p = profileOf(env, npc);
  if (p) {
    if (code === A.CARMEN_LEAVES_FOR_GOOD) p.miscFlags2 |= ProfileMiscFlag2.LEFT_COUNTRY;
    p.miscFlags2 |= ProfileMiscFlag2.DONT_ADD_TO_SECTOR;
  }
  env.startCarmenTimer(env.params.amount(code, CARMEN_TIMER_MS));
}

export function carmenLeavesSector(env: NpcActionEnv): void {
  const world = env.worldSector();
  if (sameSector(world, CARMEN_SECTOR)) trigger(env, Npc.CARMEN, 34);
  else if (sameSector(world, CARMEN_SECTOR_2)) trigger(env, Npc.CARMEN, 35);
  else if (sameSector(world, CARMEN_SECTOR_3)) trigger(env, Npc.CARMEN, 36);
}

function carmenLeavesOnNextSectorLoad(env: NpcActionEnv): void {
  const carmen = profileOf(env, Npc.CARMEN);
  if (carmen?.npcData === 0) {
    env.setFactTrue(Fact.ALL_TERRORISTS_KILLED);
    env.incrementTownLoyaltyEverywhere(env.loyaltyAmount('BONUS_TERRORISTS_DEALT_WITH'));
  }
  if (carmen) carmen.money = 0;
}

export function handleSanMonaAction(env: NpcActionEnv, npc: number, code: number, _record: number): boolean {
  if (DOOR_CODES.has(code)) {
    unlockGirlsDoor(env, code);
    return true;
  }
  if (code === A.LAYLA_GIVEN_WRONG_AMOUNT_OF_CASH || (code >= A.LAYLAS_NEXT_LINE_AFTER_CARLA && code <= A.LAYLAS_NEXT_LINE_AFTER_MARIA)) {
    laylasNextLine(env, code);
    return true;
  }
  switch (code) {
    case A.MARK_KINGPIN_QUOTE_0_USED: {
      const kingpin = profileOf(env, Npc.KINGPIN);
      if (kingpin) kingpin.lastDateSpokenTo = env.day();
      return true;
    }
    case A.KINGPIN_TRIGGER_25_OR_14:
      trigger(env, npc, env.checkFact(Fact.KINGPIN_INTRODUCED_SELF, npc) ? 25 : 14);
      return true;
    case A.TRIGGER_SPIKE_OR_DARREN:
      triggerSpikeOrDarren(env);
      return true;
    case A.TRIGGER_DARREN_OR_KINGPIN_IMPRESSED:
      if (env.boxing.boxerAvailable()) trigger(env, Npc.DARREN, 25);
      kingpinImpressed(env);
      return true;
    case A.TRIGGER_KINGPIN_IMPRESSED:
      kingpinImpressed(env);
      return true;
    case A.START_BOXING_MATCH:
      if (env.boxing.checkOnBoxers()) {
        closeMenu(env);
        env.presentation('boxingBell');
        env.boxing.startMatch();
      }
      return true;
    case A.HANDLE_END_OF_FIGHT:
      env.boxing.exitBoxing();
      closeMenu(env);
      return true;
    case A.DARREN_PAYS_PLAYER:
      darrenPaysPlayer(env, npc);
      return true;
    case A.SET_FACT_105_FALSE:
      env.setFactFalse(Fact.FRANK_HAS_BEEN_BRIBED);
      return true;
    case A.TRIGGER_LAYLA_13_14_OR_15:
      triggerLayla(env);
      return true;
    case A.SET_GIRLS_AVAILABLE:
      setGirlsAvailable(env);
      return true;
    case A.SET_DELAY_TILL_GIRLS_AVAILABLE:
      env.addSameDayNpcEvent(env.minutesInDay() + 1 + env.random(GIRLS_DELAY_SPREAD), NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code);
      return true;
    case A.SET_WAITED_FOR_GIRL_FALSE:
      env.setFactFalse(Fact.PLAYER_WAITED_FOR_GIRL);
      return true;
    case A.POSSIBLY_ADVERTISE_CINDY:
      if (env.checkFact(Fact.CINDY_AVAILABLE, 0)) trigger(env, Npc.MADAME, 14);
      if (env.checkFact(Fact.BAMBI_AVAILABLE, 0)) trigger(env, Npc.MADAME, 15);
      return true;
    case A.POSSIBLY_ADVERTISE_BAMBI:
      if (env.checkFact(Fact.BAMBI_AVAILABLE, 0)) trigger(env, Npc.MADAME, 15);
      return true;
    case A.SEX:
      env.presentation('sexScene', npc);
      env.warpTimeWithoutEvents(sexSceneWarpSeconds(env.random));
      return true;
    case A.TRIGGER_ANGEL_17_OR_18:
      trigger(env, Npc.ANGEL, env.checkFact(Fact.ANGEL_SOLD_VEST, Npc.ANGEL) ? 18 : 17);
      return true;
    case A.TRIGGER_ANGEL_16_OR_19:
      trigger(env, Npc.ANGEL, env.checkFact(Fact.PLAYER_IN_SAME_ROOM, Npc.ANGEL) ? 16 : 19);
      return true;
    case A.TRIGGER_ANGEL_21_OR_22:
      trigger(env, Npc.ANGEL, env.checkFact(Fact.PLAYER_IN_SAME_ROOM, Npc.ANGEL) ? 22 : 21);
      return true;
    case A.TRIGGER_ANGEL_22_OR_24:
      trigger(env, npc, env.checkFact(Fact.ANGEL_LEFT_DEED, npc) ? 22 : 24);
      return true;
    case A.TRIGGER_MARIA:
      triggerMaria(env);
      return true;
    case A.ANGEL_LEAVES_DEED:
      angelLeavesDeed(env, npc, code);
      return true;
    case A.KYLE_GETS_MONEY:
      kyleGetsMoney(env, npc, code);
      return true;
    case A.ADD_JOEY_TO_WORLD: {
      const joey = profileOf(env, Npc.JOEY);
      if (joey) setProfileSector(joey, JOEY_CAVE);
      env.addFutureDayNpcEvent(env.minutesInDay(), NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, DAYS_TILL_JOEY_MOVES);
      return true;
    }
    case A.DECIDE_ACTIVE_TERRORISTS: {
      env.laptop.addTerroristFiles();
      const carmen = profileOf(env, Npc.CARMEN);
      if (carmen) carmen.npcData2 = 0;
      return true;
    }
    case A.CHECK_LAST_TERRORIST_HEAD:
      checkLastTerroristHead(env);
      return true;
    case A.CARMEN_LEAVES_FOR_GOOD:
    case A.CARMEN_LEAVES_FOR_C13:
      carmenLeaves(env, npc, code);
      return true;
    case A.CARMEN_LEAVES_ON_NEXT_SECTOR_LOAD:
      carmenLeavesOnNextSectorLoad(env);
      return true;
    default:
      return false;
  }
}
