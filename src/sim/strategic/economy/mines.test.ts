import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent, setTownNames } from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { FinanceCode } from '../../campaign/finances.ts';
import { initializeMapStructure } from '../map/init.ts';
import { EventKind, NUM_MIN_IN_DAY } from '../time/constants.ts';
import { worldDayInMinutes } from '../time/world-clock.ts';
import { Town } from './constants.ts';
import { setTownLoyalty } from './loyalty.ts';
import { maxDailyRemovalFromMine } from './mine-status.ts';
import {
  calcMaxPlayerIncomeFromMines,
  handleIncomeFromMines,
  initializeMines,
  mineAMine,
  postEventsForMineProduction,
  predictDailyIncomeFromAMine,
  predictIncomeFromPlayerMines,
  runningOutRemovalRate,
  startMineStandIn,
  workforceForEnemy,
  workforceForPlayer,
} from './mines.ts';

const DRASSEN_MINE = 1;
const ALMA_MINE = 2;
const GRUMM_MINE = 5;

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(rolls: readonly number[] = [], difficulty = 2) {
  const random = new ScriptedRolls(rolls);
  const made = economyTestContext({ content, random, stateOptions: { options: { difficulty } } });
  initializeMapStructure(made.ctx);
  setTownNames(made.ctx);
  return { ...made, random };
}

function setEnemyControlled(ctx: ReturnType<typeof context>['ctx'], sector: string, enemy: boolean): void {
  const e = ctx.state.map.elements[strategicIndex(parseSectorString(sector))];
  if (e) e.enemyControlled = enemy;
}

describe('InitializeMines', () => {
  it('retries rejected mines, bumps by a fifth of the base rate and picks one depleting mine', () => {
    const bumps = [0, 1, ...new Array<number>(24).fill(5)];
    const { ctx, random } = context([...bumps, 2, 1]);
    initializeMines(ctx);
    const m = ctx.state.economy.mines;
    expect(random.ranges).toEqual(new Array<number>(28).fill(6));
    expect(m.map((s) => s.maxRemovalRate)).toEqual([0, 1200, 1500, 1500, 500, 2000 + 24 * 400]);
    expect(m[0]).toMatchObject({ empty: true, remainingOreSupply: 0, oreRunningOutPoint: 0 });
    expect(m[DRASSEN_MINE]).toMatchObject({ remainingOreSupply: 20 * 4 * 1200, oreRunningOutPoint: 12000, empty: false });
    expect(m[ALMA_MINE]).toMatchObject({ remainingOreSupply: 999999999, oreRunningOutPoint: 0 });
  });

  it('makes 20 bumps on hard and gives a non-delayed mine 10 days of ore', () => {
    const { ctx, random } = context([...new Array<number>(20).fill(4), 3], 3);
    initializeMines(ctx);
    expect(random.ranges).toHaveLength(21);
    expect(ctx.state.economy.mines[4]?.maxRemovalRate).toBe(500 + 20 * 100);
    expect(ctx.state.economy.mines[3]).toMatchObject({ remainingOreSupply: 10 * 4 * 1500, oreRunningOutPoint: 15000 });
  });
});

