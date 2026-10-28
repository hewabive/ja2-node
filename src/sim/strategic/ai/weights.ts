// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc RecalculatePatrolWeight, RecalculateGarrisonWeight, RecalculateSectorWeight,
// @src RecalculateGroupWeight, TagSAIGroupWithGracePeriod, PermittedToFillPatrolGroup, FindPatrolGroupIndexForGroupID,
// @src GarrisonReinforcementsRequested, PatrolReinforcementsRequested, ReinforcementsAvailable,
// @src GarrisonCanProvideMinimumReinforcements, GarrisonRequestingMinimumReinforcements, PatrolRequestingMinimumReinforcements,
// @src PlayerForceTooStrong.

import { byDifficultyLevel } from '../../../content/strategic/army.ts';
import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { i8, i32, idiv, u8, u16 } from '../../../core/int.ts';
import { countAllMilitiaInSector, type Group, getGroup, playerMercsInSector } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { sectorInfo } from '../map/sectors.ts';
import { worldDay } from '../time/world-clock.ts';
import {
  DEFENCE_MERC_TOO_STRONG,
  DENIAL_DIFFICULTY_BASE,
  MAX_STRATEGIC_TEAM_SIZE,
  MIN_WEIGHT,
  NO_PATROL,
  PATROL_FILL_DAY_MODULO,
  SPAWNING_COMPOSITIONS,
  WEIGHT_DIVISOR,
  WEIGHT_MULTIPLIER,
} from './constants.ts';
import type { QueenContext } from './context.ts';
import { garrisonEnemies } from './counts.ts';
import type { ArmyComposition, GarrisonGroup, PatrolGroup } from './queen-state.ts';

const PERCENT = 100;

export function garrison(q: StrategicContext, gi: number): GarrisonGroup {
  const g = q.state.queen.garrisons[gi];
  if (!g) throw new RangeError(`no garrison ${gi}`);
  return g;
}

export function patrol(q: StrategicContext, pi: number): PatrolGroup {
  const p = q.state.queen.patrols[pi];
  if (!p) throw new RangeError(`no patrol ${pi}`);
  return p;
}

export function compositionOf(q: StrategicContext, gg: GarrisonGroup): ArmyComposition {
  const c = q.state.queen.compositions[gg.composition];
  if (!c) throw new RangeError(`no army composition ${gg.composition}`);
  return c;
}

export function garrisonSectorInfo(q: StrategicContext, gg: GarrisonGroup) {
  return sectorInfo(q.state.map, sectorFromId(gg.sector));
}

export function existingForces(q: StrategicContext, gi: number): number {
  return garrisonEnemies(garrisonSectorInfo(q, garrison(q, gi)));
}

export function recalculatePatrolWeight(q: StrategicContext, p: PatrolGroup): void {
  const queen = q.state.queen;
  if (p.weight > 0) queen.requestPoints = i32(queen.requestPoints - p.weight);
  let need: number;
  if (p.group !== 0) {
    need = p.size - (getGroup(q, p.group)?.size ?? 0);
    if (need < 0) {
      p.weight = 0;
      return;
    }
  } else need = p.size;
  const weight = Math.min(idiv(need * WEIGHT_MULTIPLIER * p.priority, WEIGHT_DIVISOR), MIN_WEIGHT);
  p.weight = i8(weight);
  queen.requestPoints = i32(queen.requestPoints + weight);
}

export function garrisonWeight(desired: number, current: number, priority: number): number {
  let w = (desired - current) * WEIGHT_MULTIPLIER;
  if (w > 0) w = Math.max(idiv(w * priority, WEIGHT_DIVISOR), MIN_WEIGHT);
  else if (w < 0) w = Math.min(idiv(w * (PERCENT - priority), WEIGHT_DIVISOR), -MIN_WEIGHT);
  return w;
}

export function recalculateGarrisonWeight(q: StrategicContext, gi: number): void {
  const queen = q.state.queen;
  const gg = garrison(q, gi);
  const comp = compositionOf(q, gg);
  const prev = gg.weight;
  if (prev > 0) queen.requestPoints = i32(queen.requestPoints - prev);
  else if (prev < 0) queen.reinforcementPoints = i32(queen.reinforcementPoints + prev);
  const w = garrisonWeight(comp.desired, existingForces(q, gi), comp.priority);
  if (w > 0) queen.requestPoints = i32(queen.requestPoints + w);
  else if (w < 0) queen.reinforcementPoints = i32(queen.reinforcementPoints - i8(w));
  gg.weight = i8(w);
}

