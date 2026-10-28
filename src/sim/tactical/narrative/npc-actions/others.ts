// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (Madlab and the robot, vehicles, Estoni, Chitzena,
// @src Walter, Keith, Micky, Rat, Hans, the wheelchair, the married merc, EPC un-recruiting, the kids, Brenda, John and
// @src Mary), WalterGivenMoney.

import { ItemClass } from '../../../../content/items/items.ts';
import { soldierOnPlayerTeam } from '../../../narrative/dialogue-queue.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { NarrativeHistory } from '../../../strategic/narrative/history-codes.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { setProfileSector } from '../../../strategic/narrative/presence.ts';
import type { SectorPosition } from '../../../strategic/state.ts';
import { EventKind } from '../../../strategic/time/constants.ts';
import { findObjClass } from '../../combat/reload.ts';
import { autoPlaceObject } from '../../inventory.ts';
import { OKLIFE, type Soldier } from '../../soldier.ts';
import { soldierInventoryContext } from '../../soldier-inventory.ts';
import { NpcActionCode as A, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS } from './codes.ts';
import { closeMenu, destSoldier, npcSoldier, ProfileMiscFlag2, profileOf, roomAt, srcSoldier, tactical, trigger } from './common.ts';
import type { NpcActionEnv } from './env.ts';
import { getOutOfWheelchair, triggerFriendWithHostileQuote } from './generic.ts';

const ROBOT_READY_MINUTE = 420;
const KIDS_FREE_MINUTE = 420;
const BRENDA_PATIENCE_MINUTES = 360;
const KEITH_DAYS = 6;
const MINUTES_PER_DAY = 1440;
const WALTER_BRIBE = 20000;
const FULL_TANK = 10000;
const FULL_BREATH = 100;
const HANS_ROOM = 49;
const JOEY_MARTHA_ROOM_GRIDNO = 18326;
const RAT_SECTOR: SectorPosition = { x: 9, y: 7, z: 0 };
const UnRecruitRecord = { SKYRIDER_AT_CHOPPER: 15, JOEY_AT_MARTHA: 9, TOURISTS_AT_PLANE: 13 } as const;

function madlabAttachesGoodCamera(env: NpcActionEnv): void {
  env.setFactFalse(Fact.MADLAB_HAS_GOOD_CAMERA);
  const t = tactical(env);
  const madlab = npcSoldier(env, Npc.MADLAB);
  const robot = npcSoldier(env, Npc.ROBOT);
  if (t && madlab && robot) {
    const slot = findObjClass(t.content.items, madlab, ItemClass.GUN);
    const gun = madlab.inv[slot];
    if (slot >= 0 && gun) autoPlaceObject(soldierInventoryContext(t, robot), robot, gun);
  }
  env.recruit.recruitEpc(Npc.ROBOT);
}

function triggerIfTeamNotFull(env: NpcActionEnv, npc: number, record: number): void {
  if (env.playerTeamFull()) {
    closeMenu(env);
    env.message('teamFull', npc);
  } else trigger(env, npc, record);
}

function fillUpCar(env: NpcActionEnv): void {
  let car: Soldier | null = soldierOnPlayerTeam(env.host, Npc.PROF_HUMMER);
  if (!car) car = soldierOnPlayerTeam(env.host, Npc.PROF_ICECREAM);
  else if (car.breathRed === FULL_TANK) car = soldierOnPlayerTeam(env.host, Npc.PROF_ICECREAM) ?? car;
  if (!car) return;
  car.breathRed = FULL_TANK;
  car.breath = FULL_BREATH;
  env.message('vehicleRefuelled', car.profile);
}

function walterGivenMoney(env: NpcActionEnv, code: number): void {
  if ((profileOf(env, Npc.WALTER)?.balance ?? 0) >= env.params.amount(code, WALTER_BRIBE)) trigger(env, Npc.WALTER, 16);
  else trigger(env, Npc.WALTER, code === A.WALTER_GIVEN_MONEY_INITIALLY ? 14 : 15);
}

function triggerHansByRoom(env: NpcActionEnv): void {
  const t = tactical(env);
  const src = srcSoldier(env);
  if (t && src) trigger(env, Npc.HANS, roomAt(t, src.gridNo) === HANS_ROOM ? 18 : 14);
}

function marriedNpcLeavesTeam(env: NpcActionEnv): void {
  const groom = profileOf(env, Npc.DARYL)?.npcData ?? -1;
  const merc = groom >= 0 ? npcSoldier(env, groom) : null;
  if (!merc || !destSoldier(env)) return;
  const p = profileOf(env, merc.profile);
  if (p) p.miscFlags2 |= ProfileMiscFlag2.MARRIED_TO_HICKS;
  env.history(NarrativeHistory.MERC_MARRIED_OFF, env.worldSector(), merc.profile);
  if (merc.profile === Npc.FLO) env.setFactTrue(Fact.PC_MARRYING_DARYL_IS_FLO);
  env.moraleEvent(merc, 'MERC_MARRIED');
  env.recruit.updateDarrelScriptToGoTo(merc);
  trigger(env, Npc.DARREL, 10);
  env.recruit.addToOtherList(merc.profile);
}

