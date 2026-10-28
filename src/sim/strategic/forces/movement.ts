// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc GroupReversingDirectionsBetweenSectors,
// @src GroupBetweenSectorsAndSectorXYIsInDifferentDirection, AddWaypointToPGroup, InitiateGroupMovementToNextSector,
// @src DelayEnemyGroupsIfPathsCross, GroupArrivedAtSector, HandleNonCombatGroupArrival, CalculateNextMoveIntention,
// @src AwardExperienceForTravelling, PlayerGroupArrivedSafelyInSector, HandlePlayerGroupEnteringSectorToCheckForNPCsOfNote,
// @src RetreatGroupToPreviousSector, CalculateGroupRetreatSector, ResetMovementForEnemyGroup, RandomizePatrolGroupLocation,
// @src PlaceGroupInSector, MoveAllGroupsInCurrentSectorToSector, GroupWillMoveThroughSector, SpendVehicleFuel;
// @src Strategic_Pathing.cc RebuildWayPointsForGroupPath, ClearMercPathsAndWaypointsForAllInGroup, MoveGroupFromSectorToSector*,
// @src AddSectorToFrontOfMercPathForAllSoldiersInGroup, GetGroupMercPathPtr.
// @src The MSG_ARRIVE line of GroupArrivedAtSector becomes the groupArrived event.

import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import {
  type Sector,
  sameSector,
  sectorFromId,
  sectorFromStrategicIndex,
  sectorId,
  sectorShortString,
  strategicIndex,
} from '../../../content/strategic/sector-ids.ts';
import { Direction } from '../../../content/world/grid.ts';
import { i16, idiv, u8, u16, u32 } from '../../../core/int.ts';
import { markSecretFoundAt, secretIndexAt, setThisSectorAsPlayerControlled } from '../map/control.ts';
import { buildStrategicPath, removeHeadFromStrategicPath, removeTailFromStrategicPath, type StratPathRules } from '../map/pathing.ts';
import { getSectorFlagStatus, sectorInfo, setSectorFlag, Traversability, traversabilityBetween } from '../map/sectors.ts';
import { getSectorMvtTimeForGroup } from '../map/travel.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent, deleteStrategicEvent } from '../time/event-queue.ts';
import { CompressionStop, stopTimeCompression, worldDay, worldHour, worldTotalMinutes } from '../time/world-clock.ts';
import { ABOUT_TO_ARRIVE_DELAY, Assignment, GroupFlag, InsertionCode, MoveType, SectorFlag } from './constants.ts';
import { checkConditionsForBattle } from './encounters.ts';
import {
  countAllMilitiaInSector,
  findPlayerMovementGroupInSector,
  type Group,
  getGroup,
  groupAtFinalDestination,
  groupMembers,
  isHelicopterGroup,
  isHelicopterVehicle,
  playerMercsInSector,
  removeGroup,
  removeGroupWaypoints,
  setEnemyGroupSector,
  setGroupNextSectorValue,
  setGroupSectorValue,
  setLocationOfAllPlayerSoldiersInGroup,
  vehicleOfGroup,
  type Waypoint,
} from './groups.ts';
import { handleHeliEnteringSector } from './helicopter.ts';
import type { ArrivedWho } from './helicopter-events.ts';
import { type StrategicContext, TravelStat } from './ports.ts';
import { resetDeadSquadMemberList } from './squads.ts';
import { setVehicleSectorValues } from './vehicles.ts';

const ENEMY_SLEEP_CHANCE = 67;
const ENEMY_SLEEP_MINUTES = 360;
const ENEMY_SLEEP_VARIANCE = 121;
const NIGHT_FROM_HOUR = 21;
const NIGHT_UNTIL_HOUR = 4;
const UNDERGROUND_TRAVERSE_MINUTES = 1;
const TACTICAL_TRAVERSAL_MINUTES = 5;
const UNDERGROUND_TACTICAL_TRAVERSAL_MINUTES = 1;
const QUEUED_BATTLE_DELAY = 3;
const QUEUED_BATTLE_VARIANCE = 3;
const MEANWHILE_DELAY = 1;
const CROSSING_DELAY = 1;
const CROSSING_VARIANCE = 10;
const BOXING_SECTOR: Sector = { x: 5, y: 4, z: 0 };
const TRAVEL_EXPERIENCE_SCALE = 450;
const FULL_STAT = 100;
const CARRY_THRESHOLD = 50;
const VEHICLE_FUEL_PER_MINUTE = 6;
const MIN_RETREAT_MINUTES = 5;
const SLEEPING_TRAVERSE_LIMIT = 400;
const RESET_SLEEPING_TRAVERSE = 90;
const NO_PREVIOUS_X = 16;
const NO_PREVIOUS_Y = 16;

