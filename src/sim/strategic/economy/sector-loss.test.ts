import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EconomyTestContent,
  economyTestContext,
  loadEconomyTestContent,
  setPlayerControlled,
  setTownNames,
} from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { initializeMapStructure } from '../map/init.ts';
import { Town } from './constants.ts';
import { onSectorTakenByEnemy, setTownLoyalty } from './loyalty.ts';
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

function takenByEnemy(ctx: EconomyContext, s: Sector, wasPlayerControlled: boolean): void {
  const element = ctx.state.map.elements[strategicIndex(s)];
  if (element) element.enemyControlled = true;
  onSectorTakenByEnemy(ctx, s, wasPlayerControlled);
}

describe('the notice when the enemy takes a sector (SetThisSectorAsEnemyControlled)', () => {
  it('names an important sector the player held, whatever took it, and keeps quiet for the rest', () => {
    const ctx = context();
    const drassen = content.strategic.towns.find((t) => t.townId === Town.DRASSEN);
    setPlayerControlled(ctx, [...(drassen?.sectors ?? []), sectorId(parseSectorString('D15')), sectorId(parseSectorString('B7'))]);
    takenByEnemy(ctx, parseSectorString('C13'), true);
    takenByEnemy(ctx, parseSectorString('B13'), false);
    takenByEnemy(ctx, parseSectorString('B7'), true);
    takenByEnemy(ctx, parseSectorString('D15'), true);
    expect(ctx.events.filter((e) => e.type === 'sectorLost')).toEqual([
      { type: 'sectorLost', sector: 'C13', kind: 'town' },
      { type: 'sectorLost', sector: 'D15', kind: 'sam' },
    ]);
  });

  it('gives the income of a lost mine after the loyalty the loss costs', () => {
    const ctx = context();
    const drassen = content.strategic.towns.find((t) => t.townId === Town.DRASSEN);
    setPlayerControlled(ctx, drassen?.sectors ?? []);
    setTownLoyalty(ctx, Town.DRASSEN, 80);
    const mine = parseSectorString('D13');
    const status = ctx.state.economy.mines[mineIdForSector(ctx, mine)];
    if (!status) throw new Error('no Drassen mine');
    status.spokeToHeadMiner = true;
    const before = predictIncomeFromPlayerMines(ctx);
    takenByEnemy(ctx, mine, true);
    const after = predictIncomeFromPlayerMines(ctx);
    expect(after).toBeLessThan(before);
    expect(ctx.events.filter((e) => e.type === 'sectorLost')).toEqual([
      { type: 'sectorLost', sector: 'D13', kind: 'mine', dailyIncome: after },
    ]);
  });
});
