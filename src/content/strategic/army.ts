// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/army/{ArmyCompositionModel,GarrisonGroupModel,PatrolGroupModel}.cc;
// @src src/externalized/policy/DefaultStrategicAIPolicy.cc; DefaultGamePolicy.cc (progress). See docs/17 §2, §15.

import { i8, u8 } from '../../core/int.ts';
import { FormatError } from '../binary/errors.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { asArray, asBool, asInt, asObject, asString, type JsonObject } from './json-fields.ts';
import { parseJsoncBytes } from './jsonc.ts';
import { parseSectorId, sectorFromId } from './sector-ids.ts';

export const ARMY_CONTENT_PATHS = {
  compositions: 'externalized/army-compositions.json',
  garrisons: 'externalized/army-garrison-groups.json',
  patrols: 'externalized/army-patrol-groups.json',
  policy: 'externalized/strategic-ai-policy.json',
  game: 'externalized/game.json',
} as const;

export const NUM_ARMY_COMPOSITIONS = 27;
export const SAVED_ARMY_COMPOSITIONS = 60;
export const SAVED_PATROL_GROUPS = 50;
export const SAVED_GARRISON_GROUPS = 100;
export const PATROL_POINTS = 4;
const MIN_PATROL_POINTS = 2;
const UNSET_FILL_DAY = -1;

export type ByDifficulty = readonly [number, number, number];

export interface ArmyCompositionTemplate {
  readonly id: number;
  readonly name: string;
  readonly priority: number;
  readonly elitePct: number;
  readonly troopPct: number;
  readonly adminPct: number;
  readonly desired: number;
  readonly start: number;
}

export interface GarrisonTemplate {
  readonly sector: number;
  readonly composition: number;
}

export interface PatrolTemplate {
  readonly size: number;
  readonly priority: number;
  readonly points: readonly number[];
  readonly fillDayMod100: number;
}

export interface StrategicAiPolicy {
  readonly queensPoolOfTroops: ByDifficulty;
  readonly initialGarrisonPercentages: ByDifficulty;
  readonly minEnemyGroupSize: ByDifficulty;
  readonly enemyStartingAlertLevel: ByDifficulty;
  readonly enemyStartingAlertDecay: ByDifficulty;
  readonly timeEvaluateInMinutes: ByDifficulty;
  readonly timeEvaluateVariance: ByDifficulty;
  readonly gracePeriodInHours: ByDifficulty;
  readonly patrolGracePeriodInDays: ByDifficulty;
  readonly numAwareBattles: ByDifficulty;
  readonly refillDefeatedPatrolGroups: boolean;
}

export interface ProgressPolicy {
  readonly weightKills: number;
  readonly weightControl: number;
  readonly weightIncome: number;
  readonly killsPerPoint: ByDifficulty;
  readonly eventMadlabMin: number;
  readonly eventMikeMin: number;
  readonly eventIggyMin: number;
}

export interface ArmyContent {
  readonly compositions: readonly ArmyCompositionTemplate[];
  readonly garrisons: readonly GarrisonTemplate[];
  readonly patrols: readonly PatrolTemplate[];
  readonly policy: StrategicAiPolicy;
  readonly progress: ProgressPolicy;
}

export type ArmyContentSources = { readonly [K in keyof typeof ARMY_CONTENT_PATHS]: unknown };

export function parseArmyCompositions(json: unknown): ArmyCompositionTemplate[] {
  const list = asArray(json, 'army compositions').map((v, i) => {
    const what = `army compositions[${i}]`;
    const o = asObject(v, what);
    const int = (key: string) => i8(asInt(o[key], `${what}.${key}`));
    return {
      id: asInt(o.id, `${what}.id`),
      name: asString(o.name, `${what}.name`),
      priority: int('priority'),
      elitePct: int('elitePercentage'),
      troopPct: int('troopPercentage'),
      adminPct: int('adminPercentage'),
      desired: int('desiredPopulation'),
      start: int('startPopulation'),
    };
  });
  if (list.length < NUM_ARMY_COMPOSITIONS || list.length > SAVED_ARMY_COMPOSITIONS)
    throw new FormatError(`army compositions: expected ${NUM_ARMY_COMPOSITIONS}..${SAVED_ARMY_COMPOSITIONS}, got ${list.length}`);
  return list;
}

export function parseGarrisonGroups(json: unknown, compositions: readonly ArmyCompositionTemplate[]): GarrisonTemplate[] {
  const byName = new Map(compositions.map((c, index) => [c.name, index]));
  const list = asArray(json, 'garrison groups').map((v, i) => {
    const what = `garrison groups[${i}]`;
    const o = asObject(v, what);
    const name = asString(o.composition, `${what}.composition`);
    const composition = byName.get(name);
    if (composition === undefined) throw new FormatError(`${what}: unknown composition ${name}`);
    return { sector: parseSectorId(asString(o.sector, `${what}.sector`)), composition };
  });
  if (list.length > SAVED_GARRISON_GROUPS) throw new FormatError(`garrison groups: more than ${SAVED_GARRISON_GROUPS}`);
  return list;
}