export function nowMinutes(ctx: StrategicContext): number {
  return worldTotalMinutes(ctx.state.clock);
}

function postArrival(ctx: StrategicContext, g: Group): boolean {
  return addStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
}

function postAboutToArriveIfAhead(ctx: StrategicContext, g: Group): void {
  if (g.player && u32(g.arrivalTime - ABOUT_TO_ARRIVE_DELAY) > nowMinutes(ctx)) {
    addStrategicEvent(ctx.state.queue, EventKind.GROUP_ABOUT_TO_ARRIVE, u32(g.arrivalTime - ABOUT_TO_ARRIVE_DELAY), g.id);
  }
}

export function groupMercPath(ctx: StrategicContext, g: Group): number[] {
  if (g.vehicle) return vehicleOfGroup(ctx, g).path;
  const first = g.members[0];
  return first === undefined ? [] : (ctx.mercs.get(first)?.path ?? []);
}

export function addSectorToFrontOfMercPathForAllSoldiersInGroup(ctx: StrategicContext, g: Group, s: Sector): void {
  const index = strategicIndex(s);
  for (const m of groupMembers(ctx, g)) m.path = [index, ...m.path];
  if (g.vehicle) {
    const v = vehicleOfGroup(ctx, g);
    v.path = [index, ...v.path];
  }
}

function clearVehiclePath(ctx: StrategicContext, vehicleId: number): void {
  const v = ctx.state.forces.vehicles[vehicleId];
  if (!v || v.path.length === 0) return;
  v.path = [];
  const vg = getGroup(ctx, v.movementGroup);
  if (vg) removeGroupWaypoints(vg);
}

export function clearMercPathsAndWaypointsForAllInGroup(ctx: StrategicContext, g: Group): void {
  for (const m of groupMembers(ctx, g)) {
    if (m.path.length > 0) {
      m.path = [];
      const own = getGroup(ctx, m.groupId);
      if (own) removeGroupWaypoints(own);
    }
    if (m.isVehicle || m.assignment === Assignment.VEHICLE) clearVehiclePath(ctx, m.vehicleId);
  }
  if (g.vehicle) clearVehiclePath(ctx, ctx.state.forces.vehicles.indexOf(vehicleOfGroup(ctx, g)));
  removeGroupWaypoints(g);
}

export function groupBetweenSectorsAndSectorXYIsInDifferentDirection(g: Group, s: Sector): boolean {
  if (!g.betweenSectors) return false;
  const current = { x: g.next.x - g.sector.x, y: g.next.y - g.sector.y, z: g.next.z - g.sector.z };
  const wanted = { x: s.x - g.sector.x, y: s.y - g.sector.y, z: s.z - g.sector.z };
  let unaligned = 0;
  if (wanted.x) {
    unaligned++;
    wanted.x = Math.sign(wanted.x);
  }
  if (wanted.y) {
    unaligned++;
    wanted.y = Math.sign(wanted.y);
  }
  if (unaligned > 1) return false;
  return !(current.x === wanted.x && current.y === wanted.y && current.z === wanted.z);
}

export function groupReversingDirectionsBetweenSectors(ctx: StrategicContext, g: Group, s: Sector, buildingWaypoints: boolean): boolean {
  if (!groupBetweenSectorsAndSectorXYIsInDifferentDirection(g, s)) return false;
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  g.prev = g.next;
  g.next = g.sector;
  g.sector = g.prev;
  if (g.player) setLocationOfAllPlayerSoldiersInGroup(ctx, g, g.sector);
  const now = nowMinutes(ctx);
  g.arrivalTime = u32(g.traverseTime - g.arrivalTime + now * 2);
  if (g.arrivalTime > now) {
    postArrival(ctx, g);
    postAboutToArriveIfAhead(ctx, g);
  } else if (!buildingWaypoints) {
    groupArrivedAtSector(ctx, g, true, true);
  }
  return true;
}

export function addWaypointToPGroup(ctx: StrategicContext, g: Group | undefined, s: Sector): boolean {
  if (!g) return false;
  let aligned = 0;
  let reversing = false;
  const last = g.waypoints[g.waypoints.length - 1];
  if (!last) {
    if (groupReversingDirectionsBetweenSectors(ctx, g, s, true)) {
      if (g.player) addSectorToFrontOfMercPathForAllSoldiersInGroup(ctx, g, g.sector);
      reversing = true;
    } else {
      if (g.sector.x === s.x) aligned++;
      if (g.sector.y === s.y) aligned++;
    }
  } else {
    if (last.x === s.x) aligned++;
    if (last.y === s.y) aligned++;
  }
  if (!reversing && aligned !== 1) return false;
  const first = g.waypoints.length === 0;
  g.waypoints.push({ x: s.x, y: s.y, z: s.z });
  if (first && !reversing) initiateGroupMovementToNextSector(ctx, g);
  if (g.player) for (const m of groupMembers(ctx, g)) m.insertionCode = InsertionCode.NORTH;
  return true;
}

