// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Helicopter.cc RemoveSoldierFromHelicopter, HandleHeliEnteringSector, NearestRefuelPoint,
// @src FindClosestRefuelSite, SkyriderDestroyed, CanHelicopterFly, IsHelicopterPilotAvailable, LandHelicopter,
// @src TakeOffHelicopter, StartHoverTime, HandleHeliHoverLong, HandleHeliHoverTooLong, DoesSkyriderNoticeEnemiesInSector,
// @src SetUpHelicopterForMovement, IsRefuelSiteInSector, IsRefuelAvailableInSector, UpdateRefuelSiteAvailability,
// @src SetUpHelicopterForPlayer, MoveAllInHelicopterToFootMovementGroup, the monologue handlers, CheckAndHandleSkyriderMonologues,
// @src HandleHelicopterOnGround (the profile part), IsHelicopterOnGroundAtRefuelingSite, HandleSAMSiteAttackOfHelicopterInSector,
// @src CanHelicopterTakeOff, IsSkyriderFlyingInSector, PaySkyriderBill, PayOffSkyriderDebtIfAny, MakeHeliReturnToBase,
// @src SoldierAboardAirborneHeli; Map_Screen_Helicopter.h quote ids and costs; MapScreen.cc RequestGiveSkyriderNewDestination,
// @src ExplainWhySkyriderCantFly, PlayerMercsInHelicopterSector, HandleNewDestConfirmation and CheckIfClickOnLastSectorInPath
// @src (helicopter parts); Map_Screen_Interface_Map.cc PlotPathForHelicopter, GetLastSectorOfHelicoptersPath,
// @src ClearPathAfterThisSectorForHelicopter; Player_Command.cc SetThisSectorAsPlayerControlled (Skyrider's SAM congratulation);
// @src Tactical/Vehicles.cc OKUseVehicle.

import {
  type Sector,
  sameSector,
  sectorFromId,
  sectorId,
  sectorShortString,
  strategicIndex,
} from '../../../content/strategic/sector-ids.ts';
import { i32, u8, u32 } from '../../../core/int.ts';
import { addTransaction, FinanceCode } from '../../campaign/finances.ts';
import { markSecretFoundAt } from '../map/control.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../map/knowledge.ts';
import { appendStrategicPath, findStratPath, lastSectorOfPath } from '../map/pathing.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent, deleteStrategicEvent } from '../time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldTotalMinutes } from '../time/world-clock.ts';
import { MIN_CONDITION_FOR_SAM_SITE_TO_WORK, SectorFlag } from './constants.ts';
import {
  addPlayerToGroup,
  createNewVehicleGroupDepartingFromSector,
  type Group,
  getGroup,
  numEnemiesInSector,
  passengersOf,
  playerMercsInSector,
  requireMerc,
  type VehicleRecord,
} from './groups.ts';
import { createHelicopterState, type HelicopterState, REFUEL_SITES, RefuelSiteId } from './helicopter-state.ts';
import { buildAStrategicPath, rebuildWayPointsForGroupPath, stratPathRulesForGroup } from './movement.ts';
import type { StrategicContext, StrategicMerc } from './ports.ts';
import { isTheCursorAllowedToHighLightThisSector } from './routes.ts';
import { addCharacterToSquad, getFirstEmptySquad } from './squads.ts';
import {
  addVehicleToList,
  cancelPathForVehicle,
  findVehicle,
  inHelicopter,
  killAllInVehicle,
  numberInVehicle,
  removeVehicleFromList,
  takeSoldierOutOfVehicle,
} from './vehicles.ts';

export const SKYRIDER = 97;
export const HELICOPTER_VEHICLE_TYPE = 5;
export const FACT_SKYRIDER_USED_IN_MAPSCREEN = 45;
export const FACT_OK_USE_HUMMER = 224;
export const FACT_ESTONI_REFUELLING_POSSIBLE = 277;
export const FACT_OK_USE_ICECREAM = 307;