function axisAligned(a: number, b: number): boolean {
  const p = sectorFromId(a);
  const q = sectorFromId(b);
  return (p.x === q.x) !== (p.y === q.y);
}

function patrolPoints(value: unknown, what: string): number[] {
  const ids = asArray(value, what).map((s, k) => parseSectorId(asString(s, `${what}[${k}]`)));
  if (ids.length < MIN_PATROL_POINTS || ids.length > PATROL_POINTS)
    throw new FormatError(`${what}: expected ${MIN_PATROL_POINTS}..${PATROL_POINTS} points`);
  for (let k = 1; k < ids.length; k++) {
    if (!axisAligned(ids[k - 1] ?? 0, ids[k] ?? 0)) throw new FormatError(`${what}: points ${k - 1} and ${k} are not axis-aligned`);
  }
  return [...ids, ...new Array<number>(PATROL_POINTS - ids.length).fill(0)];
}

export function parsePatrolGroups(json: unknown): PatrolTemplate[] {
  const list = asArray(json, 'patrol groups').map((v, i) => {
    const what = `patrol groups[${i}]`;
    const o = asObject(v, what);
    return {
      size: i8(asInt(o.size, `${what}.size`)),
      priority: i8(asInt(o.priority, `${what}.priority`)),
      points: patrolPoints(o.points, `${what}.points`),
      fillDayMod100: UNSET_FILL_DAY,
    };
  });
  if (list.length > SAVED_PATROL_GROUPS) throw new FormatError(`patrol groups: more than ${SAVED_PATROL_GROUPS}`);
  return list;
}

function byDifficulty(o: JsonObject, key: string): ByDifficulty {
  const read = (suffix: string) => asInt(o[`${key}_${suffix}`], `strategic AI policy.${key}_${suffix}`);
  return [read('easy'), read('medium'), read('hard')];
}

export function parseStrategicAiPolicy(json: unknown): StrategicAiPolicy {
  const o = asObject(json, 'strategic AI policy');
  return {
    queensPoolOfTroops: byDifficulty(o, 'queens_pool_of_troops'),
    initialGarrisonPercentages: byDifficulty(o, 'initial_garrison_percentages'),
    minEnemyGroupSize: byDifficulty(o, 'min_enemy_group_size'),
    enemyStartingAlertLevel: byDifficulty(o, 'enemy_starting_alert_level'),
    enemyStartingAlertDecay: byDifficulty(o, 'enemy_starting_alert_decay'),
    timeEvaluateInMinutes: byDifficulty(o, 'time_evaluate_in_minutes'),
    timeEvaluateVariance: byDifficulty(o, 'time_evaluate_variance'),
    gracePeriodInHours: byDifficulty(o, 'grace_period_in_hours'),
    patrolGracePeriodInDays: byDifficulty(o, 'patrol_grace_period_in_days'),
    numAwareBattles: byDifficulty(o, 'num_aware_battles'),
    refillDefeatedPatrolGroups:
      o.refill_defeated_patrol_groups === undefined ? false : asBool(o.refill_defeated_patrol_groups, 'refill_defeated_patrol_groups'),
  };
}

export function parseProgressPolicy(json: unknown): ProgressPolicy {
  const game = asObject(json, 'game policy');
  const o = asObject(game.progress, 'game policy.progress');
  const int = (key: string) => u8(asInt(o[key], `progress.${key}`));
  return {
    weightKills: int('weight_kills'),
    weightControl: int('weight_control'),
    weightIncome: int('weight_income'),
    killsPerPoint: [int('kills_per_point_easy'), int('kills_per_point_medium'), int('kills_per_point_hard')],
    eventMadlabMin: int('event_madlab_min'),
    eventMikeMin: int('event_mike_min'),
    eventIggyMin: int('event_iggy_min'),
  };
}

export function parseArmyContent(sources: ArmyContentSources): ArmyContent {
  const compositions = parseArmyCompositions(sources.compositions);
  return {
    compositions,
    garrisons: parseGarrisonGroups(sources.garrisons, compositions),
    patrols: parsePatrolGroups(sources.patrols),
    policy: parseStrategicAiPolicy(sources.policy),
    progress: parseProgressPolicy(sources.game),
  };
}

export function byDifficultyLevel(values: ByDifficulty, difficulty: number): number {
  const v = values[difficulty - 1];
  if (v === undefined) throw new RangeError(`invalid difficulty level ${difficulty}`);
  return v;
}

export async function loadArmyContent(read: ReadFile): Promise<ArmyContent> {
  const keys = Object.keys(ARMY_CONTENT_PATHS) as (keyof typeof ARMY_CONTENT_PATHS)[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const bytes = await read(ARMY_CONTENT_PATHS[key]);
      if (!bytes) throw new FormatError(`missing ${ARMY_CONTENT_PATHS[key]}`);
      return parseJsoncBytes(bytes);
    }),
  );
  return parseArmyContent(Object.fromEntries(keys.map((key, i) => [key, values[i]])) as ArmyContentSources);
}
