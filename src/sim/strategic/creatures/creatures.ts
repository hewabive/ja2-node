// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Creature_Spreading.cc NewDirective, InitCreatureLair, IsMineInfestible, InitCreatureQuest,
// @src AddCreatureToNode, PlaceNewCreature, SpreadCreatures, CreatureNightPlanning, CheckConditionsForTriggeringCreatureQuest,
// @src EndCreatureQuest, CreaturesInUndergroundSector, MineClearOfMonsters, PlayerGroupIsInACreatureInfestedMine,
// @src GetWarpOutOfMineCodes, LoadCreatureDirectives, CreatureWeightsByHabitat, DistributeCreaturesByWeight; Utils/Music_Control.cc
// @src StartMusicBasedOnMode (the creature music ends with an above-ground victory); Tactical/Strategic_Exit_GUI.cc
// @src InitSectorExitMenu (when the warp to the surface is offered).

import { CreatureHabitat, type CreatureLair, lairContainsSector } from '../../../content/strategic/creature-lairs.ts';
import type { MineDef } from '../../../content/strategic/economy-content.ts';
import { type Sector, sameSector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { idiv, u8 } from '../../../core/int.ts';
import { Difficulty, SectorFlag } from '../forces/constants.ts';
import type { RollSource } from '../forces/ports.ts';
import { findUndergroundSector, type UndergroundSector } from '../map/sectors.ts';
import { Quest } from '../narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../narrative/facts.ts';
import type { StrategicState } from '../state.ts';
import { EventKind } from '../time/constants.ts';
import { addEveryDayStrategicEvent, addPeriodStrategicEvent, addStrategicEvent } from '../time/event-queue.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';

export const NO_LAIR = 0;
export const LAIR_DESTROYED = -1;

export const CreatureBattleCode = {
  NONE: 0,
  TACTICALLY_ADD: 1,
  TACTICALLY_ADD_WITH_FOV: 2,
  PRE_BATTLE_INTERFACE: 3,
  AUTORESOLVE: 4,
} as const;

export interface CreatureAttack {
  insertionCode: number;
  insertionGridNo: number;
  numAttacking: number;
  battleCode: number;
  sectorId: number;
}

export interface CreatureState {
  lairId: number;
  habitatedDistance: number;
  populationModifier: number;
  destroyedLairId: number;
  meanwhileScenePlayed: boolean;
  useCreatureMusic: boolean;
  readonly attack: CreatureAttack;
}

export function clearCreatureMusicAtVictory(state: {
  readonly creatures: CreatureState;
  readonly worldSector: { readonly z: number } | null;
}): void {
  if (state.worldSector?.z === 0) state.creatures.useCreatureMusic = false;
}

export function createCreatureState(): CreatureState {
  return {
    lairId: NO_LAIR,
    habitatedDistance: 0,
    populationModifier: 0,
    destroyedLairId: 0,
    meanwhileScenePlayed: false,
    useCreatureMusic: false,
    attack: { insertionCode: 0, insertionGridNo: 0, numAttacking: 0, battleCode: CreatureBattleCode.NONE, sectorId: 0 },
  };
}

export function clearCreatureAttack(a: CreatureAttack): void {
  a.insertionCode = 0;
  a.insertionGridNo = 0;
  a.numAttacking = 0;
  a.battleCode = CreatureBattleCode.NONE;
  a.sectorId = 0;
}

export interface CreatureContext {
  readonly state: StrategicState;
  readonly lairs: readonly CreatureLair[];
  readonly mines: readonly MineDef[];
  readonly random: RollSource;
  readonly preRandom: RollSource;
  scheduleCreatureMeanwhile(): void;
}

const SPREAD_MINUTES: Readonly<Record<number, number>> = { [Difficulty.EASY]: 510, [Difficulty.MEDIUM]: 450, [Difficulty.HARD]: 390 };
const QUEEN_INIT_BONUS_SPREADS: Readonly<Record<number, number>> = { [Difficulty.EASY]: 1, [Difficulty.MEDIUM]: 2, [Difficulty.HARD]: 3 };
const POPULATION_MODIFIER: Readonly<Record<number, number>> = { [Difficulty.EASY]: 0, [Difficulty.MEDIUM]: 0, [Difficulty.HARD]: 0 };
const REPRODUCTION: Readonly<Record<number, readonly [number, number]>> = {
  [Difficulty.EASY]: [6, 1],
  [Difficulty.MEDIUM]: [7, 2],
  [Difficulty.HARD]: [9, 3],
};
const NIGHT_PLANNING_MINUTE_OF_DAY = 1320;
const ATTACK_DELAY_RANGE = 429;
const ATTACK_CHANCE_PER_CREATURE = 10;
const MIN_CREATURES_TO_ATTACK = 1;
const MAX_STRATEGIC_TEAM_SIZE = 20;
const QUEEN_LAIR_MAX_POPULATION = 32;
const FRONT_LINE_ROLL = 60;
const FRONT_LINE_STEP = 10;
const MIN_MAX_POPULATION_PERCENT = 25;
const MIN_MAX_POPULATION = 4;
const VALID_MINES_TO_TRIGGER_QUEST = 3;
const MINE_EXIT_LEVEL = 1;
const TIXA_CAVE: Sector = { x: 9, y: 10, z: 2 };
const SURFACE_SECTORS_CLEARED_ON_QUEST_END = 255;

const ABSOLUTE_MAX_POPULATION: Readonly<Record<number, number>> = {
  [CreatureHabitat.QUEEN_LAIR]: 32,
  [CreatureHabitat.LAIR]: 18,
  [CreatureHabitat.LAIR_ENTRANCE]: 15,
  [CreatureHabitat.INNER_MINE]: 12,
  [CreatureHabitat.OUTER_MINE]: 10,
  [CreatureHabitat.FEEDING_GROUNDS]: 15,
  [CreatureHabitat.MINE_EXIT]: 10,
};

export const CreatureWeightIndex = { LARVAE: 0, INFANT: 1, YOUNG_MALE: 2, YOUNG_FEMALE: 3, ADULT_MALE: 4, ADULT_FEMALE: 5 } as const;

export const CREATURE_WEIGHTS_BY_HABITAT: readonly (readonly number[])[] = [
  [20, 40, 0, 0, 30, 10],
  [15, 35, 10, 5, 25, 10],
  [0, 15, 30, 10, 35, 10],
  [0, 0, 20, 40, 10, 30],
  [0, 0, 10, 65, 5, 20],
  [25, 25, 25, 25, 0, 0],
  [0, 0, 10, 65, 5, 20],
];
const WEIGHT_TOTAL = 100;

type LairLookup = Pick<CreatureContext, 'state' | 'lairs'>;

export const LAIR_MIN_LEVEL = 2;

export function activeLair(ctx: LairLookup): CreatureLair | null {
  return ctx.lairs.find((l) => l.lairId === ctx.state.creatures.lairId) ?? null;
}

function mineById(ctx: CreatureContext, id: number): MineDef | null {
  return ctx.mines.find((m) => m.mineId === id) ?? null;
}

function lairLevels(ctx: CreatureContext, lair: CreatureLair): UndergroundSector[] {
  return lair.sectors.map((s) => {
    const u = findUndergroundSector(ctx.state.map, sectorFromId(s.sector, s.z));
    if (!u) throw new Error(`creature lair sector ${s.sector}/${s.z} has no underground record`);
    return u;
  });
}

export function initCreatureLair(ctx: CreatureContext, lair: CreatureLair): void {
  ctx.state.creatures.lairId = lair.lairId;
  const levels = lairLevels(ctx, lair);
  lair.sectors.forEach((s, i) => {
    const level = levels[i];
    if (!level) return;
    level.creatureHabitat = s.habitat;
    if (s.habitat === CreatureHabitat.QUEEN_LAIR && !level.numCreatures) level.numCreatures = 1;
  });
}

function isMineInfestible(ctx: CreatureContext, mine: MineDef): boolean {
  const status = ctx.state.economy.mines[mine.mineId];
  const entrance = sectorFromId(mine.entranceSector, 0);
  return (
    status !== undefined &&
    !status.attackedHeadMiner &&
    status.oreRunningOutPoint === 0 &&
    ctx.state.map.elements[strategicIndex(entrance)]?.enemyControlled !== true
  );
}

export function initCreatureQuest(ctx: CreatureContext): void {
  const creatures = ctx.state.creatures;
  if (creatures.lairId) return;
  if (!creatures.meanwhileScenePlayed) {
    ctx.scheduleCreatureMeanwhile();
    creatures.meanwhileScenePlayed = true;
  }
  const difficulty = ctx.state.options.difficulty;
  creatures.habitatedDistance = 0;
  creatures.populationModifier = POPULATION_MODIFIER[difficulty] ?? creatures.populationModifier;
  const infestible: number[] = [];
  for (const lair of ctx.lairs) {
    const mine = mineById(ctx, lair.associatedMineId);
    if (mine && isMineInfestible(ctx, mine)) infestible.push(mine.mineId);
  }
  if (infestible.length === 0) return;
  const chosen = infestible[ctx.random.int(infestible.length)] as number;
  const lair = ctx.lairs.find((l) => l.associatedMineId === chosen);
  if (!lair) return;
  initCreatureLair(ctx, lair);
  const entrance = findUndergroundSector(ctx.state.map, sectorFromId(lair.entranceSector, lair.entranceSectorLevel));
  if (!entrance) throw new Error('lair entrance sector is not defined as an underground sector');
  entrance.flags |= SectorFlag.PENDING_ALTERNATE_MAP;
  const queue = ctx.state.queue;
  const clock = ctx.state.clock;
  const spreads = QUEEN_INIT_BONUS_SPREADS[difficulty] ?? 0;
  const period = SPREAD_MINUTES[difficulty];
  if (period !== undefined) addPeriodStrategicEvent(queue, clock, EventKind.CREATURE_SPREAD, period, 0);
  addEveryDayStrategicEvent(queue, clock, EventKind.CREATURE_NIGHT_PLANNING, NIGHT_PLANNING_MINUTE_OF_DAY, 0);
  for (let i = 0; i < spreads; i++) spreadCreatures(ctx);
}

function addCreatureToNode(level: UndergroundSector): void {
  level.numCreatures = u8(level.numCreatures + 1);
  if (level.flags & SectorFlag.PENDING_ALTERNATE_MAP) {
    level.flags &= ~SectorFlag.PENDING_ALTERNATE_MAP;
    level.flags |= SectorFlag.USE_ALTERNATE_MAP;
  }
}

function difficultyScaledMaximum(absolute: number, difficulty: number): number {
  if (difficulty === Difficulty.EASY) return idiv(absolute, 2);
  if (difficulty === Difficulty.MEDIUM) return idiv(absolute * 4, 5);
  return absolute;
}

function populateInterior(ctx: CreatureContext, level: UndergroundSector, distance: number): boolean | null {
  const creatures = ctx.state.creatures;
  const n = level.numCreatures;
  if (!(n < MAX_STRATEGIC_TEAM_SIZE || (n < QUEEN_LAIR_MAX_POPULATION && level.creatureHabitat === CreatureHabitat.QUEEN_LAIR)))
    return false;
  const absolute = ABSOLUTE_MAX_POPULATION[level.creatureHabitat];
  if (absolute === undefined) return null;
  let maxPopulation = 100 - idiv(distance * 100, creatures.habitatedDistance);
  maxPopulation = Math.max(maxPopulation, MIN_MAX_POPULATION_PERCENT);
  maxPopulation = idiv(difficultyScaledMaximum(absolute, ctx.state.options.difficulty) * maxPopulation, 100);
  maxPopulation = Math.max(maxPopulation, MIN_MAX_POPULATION);
  const chance = 100 - idiv(n * 100, maxPopulation);
  if (!n || (chance > ctx.random.int(100) && maxPopulation > n)) {
    addCreatureToNode(level);
    return true;
  }
  return false;
}

function placeNewCreature(ctx: CreatureContext, levels: readonly UndergroundSector[], index: number, distance: number): boolean {
  const level = levels[index];
  if (!level) return false;
  const creatures = ctx.state.creatures;
  if (creatures.habitatedDistance === distance) {
    if (level.numCreatures * FRONT_LINE_STEP - FRONT_LINE_STEP <= ctx.random.int(FRONT_LINE_ROLL)) {
      addCreatureToNode(level);
      return true;
    }
  } else if (creatures.habitatedDistance > distance) {
    const placed = populateInterior(ctx, level, distance);
    if (placed === null) return false;
    if (placed) return true;
  } else {
    addCreatureToNode(level);
    creatures.habitatedDistance++;
    return true;
  }
  return placeNewCreature(ctx, levels, index + 1, distance + 1);
}

export function spreadCreatures(ctx: CreatureContext): void {
  const creatures = ctx.state.creatures;
  if (creatures.lairId === LAIR_DESTROYED) return;
  const reproduction = REPRODUCTION[ctx.state.options.difficulty];
  let births = reproduction ? reproduction[0] + ctx.random.int(1 + reproduction[1]) : 0;
  const lair = activeLair(ctx);
  const levels = lair ? lairLevels(ctx, lair) : [];
  while (births-- > 0) placeNewCreature(ctx, levels, 0, 0);
}

export function creaturesInUndergroundSector(ctx: Pick<CreatureContext, 'state'>, sector: number, z: number): number {
  return findUndergroundSector(ctx.state.map, sectorFromId(sector, z))?.numCreatures ?? 0;
}

export function creatureNightPlanning(ctx: CreatureContext): void {
  for (const lair of ctx.lairs) {
    const mine = mineById(ctx, lair.associatedMineId);
    if (!mine) continue;
    const n = creaturesInUndergroundSector(ctx, mine.entranceSector, MINE_EXIT_LEVEL);
    if (n > MIN_CREATURES_TO_ATTACK && n * ATTACK_CHANCE_PER_CREATURE > ctx.preRandom.int(100)) {
      const minute = worldTotalMinutes(ctx.state.clock) + 1 + ctx.preRandom.int(ATTACK_DELAY_RANGE);
      addStrategicEvent(ctx.state.queue, EventKind.CREATURE_ATTACK, minute, mine.entranceSector);
    }
  }
}

export function checkConditionsForTriggeringCreatureQuest(ctx: CreatureContext): void {
  if (!ctx.state.options.sciFi || ctx.state.creatures.lairId) return;
  let valid = 0;
  for (const lair of ctx.lairs) {
    const mine = mineById(ctx, lair.associatedMineId);
    if (!mine) continue;
    if (ctx.state.map.elements[strategicIndex(sectorFromId(mine.entranceSector, 0))]?.enemyControlled !== true) valid++;
  }
  if (valid >= VALID_MINES_TO_TRIGGER_QUEST) initCreatureQuest(ctx);
}

export function endCreatureQuest(ctx: CreatureContext): void {
  const creatures = ctx.state.creatures;
  const lair = activeLair(ctx);
  creatures.destroyedLairId = creatures.lairId;
  creatures.lairId = LAIR_DESTROYED;
  if (lair) for (const level of lairLevels(ctx, lair).slice(1)) level.numCreatures = 0;
  const tixa = findUndergroundSector(ctx.state.map, TIXA_CAVE);
  if (tixa) tixa.numCreatures = 0;
  for (let i = 0; i < SURFACE_SECTORS_CLEARED_ON_QUEST_END; i++) {
    const info = ctx.state.map.sectors[i];
    if (!info) continue;
    info.numCreatures = 0;
    info.creaturesInBattle = 0;
  }
}

export function mineClearOfMonsters(ctx: CreatureContext, mineIndex: number): boolean {
  const status = ctx.state.economy.mines[mineIndex];
  if (!status?.prevInvadedByMonsters) {
    const mine = mineById(ctx, mineIndex);
    if (!mine) return true;
    return !mine.mineSectors.some((s) => creaturesInUndergroundSector(ctx, s.sector, s.z) > 0);
  }
  return ctx.state.creatures.lairId === LAIR_DESTROYED;
}

export interface MercLocation {
  readonly life: number;
  readonly sector: Sector;
  readonly betweenSectors: boolean;
}

export function playerGroupIsInACreatureInfestedMine(ctx: CreatureContext, mercs: readonly MercLocation[]): boolean {
  if (ctx.state.creatures.lairId <= NO_LAIR) return false;
  const lair = activeLair(ctx);
  if (!lair) return false;
  return lair.sectors.some((s) =>
    mercs.some((m) => m.life !== 0 && !m.betweenSectors && sameSector(m.sector, sectorFromId(s.sector, s.z))),
  );
}

export interface MineWarp {
  readonly sector: Sector;
  readonly gridNo: number;
}

export function warpOutOfMineCodes(ctx: LairLookup, world: Sector | null): MineWarp | null {
  if (!world || world.z === 0) return null;
  const creatures = ctx.state.creatures;
  let lair = activeLair(ctx);
  if (!lair && creatures.lairId === LAIR_DESTROYED) lair = ctx.lairs.find((l) => l.lairId === creatures.destroyedLairId) ?? null;
  if (!lair || !lairContainsSector(lair, sectorId(world), world.z)) return null;
  return { sector: sectorFromId(lair.warpExitSector, 0), gridNo: lair.warpExitGridNo };
}

export function surfaceWarp(ctx: LairLookup, world: Sector | null): MineWarp | null {
  if (!world || world.z < LAIR_MIN_LEVEL || questStatus(ctx.state.narrative, Quest.CREATURES) !== QuestStatus.DONE) return null;
  return warpOutOfMineCodes(ctx, world);
}

export interface SavedCreatureDirectives {
  readonly habitatedDistance: number;
  readonly populationModifier: number;
  readonly lairId: number;
  readonly useCreatureMusic: boolean;
  readonly destroyedLairId: number;
}

export function importCreatureDirectives(ctx: CreatureContext, saved: SavedCreatureDirectives, meanwhileScenePlayed: boolean): void {
  const creatures = ctx.state.creatures;
  creatures.habitatedDistance = saved.habitatedDistance;
  creatures.populationModifier = saved.populationModifier;
  creatures.lairId = saved.lairId;
  creatures.useCreatureMusic = saved.useCreatureMusic;
  creatures.destroyedLairId = saved.destroyedLairId;
  creatures.meanwhileScenePlayed = meanwhileScenePlayed;
  if (saved.lairId === NO_LAIR || saved.lairId === LAIR_DESTROYED) return;
  const lair = ctx.lairs.find((l) => l.lairId === saved.lairId);
  if (lair) initCreatureLair(ctx, lair);
}

export function distributeCreaturesByWeight(random: Pick<RollSource, 'int'>, count: number, weights: readonly number[]): number[] {
  const result = new Array<number>(weights.length).fill(0);
  for (let i = 0; i < count; i++) {
    let roll = random.int(WEIGHT_TOTAL);
    let bucket = 0;
    while (bucket < weights.length - 1 && roll >= (weights[bucket] ?? 0)) {
      roll -= weights[bucket] ?? 0;
      bucket++;
    }
    result[bucket] = (result[bucket] ?? 0) + 1;
  }
  return result;
}