export const SkyriderQuote = {
  OWED_MONEY_TO_SKYRIDER: 11,
  MENTION_DRASSEN_SAM_SITE: 20,
  SECOND_HALF_OF_MENTION_DRASSEN_SAM_SITE: 21,
  SAM_SITE_TAKEN: 22,
  SKYRIDER_SAYS_HI: 23,
  SPIEL_ABOUT_OTHER_SAM_SITES: 24,
  SECOND_HALF_OF_SPIEL_ABOUT_OTHER_SAM_SITES: 25,
  SPIEL_ABOUT_ESTONI_AIRSPACE: 26,
  CONFIRM_DESTINATION: 27,
  ARRIVED_IN_HOSTILE_SECTOR: 29,
  BELIEVED_ENEMY_SECTOR: 30,
  ARRIVED_IN_NON_HOSTILE_SECTOR: 31,
  HOVERING_A_WHILE: 32,
  RETURN_TO_BASE: 33,
  ENEMIES_SPOTTED_EN_ROUTE_IN_FRIENDLY_SECTOR_A: 34,
  ENEMIES_SPOTTED_EN_ROUTE_IN_FRIENDLY_SECTOR_B: 35,
  MENTION_HOSPITAL_IN_CAMBRIA: 45,
  THINGS_ARE_GOING_BADLY: 46,
  THINGS_ARE_GOING_WELL: 47,
  CHOPPER_NOT_ACCESSIBLE: 48,
  DOESNT_WANT_TO_FLY: 49,
  HELI_TOOK_MINOR_DAMAGE: 52,
  HELI_TOOK_MAJOR_DAMAGE: 53,
  HELI_GOING_DOWN: 54,
} as const;

export const HelicopterRefusal = {
  NO_HELICOPTER: 'noHelicopter',
  SKYRIDER_OWED: 'skyriderOwed',
  RETURNING_TO_BASE: 'returningToBase',
  GROUNDED: 'grounded',
  SKYRIDER_UNWILLING: 'skyriderUnwilling',
} as const;
export type HelicopterRefusal = (typeof HelicopterRefusal)[keyof typeof HelicopterRefusal];

const REFUSAL_QUOTES: Readonly<Record<HelicopterRefusal, number | null>> = {
  noHelicopter: null,
  skyriderOwed: SkyriderQuote.OWED_MONEY_TO_SKYRIDER,
  returningToBase: SkyriderQuote.RETURN_TO_BASE,
  grounded: SkyriderQuote.CHOPPER_NOT_ACCESSIBLE,
  skyriderUnwilling: SkyriderQuote.DOESNT_WANT_TO_FLY,
};

const NO_HELICOPTER_ID = -1;
const MAX_SAM_SITE_ACCURACY = 33;
const ENEMY_NOTICE_BASE_CHANCE = 60;
const TIME_DELAY_FOR_HOVER_WAIT = 10;
const TIME_DELAY_FOR_HOVER_WAIT_TOO_LONG = 20;
const MINUTES_BETWEEN_SKYRIDER_MONOLOGUES = 24 * 60;
const MIN_PROGRESS_FOR_SKYRIDER_QUOTE_DOING_WELL = 25;
const MIN_REGRESS_FOR_SKYRIDER_QUOTE_DOING_BADLY = 10;
const NO_DISTANCE = 9999;
const HOSPITAL_SECTOR: Sector = { x: 8, y: 6, z: 0 };
const SAM_SITE_ONE = 0;
const SAM_SITE_TWO = 1;
const SAM_SITE_THREE = 2;
const SAM_SITE_FOUR = 3;
export const PROF_HUMMER = 'PROF_HUMMER';
export const PROF_ICECREAM = 'PROF_ICECREAM';
const PROF_HELICOPTER = 'PROF_HELICOPTER';

const name = (s: Sector) => sectorShortString(s);

export function initializeHelicopter(ctx: StrategicContext): void {
  const f = ctx.state.forces;
  f.helicopterVehicleId = NO_HELICOPTER_ID;
  f.helicopterAirborne = false;
  f.helicopter = createHelicopterState();
}

export function heliState(ctx: StrategicContext): HelicopterState {
  return ctx.state.forces.helicopter;
}

export function helicopterVehicle(ctx: StrategicContext): VehicleRecord | null {
  const id = ctx.state.forces.helicopterVehicleId;
  return id === NO_HELICOPTER_ID ? null : findVehicle(ctx, id);
}

function requireHelicopter(ctx: StrategicContext): VehicleRecord {
  const v = helicopterVehicle(ctx);
  if (!v) throw new RangeError('there is no helicopter');
  return v;
}

export function helicopterGroup(ctx: StrategicContext): Group | undefined {
  const v = helicopterVehicle(ctx);
  return v ? getGroup(ctx, v.movementGroup) : undefined;
}

function requireHelicopterGroup(ctx: StrategicContext): Group {
  const g = helicopterGroup(ctx);
  if (!g) throw new RangeError('the helicopter has no movement group');
  return g;
}