function unRecruitEpc(env: NpcActionEnv, target: number, record: number): void {
  const npc = target === Npc.ANGEL ? Npc.MARIA : target;
  env.recruit.unRecruitEpc(npc);
  if (npc === Npc.MARY) env.recruit.unRecruitEpc(Npc.JOHN);
  else if (npc === Npc.JOHN) env.recruit.unRecruitEpc(Npc.MARY);
  else if (npc === Npc.SKYRIDER && record === UnRecruitRecord.SKYRIDER_AT_CHOPPER) {
    const skyrider = profileOf(env, Npc.SKYRIDER);
    if (skyrider) skyrider.useProfileInsertion = false;
  } else if (npc === Npc.JOEY && record === UnRecruitRecord.JOEY_AT_MARTHA) {
    const joey = profileOf(env, Npc.JOEY);
    if (joey) joey.insertionData = JOEY_MARTHA_ROOM_GRIDNO;
  }
  if ((npc === Npc.JOHN || npc === Npc.MARY) && record === UnRecruitRecord.TOURISTS_AT_PLANE) {
    for (const tourist of [Npc.JOHN, Npc.MARY]) {
      const p = profileOf(env, tourist);
      if (p) setProfileSector(p, null);
    }
  }
}

function triggerMaryOrJohn(env: NpcActionEnv, record: number): void {
  const mary = npcSoldier(env, Npc.MARY);
  trigger(env, mary && mary.life >= OKLIFE ? Npc.MARY : Npc.JOHN, record);
}

export function handleOtherAction(env: NpcActionEnv, npc: number, code: number, record: number): boolean {
  switch (code) {
    case A.MADLAB_GIVEN_GUN:
      env.setFactFalse(Fact.MADLAB_EXPECTING_FIREARM);
      trigger(env, npc, env.checkFact(Fact.MADLAB_EXPECTING_VIDEO_CAMERA, 0) ? 14 : 18);
      return true;
    case A.MADLAB_GIVEN_CAMERA:
      env.setFactFalse(Fact.MADLAB_EXPECTING_VIDEO_CAMERA);
      trigger(env, npc, env.checkFact(Fact.MADLAB_EXPECTING_FIREARM, 0) ? 17 : 18);
      return true;
    case A.MADLAB_ATTACHES_GOOD_CAMERA:
      madlabAttachesGoodCamera(env);
      return true;
    case A.READY_ROBOT:
      env.addFutureDayNpcEvent(ROBOT_READY_MINUTE, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    case A.TRIGGER_MADLAB_31:
      triggerIfTeamNotFull(env, Npc.MADLAB, 31);
      return true;
    case A.TRIGGER_MADLAB_32:
      triggerIfTeamNotFull(env, Npc.MADLAB, 32);
      return true;
    case A.TIMER_FOR_VEHICLE:
      env.addFutureDayNpcEvent(env.minutesInDay(), NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    case A.FILL_UP_CAR:
      fillUpCar(env);
      return true;
    case A.MAKE_ESTONI_A_FUEL_SITE:
      env.setFactTrue(Fact.ESTONI_REFUELLING_POSSIBLE);
      env.updateRefuelSiteAvailability();
      return true;
    case A.TRIGGER_YANNI:
      trigger(env, Npc.YANNI, env.checkFact(Fact.CHALICE_STOLEN, 0) ? 8 : 7);
      return true;
    case A.WALTER_GIVEN_MONEY_INITIALLY:
    case A.WALTER_GIVEN_MONEY:
      walterGivenMoney(env, code);
      return true;
    case A.START_TIMER_ON_KEITH_GOING_OUT_OF_BUSINESS:
      env.addStrategicEvent(EventKind.KEITH_GOING_OUT_OF_BUSINESS, env.totalMinutes() + KEITH_DAYS * MINUTES_PER_DAY, 0);
      return true;
    case A.KEITH_GOING_BACK_IN_BUSINESS:
      env.setFactFalse(Fact.KEITH_OUT_OF_BUSINESS);
      return true;
    case A.TRIGGER_MICKY_BY_SCI_FI:
      trigger(env, Npc.MICKY, env.sciFi() ? 7 : 8);
      return true;
    case A.MAKE_RAT_DISAPPEAR: {
      const rat = profileOf(env, Npc.RAT);
      if (rat) rat.npcData = 1;
      return true;
    }
    case A.ADD_RAT: {
      const rat = profileOf(env, Npc.RAT);
      if (rat) {
        rat.sectorX = RAT_SECTOR.x;
        rat.sectorY = RAT_SECTOR.y;
      }
      return true;
    }
    case A.TRIGGER_HANS_BY_ROOM:
      triggerHansByRoom(env);
      return true;
    case A.GET_OUT_OF_WHEELCHAIR:
      getOutOfWheelchair(env, npc);
      return true;
    case A.GET_OUT_OF_WHEELCHAIR_AND_BECOME_HOSTILE:
      getOutOfWheelchair(env, npc);
      triggerFriendWithHostileQuote(env, npc);
      return true;
    case A.HAVE_MARRIED_NPC_LEAVE_TEAM:
      marriedNpcLeavesTeam(env);
      return true;
    case A.UN_RECRUIT_EPC:
    case A.SET_EPC_TO_NPC:
      unRecruitEpc(env, npc, record);
      return true;
    case A.FREE_KIDS:
      env.addFutureDayNpcEvent(KIDS_FREE_MINUTE, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code, 1);
      return true;
    case A.DELAYED_MAKE_BRENDA_LEAVE:
      closeMenu(env);
      env.addSameDayNpcEvent(env.minutesInDay() + BRENDA_PATIENCE_MINUTES, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + code);
      return true;
    case A.TRIGGER_MARY_OR_JOHN_RECORD_9:
      triggerMaryOrJohn(env, 9);
      return true;
    case A.TRIGGER_MARY_OR_JOHN_RECORD_10:
      triggerMaryOrJohn(env, 10);
      return true;
    default:
      return false;
  }
}
