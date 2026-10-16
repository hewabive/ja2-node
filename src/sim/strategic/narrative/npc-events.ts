// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Event_Handler.cc HandleNPCSystemEvent, SetPabloToUnbribed, HandlePossiblyDamagedPackage,
// @src HandleDelayedItemsArrival, PABLOS_STOLEN_DEST_GRIDNO, LOST_SHIPMENT_GRIDNO; Strategic/Game_Event_Hook.h
// @src NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS. See docs/25 §3.13, §11.2, §11.4.

import { NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS, NpcActionCode } from '../../tactical/narrative/npc-actions/codes.ts';
import { MercStatus, type ProfileProgress } from '../../tactical/profiles.ts';
import type { SectorPosition } from '../state.ts';
import { Fact, Quest } from './fact-ids.ts';
import { QuestStatus } from './facts.ts';
import { KINGPIN_DISCOVERY_SPREAD_MINUTES } from './kingpin.ts';
import { Npc } from './npc-ids.ts';
import { setProfileSector } from './presence.ts';

export const PABLOS_STOLEN_DEST_GRIDNO = 1;
export const LOST_SHIPMENT_GRIDNO = 2;
const DAMAGED_PACKAGE_CHANCE = 70;
const PERCENT = 100;
const STOLEN_GOODS_DRAWS = 2;
const STOLEN_GOODS_KINDS = 10;
const STATUS_SPREAD = 10;
const JOEY_RETRY_MINUTES = 60;
const DAYS_TILL_KINGPIN_ACTS = 2;
const FOOD_ROUTE_SECTOR: SectorPosition = { x: 10, y: 1, z: 0 };
const KINGPIN_LETTER_SECTOR: SectorPosition = { x: 5, y: 4, z: 0 };
const JOEY_CAVE: SectorPosition = { x: 4, y: 4, z: 1 };
const SAN_MONA_C5: SectorPosition = { x: 5, y: 3, z: 0 };

export interface StolenGood {
  readonly item: 'GASMASK' | 'DESERTEAGLE' | 'STUN_GRENADE' | 'SW38';
  readonly status: number;
  readonly count: number;
}

export interface DeliveryWorld {
  deliverySectorLoaded(): boolean;
  addHiddenAtDelivery(good: StolenGood, loaded: boolean): void;
  moveLoadedPool(fromGridNo: number): void;
  moveUnloadedItemsAtStolenGridNo(): void;
}

export interface NpcSystemEventContext {
  checkFact(id: number, npc?: number): boolean;
  setFactTrue(id: number): void;
  setFactFalse(id: number): void;
  questStatus(quest: number): number;
  startQuest(quest: number, sector: SectorPosition | null): void;
  endQuest(quest: number, sector: SectorPosition | null): void;
  profile(id: number): ProfileProgress | null;
  minutesInDay(): number;
  addFutureDayNpcEvent(minuteOfDay: number, param: number, days: number): void;
  addSameDayNpcEvent(minuteOfDay: number, param: number): void;
  random(n: number): number;
  kingpinMoneyCheck(firstCheck: boolean): void;
  kingpinLetter(): void;
  enricoMiguelEmail(): void;
  kingpinGroupWillBecomeHostile(): void;
  handleNpcDoAction(npc: number, code: number, record: number): void;
  soldierInLoadedSector(profile: number): boolean;
  readonly delivery: DeliveryWorld;
}

function isDead(p: ProfileProgress | null): boolean {
  return p?.mercStatus === MercStatus.IS_DEAD;
}

function stolenGood(ctx: NpcSystemEventContext): StolenGood {
  const kind = ctx.random(STOLEN_GOODS_KINDS);
  if (kind === 0) return { item: 'GASMASK', status: 20 + ctx.random(STATUS_SPREAD), count: 1 };
  if (kind <= 2) return { item: 'DESERTEAGLE', status: 40 + ctx.random(STATUS_SPREAD), count: 1 };
  if (kind <= 5) return { item: 'STUN_GRENADE', status: 70 + ctx.random(STATUS_SPREAD), count: 1 };
  return { item: 'SW38', status: 90 + ctx.random(STATUS_SPREAD), count: 2 };
}

