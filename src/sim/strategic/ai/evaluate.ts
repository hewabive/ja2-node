// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc EvaluateQueenSituation, EvolveQueenPriorityPhase, UpgradeAdminsToTroops.

import { byDifficultyLevel } from '../../../content/strategic/army.ts';
import { sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { clamp, i8, i32, idiv, u8, u32 } from '../../../core/int.ts';
import { EnemyIntention } from '../forces/constants.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import {
  ADMIN_UPGRADE_PER_PROGRESS,
  DEFAULT_GROUP_PRIORITY,
  EVALUATION_SPREAD_FACTOR,
  EXTRA_ELITE_FACTOR,
  EXTRA_ELITES_PER_DIFFICULTY,
  FACTOR_CENTER,
  MAX_STRATEGIC_TEAM_SIZE,
  MIN_EVOLVED_DESIRED,
  PHASE_EXCLUDED_COMPOSITIONS,
  PHASE_PERCENT,
  RECRUITED_TROOPS,
  RECRUITING_INTERVAL_FACTOR,
  REQUEST_POINTS_FOR_FAST_EVALUATION,
} from './constants.ts';
import { type QueenContext, rollChance, rollInt } from './context.ts';
import { garrisonEnemies } from './counts.ts';
import { enemyPermittedToAttackSector } from './detection.ts';
import { highestPlayerProgressPercentage, queenProgress } from './difficulty.ts';
import { reinforcementsApproved, sendReinforcementsForGarrison, sendReinforcementsForPatrol } from './reinforce.ts';
import {
  findPatrolGroupIndexForGroupId,
  garrison,
  garrisonRequestingMinimumReinforcements,
  patrolRequestingMinimumReinforcements,
  recalculateGarrisonWeight,
  recalculatePatrolWeight,
} from './weights.ts';

const PERCENT = 100;

function nextEvaluationOffset(q: QueenContext): number {
  const queen = q.state.queen;
  const policy = q.army.policy;
  const d = q.state.options.difficulty;
  let offset = u32(Math.max(REQUEST_POINTS_FOR_FAST_EVALUATION - queen.requestPoints, 0));
  offset = u32(offset + rollInt(q.random, offset * EVALUATION_SPREAD_FACTOR));
  return u32(
    offset + byDifficultyLevel(policy.timeEvaluateInMinutes, d) + rollInt(q.random, byDifficultyLevel(policy.timeEvaluateVariance, d)),
  );
}

function scheduleEvaluation(q: QueenContext): boolean {
  const queen = q.state.queen;
  let offset = nextEvaluationOffset(q);
  const recruiting = !queen.reinforcementPool;
  if (recruiting) {
    offset = u32(offset * RECRUITING_INTERVAL_FACTOR);
    queen.reinforcementPool = i32(queen.reinforcementPool + RECRUITED_TROOPS);
  }
  addStrategicEvent(q.state.queue, EventKind.EVALUATE_QUEEN_SITUATION, worldTotalMinutes(q.state.clock) + offset, 0);
  return recruiting;
}

function garrisonGetsReinforcements(q: QueenContext, r: number): { decided: boolean; r: number } {
  const queen = q.state.queen;
  let left = r;
  for (let gi = 0; gi < queen.garrisons.length; gi++) {
    recalculateGarrisonWeight(q, gi);
    const gg = garrison(q, gi);
    const w = gg.weight;
    if (w <= 0) continue;
    if (
      left < w &&
      !gg.pendingGroup &&
      enemyPermittedToAttackSector(q, null, gg.sector).permitted &&
      garrisonRequestingMinimumReinforcements(q, gi)
    ) {
      const approval = reinforcementsApproved(q, gi);
      if (approval.approved) sendReinforcementsForGarrison(q, gi, approval.defence, null);
      return { decided: true, r: left };
    }
    left -= w;
  }
  return { decided: false, r: left };
}

function patrolGetsReinforcements(q: QueenContext, r: number): void {
  const queen = q.state.queen;
  let left = r;
  for (let pi = 0; pi < queen.patrols.length; pi++) {
    const pg = queen.patrols[pi];
    if (!pg) continue;
    recalculatePatrolWeight(q, pg);
    const w = pg.weight;
    if (w <= 0) continue;
    if (left < w && !pg.pendingGroup && patrolRequestingMinimumReinforcements(q, pi)) {
      sendReinforcementsForPatrol(q, pi, null);
      return;
    }
    left -= w;
  }
}

export function evaluateQueenSituation(q: QueenContext): void {
  const queen = q.state.queen;
  if (scheduleEvaluation(q)) return;
  if (!queen.awake) return;
  evolveQueenPriorityPhase(q, false);
  upgradeAdminsToTroops(q);
  if (queen.requestPoints <= 0 || (queen.reinforcementPoints <= 0 && queen.reinforcementPool <= 0)) return;
  const r = i32(rollInt(q.random, queen.requestPoints));
  const garrisons = garrisonGetsReinforcements(q, r);
  if (!garrisons.decided) patrolGetsReinforcements(q, garrisons.r);
}