function quote(ctx: StrategicContext, id: number): void {
  ctx.helicopter.emit({ type: 'skyriderQuote', quote: id });
}

function now(ctx: StrategicContext): number {
  return worldTotalMinutes(ctx.state.clock);
}

function stop(ctx: StrategicContext): void {
  stopTimeCompression(ctx.clock, CompressionStop.HELICOPTER);
}

export function skyriderBalance(ctx: StrategicContext): number {
  return ctx.state.profiles.get(SKYRIDER)?.balance ?? 0;
}

function setSkyriderBalance(ctx: StrategicContext, balance: number): void {
  const p = ctx.state.profiles.get(SKYRIDER);
  if (p) p.balance = i32(balance);
}

export function soldierAboardAirborneHeli(ctx: StrategicContext, m: StrategicMerc): boolean {
  return inHelicopter(ctx, m) && ctx.state.forces.helicopterAirborne;
}

export function isHelicopterPilotAvailable(ctx: StrategicContext): boolean {
  if (ctx.state.forces.helicopterVehicleId === NO_HELICOPTER_ID) return false;
  if (skyriderBalance(ctx) < 0) return false;
  return !ctx.helicopter.skyriderLoyaltyLow();
}

export function canHelicopterTakeOff(ctx: StrategicContext): boolean {
  if (ctx.state.forces.helicopterAirborne) return true;
  const v = requireHelicopter(ctx);
  return ctx.state.map.elements[strategicIndex(v.sector)]?.enemyControlled !== true;
}

export function canHelicopterFly(ctx: StrategicContext): boolean {
  if (ctx.state.forces.helicopterVehicleId === NO_HELICOPTER_ID) return false;
  if (!isHelicopterPilotAvailable(ctx)) return false;
  if (heliState(ctx).returningToBase) return false;
  return canHelicopterTakeOff(ctx);
}

export function whyHelicopterCannotFly(ctx: StrategicContext): HelicopterRefusal | null {
  if (canHelicopterFly(ctx)) return null;
  if (ctx.state.forces.helicopterVehicleId === NO_HELICOPTER_ID) return HelicopterRefusal.NO_HELICOPTER;
  if (skyriderBalance(ctx) < 0) return HelicopterRefusal.SKYRIDER_OWED;
  if (heliState(ctx).returningToBase) return HelicopterRefusal.RETURNING_TO_BASE;
  if (!canHelicopterTakeOff(ctx)) return HelicopterRefusal.GROUNDED;
  return HelicopterRefusal.SKYRIDER_UNWILLING;
}

export function explainWhySkyriderCantFly(ctx: StrategicContext): HelicopterRefusal | null {
  const refusal = whyHelicopterCannotFly(ctx);
  const id = refusal ? REFUSAL_QUOTES[refusal] : null;
  if (id !== null) quote(ctx, id);
  return refusal;
}

export function isSkyriderFlyingInSector(ctx: StrategicContext, s: Sector): boolean {
  const v = helicopterVehicle(ctx);
  if (!v || !canHelicopterFly(ctx) || !ctx.state.forces.helicopterAirborne) return false;
  return sameSector(s, v.sector);
}

export function okUseVehicle(ctx: StrategicContext, v: VehicleRecord): boolean {
  switch (ctx.content.vehicles[v.type]?.profile) {
    case PROF_HUMMER:
      return ctx.helicopter.fact(FACT_OK_USE_HUMMER);
    case PROF_ICECREAM:
      return ctx.helicopter.fact(FACT_OK_USE_ICECREAM);
    case PROF_HELICOPTER:
      return canHelicopterFly(ctx);
    default:
      return true;
  }
}

export function updateRefuelSiteAvailability(ctx: StrategicContext): void {
  const available = heliState(ctx).refuelSiteAvailable;
  REFUEL_SITES.forEach((site, i) => {
    const m = ctx.state.map.elements[strategicIndex(site.sector)];
    const estoniClosed = i === RefuelSiteId.ESTONI && !ctx.helicopter.fact(FACT_ESTONI_REFUELLING_POSSIBLE);
    available[i] = !(m?.enemyControlled || m?.enemyAirControlled || estoniClosed);
  });
}

export function setUpHelicopterForMovement(ctx: StrategicContext): void {
  const v = requireHelicopter(ctx);
  if (v.movementGroup !== 0) return;
  const g = createNewVehicleGroupDepartingFromSector(ctx, v.sector);
  v.movementGroup = g.id;
  for (const id of passengersOf(v)) addPlayerToGroup(ctx, g, id);
}

