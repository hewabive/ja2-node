// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc ReinforcementsApproved, RequestAttackOnSector, ChooseSuitableGarrisonToProvideReinforcements,
// @src SendReinforcementsForGarrison, SendReinforcementsForPatrol, SectorDistance, RequestHighPriorityGarrisonReinforcements,
// @src MassFortifyTowns. See docs/17 §6.4–§6.7, §9.2.

import { type Sector, sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i32, idiv, u8, u16 } from '../../../core/int.ts';
import { EnemyIntention, MoveType } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, type Group, getGroup, setEnemyGroupSector } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { convertGroupTroopsToComposition, enemyOf, removeSoldiersFromGarrisonBasedOnComposition } from './composition.ts';
import {
  ALMA_GARRISONS,
  ALMA_SUPPLIED_SECTORS,
  Composition,
  DEFENCE_MERC_APPROVAL,
  MAX_REINFORCEMENT_FACTOR_DIVISOR,
  MIN_ALMA_SHARE_PERCENT,
  OFFENCE_ADMIN,
  OFFENCE_ELITE,
  OFFENCE_TROOP,
  SEC,
  SOURCE_NONE,
} from './constants.ts';
import { type QueenContext, rollChance, rollInt } from './context.ts';
import { garrisonEnemies } from './counts.ts';
import { enemyPermittedToAttackSector } from './detection.ts';
import { MoveCode, moveSAIGroupToSector, reassignAIGroup } from './orders.ts';
import {
  compositionOf,
  garrison,
  garrisonCanProvideMinimumReinforcements,
  garrisonReinforcementsRequested,
  militiaDefence,
  patrolReinforcementsRequested,
  recalculateGarrisonWeight,
  recalculatePatrolWeight,
  recalculateSectorWeight,
  reinforcementsAvailable,
} from './weights.ts';

const PERCENT = 100;
const FAR_AWAY = 255;
const STRENGTH_PER_SOLDIER = 3;
const DENIAL_PRIORITY_DIVISOR = 2;
const NO_PATROL_INDEX = -1;
const MEDUNA: Sector = sectorFromId(SEC.P3);

export interface Approval {
  readonly approved: boolean;
  readonly defence: number;
}

function addDenial(q: QueenContext, gi: number): void {
  const queen = q.state.queen;
  const priority = compositionOf(q, garrison(q, gi)).priority;
  queen.garrisonDenied[gi] = u8((queen.garrisonDenied[gi] ?? 0) + u8(idiv(priority, DENIAL_PRIORITY_DIVISOR)));
}

export function reinforcementsApproved(q: QueenContext, gi: number): Approval {
  const gg = garrison(q, gi);
  const comp = compositionOf(q, gg);
  const denied = q.state.queen.garrisonDenied[gi] ?? 0;
  const defence = militiaDefence(q, gg.sector, DEFENCE_MERC_APPROVAL);
  let offence = u16(comp.adminPct * OFFENCE_ADMIN + comp.troopPct * OFFENCE_TROOP + comp.elitePct * OFFENCE_ELITE + denied);
  offence = u16(idiv(offence * comp.desired, PERCENT));
  if (offence > defence) return { approved: true, defence };
  if (denied + offence > defence) return { approved: true, defence };
  addDenial(q, gi);
  return { approved: false, defence };
}

export function requestAttackOnSector(q: QueenContext, id: number, defence: number): void {
  const gi = q.state.queen.garrisons.findIndex((g) => g.sector === id && !g.pendingGroup);
  if (gi >= 0) sendReinforcementsForGarrison(q, gi, defence, null);
}

function availableShareIsEnough(q: QueenContext, gi: number, requested: number): boolean {
  return reinforcementsAvailable(q, gi) * PERCENT >= requested * MIN_ALMA_SHARE_PERCENT;
}

function chooseAlmaGarrison(q: QueenContext, requested: number): number {
  const garrisons = q.state.queen.garrisons;
  let first = garrisons.findIndex((g) => g.composition === Composition.ALMA_DEFENCE);
  if (first < 0) first = garrisons.length;
  let bestWeight = 0;
  let best = SOURCE_NONE;
  for (let gi = first; gi < first + ALMA_GARRISONS && gi < garrisons.length; gi++) {
    recalculateGarrisonWeight(q, gi);
    const w = garrison(q, gi).weight;
    if (bestWeight > w && garrisonCanProvideMinimumReinforcements(q, gi)) {
      bestWeight = w;
      best = gi;
    }
  }
  if (bestWeight < 0 && availableShareIsEnough(q, best, requested)) return best;
  return SOURCE_NONE;
}