describe('mine production', () => {
  function drassen(loyalty = 60) {
    const made = context([...new Array<number>(25).fill(5), 3]);
    initializeMines(made.ctx);
    const m = made.ctx.state.economy.mines[DRASSEN_MINE];
    if (!m) throw new Error('no mine');
    m.maxRemovalRate = 1800;
    m.spokeToHeadMiner = true;
    setTownLoyalty(made.ctx, Town.DRASSEN, loyalty);
    return { ...made, m };
  }

  it('shares the workforce by loyalty and controlled sectors', () => {
    const { ctx } = drassen();
    expect(workforceForPlayer(ctx, DRASSEN_MINE)).toBe(60);
    expect(predictDailyIncomeFromAMine(ctx, DRASSEN_MINE)).toBe(4320);
    setEnemyControlled(ctx, 'B13', true);
    expect(workforceForPlayer(ctx, DRASSEN_MINE)).toBe(40);
    expect(workforceForEnemy(ctx, DRASSEN_MINE)).toBe(13);
  });

  it('needs the head miner to have been spoken to', () => {
    const { ctx, m } = drassen();
    m.spokeToHeadMiner = false;
    expect(workforceForPlayer(ctx, DRASSEN_MINE)).toBe(0);
    expect(predictIncomeFromPlayerMines(ctx)).toBe(0);
  });

  it('posts the four income events of a day and books one deposit', () => {
    const { ctx } = drassen();
    postEventsForMineProduction(ctx);
    const day = worldDayInMinutes(ctx.state.clock);
    expect(ctx.state.queue.events.filter((e) => e.kind === EventKind.HANDLE_MINE_INCOME).map((e) => e.stamp / 60 - day)).toEqual([
      540, 720, 900, 1080,
    ]);
    handleIncomeFromMines(ctx);
    expect(ctx.state.finances.ledger.at(-1)).toMatchObject({ code: FinanceCode.DEPOSIT_FROM_SILVER_MINE, amount: 1080 });
    expect(ctx.state.economy.mines[DRASSEN_MINE]).toMatchObject({ mineHasProducedForPlayer: true, timePlayerProductionStarted: day + 60 });
    expect(day).toBe(NUM_MIN_IN_DAY);
  });

  it('starts running out below the warning point with the float rate and empties the mine', () => {
    const { ctx, m } = drassen(100);
    m.remainingOreSupply = 13000;
    m.oreRunningOutPoint = 12000;
    expect(mineAMine(ctx, DRASSEN_MINE)).toBe(1800);
    expect(m).toMatchObject({ remainingOreSupply: 11200, runningOut: true, warnedOfRunningOut: true, maxRemovalRate: 1250 });
    expect(ctx.events.some((e) => e.type === 'mineRunningOut')).toBe(true);
    m.remainingOreSupply = 1000;
    expect(mineAMine(ctx, DRASSEN_MINE)).toBe(1000);
    expect(m).toMatchObject({ remainingOreSupply: 0, empty: true, runningOut: false, maxRemovalRate: 0 });
    expect(calcMaxPlayerIncomeFromMines(ctx)).toBe(4 * (1500 + 1500 + 500 + 2000 + 25 * 400));
  });

  it('computes the running-out rate with float arithmetic', () => {
    expect([12345, 2500, 2501, 249999, 1].map(runningOutRemovalRate)).toEqual([1250, 250, 500, 25000, 250]);
  });

  it('lets the Queen deplete only a mine that produced for the player', () => {
    const { ctx, m } = drassen();
    setEnemyControlled(ctx, 'D13', true);
    setEnemyControlled(ctx, 'C13', true);
    const before = m.remainingOreSupply;
    expect(mineAMine(ctx, DRASSEN_MINE)).toBe(0);
    expect(m.remainingOreSupply).toBe(before);
    m.mineHasProducedForPlayer = true;
    mineAMine(ctx, DRASSEN_MINE);
    expect(m.remainingOreSupply).toBe(before - Math.trunc((1800 * Math.trunc((40 * 2) / 3)) / 100));
  });

  it('limits prediction and max daily removal by the remaining ore', () => {
    const { ctx, m } = drassen(100);
    m.remainingOreSupply = 5000;
    expect(predictDailyIncomeFromAMine(ctx, DRASSEN_MINE)).toBe(5000);
    expect(maxDailyRemovalFromMine(ctx, DRASSEN_MINE)).toBe(5000);
    m.shutDown = true;
    expect(maxDailyRemovalFromMine(ctx, DRASSEN_MINE)).toBe(0);
    expect(maxDailyRemovalFromMine(ctx, GRUMM_MINE)).toBe(4 * (2000 + 25 * 400));
  });

  it('starts a mine through the stand-in command only with a merc at the entrance', () => {
    const { ctx, crew, m } = drassen();
    m.spokeToHeadMiner = false;
    m.shutDown = true;
    expect(startMineStandIn(ctx, DRASSEN_MINE)).toEqual({ ok: false, reason: 'noMercThere' });
    crew.add({ id: 0, sector: parseSectorString('D13') });
    expect(startMineStandIn(ctx, DRASSEN_MINE)).toEqual({ ok: true });
    expect(m).toMatchObject({ spokeToHeadMiner: true, shutDown: false });
    expect(startMineStandIn(ctx, 0)).toEqual({ ok: false, reason: 'abandoned' });
  });
});
