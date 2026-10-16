import type { ArmyContent } from '../../../content/strategic/army.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { RollSource, StrategicContext } from '../forces/ports.ts';
import type { SectorPosition } from '../state.ts';
import type { QueenState } from './queen-state.ts';

const PERCENT = 100;

export interface MineIncomePort {
  predictIncomeFromPlayerMines(): number;
  maxPlayerIncomeFromMines(): number;
}

export interface QueenHooks {
  samRepaired(sector: Sector): void;
  creatureQuestEnded(): void;
  profile(id: number): ProfileProgress | null;
  startQuest(quest: number, sector: SectorPosition | null): void;
}

export interface QueenContext extends StrategicContext {
  readonly army: ArmyContent;
  readonly mines: MineIncomePort;
  readonly queenHooks: QueenHooks;
}

export interface QueenContextOptions {
  readonly army: ArmyContent;
  readonly mines?: MineIncomePort;
  readonly hooks?: Partial<QueenHooks>;
}

export const noMineIncome: MineIncomePort = { predictIncomeFromPlayerMines: () => 0, maxPlayerIncomeFromMines: () => 0 };

export function createQueenContext(ctx: StrategicContext, options: QueenContextOptions): QueenContext {
  const defaults: QueenHooks = {
    samRepaired: () => {},
    creatureQuestEnded: () => {},
    profile: (id) => ctx.state.profiles.get(id) ?? null,
    startQuest: () => {},
  };
  return { ...ctx, army: options.army, mines: options.mines ?? noMineIncome, queenHooks: { ...defaults, ...options.hooks } };
}

export function queenOf(q: StrategicContext): QueenState {
  return q.state.queen;
}

export function rollChance(rolls: RollSource, percent: number): boolean {
  return rolls.int(PERCENT) < u32(percent);
}

export function rollInt(rolls: RollSource, range: number): number {
  return rolls.int(u32(range));
}