function surplusWeight(q: QueenContext, gi: number): number {
  recalculateGarrisonWeight(q, gi);
  return -garrison(q, gi).weight;
}

export function chooseSuitableGarrisonToProvideReinforcements(q: QueenContext, dst: number, requested: number): number {
  const queen = q.state.queen;
  const count = queen.garrisons.length;
  if (ALMA_SUPPLIED_SECTORS.includes(garrison(q, dst).sector)) {
    const alma = chooseAlmaGarrison(q, requested);
    if (alma !== SOURCE_NONE) return alma;
  }
  let r = i32(rollInt(q.random, queen.reinforcementPoints));
  for (let gi = 0; gi < count; gi++) {
    const w = surplusWeight(q, gi);
    if (w <= 0) continue;
    if (r < w && garrisonCanProvideMinimumReinforcements(q, gi) && availableShareIsEnough(q, gi, requested)) return gi;
    r -= w;
  }
  for (let gi = 0; gi < count; gi++) {
    const w = surplusWeight(q, gi);
    if (w > 0 && garrisonCanProvideMinimumReinforcements(q, gi) && availableShareIsEnough(q, gi, requested)) return gi;
  }
  r = i32(rollInt(q.random, queen.reinforcementPoints));
  for (let gi = 0; gi < count; gi++) {
    const w = surplusWeight(q, gi);
    if (w <= 0 || !garrisonCanProvideMinimumReinforcements(q, gi)) continue;
    if (r < w) return gi;
    r -= w;
  }
  return SOURCE_NONE;
}

interface GarrisonRequest {
  readonly dst: number;
  readonly requested: number;
  readonly extra: number;
  readonly max: number;
  readonly limited: boolean;
  readonly defence: number;
}

function worthTheRisk(q: QueenContext, sent: number, defence: number): boolean {
  if (defence === 0) return true;
  return rollChance(q.random, idiv(sent * PERCENT, defence));
}

function sendFromQueenPool(q: QueenContext, req: GarrisonRequest): void {
  const queen = q.state.queen;
  const gg = garrison(q, req.dst);
  if (!q.state.map.elements[strategicIndex(MEDUNA)]?.enemyControlled) return;
  if (!queen.reinforcementPool) return;
  const approved = Math.min(req.requested, queen.reinforcementPool);
  if (approved * STRENGTH_PER_SOLDIER < req.defence) {
    addDenial(q, req.dst);
    return;
  }
  queen.garrisonDenied[req.dst] = 0;
  if (req.extra && req.limited && approved === req.max && !worthTheRisk(q, approved + req.extra, req.defence)) return;
  const g = createNewEnemyGroupDepartingFromSector(q, SEC.P3, 0, u8(approved), 0);
  convertGroupTroopsToComposition(q, g, gg.composition);
  g.originalSector = gg.sector;
  queen.reinforcementPool = i32(queen.reinforcementPool - approved);
  g.moveType = MoveType.ONE_WAY;
  gg.pendingGroup = g.id;
  moveSAIGroupToSector(q, g, gg.sector, MoveCode.STAGE, req.extra ? EnemyIntention.STAGING : EnemyIntention.REINFORCEMENTS);
}

function sendFromGarrison(q: QueenContext, req: GarrisonRequest, src: number): void {
  const gg = garrison(q, req.dst);
  const srcSector = sectorFromId(garrison(q, src).sector);
  const world = q.state.worldSector;
  if (world && sameSector(srcSector, world)) return;
  const available = reinforcementsAvailable(q, src);
  if (available <= 0) return;
  let approved = Math.min(req.requested, available);
  if (approved > req.max - req.extra) approved = req.max - req.extra;
  else if ((approved + req.extra) * STRENGTH_PER_SOLDIER < req.defence) {
    addDenial(q, req.dst);
    return;
  } else q.state.queen.garrisonDenied[req.dst] = 0;
  if (approved + req.extra === req.max && req.defence && !worthTheRisk(q, approved + req.extra, req.defence)) return;
  const g = createNewEnemyGroupDepartingFromSector(q, sectorId(srcSector), 0, u8(approved), 0);
  convertGroupTroopsToComposition(q, g, gg.composition);
  removeSoldiersFromGarrisonBasedOnComposition(q, src, g.size);
  g.originalSector = gg.sector;
  g.moveType = MoveType.ONE_WAY;
  gg.pendingGroup = g.id;
  if (req.extra) {
    enemyOf(g).pendingReinforcements = req.extra;
    moveSAIGroupToSector(q, g, gg.sector, MoveCode.STAGE, EnemyIntention.STAGING);
  } else moveSAIGroupToSector(q, g, gg.sector, MoveCode.STAGE, EnemyIntention.REINFORCEMENTS);
}

