// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc CalcNumTroopsBasedOnComposition, ConvertGroupTroopsToComposition,
// @src RemoveSoldiersFromGarrisonBasedOnComposition, EliminateSurplusTroopsForGarrison.

import { idiv, u8 } from '../../../core/int.ts';
import type { EnemyGroup, Group } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import type { SectorInfo } from '../map/sectors.ts';
import { MAX_STRATEGIC_TEAM_SIZE } from './constants.ts';
import { rollChance } from './context.ts';
import { garrisonEnemies } from './counts.ts';
import { garrison, garrisonSectorInfo, recalculateGarrisonWeight } from './weights.ts';

const PERCENT = 100;

export interface TroopSplit {
  troops: number;
  elites: number;
}

export function calcNumTroopsBasedOnComposition(q: StrategicContext, total: number, ci: number): TroopSplit {
  const comp = q.state.queen.compositions[ci];
  if (!comp) throw new RangeError(`no army composition ${ci}`);
  const split = { troops: u8(idiv(comp.troopPct * total, PERCENT)), elites: u8(idiv(comp.elitePct * total, PERCENT)) };
  while (split.troops + split.elites < total) {
    if (rollChance(q.random, comp.troopPct)) split.troops = u8(split.troops + 1);
    else split.elites = u8(split.elites + 1);
  }
  return split;
}

export function enemyMembers(e: EnemyGroup): number {
  return u8(e.numAdmins + e.numTroops + e.numElites);
}

export function enemyOf(g: Group): EnemyGroup {
  if (!g.enemy) throw new RangeError(`group ${g.id} is not an enemy group`);
  return g.enemy;
}

export function convertGroupTroopsToComposition(q: StrategicContext, g: Group, ci: number): void {
  const e = enemyOf(g);
  const split = calcNumTroopsBasedOnComposition(q, g.size, ci);
  e.numTroops = split.troops;
  e.numElites = split.elites;
  e.numAdmins = 0;
  g.size = enemyMembers(e);
}

export function removeSoldiersFromGarrisonBasedOnComposition(q: StrategicContext, gi: number, size: number): void {
  const gg = garrison(q, gi);
  let { troops, elites } = calcNumTroopsBasedOnComposition(q, size, gg.composition);
  const info = garrisonSectorInfo(q, gg);
  let left = size;
  while (left && info.numAdmins) {
    info.numAdmins--;
    left--;
    if (troops) troops--;
    else elites = u8(elites - 1);
  }
  for (; troops; troops--) {
    if (info.numTroops) info.numTroops--;
    else if (info.numElites) info.numElites--;
  }
  for (; elites; elites--) {
    if (info.numElites) info.numElites--;
    else if (info.numTroops) info.numTroops--;
  }
  recalculateGarrisonWeight(q, gi);
}

type Bucket = 'admins' | 'troops' | 'elites';
const SURPLUS_ORDER: readonly Bucket[] = ['admins', 'troops', 'elites'];

function groupField(bucket: Bucket): 'numAdmins' | 'numTroops' | 'numElites' {
  return bucket === 'admins' ? 'numAdmins' : bucket === 'troops' ? 'numTroops' : 'numElites';
}

function takeFrom(holder: { numAdmins: number; numTroops: number; numElites: number }, bucket: Bucket, wanted: number): number {
  const field = groupField(bucket);
  const have = holder[field];
  if (have < wanted) {
    holder[field] = 0;
    return have;
  }
  holder[field] = u8(have - wanted);
  return wanted;
}

export function eliminateSurplusTroopsForGarrison(g: Group, info: SectorInfo): void {
  const e = enemyOf(g);
  let surplus = enemyMembers(e) + u8(garrisonEnemies(info)) - MAX_STRATEGIC_TEAM_SIZE;
  for (const bucket of SURPLUS_ORDER) {
    if (surplus > 0 && e[groupField(bucket)]) surplus -= takeFrom(e, bucket, surplus);
    if (surplus > 0 && info[groupField(bucket)]) surplus -= takeFrom(info, bucket, surplus);
  }
}