export function addWaypointIdToPGroup(ctx: StrategicContext, g: Group | undefined, id: number): boolean {
  return addWaypointToPGroup(ctx, g, sectorFromId(id));
}

export function addWaypointStrategicIdToPGroup(ctx: StrategicContext, g: Group | undefined, index: number): boolean {
  return addWaypointToPGroup(ctx, g, sectorFromStrategicIndex(index));
}

function enemyGoesToSleep(ctx: StrategicContext, g: Group): boolean {
  if (g.player) return false;
  const hour = worldHour(ctx.state.clock);
  if (hour < NIGHT_FROM_HOUR && hour > NIGHT_UNTIL_HOUR) return false;
  return ctx.random.chance(ENEMY_SLEEP_CHANCE);
}

function stepToward(wp: Waypoint, g: Group): { direction: number; next: Sector } | null {
  const d = { x: wp.x - g.sector.x, y: wp.y - g.sector.y, z: wp.z - g.sector.z };
  let direction: number;
  if (d.x >= 1) {
    direction = StrategicMove.EAST;
    d.x = 1;
  } else if (d.y >= 1) {
    direction = StrategicMove.SOUTH;
    d.y = 1;
  } else if (d.x <= -1) {
    direction = StrategicMove.WEST;
    d.x = -1;
  } else if (d.y <= -1) {
    direction = StrategicMove.NORTH;
    d.y = -1;
  } else return null;
  return { direction, next: { x: g.sector.x + d.x, y: g.sector.y + d.y, z: g.sector.z + d.z } };
}

export function initiateGroupMovementToNextSector(ctx: StrategicContext, g: Group): void {
  const wp = g.waypoints[g.nextWaypointId];
  if (!wp) return;
  const step = stepToward(wp, g);
  if (!step) return;
  g.next = step.next;
  const id = sectorId(g.sector);
  let sleep = 0;
  if (!g.sector.z) {
    const sleeping = enemyGoesToSleep(ctx, g);
    g.traverseTime = u32(getSectorMvtTimeForGroup(ctx, id, step.direction, g));
    if (sleeping) sleep = ENEMY_SLEEP_MINUTES + ctx.random.int(ENEMY_SLEEP_VARIANCE);
  } else g.traverseTime = UNDERGROUND_TRAVERSE_MINUTES;
  g.traverseTime = u32(g.traverseTime + sleep);
  const tt = ctx.state.movement.tacticalTraversal;
  if (tt.active && tt.groupId === g.id) {
    g.traverseTime = ctx.state.movement.undergroundTacticalTraversal ? UNDERGROUND_TACTICAL_TRAVERSAL_MINUTES : TACTICAL_TRAVERSAL_MINUTES;
  }
  const now = nowMinutes(ctx);
  if (!g.betweenSectors) {
    g.betweenSectors = true;
    g.arrivalTime = u32(now + g.traverseTime);
  }
  if (ctx.state.movement.randomizingPatrolGroup) {
    g.traverseTime = u32(1 + ctx.random.int(u32(g.traverseTime - 1)));
    g.arrivalTime = u32(now + g.traverseTime);
  }
  if (g.vehicle) {
    const v = vehicleOfGroup(ctx, g);
    v.betweenSectors = true;
    if (!isHelicopterVehicle(ctx, v)) {
      const vs = ctx.mercs.get(v.soldierId);
      if (vs) {
        vs.betweenSectors = true;
        ctx.mercs.removeFromTacticalSector(vs.id);
      }
    }
  }
  postArrival(ctx, g);
  if (!g.player) return;
  postAboutToArriveIfAhead(ctx, g);
  for (const m of groupMembers(ctx, g)) {
    m.betweenSectors = true;
    ctx.mercs.removeFromTacticalSector(m.id);
  }
  ctx.world.checkAndHandleUnloadingOfCurrentWorld();
  if (!g.sector.z) delayEnemyGroupsIfPathsCross(ctx, g);
}

export function delayEnemyGroupsIfPathsCross(ctx: StrategicContext, pg: Group): void {
  for (const g of ctx.state.forces.groups) {
    if (g.player) continue;
    if (g.arrivalTime >= pg.arrivalTime) continue;
    if (!sameSector(g.next, pg.sector)) continue;
    if (!sameSector(g.sector, pg.next)) continue;
    deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
    g.arrivalTime = u32(pg.arrivalTime + CROSSING_DELAY + ctx.random.int(CROSSING_VARIANCE));
    postArrival(ctx, g);
  }
}