export function handleDelayedItemsArrival(ctx: NpcSystemEventContext, reason: number): void {
  let start: number;
  const loaded = ctx.delivery.deliverySectorLoaded();
  if (reason === NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + NpcActionCode.RETURN_STOLEN_SHIPMENT_ITEMS) {
    if (isDead(ctx.profile(Npc.PABLO))) return;
    ctx.setFactTrue(Fact.PABLO_RETURNED_GOODS);
    ctx.setFactFalse(Fact.PABLO_PUNISHED_BY_PLAYER);
    start = PABLOS_STOLEN_DEST_GRIDNO;
    for (let k = 0; k < STOLEN_GOODS_DRAWS; k++) ctx.delivery.addHiddenAtDelivery(stolenGood(ctx), loaded);
  } else if (reason === Fact.PACKAGE_DAMAGED) start = LOST_SHIPMENT_GRIDNO;
  else return;
  if (loaded) ctx.delivery.moveLoadedPool(start);
  else ctx.delivery.moveUnloadedItemsAtStolenGridNo();
}

function handlePossiblyDamagedPackage(ctx: NpcSystemEventContext): void {
  if (ctx.random(PERCENT) < DAMAGED_PACKAGE_CHANCE) {
    ctx.setFactTrue(Fact.PACKAGE_DAMAGED);
    handleDelayedItemsArrival(ctx, Fact.PACKAGE_DAMAGED);
  } else ctx.setFactTrue(Fact.PACKAGE_LOST_PERMANENTLY);
  ctx.setFactFalse(Fact.SHIPMENT_DELAYED_24_HOURS);
}

function kingpinEvent(ctx: NpcSystemEventContext): void {
  if (!ctx.checkFact(Fact.KINGPIN_KNOWS_MONEY_GONE)) {
    ctx.kingpinMoneyCheck(false);
    return;
  }
  if (ctx.checkFact(Fact.KINGPIN_DEAD)) return;
  const status = ctx.questStatus(Quest.KINGPIN_MONEY);
  if (status === QuestStatus.NOT_STARTED) {
    ctx.kingpinLetter();
    ctx.startQuest(Quest.KINGPIN_MONEY, KINGPIN_LETTER_SECTOR);
    ctx.addFutureDayNpcEvent(ctx.random(KINGPIN_DISCOVERY_SPREAD_MINUTES), Fact.KINGPIN_KNOWS_MONEY_GONE, DAYS_TILL_KINGPIN_ACTS);
  } else if (status === QuestStatus.IN_PROGRESS) {
    ctx.setFactTrue(Fact.KINGPIN_CAN_SEND_ASSASSINS);
    const spike = ctx.profile(Npc.SPIKE);
    if (spike) {
      spike.sectorX = SAN_MONA_C5.x;
      spike.sectorY = SAN_MONA_C5.y;
    }
    ctx.kingpinGroupWillBecomeHostile();
  }
}

function factEvent(ctx: NpcSystemEventContext, param: number): void {
  switch (param) {
    case Fact.PABLOS_BRIBED:
      ctx.setFactFalse(Fact.PABLOS_BRIBED);
      return;
    case Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING:
      ctx.setFactFalse(Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING);
      if (ctx.checkFact(Fact.LARGE_SIZED_SHIPMENT_WAITING)) ctx.setFactTrue(Fact.LARGE_SIZED_OLD_SHIPMENT_WAITING);
      return;
    case Fact.SHIPMENT_DELAYED_24_HOURS:
    case Fact.FACT_24_HOURS_SINCE_DOCTOR_TALKED_TO:
    case Fact.FACT_24_HOURS_SINCE_JOEY_RESCUED:
      ctx.setFactTrue(param);
      return;
    case Fact.KINGPIN_KNOWS_MONEY_GONE:
      kingpinEvent(ctx);
      return;
  }
}