export function sendReinforcementsForGarrison(q: QueenContext, dst: number, defence: number, optional: Group | null): Group | null {
  const queen = q.state.queen;
  const gg = garrison(q, dst);
  const comp = compositionOf(q, gg);
  const request = garrisonReinforcementsRequested(q, dst);
  let { requested, extra } = request;
  const max = comp.desired + idiv(comp.desired * comp.priority, MAX_REINFORCEMENT_FACTOR_DIVISOR);
  let limited = false;
  if (requested + extra > max) {
    limited = true;
    extra = u8(max - requested);
  }
  requested += extra;
  if (requested <= 0) return optional;
  if (optional) {
    gg.pendingGroup = optional.id;
    convertGroupTroopsToComposition(q, optional, gg.composition);
    return moveSAIGroupToSector(q, optional, gg.sector, MoveCode.STAGE, EnemyIntention.REINFORCEMENTS);
  }
  const req: GarrisonRequest = { dst, requested, extra, max, limited, defence };
  const r = i32(rollInt(q.random, queen.reinforcementPoints + queen.reinforcementPool));
  if (r < queen.reinforcementPool) {
    sendFromQueenPool(q, req);
    return null;
  }
  const src = chooseSuitableGarrisonToProvideReinforcements(q, dst, requested);
  if (src === SOURCE_NONE) sendFromQueenPool(q, req);
  else sendFromGarrison(q, req, src);
  return null;
}