export function recalculateSectorWeight(q: StrategicContext, id: number): void {
  const gi = q.state.queen.garrisons.findIndex((g) => g.sector === id);
  if (gi >= 0) recalculateGarrisonWeight(q, gi);
}

export function findPatrolGroupIndexForGroupId(q: StrategicContext, groupId: number): number {
  return q.state.queen.patrols.findIndex((p) => p.group === groupId);
}

export function tagSaiGroupWithGracePeriod(q: QueenContext, g: Group): void {
  const pi = findPatrolGroupIndexForGroupId(q, g.id);
  if (pi === NO_PATROL) return;
  const grace = byDifficultyLevel(q.army.policy.patrolGracePeriodInDays, q.state.options.difficulty);
  patrol(q, pi).fillDayMod100 = i8((worldDay(q.state.clock) + grace) % PATROL_FILL_DAY_MODULO);
}

export function permittedToFillPatrolGroup(q: StrategicContext, pi: number): boolean {
  const day = worldDay(q.state.clock);
  return day >= patrol(q, pi).fillDayMod100 + idiv(day, PATROL_FILL_DAY_MODULO) * PATROL_FILL_DAY_MODULO;
}

export function recalculateGroupWeight(q: QueenContext, g: Group): void {
  const p = q.state.queen.patrols.find((x) => x.group === g.id);
  if (!p) return;
  if (g.size === 0) {
    tagSaiGroupWithGracePeriod(q, g);
    p.group = 0;
  }
  recalculatePatrolWeight(q, p);
}

export interface ReinforcementRequest {
  readonly requested: number;
  readonly extra: number;
}

export function garrisonReinforcementsRequested(q: StrategicContext, gi: number): ReinforcementRequest {
  const gg = garrison(q, gi);
  const requested = compositionOf(q, gg).desired - existingForces(q, gi);
  let extra = u8(idiv(q.state.queen.garrisonDenied[gi] ?? 0, DENIAL_DIFFICULTY_BASE - q.state.options.difficulty));
  extra = u8(Math.min(extra, Math.min(extra, MAX_STRATEGIC_TEAM_SIZE - requested)));
  return { requested: Math.min(MAX_STRATEGIC_TEAM_SIZE, requested), extra };
}

export function patrolReinforcementsRequested(q: StrategicContext, p: PatrolGroup): number {
  const g = getGroup(q, p.group);
  return g ? p.size - g.size : p.size;
}

export function reinforcementsAvailable(q: StrategicContext, gi: number): number {
  const gg = garrison(q, gi);
  if (!SPAWNING_COMPOSITIONS.has(gg.composition)) return 0;
  return existingForces(q, gi) - compositionOf(q, gg).desired;
}

export function garrisonCanProvideMinimumReinforcements(q: StrategicContext, gi: number): boolean {
  const gg = garrison(q, gi);
  if (existingForces(q, gi) - compositionOf(q, gg).desired < q.state.queen.minGroupSize) return false;
  const s = sectorFromId(gg.sector);
  return !playerMercsInSector(q, s) && !countAllMilitiaInSector(q, s);
}

export function garrisonRequestingMinimumReinforcements(q: StrategicContext, gi: number): boolean {
  const gg = garrison(q, gi);
  if (gg.pendingGroup) return false;
  return compositionOf(q, gg).desired - existingForces(q, gi) >= q.state.queen.minGroupSize;
}

export function patrolRequestingMinimumReinforcements(q: QueenContext, pi: number): boolean {
  const p = patrol(q, pi);
  if (p.pendingGroup) return false;
  if (!permittedToFillPatrolGroup(q, pi)) return false;
  const g = getGroup(q, p.group);
  if (g) return p.size - g.size >= q.state.queen.minGroupSize;
  return q.army.policy.refillDefeatedPatrolGroups;
}

export function militiaDefence(q: StrategicContext, id: number, perMerc: number): number {
  const s = sectorFromId(id);
  const m = sectorInfo(q.state.map, s).militia;
  return u16((m[0] ?? 0) + (m[1] ?? 0) * 2 + (m[2] ?? 0) * 3 + playerMercsInSector(q, s) * perMerc);
}

export function playerForceTooStrong(q: StrategicContext, id: number, offence: number): { tooStrong: boolean; defence: number } {
  const defence = militiaDefence(q, id, DEFENCE_MERC_TOO_STRONG);
  return { tooStrong: defence > offence, defence };
}
