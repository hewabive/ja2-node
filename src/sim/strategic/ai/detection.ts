// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc OkayForEnemyToMoveThroughSector, EnemyPermittedToAttackSector,
// @src AttemptToNoticeEmptySectorSucceeds, AttemptToNoticeAdjacentGroupSucceeds, AdjacentSectorIsImportantAndUndefended,
// @src HandlePlayerGroupNoticedByPatrolGroup, HandlePlayerGroupNoticedByGarrison, HandleMilitiaNoticedByPatrolGroup,
// @src HandleEmptySectorNoticedByPatrolGroup, HandleEmptySectorNoticedByGarrison, EnemyNoticesPlayerArrival,
// @src StrategicAILookForAdjacentGroups, CheckEnemyControlledSector.

import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { MAP_SIDE, type Sector, sameSector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { idiv, u8, u16 } from '../../../core/int.ts';
import { EnemyIntention } from '../forces/constants.ts';
import {
  countAllMilitiaInSector,
  createNewEnemyGroupDepartingFromSector,
  findEnemyMovementGroupInSector,
  findPlayerMovementGroupInSector,
  type Group,
  getGroup,
  groupAtFinalDestination,
} from '../forces/groups.ts';
import { townIdOfSector } from '../map/control.ts';
import { sectorInfo, Traversability } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { fact } from '../narrative/facts.ts';
import { isDayTime, worldTotalMinutes } from '../time/world-clock.ts';
import { convertGroupTroopsToComposition, enemyOf, removeSoldiersFromGarrisonBasedOnComposition } from './composition.ts';
import {
  DRASSEN_OPEN_MINUTE,
  GARRISON_ATTACK_RATIO_ENEMY,
  GARRISON_ATTACK_RATIO_PLAYER,
  NIGHT_ALERTNESS_GAIN_CHANCE,
  NIGHT_NOTICE_DIVISOR,
  NO_GARRISON,
  NOTICE_OFFENCE_ADMIN,
  NOTICE_OFFENCE_ELITE,
  NOTICE_OFFENCE_TROOP,
  OMERTA_OPEN_MINUTE,
  SEC,
  SECONDS_PER_HOUR,
  STAGING_TOP_UP_BASE,
  STAGING_TOP_UP_THRESHOLD,
  STAGING_TOP_UP_VARIANCE,
  UNIMPORTANT_TOWNS,
} from './constants.ts';
import { type QueenContext, rollChance } from './context.ts';
import { garrisonEnemies, playerSectorDefended } from './counts.ts';
import {
  evaluateGroupSituation,
  MoveCode,
  moveSAIGroupToSector,
  reassignAIGroup,
  removeGroupFromStrategicAILists,
  sendGroupToPool,
} from './orders.ts';
import { wakeUpQueen } from './reactions.ts';
import { requestAttackOnSector } from './reinforce.ts';
import { compositionOf, garrison, playerForceTooStrong, recalculateGroupWeight } from './weights.ts';

const GARRISON_KEEPS_DESIRED_DIVISOR = 2;
const SPLIT_PARTS = 2;
const NORTH = -MAP_SIDE;
const WEST = -1;
const SOUTH = MAP_SIDE;
const EAST = 1;
const OMERTA_SECTOR: Sector = sectorFromId(SEC.A9);
const MEDUNA_SECTOR: Sector = sectorFromId(SEC.P3);

export function okayForEnemyToMoveThroughSector(q: QueenContext, id: number): boolean {
  const liberated = q.state.map.sectors[id]?.timeLastPlayerLiberated ?? 0;
  return !(liberated && liberated + q.state.queen.graceHours * SECONDS_PER_HOUR > q.state.clock.seconds);
}

export interface PermissionResult {
  readonly permitted: boolean;
  readonly group: Group | null;
}

function specialSectorPermits(q: QueenContext, id: number): boolean {
  const minutes = worldTotalMinutes(q.state.clock);
  switch (id) {
    case SEC.F10:
      return !fact(q.state.narrative, Fact.HILLBILLIES_KILLED);
    case SEC.A9:
    case SEC.A10:
      return minutes >= OMERTA_OPEN_MINUTE;
    case SEC.B13:
    case SEC.C13:
    case SEC.D13:
      return minutes >= DRASSEN_OPEN_MINUTE;
    case SEC.C5:
    case SEC.C6:
    case SEC.D5:
      return fact(q.state.narrative, Fact.KINGPIN_DEAD);
    case SEC.G1:
      return !(playerSectorDefended(q, SEC.G2) && (playerSectorDefended(q, SEC.H1) || playerSectorDefended(q, SEC.H2)));
    case SEC.H2:
      return !(playerSectorDefended(q, SEC.H2) && (playerSectorDefended(q, SEC.G1) || playerSectorDefended(q, SEC.G2)));
    default:
      return true;
  }
}

export function enemyPermittedToAttackSector(q: QueenContext, group: Group | null, id: number): PermissionResult {
  const permitted = okayForEnemyToMoveThroughSector(q, id);
  let g = group;
  const gi = q.state.map.sectors[id]?.garrisonId ?? NO_GARRISON;
  if (g && gi !== NO_GARRISON) {
    const pending = garrison(q, gi).pendingGroup;
    if (pending && getGroup(q, pending) === g) {
      if (permitted) {
        if (groupAtFinalDestination(g)) return { permitted: true, group: g };
      } else g = reassignAIGroup(q, g);
    }
  }
  if (!permitted) return { permitted: false, group: g };
  return { permitted: specialSectorPermits(q, id), group: g };
}

function attemptToNotice(q: QueenContext): boolean {
  const queen = q.state.queen;
  if (queen.awareBattles) return true;
  if (isDayTime(q.state.clock)) {
    if (rollChance(q.random, queen.alertness)) {
      queen.alertness = Math.max(0, queen.alertness - queen.alertnessDecay);
      return true;
    }
    queen.alertness++;
    return false;
  }
  if (rollChance(q.random, idiv(queen.alertness, NIGHT_NOTICE_DIVISOR))) {
    queen.alertness = Math.max(0, queen.alertness - queen.alertnessDecay);
    return true;
  }
  if (rollChance(q.random, NIGHT_ALERTNESS_GAIN_CHANCE)) queen.alertness++;
  return false;
}

export const attemptToNoticeEmptySectorSucceeds = attemptToNotice;
export const attemptToNoticeAdjacentGroupSucceeds = attemptToNotice;

export function adjacentSectorIsImportantAndUndefended(q: QueenContext, id: number): boolean {
  const s = sectorFromId(id);
  if (UNIMPORTANT_TOWNS.has(townIdOfSector(q, s))) return false;
  const si = sectorInfo(q.state.map, s);
  return (
    si.numTroops === 0 &&
    si.numElites === 0 &&
    si.numAdmins === 0 &&
    si.traversability[StrategicMove.THROUGH] === Traversability.TOWN &&
    !playerSectorDefended(q, id)
  );
}

function groupOffence(g: Group): number {
  const e = enemyOf(g);
  return u16(e.numAdmins * NOTICE_OFFENCE_ADMIN + e.numTroops * NOTICE_OFFENCE_TROOP + e.numElites * NOTICE_OFFENCE_ELITE);
}

export function handlePlayerGroupNoticedByPatrolGroup(q: QueenContext, pg: Group, eg: Group): boolean {
  const id = sectorId(pg.sector);
  const target = pg.next.x ? sectorId(pg.next) : id;
  const force = playerForceTooStrong(q, id, groupOffence(eg));
  if (force.tooStrong || q.state.map.sectors[target]?.garrisonId !== NO_GARRISON) {
    requestAttackOnSector(q, id, force.defence);
    return false;
  }
  moveSAIGroupToSector(q, eg, target, MoveCode.DIRECT, EnemyIntention.PURSUIT);
  return true;
}

export function handlePlayerGroupNoticedByGarrison(q: QueenContext, pg: Group, id: number): void {
  const si = sectorInfo(q.state.map, sectorFromId(id));
  if (!groupAtFinalDestination(pg)) return;
  const offence = u16(si.numAdmins * NOTICE_OFFENCE_ADMIN + si.numTroops * NOTICE_OFFENCE_TROOP + si.numElites * NOTICE_OFFENCE_ELITE);
  const force = playerForceTooStrong(q, id, offence);
  if (force.tooStrong) {
    requestAttackOnSector(q, id, force.defence);
    return;
  }
  if (si.garrisonId === NO_GARRISON) return;
  const gg = garrison(q, si.garrisonId);
  const approved = u8(garrisonEnemies(si)) - idiv(compositionOf(q, gg).desired, GARRISON_KEEPS_DESIRED_DIVISOR);
  if (approved * GARRISON_ATTACK_RATIO_ENEMY <= pg.size * GARRISON_ATTACK_RATIO_PLAYER || approved <= q.state.queen.minGroupSize) return;
  const g = createGroupFromGarrison(q, id, approved);
  convertGroupTroopsToComposition(q, g, gg.composition);
  moveSAIGroupToSector(q, g, sectorId(pg.sector), MoveCode.DIRECT, EnemyIntention.REINFORCEMENTS);
  removeSoldiersFromGarrisonBasedOnComposition(q, si.garrisonId, g.size);
}

export function handleMilitiaNoticedByPatrolGroup(q: QueenContext, id: number, eg: Group): boolean {
  const force = playerForceTooStrong(q, id, groupOffence(eg));
  if (force.tooStrong) {
    requestAttackOnSector(q, id, force.defence);
    return false;
  }
  moveSAIGroupToSector(q, eg, id, MoveCode.DIRECT, EnemyIntention.REINFORCEMENTS);
  return false;
}

export function handleEmptySectorNoticedByPatrolGroup(q: QueenContext, g: Group, id: number): boolean {
  const gi = q.state.map.sectors[id]?.garrisonId ?? NO_GARRISON;
  if (gi === NO_GARRISON || garrison(q, gi).pendingGroup) return false;
  removeGroupFromStrategicAILists(q, g.id);
  garrison(q, gi).pendingGroup = g.id;
  moveSAIGroupToSector(q, g, id, MoveCode.DIRECT, EnemyIntention.REINFORCEMENTS);
  return true;
}

export function handleEmptySectorNoticedByGarrison(q: QueenContext, srcId: number, dstId: number): void {
  const src = q.state.map.sectors[srcId]?.garrisonId ?? NO_GARRISON;
  const dst = q.state.map.sectors[dstId]?.garrisonId ?? NO_GARRISON;
  if (src === NO_GARRISON || dst === NO_GARRISON) return;
  const dstGarrison = garrison(q, dst);
  if (dstGarrison.pendingGroup) return;
  const available = u8(garrisonEnemies(sectorInfo(q.state.map, sectorFromId(srcId))));
  if (available < q.state.queen.minGroupSize * SPLIT_PARTS) return;
  const g = createGroupFromGarrison(q, srcId, u8(idiv(available, SPLIT_PARTS)));
  convertGroupTroopsToComposition(q, g, dstGarrison.composition);
  removeSoldiersFromGarrisonBasedOnComposition(q, src, g.size);
  dstGarrison.pendingGroup = g.id;
  moveSAIGroupToSector(q, g, dstId, MoveCode.DIRECT, EnemyIntention.REINFORCEMENTS);
}

function createGroupFromGarrison(q: QueenContext, id: number, troops: number): Group {
  return createNewEnemyGroupDepartingFromSector(q, id, 0, u8(troops), 0);
}

function enemyNoticesPlayerArrival(q: QueenContext, pg: Group, s: Sector): boolean {
  const eg = findEnemyMovementGroupInSector(q, s);
  if (eg && attemptToNoticeAdjacentGroupSucceeds(q)) {
    handlePlayerGroupNoticedByPatrolGroup(q, pg, eg);
    return true;
  }
  const si = sectorInfo(q.state.map, s);
  if (u8(garrisonEnemies(si)) && si.garrisonId !== NO_GARRISON && attemptToNoticeAdjacentGroupSucceeds(q)) {
    handlePlayerGroupNoticedByGarrison(q, pg, sectorId(s));
    return true;
  }
  return false;
}

interface Direction {
  readonly delta: number;
  readonly allowed: (s: Sector) => boolean;
}

const ENEMY_LOOK_ORDER: readonly Direction[] = [
  { delta: NORTH, allowed: (s) => s.y > 1 },
  { delta: WEST, allowed: (s) => s.x > 1 },
  { delta: SOUTH, allowed: (s) => s.y < MAP_SIDE },
  { delta: EAST, allowed: (s) => s.x < MAP_SIDE },
];

const GARRISON_LOOK_ORDER: readonly Direction[] = [
  { delta: NORTH, allowed: (s) => s.y > 1 },
  { delta: EAST, allowed: (s) => s.x < MAP_SIDE },
  { delta: SOUTH, allowed: (s) => s.y < MAP_SIDE },
  { delta: WEST, allowed: (s) => s.x > 1 },
];

function enemyGroupLooksAround(q: QueenContext, group: Group): boolean {
  let eg: Group | null = group;
  if (groupAtFinalDestination(eg)) return evaluateGroupSituation(q, eg);
  const id = sectorId(eg.sector);
  for (const dir of ENEMY_LOOK_ORDER) {
    if (!eg || !dir.allowed(eg.sector)) continue;
    const adjId = id + dir.delta;
    const permission = enemyPermittedToAttackSector(q, eg, adjId);
    eg = permission.group;
    if (!permission.permitted || !eg) continue;
    const adj = sectorFromId(adjId);
    const pg = findPlayerMovementGroupInSector(q, adj);
    if (pg && attemptToNoticeAdjacentGroupSucceeds(q)) return handlePlayerGroupNoticedByPatrolGroup(q, pg, eg);
    if (countAllMilitiaInSector(q, adj) && attemptToNoticeAdjacentGroupSucceeds(q)) return handleMilitiaNoticedByPatrolGroup(q, adjId, eg);
    if (adjacentSectorIsImportantAndUndefended(q, adjId) && attemptToNoticeEmptySectorSucceeds(q))
      return handleEmptySectorNoticedByPatrolGroup(q, eg, adjId);
  }
  return !eg;
}

const PLAYER_LOOK_ORDER: readonly Direction[] = [
  { delta: NORTH, allowed: (s) => s.y > 1 },
  { delta: EAST, allowed: (s) => s.x < MAP_SIDE },
  { delta: SOUTH, allowed: (s) => s.y < MAP_SIDE },
  { delta: WEST, allowed: (s) => s.x > 1 },
];

function playerGroupLooksAround(q: QueenContext, pg: Group): boolean {
  if (pg.sector.z !== 0) return false;
  const id = sectorId(pg.sector);
  if (!enemyPermittedToAttackSector(q, null, id).permitted) return false;
  for (const dir of PLAYER_LOOK_ORDER) {
    if (dir.allowed(pg.sector) && enemyNoticesPlayerArrival(q, pg, sectorFromId(id + dir.delta))) return false;
  }
  return false;
}

export function strategicAILookForAdjacentGroups(q: QueenContext, group: Group): boolean {
  const queen = q.state.queen;
  let g: Group | null = group;
  if (!queen.awake) {
    if (!g.player && groupAtFinalDestination(g)) {
      wakeUpQueen(q);
      if (sameSector(g.sector, OMERTA_SECTOR) || sameSector(g.sector, MEDUNA_SECTOR)) {
        g = sendGroupToPool(q, g);
        if (!g) return true;
      }
    }
    if (!queen.awake) return false;
  }
  return g.player ? playerGroupLooksAround(q, g) : enemyGroupLooksAround(q, g);
}

function topUpStagingGroup(q: QueenContext, g: Group, garrisonSector: number): void {
  const e = enemyOf(g);
  if (e.pendingReinforcements) {
    if (e.pendingReinforcements > STAGING_TOP_UP_THRESHOLD) {
      const n = u8(STAGING_TOP_UP_BASE + q.random.int(STAGING_TOP_UP_VARIANCE));
      e.numTroops = u8(e.numTroops + n);
      g.size = u8(g.size + n);
      e.pendingReinforcements = u8(e.pendingReinforcements - n);
      recalculateGroupWeight(q, g);
    } else {
      e.numTroops = u8(e.numTroops + e.pendingReinforcements);
      g.size = u8(g.size + e.pendingReinforcements);
      e.pendingReinforcements = 0;
    }
  } else if (sectorId(g.sector) !== garrisonSector) moveSAIGroupToSector(q, g, garrisonSector, MoveCode.DIRECT, e.intention);
}

export function checkEnemyControlledSector(q: QueenContext, id: number): void {
  if (!q.state.queen.awake) return;
  const si = sectorInfo(q.state.map, sectorFromId(id));
  if (si.garrisonId !== NO_GARRISON) {
    const gg = garrison(q, si.garrisonId);
    const g = gg.pendingGroup ? getGroup(q, gg.pendingGroup) : undefined;
    if (g && groupAtFinalDestination(g)) topUpStagingGroup(q, g, gg.sector);
  }
  if (!garrisonEnemies(si)) return;
  const s = sectorFromId(id);
  for (const dir of GARRISON_LOOK_ORDER) {
    if (!dir.allowed(s)) continue;
    const adjId = id + dir.delta;
    if (!enemyPermittedToAttackSector(q, null, adjId).permitted) continue;
    if (adjacentSectorIsImportantAndUndefended(q, adjId) && attemptToNoticeEmptySectorSucceeds(q)) {
      handleEmptySectorNoticedByGarrison(q, id, adjId);
      return;
    }
  }
}