export function sendReinforcementsForPatrol(q: QueenContext, pi: number, optional: Group | null): Group | null {
  const queen = q.state.queen;
  const pg = queen.patrols[pi];
  if (!pg) return optional;
  const requested = patrolReinforcementsRequested(q, pg);
  if (requested <= 0) return optional;
  const dst = pg.points[1] ?? 0;
  if (optional) {
    pg.pendingGroup = optional.id;
    return moveSAIGroupToSector(q, optional, dst, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
  }
  let r = i32(rollInt(q.random, queen.reinforcementPoints + queen.reinforcementPool));
  if (r < queen.reinforcementPool) {
    const approved = Math.min(requested, queen.reinforcementPool);
    if (!approved) return null;
    const g = createNewEnemyGroupDepartingFromSector(q, SEC.P3, 0, u8(approved), 0);
    g.originalSector = dst;
    queen.reinforcementPool = i32(queen.reinforcementPool - approved);
    pg.pendingGroup = g.id;
    moveSAIGroupToSector(q, g, dst, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
    return null;
  }
  r -= queen.reinforcementPool;
  for (let gi = 0; gi < queen.garrisons.length; gi++) {
    const w = surplusWeight(q, gi);
    if (w <= 0) continue;
    if (r < w) {
      const srcSector = sectorFromId(garrison(q, gi).sector);
      const world = q.state.worldSector;
      if (!world || !sameSector(srcSector, world)) {
        const approved = Math.min(requested, reinforcementsAvailable(q, gi));
        const g = createNewEnemyGroupDepartingFromSector(q, sectorId(srcSector), 0, u8(approved), 0);
        g.originalSector = dst;
        pg.pendingGroup = g.id;
        removeSoldiersFromGarrisonBasedOnComposition(q, gi, g.size);
        moveSAIGroupToSector(q, g, dst, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
        return null;
      }
    }
    r -= w;
  }
  return null;
}

function sectorDistance(a: Sector, id: number): number {
  const b = sectorFromId(id);
  return u8(Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
}

function nearestPatrolWithAtLeast(q: QueenContext, gi: number, wanted: number): number {
  let bestDistance = FAR_AWAY;
  let best = NO_PATROL_INDEX;
  q.state.queen.patrols.forEach((pg, pi) => {
    if (!pg.group) return;
    const g = getGroup(q, pg.group);
    if (!g || g.size < wanted) return;
    const d = sectorDistance(g.sector, garrison(q, gi).sector);
    if (d < bestDistance) {
      bestDistance = d;
      best = pi;
    }
  });
  return best;
}

function splitPatrolGroup(q: QueenContext, from: Group, wanted: number): Group | null {
  const e = enemyOf(from);
  const split = createNewEnemyGroupDepartingFromSector(q, sectorId(from.sector), 0, 0, 0);
  const ne = enemyOf(split);
  if (e.numTroops >= wanted) {
    e.numTroops = u8(e.numTroops - wanted);
    from.size = u8(from.size - wanted);
    ne.numTroops = wanted;
    split.size = u8(split.size + wanted);
    return split;
  }
  for (let left = wanted; left > 0; left--) {
    if (e.numTroops) {
      e.numTroops--;
      ne.numTroops++;
    } else if (e.numAdmins) {
      e.numAdmins--;
      ne.numAdmins++;
    } else if (e.numElites) {
      e.numElites--;
      ne.numElites++;
    } else return null;
    from.size = u8(from.size - 1);
    split.size = u8(split.size + 1);
  }
  return split;
}

export function requestHighPriorityGarrisonReinforcements(q: QueenContext, gi: number, wanted: number): void {
  const queen = q.state.queen;
  const gg = garrison(q, gi);
  const pi = nearestPatrolWithAtLeast(q, gi, wanted);
  const pg = queen.patrols[pi];
  const patrolGroup = pg ? getGroup(q, pg.group) : undefined;
  if (pg && patrolGroup) {
    if (patrolGroup.size > wanted && patrolGroup.size - wanted >= queen.minGroupSize) {
      const split = splitPatrolGroup(q, patrolGroup, wanted);
      if (!split) return;
      split.originalSector = gg.sector;
      gg.pendingGroup = split.id;
      recalculatePatrolWeight(q, pg);
      moveSAIGroupToSector(q, split, gg.sector, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
      return;
    }
    pg.group = 0;
    gg.pendingGroup = patrolGroup.id;
    patrolGroup.originalSector = gg.sector;
    recalculatePatrolWeight(q, pg);
    setEnemyGroupSector(q, patrolGroup, sectorId(patrolGroup.sector));
    moveSAIGroupToSector(q, patrolGroup, gg.sector, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
    return;
  }
  const g = createNewEnemyGroupDepartingFromSector(q, SEC.P3, 0, wanted, 0);
  g.moveType = MoveType.ONE_WAY;
  enemyOf(g).intention = EnemyIntention.REINFORCEMENTS;
  gg.pendingGroup = g.id;
  g.originalSector = gg.sector;
  queen.reinforcementPool = i32(queen.reinforcementPool - wanted);
  moveSAIGroupToSector(q, g, gg.sector, MoveCode.EVASIVE, EnemyIntention.REINFORCEMENTS);
}

export function massFortifyTowns(q: QueenContext): void {
  const queen = q.state.queen;
  for (let gi = 0; gi < queen.garrisons.length; gi++) {
    const gg = garrison(q, gi);
    const present = u8(garrisonEnemies(sectorInfo(q.state.map, sectorFromId(gg.sector))));
    const desired = u8(compositionOf(q, gg).desired);
    if (present >= desired) continue;
    if (!gg.pendingGroup && gg.composition !== Composition.ROADBLOCK && enemyPermittedToAttackSector(q, null, gg.sector).permitted)
      requestHighPriorityGarrisonReinforcements(q, gi, u8(desired - present));
  }
  const a9 = sectorInfo(q.state.map, sectorFromId(SEC.A9));
  if (!a9.numTroops) return;
  const g = createNewEnemyGroupDepartingFromSector(q, SEC.A9, 0, a9.numTroops, 0);
  a9.numTroops = 0;
  enemyOf(g).intention = EnemyIntention.PATROL;
  g.moveType = MoveType.ONE_WAY;
  reassignAIGroup(q, g);
  recalculateSectorWeight(q, SEC.A9);
}