export function rebuildWayPointsForGroupPath(ctx: StrategicContext, path: readonly number[] | null, g: Group): void {
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  removeGroupWaypoints(g);
  if (!path || path.length < 2) {
    if (g.player && g.betweenSectors) groupReversingDirectionsBetweenSectors(ctx, g, g.sector, false);
    return;
  }
  const nodes = [...path];
  let oldDelta = g.betweenSectors ? strategicIndex(g.next) - strategicIndex(g.sector) : 0;
  for (let k = 0; k + 1 < nodes.length; k++) {
    const node = nodes[k] ?? 0;
    const delta = (nodes[k + 1] ?? 0) - node;
    if (oldDelta !== 0 && delta !== oldDelta) addWaypointStrategicIdToPGroup(ctx, g, node);
    oldDelta = delta;
  }
  addWaypointStrategicIdToPGroup(ctx, g, nodes[nodes.length - 1] ?? 0);
  if (g.arrivalTime === nowMinutes(ctx)) groupArrivedAtSector(ctx, g, true, true);
}

function battleMustBeQueued(ctx: StrategicContext, g: Group, arrival: Sector, checkForBattle: boolean): boolean {
  const w = ctx.world;
  const world = ctx.state.worldSector;
  if (w.boxing() && !g.player && sameSector(arrival, BOXING_SECTOR)) return true;
  if (
    checkForBattle &&
    w.enemyInSector() &&
    world !== null &&
    findPlayerMovementGroupInSector(ctx, world) !== undefined &&
    (!sameSector(arrival, world) || world.z > 0)
  ) {
    return true;
  }
  if (w.inMeanwhile()) return true;
  return checkForBattle && (w.hostileCiviliansPresent() || w.hostileBloodcatsPresent());
}

function awardExperienceForTravelling(ctx: StrategicContext, g: Group): void {
  const traverse = g.traverseTime;
  for (const m of groupMembers(ctx, g)) {
    if (m.isVehicle || m.isRobot || m.isEpc) continue;
    if (m.lifeMax < FULL_STAT) {
      const points = idiv(traverse, idiv(TRAVEL_EXPERIENCE_SCALE, FULL_STAT - m.lifeMax));
      if (points > 0) ctx.mercs.awardTravelExperience(m.id, TravelStat.HEALTH, u8(points));
    }
    if (m.strength < FULL_STAT) {
      const carried = ctx.mercs.carriedWeightPercent(m.id);
      if (carried > CARRY_THRESHOLD) {
        const points = idiv(traverse, idiv(TRAVEL_EXPERIENCE_SCALE, FULL_STAT - m.strength));
        ctx.mercs.awardTravelExperience(m.id, TravelStat.STRENGTH, u16(idiv(points * (carried - CARRY_THRESHOLD), FULL_STAT)));
      }
    }
  }
}

function insertionFromTravel(arrival: Sector, prev: Sector): { direction: number; code: number } | null {
  if (arrival.x < prev.x) return { direction: Direction.SOUTHWEST, code: InsertionCode.EAST };
  if (arrival.x > prev.x) return { direction: Direction.NORTHEAST, code: InsertionCode.WEST };
  if (arrival.y < prev.y) return { direction: Direction.NORTHWEST, code: InsertionCode.SOUTH };
  if (arrival.y > prev.y) return { direction: Direction.SOUTHEAST, code: InsertionCode.NORTH };
  return null;
}

function spendVehicleFuel(ctx: StrategicContext, g: Group): void {
  const v = vehicleOfGroup(ctx, g);
  const remaining = ctx.mercs.spendVehicleFuel(v.soldierId, i16(g.traverseTime * VEHICLE_FUEL_PER_MINUTE));
  if (remaining === 0) clearMercPathsAndWaypointsForAllInGroup(ctx, g);
}

type ArrivalOutcome = 'invalid' | 'arrived' | 'destroyed';

function arrivedWho(ctx: StrategicContext, g: Group): ArrivedWho | null {
  if (g.vehicle) return { kind: 'vehicle', vehicleType: vehicleOfGroup(ctx, g).type };
  const first = groupMembers(ctx, g)[0];
  if (!first) return null;
  return first.assignment >= Assignment.ON_DUTY ? { kind: 'merc', soldier: first.id } : { kind: 'squad', squad: first.assignment };
}

function announceArrival(ctx: StrategicContext, g: Group, arrival: Sector, final: boolean, neverLeft: boolean): void {
  const who = arrivedWho(ctx, g);
  if (!who || neverLeft) return;
  const sector = arrival.z ? `${sectorShortString(arrival)}-${arrival.z}` : sectorShortString(arrival);
  ctx.helicopter.emit({ type: 'groupArrived', group: g.id, sector, final, who });
}