function ownership(q: QueenContext): { owned: number[]; total: number[] } {
  const queen = q.state.queen;
  const owned = new Array<number>(queen.compositions.length).fill(0);
  const total = new Array<number>(queen.compositions.length).fill(0);
  for (const gg of queen.garrisons) {
    if (q.state.map.elements[strategicIndex(sectorFromId(gg.sector))]?.enemyControlled)
      owned[gg.composition] = u8((owned[gg.composition] ?? 0) + 1);
    total[gg.composition] = u8((total[gg.composition] ?? 0) + 1);
  }
  return { owned, total };
}

function ownershipFactor(owned: number, total: number): number {
  return total ? idiv(owned * PERCENT, total) - FACTOR_CENTER : -FACTOR_CENTER;
}

function promoteToElites(q: QueenContext, ci: number, sectorIdOf: number): void {
  const world = q.state.worldSector;
  const s = sectorFromId(sectorIdOf);
  if (world && sameSector(world, s)) return;
  const si = sectorInfo(q.state.map, s);
  const comp = q.state.queen.compositions[ci];
  if (!comp) return;
  let promotions = idiv(comp.elitePct * garrisonEnemies(si), PERCENT) - si.numElites;
  for (; promotions > 0; promotions--) {
    if (si.numAdmins) si.numAdmins--;
    else if (si.numTroops) si.numTroops--;
    si.numElites = u8(si.numElites + 1);
  }
}

export function evolveQueenPriorityPhase(q: QueenContext, force: boolean): void {
  const queen = q.state.queen;
  const phase = u8(idiv(queenProgress(q), PHASE_PERCENT));
  if (!force && phase === queen.priorityPhase) return;
  queen.priorityPhase = phase;
  const { owned, total } = ownership(q);
  queen.compositions.forEach((comp, ci) => {
    if (PHASE_EXCLUDED_COMPOSITIONS.has(ci)) return;
    const orig = q.army.compositions[ci];
    if (!orig) return;
    const factor = idiv(ownershipFactor(owned[ci] ?? 0, total[ci] ?? 0) * queen.priorityPhase, PHASE_PERCENT);
    if (comp.priority) comp.priority = i8(clamp(orig.priority + idiv(factor, 2), 0, PERCENT));
    comp.desired = i8(clamp(idiv(orig.desired * (PERCENT + factor), PERCENT), MIN_EVOLVED_DESIRED, MAX_STRATEGIC_TEAM_SIZE));
    if (queen.extraElites && factor >= EXTRA_ELITE_FACTOR && comp.elitePct) {
      const change = q.state.options.difficulty * EXTRA_ELITES_PER_DIFFICULTY;
      comp.elitePct = i8(Math.min(PERCENT, comp.elitePct + change));
      comp.troopPct = i8(Math.max(0, comp.troopPct - change));
    }
  });
  if (queen.extraElites) {
    queen.extraElites = false;
    for (const gg of queen.garrisons) {
      if (PHASE_EXCLUDED_COMPOSITIONS.has(gg.composition)) continue;
      if (ownershipFactor(owned[gg.composition] ?? 0, total[gg.composition] ?? 0) >= EXTRA_ELITE_FACTOR)
        promoteToElites(q, gg.composition, gg.sector);
    }
  }
  for (let gi = 0; gi < queen.garrisons.length; gi++) recalculateGarrisonWeight(q, gi);
}

function upgradeAdmins(q: QueenContext, holder: { numAdmins: number; numTroops: number }, priority: number): void {
  for (let n = holder.numAdmins; n !== 0; n--) {
    if (!rollChance(q.random, priority)) continue;
    holder.numAdmins--;
    holder.numTroops = u8(holder.numTroops + 1);
  }
}

export function upgradeAdminsToTroops(q: QueenContext): void {
  const queen = q.state.queen;
  const minPriority = PERCENT - ADMIN_UPGRADE_PER_PROGRESS * highestPlayerProgressPercentage(q);
  const world = q.state.worldSector;
  const loaded = world ? sectorId(world) : -1;
  for (const gg of queen.garrisons) {
    if (loaded === gg.sector) continue;
    const si = sectorInfo(q.state.map, sectorFromId(gg.sector));
    if (si.numAdmins === 0) continue;
    const priority = queen.compositions[gg.composition]?.priority ?? 0;
    if (priority <= minPriority) continue;
    upgradeAdmins(q, si, priority);
  }
  for (const g of q.state.forces.groups) {
    if (g.player || g.size === 0 || g.vehicle || !g.enemy) continue;
    if (world && sameSector(g.sector, world)) continue;
    if (g.enemy.numAdmins === 0) continue;
    const priority =
      g.enemy.intention === EnemyIntention.PATROL
        ? (queen.patrols[findPatrolGroupIndexForGroupId(q, g.id)]?.priority ?? DEFAULT_GROUP_PRIORITY)
        : DEFAULT_GROUP_PRIORITY;
    if (priority <= minPriority) continue;
    upgradeAdmins(q, g.enemy, priority);
  }
}
