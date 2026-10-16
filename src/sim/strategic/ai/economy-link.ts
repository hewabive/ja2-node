import { sectorId } from '../../../content/strategic/sector-ids.ts';
import { calcMaxPlayerIncomeFromMines, predictIncomeFromPlayerMines } from '../economy/mines.ts';
import type { EconomyContext, EconomyHooks, PeriodicSlots } from '../economy/ports.ts';
import type { MineIncomePort, QueenContext } from './context.ts';
import { hourlyProgressUpdate } from './difficulty.ts';
import {
  handleMeanwhileEventPostingForSamLiberation,
  handleMeanwhileEventPostingForTownLiberation,
  handleMeanwhileEventPostingForTownLoss,
} from './meanwhile.ts';
import { strategicHandleMineThatRanOut } from './reactions.ts';

export function queenMineIncome(economy: () => EconomyContext | null): MineIncomePort {
  return {
    predictIncomeFromPlayerMines: () => {
      const ctx = economy();
      return ctx ? predictIncomeFromPlayerMines(ctx) : 0;
    },
    maxPlayerIncomeFromMines: () => {
      const ctx = economy();
      return ctx ? calcMaxPlayerIncomeFromMines(ctx) : 0;
    },
  };
}

export const MeanwhileKind = { TOWN_LIBERATION: 'townLiberation', TOWN_LOSS: 'townLoss', SAM_LIBERATION: 'samLiberation' } as const;

export function queenEconomyHooks(q: QueenContext): Partial<EconomyHooks> {
  return {
    queenMineRanOut: (sector) => strategicHandleMineThatRanOut(q, sectorId(sector)),
    meanwhile: (kind, param) => {
      if (kind === MeanwhileKind.TOWN_LIBERATION) handleMeanwhileEventPostingForTownLiberation(q, param);
      else if (kind === MeanwhileKind.TOWN_LOSS) handleMeanwhileEventPostingForTownLoss(q);
      else if (kind === MeanwhileKind.SAM_LIBERATION) handleMeanwhileEventPostingForSamLiberation(q, param);
    },
  };
}

export function queenEconomySlots(q: QueenContext): PeriodicSlots {
  return { hourlyProgressUpdate: () => hourlyProgressUpdate(q) };
}