function updateArrivedPlayerGroup(ctx: StrategicContext, g: Group, arrival: Sector, neverLeft: boolean): ArrivalOutcome {
  const final = groupAtFinalDestination(g);
  if (final) clearMercPathsAndWaypointsForAllInGroup(ctx, g);
  if (arrival.z === 0 && secretIndexAt(ctx, sectorId(arrival)) >= 0) markSecretFoundAt(ctx, sectorId(arrival));
  const insertion = insertionFromTravel(arrival, g.prev);
  if (!insertion) return 'invalid';
  const world = ctx.state.worldSector;
  const here = world !== null && sameSector(arrival, world);
  let destroyed = false;
  if (!g.vehicle) {
    for (const m of groupMembers(ctx, g)) {
      m.betweenSectors = false;
      m.sector = arrival;
      m.prevSectorId = sectorId(g.prev);
      m.insertionDirection = insertion.direction;
      if (m.insertionCode !== InsertionCode.PRIMARY_EDGEINDEX && m.insertionCode !== InsertionCode.SECONDARY_EDGEINDEX) {
        m.insertionCode = insertion.code;
      }
      if (m.path.length > 0) m.path = removeHeadFromStrategicPath(m.path);
      if (here) ctx.mercs.updateMercInSector(m.id, arrival);
    }
  } else {
    const v = vehicleOfGroup(ctx, g);
    if (v.path.length > 0) v.path = removeHeadFromStrategicPath(v.path);
    setVehicleSectorValues(ctx, v, arrival);
    v.betweenSectors = false;
    if (!isHelicopterVehicle(ctx, v)) {
      const vs = ctx.mercs.get(v.soldierId);
      const riders = groupMembers(ctx, g);
      for (const m of vs ? [vs, ...riders] : riders) {
        m.betweenSectors = false;
        m.sector = arrival;
        m.insertionDirection = insertion.direction;
        m.insertionCode = insertion.code;
        if (here) ctx.mercs.updateMercInSector(m.id, arrival);
      }
    } else destroyed = handleHeliEnteringSector(ctx, arrival, neverLeft);
  }
  if (destroyed) return 'destroyed';
  announceArrival(ctx, g, arrival, final, neverLeft);
  if (!g.vehicle || !isHelicopterGroup(ctx, g)) {
    const spawn = ctx.content.bloodCatSpawns.find((b) => b.sector === sectorId(arrival));
    if (spawn?.isLair && !getSectorFlagStatus(ctx.state.map, arrival, SectorFlag.ALREADY_VISITED))
      ctx.world.addCorpsesToBloodcatLair(arrival);
    setSectorFlag(ctx.state.map, arrival, SectorFlag.ALREADY_VISITED, worldDay(ctx.state.clock));
  }
  return 'arrived';
}

export function groupArrivedAtSector(ctx: StrategicContext, g: Group, checkForBattle: boolean, neverLeft: boolean): void {
  const flow = ctx.state.movement;
  flow.waitingForInput = false;
  if (g.player) {
    const first = g.members[0] === undefined ? undefined : ctx.mercs.get(g.members[0]);
    if (first && first.assignment < Assignment.ON_DUTY) resetDeadSquadMemberList(ctx, first.assignment);
    if (g.vehicle) {
      const v = vehicleOfGroup(ctx, g);
      if (!isHelicopterVehicle(ctx, v) && g.size <= 1) return;
    } else if (g.members.length === 0) return;
  }
  const arrival: Sector = { x: g.next.x, y: g.next.y, z: g.sector.z };
  if (battleMustBeQueued(ctx, g, arrival, checkForBattle)) {
    const delay = ctx.world.inMeanwhile() ? MEANWHILE_DELAY : ctx.random.int(QUEUED_BATTLE_VARIANCE) + QUEUED_BATTLE_DELAY;
    g.arrivalTime = u32(g.arrivalTime + delay);
    postArrival(ctx, g);
    postAboutToArriveIfAhead(ctx, g);
    return;
  }
  g.prev = g.sector;
  g.sector = arrival;
  g.next = { x: 0, y: 0, z: g.next.z };
  if (g.player && !neverLeft) {
    if (!g.vehicle) awardExperienceForTravelling(ctx, g);
    else if (!isHelicopterGroup(ctx, g)) spendVehicleFuel(ctx, g);
  }
  g.traverseTime = 0;
  g.arrivalTime = 0;
  g.betweenSectors = false;
  const outcome = g.player ? updateArrivedPlayerGroup(ctx, g, arrival, neverLeft) : 'arrived';
  if (outcome === 'invalid') return;
  if (outcome === 'destroyed') {
    flow.waitingForInput = false;
    return;
  }
  if (checkForBattle && !checkConditionsForBattle(ctx, g) && !flow.waitingForInput) {
    handleNonCombatGroupArrival(ctx, g, true);
    releaseSimultaneousArrivals(ctx);
  } else {
    g.flags = 0;
    if (ctx.state.encounter.numAwareBattles !== 0) ctx.state.encounter.numAwareBattles--;
  }
  flow.waitingForInput = false;
}