export function setUpHelicopterForPlayer(ctx: StrategicContext, s: Sector): void {
  const heli = heliState(ctx);
  if (heli.setUp) return;
  ctx.state.forces.helicopterVehicleId = addVehicleToList(ctx, s, HELICOPTER_VEHICLE_TYPE);
  setUpHelicopterForMovement(ctx);
  updateRefuelSiteAvailability(ctx);
  heli.setUp = true;
  ctx.helicopter.emit({ type: 'helicopterSetUp', sector: name(s) });
}

function isHelicopterOnGroundAtRefuelingSite(ctx: StrategicContext, site: number): boolean {
  const heli = heliState(ctx);
  if (heli.destroyed || ctx.state.forces.helicopterAirborne) return false;
  if (!heli.setUp) return site === RefuelSiteId.DRASSEN;
  const v = helicopterVehicle(ctx);
  const refuel = REFUEL_SITES[site];
  return v !== null && refuel !== undefined && strategicIndex(v.sector) === strategicIndex(refuel.sector);
}

export function handleHelicopterOnGround(ctx: StrategicContext): void {
  const world = ctx.state.worldSector;
  if (world?.z !== 0) return;
  const site = REFUEL_SITES.findIndex((r) => strategicIndex(r.sector) === strategicIndex(world));
  if (site < 0 || ctx.state.forces.helicopterVehicleId === NO_HELICOPTER_ID) return;
  ctx.helicopter.skyriderOnGround(isHelicopterOnGroundAtRefuelingSite(ctx, site) ? world : null);
}

export function takeOffHelicopter(ctx: StrategicContext): void {
  ctx.state.forces.helicopterAirborne = true;
  heliState(ctx).hovering = false;
  handleHelicopterOnGround(ctx);
  const v = helicopterVehicle(ctx);
  if (v) ctx.helicopter.emit({ type: 'heliTakeOff', sector: name(v.sector) });
}

function startHoverTime(ctx: StrategicContext, s: Sector): void {
  const heli = heliState(ctx);
  heli.hovering = true;
  heli.startHoverMinute = now(ctx);
  addStrategicEvent(ctx.state.queue, EventKind.HELICOPTER_HOVER_TOO_LONG, now(ctx) + TIME_DELAY_FOR_HOVER_WAIT, 0);
  ctx.helicopter.emit({ type: 'heliHovering', sector: name(s), stage: 'started' });
}

export function handleHeliHoverLong(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  const v = helicopterVehicle(ctx);
  if (!heli.hovering || !v) {
    heli.startHoverMinute = 0;
    return;
  }
  addStrategicEvent(
    ctx.state.queue,
    EventKind.HELICOPTER_HOVER_WAY_TOO_LONG,
    heli.startHoverMinute + TIME_DELAY_FOR_HOVER_WAIT_TOO_LONG,
    0,
  );
  quote(ctx, SkyriderQuote.HOVERING_A_WHILE);
  stop(ctx);
  ctx.helicopter.emit({ type: 'heliHovering', sector: name(v.sector), stage: 'long' });
}

export function handleHeliHoverTooLong(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  heli.startHoverMinute = 0;
  const v = helicopterVehicle(ctx);
  if (!heli.hovering || !v) return;
  quote(ctx, SkyriderQuote.RETURN_TO_BASE);
  ctx.helicopter.emit({ type: 'heliHovering', sector: name(v.sector), stage: 'tooLong' });
  if (numEnemiesInSector(ctx, v.sector) === 0) moveAllInHelicopterToFootMovementGroup(ctx);
  makeHeliReturnToBase(ctx);
}

function doesSkyriderNoticeEnemiesInSector(ctx: StrategicContext, enemies: number): boolean {
  if (!canHelicopterFly(ctx)) return false;
  if (enemies === 0) return false;
  return ctx.preRandom.int(100) < u8(ENEMY_NOTICE_BASE_CHANCE + enemies);
}

function samSector(ctx: StrategicContext, sam: number): Sector | null {
  const site = ctx.content.samSites[sam];
  return site ? sectorFromId(site.sector) : null;
}

