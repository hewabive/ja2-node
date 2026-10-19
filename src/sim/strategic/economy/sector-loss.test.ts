import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent, setTownNames } from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { initializeMapStructure } from '../map/init.ts';
import { mineIdForSector } from './mine-status.ts';
import { initializeMines, predictIncomeFromPlayerMines } from './mines.ts';
import type { EconomyContext } from './ports.ts';
import { importantSectorLoss } from './sector-loss.ts';

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const MINE_ROLLS = [0, 1, ...new Array<number>(24).fill(5), 2, 1];

function context(): EconomyContext {
  const { ctx } = economyTestContext({ content, random: new ScriptedRolls(MINE_ROLLS) });
  initializeMapStructure(ctx);
  setTownNames(ctx);
  initializeMines(ctx);
  return ctx;
}

describe('the notice of an important sector lost to the enemy (NotifyPlayerWhenEnemyTakesControlOfImportantSector)', () => {
  it('names SAM sites, producing mines with the reduced income, and towns except San Mona', () => {
    const ctx = context();
    const drassenMine = parseSectorString('D13');
    expect(importantSectorLoss(ctx, parseSectorString('D15'))).toEqual({ kind: 'sam' });
    expect(importantSectorLoss(ctx, parseSectorString('C13'))).toEqual({ kind: 'town' });
    expect(importantSectorLoss(ctx, parseSectorString('C5'))).toBeNull();
    expect(importantSectorLoss(ctx, { ...drassenMine, z: 1 })).toBeNull();
    expect(importantSectorLoss(ctx, drassenMine)).toEqual({ kind: 'town' });
    const status = ctx.state.economy.mines[mineIdForSector(ctx, drassenMine)];
    if (!status) throw new Error('no Drassen mine');
    status.spokeToHeadMiner = true;
    expect(importantSectorLoss(ctx, drassenMine)).toEqual({ kind: 'mine', dailyIncome: predictIncomeFromPlayerMines(ctx) });
  });
});