function releaseSimultaneousArrivals(ctx: StrategicContext): void {
  const flow = ctx.state.movement;
  if (flow.numGroupsArrivedSimultaneously === 0) return;
  for (const other of [...ctx.state.forces.groups]) {
    if (!ctx.state.forces.groups.includes(other)) continue;
    if (!(other.flags & GroupFlag.GROUP_ARRIVED_SIMULTANEOUSLY)) continue;
    flow.numGroupsArrivedSimultaneously--;
    handleNonCombatGroupArrival(ctx, other, false);
    if (flow.numGroupsArrivedSimultaneously === 0) break;
  }
}

function handleNonCombatGroupArrival(ctx: StrategicContext, g: Group, mainGroup: boolean): void {
  if (ctx.ai.lookForAdjacentGroups(g)) return;
  if (g.player) {
    const heli = g.vehicle && isHelicopterGroup(ctx, g);
    if (!heli) setThisSectorAsPlayerControlled(ctx, g.sector, false);
    if (groupAtFinalDestination(g)) {
      if (playerMercsInSector(ctx, ctx.state.map.selectedSector) === 0) ctx.state.map.selectedSector = g.sector;
      if (!heli) stopTimeCompression(ctx.clock, CompressionStop.ARRIVED);
    }
    playerGroupArrivedSafelyInSector(ctx, g, mainGroup);
  } else if (!g.debug) {
    calculateNextMoveIntention(ctx, g);
  } else {
    removeGroup(ctx, g);
    return;
  }
  g.flags = 0;
}

function anyMercInGroupCantContinueMoving(ctx: StrategicContext, g: Group): boolean {
  let mustStop = false;
  for (const m of groupMembers(ctx, g)) {
    if (!ctx.mercs.tooTiredToTravel(m.id)) continue;
    ctx.mercs.collapseFromFatigue(m.id, !mustStop);
    mustStop = true;
  }
  return mustStop;
}

function promptForNpcsOfNote(ctx: StrategicContext, g: Group): boolean {
  if (g.members.length === 0 || isHelicopterGroup(ctx, g) || ctx.state.movement.groupPrompting !== null) return false;
  if (!ctx.world.npcOfNoteInSector(g.sector)) return false;
  ctx.state.movement.groupPrompting = g.id;
  return true;
}

export function playerGroupArrivedSafelyInSector(ctx: StrategicContext, g: Group, checkNpcs: boolean): void {
  if (checkNpcs && promptForNpcsOfNote(ctx, g)) return;
  if (groupAtFinalDestination(g)) return;
  if (anyMercInGroupCantContinueMoving(ctx, g)) {
    clearMercPathsAndWaypointsForAllInGroup(ctx, g);
    stopTimeCompression(ctx.clock, CompressionStop.HALTED);
  } else {
    rebuildWayPointsForGroupPath(ctx, groupMercPath(ctx, g), g);
  }
}

export function answerNpcOfNotePrompt(ctx: StrategicContext, continueMoving: boolean): void {
  const g = getGroup(ctx, ctx.state.movement.groupPrompting ?? -1);
  ctx.state.movement.groupPrompting = null;
  if (!g) return;
  if (continueMoving) {
    playerGroupArrivedSafelyInSector(ctx, g, false);
    return;
  }
  clearMercPathsAndWaypointsForAllInGroup(ctx, g);
  ctx.state.map.selectedSector = g.sector;
  stopTimeCompression(ctx.clock, CompressionStop.HALTED);
}

export function calculateNextMoveIntention(ctx: StrategicContext, g: Group): void {
  if (g.betweenSectors || g.waypoints.length === 0) return;
  const wp = g.waypoints[g.nextWaypointId];
  if (wp && sameSector(g.sector, wp)) {
    const isLast = g.nextWaypointId + 1 >= g.waypoints.length;
    switch (g.moveType) {
      case MoveType.ONE_WAY:
        if (isLast) return;
        g.nextWaypointId++;
        break;
      case MoveType.CIRCULAR:
        g.nextWaypointId = isLast ? 0 : g.nextWaypointId + 1;
        break;
      case MoveType.ENDTOEND_FORWARDS:
        if (isLast) {
          g.nextWaypointId--;
          g.moveType = MoveType.ENDTOEND_BACKWARDS;
        } else g.nextWaypointId++;
        break;
      case MoveType.ENDTOEND_BACKWARDS:
        if (!g.nextWaypointId) {
          g.nextWaypointId++;
          g.moveType = MoveType.ENDTOEND_FORWARDS;
        } else g.nextWaypointId--;
        break;
    }
  }
  initiateGroupMovementToNextSector(ctx, g);
}