function handleSamSiteAttackOfHelicopterInSector(ctx: StrategicContext, s: Sector): boolean {
  if (!ctx.state.map.elements[strategicIndex(s)]?.enemyAirControlled) return false;
  const samId = ctx.content.samAirControl[sectorId(s)] ?? -1;
  if (samId < 0) return false;
  const where = samSector(ctx, samId);
  const condition = where ? (ctx.state.map.elements[strategicIndex(where)]?.samCondition ?? 0) : 0;
  if (condition < MIN_CONDITION_FOR_SAM_SITE_TO_WORK) return false;
  const chance = Math.min(u8(condition), MAX_SAM_SITE_ACCURACY);
  if (ctx.preRandom.int(100) >= chance) return false;
  const heli = heliState(ctx);
  heli.hitsTaken = u8(heli.hitsTaken + 1);
  stop(ctx);
  ctx.helicopter.emit({ type: 'heliHit', sector: name(s), hits: heli.hitsTaken });
  if (heli.hitsTaken === 1) quote(ctx, SkyriderQuote.HELI_TOOK_MINOR_DAMAGE);
  else if (heli.hitsTaken === 2) {
    quote(ctx, SkyriderQuote.HELI_TOOK_MAJOR_DAMAGE);
    makeHeliReturnToBase(ctx);
  } else {
    quote(ctx, SkyriderQuote.HELI_GOING_DOWN);
    skyriderDestroyed(ctx);
    return true;
  }
  return false;
}

function airspaceCost(ctx: StrategicContext, s: Sector): number {
  const unsafe = ctx.state.map.elements[strategicIndex(s)]?.enemyAirControlled === true;
  return unsafe ? ctx.content.travel.airspaceCostUnsafe : ctx.content.travel.airspaceCostSafe;
}

export function handleHeliEnteringSector(ctx: StrategicContext, s: Sector, neverLeft: boolean): boolean {
  const v = requireHelicopter(ctx);
  const heli = heliState(ctx);
  const endOfPath = v.path.length < 2;
  if (!neverLeft && handleSamSiteAttackOfHelicopterInSector(ctx, s)) return true;
  const enemies = numEnemiesInSector(ctx, s);
  if (enemies > 0 && !neverLeft && whatPlayerKnowsAboutEnemiesInSector(ctx, s) === EnemyKnowledge.NOTHING) {
    if (doesSkyriderNoticeEnemiesInSector(ctx, enemies)) {
      if (!endOfPath) {
        stop(ctx);
        const spotted =
          ctx.helicopter.cosmeticChoice(2) !== 0
            ? SkyriderQuote.ENEMIES_SPOTTED_EN_ROUTE_IN_FRIENDLY_SECTOR_A
            : SkyriderQuote.ENEMIES_SPOTTED_EN_ROUTE_IN_FRIENDLY_SECTOR_B;
        quote(ctx, spotted);
      }
      const info = sectorInfo(ctx.state.map, s);
      info.flags = u32(info.flags | SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE);
      ctx.helicopter.emit({ type: 'enemiesSpottedFromAir', sector: name(s) });
    }
  }
  if (!heli.returningToBase && !neverLeft) heli.totalCost = i32(heli.totalCost + airspaceCost(ctx, s));
  if (!endOfPath) return false;
  startHoverTime(ctx, s);
  if (enemies === 0 || heli.returningToBase) {
    if (numberInVehicle(v) > 0 || !heli.returningToBase) {
      quote(ctx, SkyriderQuote.ARRIVED_IN_NON_HOSTILE_SECTOR);
      stop(ctx);
    }
    ctx.helicopter.emit({ type: 'heliArrived', sector: name(s), hostile: false });
    paySkyriderBill(ctx);
  } else {
    quote(ctx, SkyriderQuote.ARRIVED_IN_HOSTILE_SECTOR);
    stop(ctx);
    ctx.helicopter.emit({ type: 'heliArrived', sector: name(s), hostile: true });
  }
  if (isRefuelAvailableInSector(ctx, s)) landHelicopter(ctx);
  return false;
}

function findClosestRefuelSite(ctx: StrategicContext, mustBeAvailable: boolean): number | null {
  const v = requireHelicopter(ctx);
  const rules = stratPathRulesForGroup(ctx, requireHelicopterGroup(ctx));
  const available = heliState(ctx).refuelSiteAvailable;
  let shortest = NO_DISTANCE;
  let closest: number | null = null;
  REFUEL_SITES.forEach((site, i) => {
    if (!available[i] && mustBeAvailable) return;
    const distance = findStratPath(strategicIndex(v.sector), strategicIndex(site.sector), rules).length;
    if (distance >= shortest) return;
    shortest = distance;
    closest = i;
  });
  return closest;
}

function nearestRefuelPoint(ctx: StrategicContext): { readonly site: number; readonly safe: boolean } {
  const safe = findClosestRefuelSite(ctx, true);
  if (safe !== null) return { site: safe, safe: true };
  return { site: findClosestRefuelSite(ctx, false) ?? RefuelSiteId.DRASSEN, safe: false };
}

