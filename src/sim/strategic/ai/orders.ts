// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc MoveSAIGroupToSector, EvaluateGroupSituation, ReassignAIGroup, SendGroupToPool,
// @src TransferGroupToPool, RemoveGroupFromStrategicAILists, RepollSAIGroup, RedirectEnemyGroupsMovingThroughSector;
// @src SAM_Sites.cc UpdateSAMDoneRepair. See docs/17 §7.

import { type Sector, sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i32, u8 } from '../../../core/int.ts';
import { EnemyIntention, MoveType, SectorFlag } from '../forces/constants.ts';
import {
  type Group,
  getFinalWaypoint,
  getGroup,
  groupAtFinalDestination,
  removeGroup,
  removeGroupWaypoints,
  setEnemyGroupSector,
} from '../forces/groups.ts';
import {
  addWaypointIdToPGroup,
  calculateNextMoveIntention,
  groupWillMoveThroughSector,
  moveGroupFromSectorToSector,
  moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectors,
  moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectorsAndStopOneSectorBeforeEnd,
} from '../forces/movement.ts';
import { isThisSectorASamSector, setThisSectorAsEnemyControlled, updateAirspaceControl } from '../map/control.ts';
import { sectorInfo, setSectorFlag } from '../map/sectors.ts';
import { worldDay } from '../time/world-clock.ts';
import { eliminateSurplusTroopsForGarrison, enemyMembers, enemyOf } from './composition.ts';
import { MAX_STRATEGIC_TEAM_SIZE, NO_RELOOP, SAM_CONDITION_REPAIRED, SEC } from './constants.ts';
import type { QueenContext } from './context.ts';
import { enemyPermittedToAttackSector } from './detection.ts';
import { reinforcementsApproved, sendReinforcementsForGarrison, sendReinforcementsForPatrol } from './reinforce.ts';
import {
  garrison,
  garrisonRequestingMinimumReinforcements,
  patrolRequestingMinimumReinforcements,
  recalculateGarrisonWeight,
  recalculatePatrolWeight,
} from './weights.ts';

export const MoveCode = { DIRECT: 0, EVASIVE: 1, STAGE: 2 } as const;
export type MoveCode = (typeof MoveCode)[keyof typeof MoveCode];

const MEDUNA: Sector = sectorFromId(SEC.P3);

export function moveSAIGroupToSector(q: QueenContext, g: Group, dst: number, code: MoveCode, intention: number): Group | null {
  if (g.betweenSectors) setEnemyGroupSector(q, g, sectorId(g.sector));
  enemyOf(g).intention = intention;
  g.moveType = MoveType.ONE_WAY;
  const dest = sectorFromId(dst);
  if (sameSector(g.sector, dest) && evaluateGroupSituation(q, g)) return null;
  if (code === MoveCode.STAGE) moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectorsAndStopOneSectorBeforeEnd(q, g, g.sector, dest);
  else if (code === MoveCode.EVASIVE) moveGroupFromSectorToSectorButAvoidPlayerInfluencedSectors(q, g, g.sector, dest);
  else moveGroupFromSectorToSector(q, g, g.sector, dest);
  return g;
}

function updateSamDoneRepair(q: QueenContext, s: Sector): void {
  if (s.z !== 0) return;
  setSectorFlag(q.state.map, s, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS, worldDay(q.state.clock));
  q.queenHooks.samRepaired(s);
  updateAirspaceControl(q);
}

function reinforcePalace(q: QueenContext, g: Group, id: number): void {
  const queen = q.state.queen;
  const si = sectorInfo(q.state.map, sectorFromId(id));
  if (si.numElites < MAX_STRATEGIC_TEAM_SIZE) {
    if (si.numElites + g.size >= MAX_STRATEGIC_TEAM_SIZE) {
      queen.reinforcementPool = i32(queen.reinforcementPool + MAX_STRATEGIC_TEAM_SIZE - si.numElites);
      si.numElites = MAX_STRATEGIC_TEAM_SIZE;
    } else si.numElites = u8(si.numElites + g.size);
  } else queen.reinforcementPool = i32(queen.reinforcementPool + g.size);
}

function mergeIntoGarrison(q: QueenContext, g: Group, id: number): void {
  const s = sectorFromId(id);
  const si = sectorInfo(q.state.map, s);
  const e = enemyOf(g);
  eliminateSurplusTroopsForGarrison(g, si);
  si.numAdmins = u8(si.numAdmins + e.numAdmins);
  si.numTroops = u8(si.numTroops + e.numTroops);
  si.numElites = u8(si.numElites + e.numElites);
  if (isThisSectorASamSector(q, s)) {
    const element = q.state.map.elements[strategicIndex(s)];
    if (element) element.samCondition = SAM_CONDITION_REPAIRED;
    updateSamDoneRepair(q, s);
  }
}