function retreatTraversable(t: number | undefined): boolean {
  return t !== Traversability.GROUNDBARRIER && t !== Traversability.EDGEOFWORLD;
}

export function calculateGroupRetreatSector(ctx: StrategicContext, g: Group): void {
  const t = sectorInfo(ctx.state.map, g.sector).traversability;
  const { x, y, z } = g.sector;
  if (retreatTraversable(t[StrategicMove.NORTH])) g.prev = { x, y: y - 1, z };
  else if (retreatTraversable(t[StrategicMove.EAST])) g.prev = { x: x + 1, y, z };
  else if (retreatTraversable(t[StrategicMove.WEST])) g.prev = { x: x - 1, y, z };
  else if (retreatTraversable(t[StrategicMove.SOUTH])) g.prev = { x, y: y + 1, z };
  else {
    g.prev = g.sector;
    return;
  }
  if (g.player) for (const m of groupMembers(ctx, g)) m.prevSectorId = sectorId(g.prev);
}

function retreatDirection(g: Group): number {
  const dx = g.next.x - g.sector.x;
  const dy = g.next.y - g.sector.y;
  if (dx === 0 && dy === -1) return StrategicMove.NORTH;
  if (dx === 1 && dy === 0) return StrategicMove.EAST;
  if (dx === 0 && dy === 1) return StrategicMove.SOUTH;
  if (dx === -1 && dy === 0) return StrategicMove.WEST;
  throw new RangeError(`group ${g.id} attempting illegal retreat`);
}

export function retreatGroupToPreviousSector(ctx: StrategicContext, g: Group): void {
  if (g.prev.x === NO_PREVIOUS_X && g.prev.y === NO_PREVIOUS_Y) calculateGroupRetreatSector(ctx, g);
  g.next = g.prev;
  const direction = retreatDirection(g);
  g.traverseTime = u32(getSectorMvtTimeForGroup(ctx, sectorId(g.sector), direction, g));
  if (g.traverseTime === 0) g.traverseTime = MIN_RETREAT_MINUTES;
  g.arrivalTime = u32(nowMinutes(ctx) + g.traverseTime);
  g.betweenSectors = true;
  g.flags |= GroupFlag.JUST_RETREATED_FROM_BATTLE;
  if (g.vehicle) vehicleOfGroup(ctx, g).betweenSectors = true;
  postArrival(ctx, g);
  if (!g.player) return;
  postAboutToArriveIfAhead(ctx, g);
  for (const m of groupMembers(ctx, g)) {
    m.betweenSectors = true;
    ctx.mercs.removeFromTacticalSector(m.id);
  }
}

export function resetMovementForEnemyGroup(ctx: StrategicContext, g: Group): void {
  if (g.player) return;
  if (!g.betweenSectors || !g.next.x || !g.next.y) {
    ctx.ai.repollGroup(g);
    return;
  }
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  if (g.traverseTime > SLEEPING_TRAVERSE_LIMIT) g.traverseTime = RESET_SLEEPING_TRAVERSE;
  g.arrivalTime = u32(nowMinutes(ctx) + g.traverseTime);
  postArrival(ctx, g);
}

export function resetMovementForEnemyGroupsInLocation(ctx: StrategicContext, battleSector: Sector): void {
  for (const g of [...ctx.state.forces.groups]) if (!g.player && sameSector(g.sector, battleSector)) resetMovementForEnemyGroup(ctx, g);
}

export function randomizePatrolGroupLocation(ctx: StrategicContext, g: Group): void {
  deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
  const maxWaypointId = Math.max(0, g.waypoints.length - 1);
  let chosen = ctx.random.int(u8(maxWaypointId * 2));
  if (chosen >= maxWaypointId) {
    g.moveType = MoveType.ENDTOEND_BACKWARDS;
    g.nextWaypointId = u8(chosen - maxWaypointId);
    chosen = g.nextWaypointId + 1;
  } else {
    g.moveType = MoveType.ENDTOEND_FORWARDS;
    g.nextWaypointId = chosen + 1;
  }
  const wp = g.waypoints[chosen];
  if (!wp) return;
  ctx.state.movement.randomizingPatrolGroup = true;
  setEnemyGroupSector(ctx, g, sectorId(wp));
  initiateGroupMovementToNextSector(ctx, g);
  ctx.state.movement.randomizingPatrolGroup = false;
}

export function placeGroupInSector(ctx: StrategicContext, g: Group, prev: Sector, next: Sector, checkForBattle: boolean): void {
  clearMercPathsAndWaypointsForAllInGroup(ctx, g);
  g.prev = prev;
  setGroupSectorValue(ctx, { x: prev.x, y: prev.y, z: next.z }, g);
  setGroupNextSectorValue(g, next);
  groupArrivedAtSector(ctx, g, checkForBattle, false);
}