export function isRefuelAvailableInSector(ctx: StrategicContext, s: Sector): boolean {
  const site = REFUEL_SITES[nearestRefuelPoint(ctx).site];
  return site !== undefined && strategicIndex(site.sector) === strategicIndex(s);
}

function landHelicopter(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  ctx.state.forces.helicopterAirborne = false;
  heli.hovering = false;
  heli.returningToBase = false;
  handleHelicopterOnGround(ctx);
  const v = helicopterVehicle(ctx);
  if (v) ctx.helicopter.emit({ type: 'heliLanded', sector: name(v.sector) });
  if (!canHelicopterFly(ctx)) moveAllInHelicopterToFootMovementGroup(ctx);
  else ctx.helicopter.scheduleKillChopperMeanwhile();
}

export function makeHeliReturnToBase(ctx: StrategicContext): void {
  const v = requireHelicopter(ctx);
  if (isRefuelAvailableInSector(ctx, v.sector)) landHelicopter(ctx);
  else {
    const { site, safe } = nearestRefuelPoint(ctx);
    const refuel = REFUEL_SITES[site] ?? REFUEL_SITES[0];
    const g = requireHelicopterGroup(ctx);
    v.path = [];
    g.waypoints = [];
    g.nextWaypointId = 0;
    v.path = (refuel ? buildAStrategicPath(ctx, strategicIndex(v.sector), strategicIndex(refuel.sector), g) : null) ?? [];
    rebuildWayPointsForGroupPath(ctx, v.path, g);
    const heli = heliState(ctx);
    heli.returningToBase = true;
    heli.hovering = false;
    if (refuel) ctx.helicopter.emit({ type: 'heliReturning', to: name(refuel.sector), safe });
  }
  stop(ctx);
}

function skyriderDestroyed(ctx: StrategicContext): void {
  const v = requireHelicopter(ctx);
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, v.movementGroup);
  const killed = killAllInVehicle(ctx, v);
  const skyrider = ctx.state.profiles.get(SKYRIDER);
  if (skyrider) skyrider.life = 0;
  const heli = heliState(ctx);
  heli.destroyed = true;
  setSkyriderBalance(ctx, 0);
  heli.totalCost = 0;
  removeVehicleFromList(v);
  ctx.state.forces.helicopterVehicleId = NO_HELICOPTER_ID;
  ctx.helicopter.emit({ type: 'heliDestroyed', sector: name(v.sector), killed });
}

function payToSkyrider(ctx: StrategicContext, amount: number): void {
  const record = addTransaction(ctx.state.finances, FinanceCode.PAYMENT_TO_NPC, SKYRIDER, now(ctx), -amount);
  ctx.helicopter.emit({ type: 'heliPaid', amount, balance: record.balanceAfter });
}

function paySkyriderBill(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  if (heli.totalCost <= 0) return;
  const balance = ctx.state.finances.balance;
  if (balance >= heli.totalCost) payToSkyrider(ctx, heli.totalCost);
  else {
    if (balance > 0) {
      setSkyriderBalance(ctx, balance - heli.totalCost);
      payToSkyrider(ctx, balance);
    } else setSkyriderBalance(ctx, -heli.totalCost);
    quote(ctx, SkyriderQuote.OWED_MONEY_TO_SKYRIDER);
    ctx.helicopter.emit({ type: 'heliOwed', amount: -skyriderBalance(ctx) });
    moveAllInHelicopterToFootMovementGroup(ctx);
    makeHeliReturnToBase(ctx);
  }
  heli.totalCost = 0;
}

export function payOffSkyriderDebtIfAny(ctx: StrategicContext): void {
  let owed = -skyriderBalance(ctx);
  const balance = ctx.state.finances.balance;
  if (owed <= 0 || balance <= 0) return;
  const pay = Math.min(owed, balance);
  setSkyriderBalance(ctx, skyriderBalance(ctx) + pay);
  payToSkyrider(ctx, pay);
  owed = -skyriderBalance(ctx);
  if (owed <= 0) return;
  ctx.helicopter.emit({ type: 'heliOwed', amount: owed });
  quote(ctx, SkyriderQuote.OWED_MONEY_TO_SKYRIDER);
}

