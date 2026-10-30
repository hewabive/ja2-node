// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc InitStrategicAI; src/externalized/strategic/CacheSectorsModel.cc pickSector, getNumTroops;
// @src Strategic_Status.cc InitStrategicStatus.

import { byDifficultyLevel } from '../../../content/strategic/army.ts';
import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { clamp, i8, i32, idiv, u8, u32, udiv } from '../../../core/int.ts';
import { Difficulty, EnemyIntention, MoveType, SectorFlag } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector } from '../forces/groups.ts';
import { addWaypointIdToPGroup, randomizePatrolGroupLocation } from '../forces/movement.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { addPeriodStrategicEventWithOffset, addStrategicEvent } from '../time/event-queue.ts';
import {
  ADMIN_PATROLS,
  CHECK_PERIOD_BASE,
  CHECK_PERIOD_PER_DIFFICULTY,
  CHECK_PERIOD_VARIANCE,
  Composition,
  DRASSEN_MIN_ADMINS,
  FULL_FORCE_PERCENT,
  MAX_STRATEGIC_TEAM_SIZE,
  NO_GARRISON,
  PATROL_SIZE_VARIANCE,
  QUEEN_DEFENCE_MAX,
  ROADBLOCK_CHANCE,
  SAI_VERSION,
  SEC,
  START_MINUTE_OF_DAY,
  START_VARIANCE,
  START_VARIANCE_OFFSET,
  TIXA_MIN_ADMINS,
} from './constants.ts';
import { type QueenContext, rollChance } from './context.ts';
import {
  type ArmyComposition,
  compositionFromTemplate,
  createStrategicStatus,
  patrolFromTemplate,
  type QueenState,
} from './queen-state.ts';
import { garrisonWeight } from './weights.ts';

const PERCENT = 100;

const TROOPS_FILL_START = new Set<number>([
  Composition.CAMBRIA_DEFENCE,
  Composition.CAMBRIA_MINE,
  Composition.ALMA_MINE,
  Composition.GRUMM_MINE,
]);
const DRASSEN_ADMIN_GARRISONS = new Set<number>([Composition.DRASSEN_AIRPORT, Composition.DRASSEN_DEFENCE, Composition.DRASSEN_MINE]);

function policyValue(q: QueenContext, values: readonly [number, number, number]): number {
  return byDifficultyLevel(values, q.state.options.difficulty);
}

function resetGlobals(queen: QueenState): void {
  queen.extraElites = false;
  queen.awareBattles = 0;
  queen.awake = false;
  queen.reinforcementPoints = 0;
  queen.requestPoints = 0;
  queen.saiVersion = SAI_VERSION;
  queen.priorityPhase = 0;
  queen.firstBattleMeanwhilePending = false;
  queen.massFortificationOrdered = false;
  queen.playerBattleVictories = 0;
  queen.useAlternateQueenPosition = false;
}

function removePerimeterDefences(compositions: ArmyComposition[], difficulty: number): void {
  const remove = (ci: number) => {
    const c = compositions[ci];
    if (!c) return;
    c.desired = 0;
    c.start = 0;
  };
  if (difficulty === Difficulty.EASY) remove(Composition.LEVEL2_DEFENCE);
  if (difficulty <= Difficulty.MEDIUM) remove(Composition.LEVEL3_DEFENCE);
}

function scaleForces(q: QueenContext, percent: number): void {
  const queen = q.state.queen;
  if (percent === FULL_FORCE_PERCENT) return;
  queen.compositions.forEach((a, ci) => {
    if (ci !== Composition.QUEEN_DEFENCE) {
      a.desired = i8(Math.min(MAX_STRATEGIC_TEAM_SIZE, idiv(a.desired * percent, PERCENT)));
      if (a.start !== MAX_STRATEGIC_TEAM_SIZE) a.start = i8(Math.min(MAX_STRATEGIC_TEAM_SIZE, idiv(a.start * percent, PERCENT)));
    } else {
      a.desired = i8(Math.min(QUEEN_DEFENCE_MAX, idiv(a.desired * percent, PERCENT)));
      a.start = a.desired;
    }
  });
  for (const p of queen.patrols) p.size = i8(clamp(idiv(p.size * percent, PERCENT), queen.minGroupSize, MAX_STRATEGIC_TEAM_SIZE));
}