function arriveAtGarrison(q: QueenContext, g: Group, gi: number, id: number): void {
  if (id !== SEC.P3) mergeIntoGarrison(q, g, id);
  else reinforcePalace(q, g, id);
  setThisSectorAsEnemyControlled(q, sectorFromId(id));
  removeGroup(q, g);
  recalculateGarrisonWeight(q, gi);
}

function warpIntoPatrol(g: Group, patrolGroup: Group): void {
  const e = enemyOf(g);
  const pe = enemyOf(patrolGroup);
  pe.numTroops = u8(pe.numTroops + e.numTroops);
  pe.numElites = u8(pe.numElites + e.numElites);
  pe.numAdmins = u8(pe.numAdmins + e.numAdmins);
  patrolGroup.size = u8(patrolGroup.size + enemyMembers(e));
  if (patrolGroup.size <= MAX_STRATEGIC_TEAM_SIZE) return;
  for (let cut = patrolGroup.size - MAX_STRATEGIC_TEAM_SIZE; cut > 0; cut--) {
    if (e.numAdmins) {
      e.numAdmins--;
      pe.numAdmins = u8(pe.numAdmins - 1);
    } else if (e.numTroops) {
      e.numTroops--;
      pe.numTroops = u8(pe.numTroops - 1);
    } else if (e.numElites) {
      e.numElites--;
      pe.numElites = u8(pe.numElites - 1);
    }
  }
  patrolGroup.size = MAX_STRATEGIC_TEAM_SIZE;
}

function becomePatrol(q: QueenContext, g: Group, pi: number): void {
  const pg = q.state.queen.patrols[pi];
  if (!pg) return;
  pg.group = g.id;
  enemyOf(g).intention = EnemyIntention.PATROL;
  g.moveType = MoveType.ENDTOEND_FORWARDS;
  removeGroupWaypoints(g);
  addWaypointIdToPGroup(q, g, pg.points[0] ?? 0);
  addWaypointIdToPGroup(q, g, pg.points[1] ?? 0);
  if (pg.points[2]) {
    addWaypointIdToPGroup(q, g, pg.points[2]);
    if (pg.points[3]) addWaypointIdToPGroup(q, g, pg.points[3]);
  }
  recalculatePatrolWeight(q, pg);
}

function arriveAtPatrol(q: QueenContext, g: Group, pi: number): void {
  const pg = q.state.queen.patrols[pi];
  if (!pg) return;
  pg.pendingGroup = 0;
  const patrolGroup = pg.group && pg.group !== g.id ? getGroup(q, pg.group) : undefined;
  if (pg.group && pg.group !== g.id) {
    if (patrolGroup) warpIntoPatrol(g, patrolGroup);
    removeGroup(q, g);
    recalculatePatrolWeight(q, pg);
    return;
  }
  becomePatrol(q, g, pi);
}

export function evaluateGroupSituation(q: QueenContext, g: Group): boolean {
  const queen = q.state.queen;
  if (!queen.awake) return false;
  const intention = enemyOf(g).intention;
  if (intention === EnemyIntention.PURSUIT) {
    reassignAIGroup(q, g);
    return true;
  }
  if (intention === EnemyIntention.REINFORCEMENTS) {
    const id = sectorId(g.sector);
    const gi = queen.garrisons.findIndex((gg) => gg.sector === id && gg.pendingGroup === g.id);
    if (gi >= 0) {
      arriveAtGarrison(q, g, gi, id);
      return true;
    }
    const pi = queen.patrols.findIndex((pg) => pg.points[1] === id && pg.pendingGroup === g.id);
    if (pi >= 0) {
      arriveAtPatrol(q, g, pi);
      return true;
    }
    return false;
  }
  if (intention !== EnemyIntention.STAGING) {
    reassignAIGroup(q, g);
    return true;
  }
  return false;
}

export function transferGroupToPool(q: QueenContext, g: Group): null {
  const queen = q.state.queen;
  queen.reinforcementPool = i32(queen.reinforcementPool + g.size);
  removeGroup(q, g);
  return null;
}