export function removeSoldierFromHelicopter(ctx: StrategicContext, id: number): boolean {
  const v = helicopterVehicle(ctx);
  if (!v) return false;
  const heli = heliState(ctx);
  if (ctx.state.forces.helicopterAirborne && !heli.hovering) return false;
  if (heli.returningToBase) return false;
  const m = requireMerc(ctx, id);
  m.sector = { ...v.sector };
  m.betweenSectors = false;
  return takeSoldierOutOfVehicle(ctx, id);
}

export function moveAllInHelicopterToFootMovementGroup(ctx: StrategicContext): void {
  const v = requireHelicopter(ctx);
  const riders = passengersOf(v);
  if (riders.length === 0) return;
  const squad = getFirstEmptySquad(ctx);
  let insertion: { readonly code: number; readonly data: number } | null = null;
  for (const id of riders) {
    removeSoldierFromHelicopter(ctx, id);
    addCharacterToSquad(ctx, id, squad);
    const m = requireMerc(ctx, id);
    if (!insertion) insertion = { code: m.insertionCode, data: ctx.mercs.insertionData?.(id) ?? 0 };
    else {
      m.insertionCode = insertion.code;
      ctx.mercs.setInsertionData?.(id, insertion.data);
    }
  }
  ctx.helicopter.emit({ type: 'passengersDropped', sector: name(v.sector), soldiers: riders, squad });
}

function revealSamSites(ctx: StrategicContext, sams: readonly number[]): void {
  const sites: string[] = [];
  for (const sam of sams) {
    const site = ctx.content.samSites[sam];
    if (!site) continue;
    markSecretFoundAt(ctx, site.sector);
    sites.push(name(sectorFromId(site.sector)));
  }
  ctx.helicopter.emit({ type: 'samSitesRevealed', sites });
}

function monologueAboutDrassenSamSite(ctx: StrategicContext): void {
  ctx.helicopter.emit({ type: 'skyriderMonologue', topic: 'drassenSam' });
  quote(ctx, SkyriderQuote.MENTION_DRASSEN_SAM_SITE);
  revealSamSites(ctx, [SAM_SITE_TWO]);
  const sam = samSector(ctx, SAM_SITE_TWO);
  if (sam && ctx.state.map.elements[strategicIndex(sam)]?.enemyControlled)
    quote(ctx, SkyriderQuote.SECOND_HALF_OF_MENTION_DRASSEN_SAM_SITE);
  else if (ctx.helicopter.fact(FACT_SKYRIDER_USED_IN_MAPSCREEN)) {
    quote(ctx, SkyriderQuote.SAM_SITE_TAKEN);
    heliState(ctx).saidCongratsOnTakingSam = true;
  }
}

function monologueAboutCambriaHospital(ctx: StrategicContext): void {
  ctx.helicopter.emit({ type: 'skyriderMonologue', topic: 'cambriaHospital' });
  quote(ctx, SkyriderQuote.MENTION_HOSPITAL_IN_CAMBRIA);
}

function monologueAboutOtherSamSites(ctx: StrategicContext): void {
  ctx.helicopter.emit({ type: 'skyriderMonologue', topic: 'otherSams' });
  quote(ctx, SkyriderQuote.SPIEL_ABOUT_OTHER_SAM_SITES);
  revealSamSites(ctx, [SAM_SITE_ONE, SAM_SITE_THREE, SAM_SITE_FOUR]);
  quote(ctx, SkyriderQuote.SECOND_HALF_OF_SPIEL_ABOUT_OTHER_SAM_SITES);
}

function monologueAboutEstoniRefuel(ctx: StrategicContext): void {
  ctx.helicopter.emit({ type: 'skyriderMonologue', topic: 'estoniRefuel' });
  quote(ctx, SkyriderQuote.SPIEL_ABOUT_ESTONI_AIRSPACE);
}

function monologue(ctx: StrategicContext, say: (ctx: StrategicContext) => void): void {
  say(ctx);
  heliState(ctx).lastMonologueMinute = now(ctx);
}

export function checkAndHandleSkyriderMonologues(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  if (now(ctx) - heli.lastMonologueMinute < MINUTES_BETWEEN_SKYRIDER_MONOLOGUES) return;
  switch (heli.talkState) {
    case 0:
      monologue(ctx, monologueAboutDrassenSamSite);
      heli.talkState = 1;
      break;
    case 1:
      if (ctx.state.map.elements[strategicIndex(HOSPITAL_SECTOR)]?.enemyControlled) monologue(ctx, monologueAboutCambriaHospital);
      heli.talkState = 2;
      break;
    case 2:
      if (!heli.saidCongratsOnTakingSam) break;
      monologue(ctx, monologueAboutOtherSamSites);
      heli.talkState = 3;
      break;
    case 3:
      if (!heli.refuelSiteAvailable[RefuelSiteId.ESTONI]) break;
      monologue(ctx, monologueAboutEstoniRefuel);
      heli.talkState = 4;
      break;
  }
}