function populateGarrison(q: QueenContext, gi: number): void {
  const queen = q.state.queen;
  const gg = queen.garrisons[gi];
  if (!gg) return;
  const si = sectorInfo(q.state.map, sectorFromId(gg.sector));
  si.garrisonId = gi;
  const ac = queen.compositions[gg.composition];
  if (!ac) throw new RangeError(`no army composition ${gg.composition}`);
  let start = ac.start;
  const eliteChance = ac.elitePct;
  const troopChance = ac.troopPct + eliteChance;
  const adminChance = ac.adminPct;
  if (gg.composition === Composition.ROADBLOCK) {
    si.flags = u32(si.flags | SectorFlag.ENEMY_AMBUSH_LOCATION);
    start = rollChance(q.random, ROADBLOCK_CHANCE) ? ac.desired : 0;
  } else if (gg.composition === Composition.SANMONA_SMALL) start = 0;
  if (start !== 0) {
    if (gg.sector !== SEC.P3) {
      if (start !== MAX_STRATEGIC_TEAM_SIZE)
        start = udiv(u32(start * u32(PERCENT + q.random.int(START_VARIANCE) - START_VARIANCE_OFFSET)), PERCENT);
      start = clamp(start, queen.minGroupSize, MAX_STRATEGIC_TEAM_SIZE);
    }
    if (adminChance !== 0) si.numAdmins = u8(idiv(adminChance * start, PERCENT));
    else {
      for (let n = start; n !== 0; n--) {
        const roll = q.random.int(PERCENT);
        if (roll < eliteChance) si.numElites = u8(si.numElites + 1);
        else if (roll < troopChance) si.numTroops = u8(si.numTroops + 1);
      }
    }
    if (TROOPS_FILL_START.has(gg.composition)) {
      start -= si.numAdmins;
      si.numTroops = u8(start);
    } else if (DRASSEN_ADMIN_GARRISONS.has(gg.composition)) si.numAdmins = Math.max(DRASSEN_MIN_ADMINS, si.numAdmins);
    else if (gg.composition === Composition.TIXA_PRISON) si.numAdmins = Math.max(TIXA_MIN_ADMINS, si.numAdmins);
  }
  if (adminChance !== 0 && si.numAdmins < queen.minGroupSize) si.numAdmins = queen.minGroupSize;
  const weight = garrisonWeight(ac.desired, start, ac.priority);
  if (weight > 0) queen.requestPoints = i32(queen.requestPoints + weight);
  else if (weight < 0) queen.reinforcementPoints = i32(queen.reinforcementPoints - weight);
  gg.weight = i8(weight);
  const period = CHECK_PERIOD_BASE - CHECK_PERIOD_PER_DIFFICULTY * q.state.options.difficulty + q.random.int(CHECK_PERIOD_VARIANCE);
  addPeriodStrategicEventWithOffset(
    q.state.queue,
    q.state.clock,
    EventKind.CHECK_ENEMY_CONTROLLED_SECTOR,
    period,
    START_MINUTE_OF_DAY + gi,
    gg.sector,
  );
}

function createPatrol(q: QueenContext, pi: number): void {
  const queen = q.state.queen;
  const pg = queen.patrols[pi];
  if (!pg) return;
  const n = clamp(pg.size + q.random.int(PATROL_SIZE_VARIANCE) - 1, queen.minGroupSize, MAX_STRATEGIC_TEAM_SIZE);
  const g = createNewEnemyGroupDepartingFromSector(q, pg.points[1] ?? 0, 0, n, 0);
  const e = g.enemy;
  if (!e) return;
  if (ADMIN_PATROLS.includes(pi)) {
    e.numAdmins = e.numTroops;
    e.numTroops = 0;
  }
  pg.group = g.id;
  e.intention = EnemyIntention.PATROL;
  g.moveType = MoveType.ENDTOEND_FORWARDS;
  for (const point of pg.points) {
    if (point === 0) break;
    addWaypointIdToPGroup(q, g, point);
  }
  randomizePatrolGroupLocation(q, g);
}

function placeWeaponCache(q: QueenContext): void {
  const cache = q.content.cacheSectors;
  if (cache.sectors.length === 0) return;
  const id = cache.sectors[q.random.int(cache.sectors.length)] ?? 0;
  const si = sectorInfo(q.state.map, sectorFromId(id));
  si.flags = u32(si.flags | SectorFlag.USE_ALTERNATE_MAP);
  const d = q.state.options.difficulty - 1;
  si.numTroops = u8((cache.numTroops[d] ?? 0) + q.random.int(cache.numTroopsVariance[d] ?? 0));
}

export function initStrategicAI(q: QueenContext): void {
  const queen = q.state.queen;
  const policy = q.army.policy;
  resetGlobals(queen);
  queen.reinforcementPool = policyValue(q, policy.queensPoolOfTroops);
  queen.forcePercentage = policyValue(q, policy.initialGarrisonPercentages);
  queen.alertness = policyValue(q, policy.enemyStartingAlertLevel);
  queen.alertnessDecay = policyValue(q, policy.enemyStartingAlertDecay);
  queen.minGroupSize = u8(policyValue(q, policy.minEnemyGroupSize));
  queen.graceHours = u8(policyValue(q, policy.gracePeriodInHours));
  const evaluateMinute =
    START_MINUTE_OF_DAY + policyValue(q, policy.timeEvaluateInMinutes) + q.random.int(u32(policyValue(q, policy.timeEvaluateVariance)));
  addStrategicEvent(q.state.queue, EventKind.EVALUATE_QUEEN_SITUATION, evaluateMinute, 0);
  for (const si of q.state.map.sectors) si.garrisonId = NO_GARRISON;
  queen.compositions = q.army.compositions.map(compositionFromTemplate);
  removePerimeterDefences(queen.compositions, q.state.options.difficulty);
  queen.patrols = q.army.patrols.map(patrolFromTemplate);
  queen.garrisons = q.army.garrisons.map((g) => ({ sector: g.sector, composition: g.composition, weight: 0, pendingGroup: 0 }));
  queen.garrisonDenied = new Array<number>(queen.garrisons.length).fill(0);
  scaleForces(q, queen.forcePercentage);
  for (let gi = 0; gi < queen.garrisons.length; gi++) populateGarrison(q, gi);
  for (let pi = 0; pi < queen.patrols.length; pi++) createPatrol(q, pi);
  placeWeaponCache(q);
}

export function initStrategicStatus(q: QueenContext): void {
  Object.assign(q.state.status, createStrategicStatus());
}