export function sendGroupToPool(q: QueenContext, g: Group): Group | null {
  if (sameSector(g.sector, MEDUNA)) return transferGroupToPool(q, g);
  g.sectorIdOfLastReassignment = sectorId(g.sector);
  return moveSAIGroupToSector(q, g, SEC.P3, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
}

function garrisonTakesGroup(q: QueenContext, gi: number, g: Group): { taken: boolean; group: Group | null } {
  const gg = garrison(q, gi);
  if (gg.pendingGroup || !enemyPermittedToAttackSector(q, null, gg.sector).permitted || !garrisonRequestingMinimumReinforcements(q, gi))
    return { taken: false, group: g };
  const approval = reinforcementsApproved(q, gi);
  if (!approval.approved) return { taken: false, group: g };
  return { taken: true, group: sendReinforcementsForGarrison(q, gi, approval.defence, g) };
}

function patrolTakesGroup(q: QueenContext, pi: number, g: Group): { taken: boolean; group: Group | null } {
  const pg = q.state.queen.patrols[pi];
  if (!pg || pg.pendingGroup || !patrolRequestingMinimumReinforcements(q, pi)) return { taken: false, group: g };
  return { taken: true, group: sendReinforcementsForPatrol(q, pi, g) };
}

export function reassignAIGroup(q: QueenContext, g: Group): Group | null {
  const queen = q.state.queen;
  const id = sectorId(g.sector);
  g.sectorIdOfLastReassignment = id;
  removeGroupFromStrategicAILists(q, g.id);
  setEnemyGroupSector(q, g, id);
  if (queen.requestPoints <= 0) return sendGroupToPool(q, g);
  let r = i32(q.random.int(queen.requestPoints));
  let reloop = NO_RELOOP;
  for (let gi = 0; gi < queen.garrisons.length; gi++) {
    recalculateGarrisonWeight(q, gi);
    const w = garrison(q, gi).weight;
    if (w <= 0) continue;
    if (r < w) {
      const result = garrisonTakesGroup(q, gi, g);
      if (result.taken) return result.group;
      if (reloop === NO_RELOOP) {
        reloop = gi - 1;
        r = 0;
      }
    }
    r -= w;
  }
  if (reloop !== NO_RELOOP) {
    for (let gi = 0; gi <= reloop; gi++) {
      recalculateGarrisonWeight(q, gi);
      if (garrison(q, gi).weight <= 0) continue;
      const result = garrisonTakesGroup(q, gi, g);
      if (result.taken) return result.group;
    }
  }
  if (reloop === NO_RELOOP) {
    for (let pi = 0; pi < queen.patrols.length; pi++) {
      const pg = queen.patrols[pi];
      if (!pg) continue;
      recalculatePatrolWeight(q, pg);
      const w = pg.weight;
      if (w <= 0) continue;
      if (r < w) {
        const result = patrolTakesGroup(q, pi, g);
        if (result.taken) return result.group;
      }
      if (reloop === NO_RELOOP) {
        reloop = pi - 1;
        r = 0;
      }
      r -= w;
    }
  } else reloop = queen.patrols.length - 1;
  const last = reloop === NO_RELOOP ? queen.patrols.length - 1 : reloop;
  for (let pi = 0; pi <= last; pi++) {
    const pg = queen.patrols[pi];
    if (!pg) continue;
    recalculatePatrolWeight(q, pg);
    if (pg.weight <= 0) continue;
    const result = patrolTakesGroup(q, pi, g);
    if (result.taken) return result.group;
  }
  return transferGroupToPool(q, g);
}

export function removeGroupFromStrategicAILists(q: QueenContext, groupId: number): void {
  const queen = q.state.queen;
  for (const pg of queen.patrols) {
    if (pg.group === groupId) {
      pg.group = 0;
      recalculatePatrolWeight(q, pg);
      return;
    }
    if (pg.pendingGroup === groupId) {
      pg.pendingGroup = 0;
      return;
    }
  }
  for (const gg of queen.garrisons) {
    if (gg.pendingGroup === groupId) {
      gg.pendingGroup = 0;
      return;
    }
  }
}

export function repollSAIGroup(q: QueenContext, g: Group): void {
  if (groupAtFinalDestination(g)) {
    evaluateGroupSituation(q, g);
    return;
  }
  const queen = q.state.queen;
  const pg = queen.patrols.find((p) => p.group === g.id);
  if (pg) {
    recalculatePatrolWeight(q, pg);
    calculateNextMoveIntention(q, g);
    return;
  }
  const gi = queen.garrisons.findIndex((gg) => gg.pendingGroup === g.id);
  if (gi < 0) return;
  recalculateGarrisonWeight(q, gi);
  calculateNextMoveIntention(q, g);
}

export function redirectEnemyGroupsMovingThroughSector(q: QueenContext, s: Sector): number {
  let redirected = 0;
  for (const g of [...q.state.forces.groups]) {
    if (g.player || g.moveType !== MoveType.ONE_WAY || !q.state.forces.groups.includes(g)) continue;
    if (!groupWillMoveThroughSector(g, s)) continue;
    const final = getFinalWaypoint(g);
    if (!final) continue;
    setEnemyGroupSector(q, g, sectorId(g.sector));
    moveSAIGroupToSector(q, g, sectorId(final), MoveCode.EVASIVE, enemyOf(g).intention);
    redirected = u8(redirected + 1);
  }
  return redirected;
}