export function skyriderCongratulatesOnSamTaken(ctx: StrategicContext): void {
  const heli = heliState(ctx);
  if (!isHelicopterPilotAvailable(ctx) || heli.talkState < 1 || heli.saidCongratsOnTakingSam) return;
  quote(ctx, SkyriderQuote.SAM_SITE_TAKEN);
  heli.saidCongratsOnTakingSam = true;
}

function playerMercsInHelicopterSector(ctx: StrategicContext): number {
  const g = requireHelicopterGroup(ctx);
  if (g.betweenSectors) return 0;
  return playerMercsInSector(ctx, g.sector);
}

export type DestinationRequest =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: HelicopterRefusal | 'emptyHelicopterHint' };

export function requestGiveSkyriderNewDestination(ctx: StrategicContext): DestinationRequest {
  if (!canHelicopterFly(ctx)) {
    const refusal = explainWhySkyriderCantFly(ctx) ?? HelicopterRefusal.NO_HELICOPTER;
    return { ok: false, refusal };
  }
  const heli = heliState(ctx);
  const v = requireHelicopter(ctx);
  if (!heli.emptyHelpGiven && numberInVehicle(v) === 0 && playerMercsInHelicopterSector(ctx) > 0) {
    heli.emptyHelpGiven = true;
    ctx.helicopter.emit({ type: 'heliEmptyHint', sector: name(v.sector) });
    return { ok: false, refusal: 'emptyHelicopterHint' };
  }
  quote(ctx, SkyriderQuote.SKYRIDER_SAYS_HI);
  ctx.helicopter.setFactTrue(FACT_SKYRIDER_USED_IN_MAPSCREEN);
  return { ok: true };
}

export function lastSectorOfHelicoptersPath(ctx: StrategicContext): number {
  const v = requireHelicopter(ctx);
  return lastSectorOfPath(v.path, strategicIndex(v.sector));
}

export function plotPathForHelicopter(ctx: StrategicContext, dest: Sector): boolean {
  if (!isTheCursorAllowedToHighLightThisSector(ctx, dest)) return false;
  setUpHelicopterForMovement(ctx);
  const v = requireHelicopter(ctx);
  const section = buildAStrategicPath(ctx, lastSectorOfHelicoptersPath(ctx), strategicIndex(dest), requireHelicopterGroup(ctx));
  v.path = appendStrategicPath(section, v.path);
  return true;
}

function handleNewDestConfirmation(ctx: StrategicContext, dest: Sector): void {
  const known = numEnemiesInSector(ctx, dest) === 0 || whatPlayerKnowsAboutEnemiesInSector(ctx, dest) === EnemyKnowledge.NOTHING;
  if (!known) {
    quote(ctx, SkyriderQuote.BELIEVED_ENEMY_SECTOR);
    return;
  }
  const heli = heliState(ctx);
  const progress = u8(ctx.ai.progressPercentage());
  const last = heli.progressLastCommentedOn;
  if (progress > last && progress - last >= MIN_PROGRESS_FOR_SKYRIDER_QUOTE_DOING_WELL) {
    quote(ctx, SkyriderQuote.THINGS_ARE_GOING_WELL);
    heli.progressLastCommentedOn = progress;
  } else if (progress < last && last - progress >= MIN_REGRESS_FOR_SKYRIDER_QUOTE_DOING_BADLY) {
    quote(ctx, SkyriderQuote.THINGS_ARE_GOING_BADLY);
    heli.progressLastCommentedOn = progress;
  } else quote(ctx, SkyriderQuote.CONFIRM_DESTINATION);
}

export function confirmHelicopterRoute(ctx: StrategicContext, dest: Sector): void {
  takeOffHelicopter(ctx);
  const v = requireHelicopter(ctx);
  rebuildWayPointsForGroupPath(ctx, v.path, requireHelicopterGroup(ctx));
  if (helicopterVehicle(ctx)?.path.length) handleNewDestConfirmation(ctx, dest);
}

export function cancelHelicopterRoute(ctx: StrategicContext): void {
  const v = requireHelicopter(ctx);
  if (v.path.length > 0) cancelPathForVehicle(ctx, v, false);
}
