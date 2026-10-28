// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc CalcDifficultyModifier, GetLocationModifier, GetPythDistanceFromPalace;
// @src Tactical/Campaign.cc CurrentPlayerProgressPercentage, HighestPlayerProgressPercentage, HourlyProgressUpdate,
// @src CalcImportantSectorControl; Strategic/Town_Militia.cc MilitiaTrainingAllowedInSector.

import type { ProgressPolicy } from '../../../content/strategic/army.ts';
import { MAP_SIDE, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { clamp, idiv, u8, u16, u32 } from '../../../core/int.ts';
import { SoldierClass } from '../../tactical/soldier.ts';
import { Difficulty } from '../forces/constants.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { isThisSectorASamSector, townIdOfSector } from '../map/control.ts';
import { Town } from './constants.ts';
import type { MineIncomePort, QueenContext } from './context.ts';

export const DIFF_FACTOR_PLAYER_PROGRESS = 50;
export const DIFF_FACTOR_PALACE_DISTANCE = 30;
export const DIFF_FACTOR_GAME_DIFFICULTY = 20;
export const DIFF_MODIFIER_SOME_PROGRESS = 5;
export const DIFF_MODIFIER_NO_INCOME = -5;
export const PALACE_SECTOR: Readonly<{ x: number; y: number }> = { x: 3, y: 16 };
export const MAX_PALACE_DISTANCE = 20;
export const ORTA_TIXA_PALACE_DISTANCE = 4;
export const ALMA_PALACE_DISTANCE = 10;
const MAX_MODIFIER = 100;
const PERCENT = 100;
const DEFAULT_KILLS_PER_POINT = 10;

export function roundedSquareRoot(n: number): number {
  let k = 0;
  while (k * (k + 1) < n) k++;
  return k;
}

export function pythDistanceFromPalace(s: { readonly x: number; readonly y: number }): number {
  const dx = s.x - PALACE_SECTOR.x;
  const dy = s.y - PALACE_SECTOR.y;
  return u8(roundedSquareRoot(dx * dx + dy * dy));
}

export function palaceDistanceForTown(townId: number, s: { readonly x: number; readonly y: number }): number {
  if (townId === Town.ORTA || townId === Town.TIXA) return ORTA_TIXA_PALACE_DISTANCE;
  if (townId === Town.ALMA) return ALMA_PALACE_DISTANCE;
  return Math.min(pythDistanceFromPalace(s), MAX_PALACE_DISTANCE);
}

export function locationModifier(townId: number, s: { readonly x: number; readonly y: number }): number {
  return u8(idiv((MAX_PALACE_DISTANCE - palaceDistanceForTown(townId, s)) * DIFF_FACTOR_PALACE_DISTANCE, MAX_PALACE_DISTANCE));
}

export interface DifficultyInputs {
  readonly difficulty: number;
  readonly highestProgress: number;
  readonly predictedMineIncome: number;
  readonly battleSector: { readonly x: number; readonly y: number };
  readonly battleSectorTownId: number;
}

function isMilitiaClass(soldierClass: number): boolean {
  return soldierClass >= SoldierClass.GREEN_MILITIA && soldierClass <= SoldierClass.ELITE_MILITIA;
}

export function calcDifficultyModifier(inputs: DifficultyInputs, soldierClass: number): number {
  let m = 0;
  if (inputs.difficulty === Difficulty.EASY) {
    if (isMilitiaClass(soldierClass)) m += DIFF_FACTOR_GAME_DIFFICULTY;
  } else if (inputs.difficulty === Difficulty.MEDIUM) m += idiv(DIFF_FACTOR_GAME_DIFFICULTY, 2);
  else if (inputs.difficulty === Difficulty.HARD) m += DIFF_FACTOR_GAME_DIFFICULTY;
  const progress = u8(inputs.highestProgress);
  if (progress > 0) m += DIFF_MODIFIER_SOME_PROGRESS;
  if (inputs.predictedMineIncome === 0) m += DIFF_MODIFIER_NO_INCOME;
  m += u8(idiv(progress * DIFF_FACTOR_PLAYER_PROGRESS, PERCENT));
  m += locationModifier(inputs.battleSectorTownId, inputs.battleSector);
  return clamp(m, 0, MAX_MODIFIER);
}

export function difficultyInputs(q: QueenContext, battleSector: Sector): DifficultyInputs {
  return {
    difficulty: q.state.options.difficulty,
    highestProgress: q.state.status.highestProgress,
    predictedMineIncome: q.mines.predictIncomeFromPlayerMines(),
    battleSector,
    battleSectorTownId: townIdOfSector(q, battleSector),
  };
}

export function difficultyModifierAt(q: QueenContext, soldierClass: number, battleSector: Sector): number {
  return calcDifficultyModifier(difficultyInputs(q, battleSector), soldierClass);
}

export function militiaTrainingAllowedInSector(ctx: StrategicContext, s: Sector): boolean {
  if (s.z !== 0) return false;
  if (isThisSectorASamSector(ctx, s)) return true;
  const townId = townIdOfSector(ctx, s);
  return ctx.content.towns.find((t) => t.townId === townId)?.isMilitiaTrainingAllowed === true;
}

export function calcImportantSectorControl(ctx: StrategicContext): number {
  let points = 0;
  for (let x = 1; x <= MAP_SIDE; x++) {
    for (let y = 1; y <= MAP_SIDE; y++) {
      const s: Sector = { x, y, z: 0 };
      if (ctx.state.map.elements[strategicIndex(s)]?.enemyControlled) continue;
      if (!militiaTrainingAllowedInSector(ctx, s)) continue;
      points = u8(points + 1);
      if (isThisSectorASamSector(ctx, s)) points = u8(points + 1);
    }
  }
  return points;
}

export interface ProgressPortions {
  readonly kills: number;
  readonly control: number;
  readonly income: number;
}

export function progressPortions(p: ProgressPolicy): ProgressPortions {
  const total = p.weightKills + p.weightControl + p.weightIncome;
  return {
    kills: idiv(PERCENT * p.weightKills, total),
    control: idiv(PERCENT * p.weightControl, total),
    income: idiv(PERCENT * p.weightIncome, total),
  };
}

export function currentPlayerProgressPercentage(ctx: StrategicContext, policy: ProgressPolicy, mines: MineIncomePort): number {
  const portions = progressPortions(policy);
  const income = u32(mines.predictIncomeFromPlayerMines());
  const possible = u32(mines.maxPlayerIncomeFromMines());
  let progress = possible > 0 ? u8(Math.trunc((income * portions.income) / possible)) : 0;
  const killsPerPoint = policy.killsPerPoint[ctx.state.options.difficulty - 1] ?? DEFAULT_KILLS_PER_POINT;
  const kills = killsPerPoint > 0 ? Math.min(u16(idiv(ctx.state.status.playerKills, killsPerPoint)), portions.kills) : portions.kills;
  progress = u8(progress + kills);
  progress = u8(progress + Math.min(calcImportantSectorControl(ctx), portions.control));
  return progress;
}

export function queenProgress(q: QueenContext): number {
  return currentPlayerProgressPercentage(q, q.army.progress, q.mines);
}

export function highestPlayerProgressPercentage(ctx: StrategicContext): number {
  return ctx.state.status.highestProgress;
}

export interface ProgressMilestones {
  readonly madlab: boolean;
  readonly mike: boolean;
  readonly iggy: boolean;
}

export function hourlyProgressUpdate(q: QueenContext): ProgressMilestones {
  return progressMilestones(q, queenProgress(q));
}

export function progressMilestones(q: QueenContext, current: number): ProgressMilestones {
  const status = q.state.status;
  const reached = (threshold: number) => current >= threshold && status.highestProgress < threshold;
  if (current <= status.highestProgress) return { madlab: false, mike: false, iggy: false };
  const p = q.army.progress;
  const milestones = { madlab: reached(p.eventMadlabMin), mike: reached(p.eventMikeMin), iggy: reached(p.eventIggyMin) };
  status.highestProgress = current;
  return milestones;
}