function readyRobot(ctx: NpcSystemEventContext): void {
  const robot = ctx.profile(Npc.ROBOT);
  if (ctx.checkFact(Fact.FIRST_ROBOT_DESTROYED)) {
    ctx.setFactTrue(Fact.ROBOT_READY_SECOND_TIME);
    if (robot) {
      robot.life = robot.stats.lifeMax;
      robot.mercStatus = MercStatus.OK;
    }
  } else ctx.setFactTrue(Fact.ROBOT_READY);
  const madlab = ctx.profile(Npc.MADLAB);
  if (robot && madlab) {
    robot.sectorX = madlab.sectorX;
    robot.sectorY = madlab.sectorY;
    robot.sectorZ = madlab.sectorZ;
  }
}

function addJoeyToWorld(ctx: NpcSystemEventContext): void {
  const joey = ctx.profile(Npc.JOEY);
  if (!joey || isDead(joey) || ctx.checkFact(Fact.NPC_ESCORTED, Npc.JOEY)) return;
  if (joey.sectorX !== JOEY_CAVE.x || joey.sectorY !== JOEY_CAVE.y || joey.sectorZ !== JOEY_CAVE.z) return;
  if (ctx.soldierInLoadedSector(Npc.JOEY)) {
    ctx.addSameDayNpcEvent(ctx.minutesInDay() + JOEY_RETRY_MINUTES, NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS + NpcActionCode.ADD_JOEY_TO_WORLD);
  } else setProfileSector(joey, SAN_MONA_C5);
}

function actionEvent(ctx: NpcSystemEventContext, param: number): void {
  switch (param - NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS) {
    case NpcActionCode.RETURN_STOLEN_SHIPMENT_ITEMS:
      handleDelayedItemsArrival(ctx, param);
      return;
    case NpcActionCode.SET_RANDOM_PACKAGE_DAMAGE_TIMER:
      handlePossiblyDamagedPackage(ctx);
      return;
    case NpcActionCode.ENABLE_CAMBRIA_DOCTOR_BONUS:
      ctx.setFactTrue(Fact.WILLIS_HEARD_ABOUT_JOEY_RESCUE);
      return;
    case NpcActionCode.TRIGGER_END_OF_FOOD_QUEST:
      if (isDead(ctx.profile(Npc.FATHER))) return;
      ctx.endQuest(Quest.FOOD_ROUTE, FOOD_ROUTE_SECTOR);
      ctx.setFactTrue(Fact.FOOD_QUEST_OVER);
      return;
    case NpcActionCode.DELAYED_MAKE_BRENDA_LEAVE:
      ctx.setFactTrue(Fact.BRENDA_PATIENCE_TIMER_EXPIRED);
      return;
    case NpcActionCode.SET_DELAY_TILL_GIRLS_AVAILABLE:
      ctx.handleNpcDoAction(Npc.MADAME, NpcActionCode.SET_GIRLS_AVAILABLE, 0);
      return;
    case NpcActionCode.READY_ROBOT:
      readyRobot(ctx);
      return;
    case NpcActionCode.ADD_JOEY_TO_WORLD:
      addJoeyToWorld(ctx);
      return;
    case NpcActionCode.SEND_ENRICO_MIGUEL_EMAIL:
      ctx.enricoMiguelEmail();
      return;
    case NpcActionCode.TIMER_FOR_VEHICLE:
      ctx.setFactTrue(Fact.OK_USE_HUMMER);
      return;
    case NpcActionCode.FREE_KIDS:
      ctx.setFactTrue(Fact.KIDS_ARE_FREE);
      return;
  }
}

export function handleNpcSystemEvent(ctx: NpcSystemEventContext, param: number): void {
  if (param < NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS) factEvent(ctx, param);
  else actionEvent(ctx, param);
}