export function moveAllGroupsInCurrentSectorToSector(ctx: StrategicContext, s: Sector): void {
  const world = ctx.state.worldSector;
  for (const g of ctx.state.forces.groups) {
    if (!g.player || !world || !sameSector(g.sector, world) || g.betweenSectors) continue;
    g.sector = s;
    for (const m of groupMembers(ctx, g)) {
      m.sector = s;
      m.betweenSectors = false;
    }
  }
  ctx.world.checkAndHandleUnloadingOfCurrentWorld();
}

export function groupWillMoveThroughSector(g: Group, s: Sector): boolean {
  let at = g.sector;
  for (let k = g.nextWaypointId; k < g.waypoints.length; k++) {
    const wp = g.waypoints[k];
    if (!wp) break;
    while (!sameSector(at, wp)) {
      const dx = wp.x - at.x;
      const dy = wp.y - at.y;
      if ((dx && dy) || (!dx && !dy)) return true;
      at = { x: at.x + Math.sign(dx), y: at.y + Math.sign(dy), z: at.z };
      if (sameSector(at, s)) return true;
    }
  }
  return false;
}

export interface GroupPathOptions {
  readonly tacticalTraversal?: boolean;
  readonly direct?: boolean;
  readonly avoidPlayerInfluenced?: boolean;
}

export function stratPathRulesForGroup(ctx: StrategicContext, g: Group, options: GroupPathOptions = {}): StratPathRules {
  const travel = ctx.content.travel;
  const heli = isHelicopterGroup(ctx, g);
  return {
    edgeCost: (id, direction) => getSectorMvtTimeForGroup(ctx, id, direction, g),
    helicopterCost: heli
      ? (from) => (ctx.state.map.elements[from]?.enemyAirControlled ? travel.airspaceCostUnsafe : travel.airspaceCostSafe)
      : undefined,
    tacticalTraversal: options.tacticalTraversal === true,
    direct: g.player && options.direct === true,
    flatTravelTime: travel.flatStrategicTravelTime,
    traversability: (from, to) => traversabilityBetween(ctx.state.map, from, to),
    groundBarrier: Traversability.GROUNDBARRIER,
    avoid: options.avoidPlayerInfluenced
      ? (index) => {
          const s = sectorFromStrategicIndex(index);
          return (
            ctx.mercs.all().some((m) => sameSector(m.sector, s)) ||
            countAllMilitiaInSector(ctx, s) !== 0 ||
            !ctx.ai.okayForEnemyToMoveThroughSector(sectorId(s))
          );
        }
      : undefined,
  };
}

export function buildAStrategicPath(
  ctx: StrategicContext,
  start: number,
  end: number,
  g: Group,
  options: GroupPathOptions = {},
): number[] | null {
  return buildStrategicPath(start, end, stratPathRulesForGroup(ctx, g, options));
}

export function moveGroupFromSectorToSector(ctx: StrategicContext, g: Group, start: Sector, dest: Sector): boolean {
  const path = buildAStrategicPath(ctx, strategicIndex(start), strategicIndex(dest), g);
  if (!path) return false;
  rebuildWayPointsForGroupPath(ctx, path, g);
  return true;
}

function moveGroupFromSectorToSectorButAvoidLastSector(ctx: StrategicContext, g: Group, start: Sector, dest: Sector): boolean {
  const path = buildAStrategicPath(ctx, strategicIndex(start), strategicIndex(dest), g);
  if (!path) return false;
  rebuildWayPointsForGroupPath(ctx, removeTailFromStrategicPath(path), g);
  return true;
}

export function moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectors(
  ctx: StrategicContext,
  g: Group,
  start: Sector,
  dest: Sector,
): boolean {
  const path = buildAStrategicPath(ctx, strategicIndex(start), strategicIndex(dest), g, { avoidPlayerInfluenced: true });
  if (!path) return moveGroupFromSectorToSector(ctx, g, start, dest);
  rebuildWayPointsForGroupPath(ctx, path, g);
  return true;
}

export function moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectorsAndStopOneSectorBeforeEnd(
  ctx: StrategicContext,
  g: Group,
  start: Sector,
  dest: Sector,
): boolean {
  const path = buildAStrategicPath(ctx, strategicIndex(start), strategicIndex(dest), g, { avoidPlayerInfluenced: true });
  if (!path) return moveGroupFromSectorToSectorButAvoidLastSector(ctx, g, start, dest);
  rebuildWayPointsForGroupPath(ctx, removeTailFromStrategicPath(path), g);
  return true;
}
