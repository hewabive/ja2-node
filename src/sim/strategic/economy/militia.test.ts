import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent, setTownNames } from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import { addTransaction, FinanceCode } from '../../campaign/finances.ts';
import { initSquads } from '../forces/squads.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { canCharacterTrainMilitia } from './conditions.ts';
import { Assignment, MilitiaRank, SoldierClass, Town } from './constants.ts';
import { setTownLoyalty } from './loyalty.ts';
import {
  checkOneMilitiaForPromotion,
  handleMilitiaDefections,
  handleMilitiaPromotions,
  townMilitiaTrainingCompleted,
  trainTownInSector,
  unpaidTrainableSectors,
} from './militia.ts';
import { isAreaFullOfMilitia } from './militia-rules.ts';
import type { DecisionAnswer } from './ports.ts';
import { answerPendingMilitiaPrompt, assignSoldiers } from './set-assignment.ts';
import { updateAssignments } from './update.ts';

const B13 = parseSectorString('B13');
const C13 = parseSectorString('C13');
const D13 = parseSectorString('D13');
const D15 = parseSectorString('D15');

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(answer: DecisionAnswer = 'yes', rolls?: ScriptedRolls) {
  const made = economyTestContext({
    content,
    ...(rolls ? { random: rolls } : {}),
    setup: { decisions: { militiaPayment: () => answer, militiaContinue: () => answer } },
  });
  initializeMapStructure(made.ctx);
  initStrategicMovementCosts(made.ctx);
  initSquads(made.ctx);
  setTownNames(made.ctx);
  addTransaction(made.ctx.state.finances, FinanceCode.ANONYMOUS_DEPOSIT, 0, 0, 5000);
  setTownLoyalty(made.ctx, Town.DRASSEN, 40);
  return made;
}

function militia(made: ReturnType<typeof context>, s: { x: number; y: number }, green: number, regular: number, elite: number): void {
  sectorInfo(made.ctx.state.map, s).militia = [green, regular, elite];
}

describe('eligibility and payment', () => {
  it('checks loyalty, area capacity and the two-trainer limit', () => {
    const made = context();
    const a = made.crew.add({ id: 0, sector: C13 });
    expect(canCharacterTrainMilitia(made.ctx, a)).toBe(true);
    setTownLoyalty(made.ctx, Town.DRASSEN, 19);
    expect(canCharacterTrainMilitia(made.ctx, a)).toBe(false);
    setTownLoyalty(made.ctx, Town.DRASSEN, 40);
    made.crew.add({ id: 1, sector: C13, assignment: Assignment.TRAIN_TOWN });
    made.crew.add({ id: 2, sector: C13, assignment: Assignment.TRAIN_TOWN });
    expect(canCharacterTrainMilitia(made.ctx, a)).toBe(false);
    for (const s of [B13, C13, D13]) militia(made, s, 0, 20, 0);
    expect(isAreaFullOfMilitia(made.ctx, C13)).toBe(true);
    militia(made, D13, 5, 15, 0);
    expect(isAreaFullOfMilitia(made.ctx, C13)).toBe(false);
    expect(isAreaFullOfMilitia(made.ctx, D15)).toBe(false);
  });

  it('charges 750 per distinct unpaid sector once and lets later trainers join for free', () => {
    const made = context();
    const a = made.crew.add({ id: 0, sector: C13 });
    const b = made.crew.add({ id: 1, sector: C13 });
    const c = made.crew.add({ id: 2, sector: D13 });
    expect(unpaidTrainableSectors(made.ctx, [a, b, c])).toEqual([sectorId(C13), sectorId(D13)]);
    const results = assignSoldiers(made.ctx, [0, 1, 2], { kind: 'trainMilitia' });
    expect(results).toEqual([{ ok: true, militia: 'paid' }, { ok: true }, { ok: true }]);
    expect(made.ctx.state.finances.balance).toBe(5000 - 1500);
    expect(sectorInfo(made.ctx.state.map, C13).militiaTrainingPaid).toBe(true);
    const d = made.crew.add({ id: 3, sector: B13 });
    sectorInfo(made.ctx.state.map, B13).militiaTrainingPaid = true;
    expect(assignSoldiers(made.ctx, [d.id], { kind: 'trainMilitia' })).toEqual([{ ok: true, militia: 'alreadyPaid' }]);
    expect(made.ctx.state.finances.balance).toBe(3500);
  });

  it('puts the trainers of unpaid sectors on a squad when the payment is declined or unaffordable', () => {
    const made = context('no');
    made.crew.add({ id: 0, sector: C13 });
    expect(assignSoldiers(made.ctx, [0], { kind: 'trainMilitia' })).toEqual([{ ok: true, militia: 'declined' }]);
    expect(made.crew.get(0)?.assignment).toBe(Assignment.SQUAD_1);
    const poor = context('yes');
    poor.ctx.state.finances.balance = 700;
    poor.crew.add({ id: 0, sector: C13 });
    expect(assignSoldiers(poor.ctx, [0], { kind: 'trainMilitia' })).toEqual([{ ok: true, militia: 'cannotAfford' }]);
    expect(poor.crew.get(0)?.assignment).toBe(Assignment.SQUAD_1);
  });

  it('keeps a deferred prompt pending', () => {
    const made = context('defer');
    made.crew.add({ id: 0, sector: C13 });
    expect(assignSoldiers(made.ctx, [0], { kind: 'trainMilitia' })).toEqual([{ ok: true, militia: 'pending' }]);
    expect(made.ctx.state.economy.prompts).toEqual([
      { kind: 'militiaPayment', trainer: 0, leader: 0, soldiers: [], sectors: [sectorId(C13)], cost: 750, balance: 5000 },
    ]);
  });

  it('pays and sets the assignments of the list when a deferred prompt is answered later', () => {
    const made = context('defer');
    made.crew.add({ id: 0, sector: C13 });
    made.crew.add({ id: 1, sector: C13 });
    expect(assignSoldiers(made.ctx, [0, 1], { kind: 'trainMilitia' })[0]).toEqual({ ok: true, militia: 'pending' });
    expect(made.ctx.state.economy.prompts[0]?.kind).toBe('militiaPayment');
    expect(answerPendingMilitiaPrompt(made.ctx, true)).toBe('paid');
    expect(made.ctx.state.economy.prompts).toEqual([]);
    expect(sectorInfo(made.ctx.state.map, C13).militiaTrainingPaid).toBe(true);
    expect([made.crew.get(0)?.assignment, made.crew.get(1)?.assignment]).toEqual([Assignment.TRAIN_TOWN, Assignment.TRAIN_TOWN]);
    expect(made.ctx.state.finances.balance).toBe(4250);
  });
});

describe('training progress and completion', () => {
  it('carries hundredths into percent and completes at 100 without carry-over', () => {
    const made = context();
    const t = made.crew.add({ id: 0, sector: C13, assignment: Assignment.TRAIN_TOWN });
    const info = sectorInfo(made.ctx.state.map, C13);
    info.militiaTrainingPaid = true;
    info.militiaTrainingPercentDone = 90;
    info.militiaTrainingHundredths = 50;
    expect(trainTownInSector(made.ctx, t, C13, 760)).toBe(false);
    expect(info).toMatchObject({ militiaTrainingPercentDone: 98, militiaTrainingHundredths: 10 });
    expect(made.crew.statChanges.at(-1)).toMatchObject({ chances: 4 });
    expect(trainTownInSector(made.ctx, t, C13, 760)).toBe(true);
    expect(info).toMatchObject({
      militiaTrainingPercentDone: 0,
      militiaTrainingHundredths: 0,
      militiaTrainingPaid: false,
      militia: [10, 0, 0],
    });
    expect(made.ctx.state.economy.towns[Town.DRASSEN]?.rating).toBe(43);
  });

  it('fills the sector, then town sectors column-major, then promotes here and there, then wastes', () => {
    const made = context();
    const t = made.crew.add({ id: 0, sector: C13, assignment: Assignment.TRAIN_TOWN });
    militia(made, C13, 15, 0, 0);
    militia(made, B13, 0, 18, 0);
    militia(made, D13, 0, 19, 0);
    expect(townMilitiaTrainingCompleted(made.ctx, t, C13)).toBe(10);
    expect(sectorInfo(made.ctx.state.map, C13).militia).toEqual([20 - 2, 2, 0]);
    expect(sectorInfo(made.ctx.state.map, B13).militia).toEqual([2, 18, 0]);
    expect(sectorInfo(made.ctx.state.map, D13).militia).toEqual([1, 19, 0]);
    militia(made, C13, 0, 20, 0);
    militia(made, B13, 1, 19, 0);
    militia(made, D13, 0, 20, 0);
    const rating = made.ctx.state.economy.towns[Town.DRASSEN]?.rating;
    expect(townMilitiaTrainingCompleted(made.ctx, t, C13)).toBe(1);
    expect(sectorInfo(made.ctx.state.map, B13).militia).toEqual([0, 20, 0]);
    expect(made.ctx.state.economy.towns[Town.DRASSEN]?.rating).toBeGreaterThan(rating ?? 0);
    const before = made.ctx.state.economy.towns[Town.DRASSEN]?.rating;
    expect(townMilitiaTrainingCompleted(made.ctx, t, C13)).toBe(0);
    expect(made.ctx.state.economy.towns[Town.DRASSEN]?.rating).toBe(before);
    expect(made.ctx.state.economy.militiaTrainingCompletedBy).toEqual([0]);
  });

  it('trains to completion in the hourly update and asks to continue', () => {
    const asked: string[] = [];
    const made = economyTestContext({
      content,
      setup: {
        decisions: {
          militiaPayment: () => 'yes',
          militiaContinue: (p) => {
            asked.push(`${p.sector}:${p.cost}`);
            return 'no';
          },
        },
      },
    });
    initializeMapStructure(made.ctx);
    initStrategicMovementCosts(made.ctx);
    initSquads(made.ctx);
    setTownNames(made.ctx);
    setTownLoyalty(made.ctx, Town.DRASSEN, 40);
    addTransaction(made.ctx.state.finances, FinanceCode.ANONYMOUS_DEPOSIT, 0, 0, 5000);
    made.crew.add({ id: 0, sector: C13, lastAssignmentChangeMin: worldTotalMinutes(made.ctx.state.clock) - 60 });
    assignSoldiers(made.ctx, [0], { kind: 'trainMilitia' });
    const t = made.crew.get(0);
    if (!t) throw new Error('no trainer');
    t.lastAssignmentChangeMin = 0;
    sectorInfo(made.ctx.state.map, C13).militiaTrainingPercentDone = 95;
    updateAssignments(made.ctx);
    expect(sectorInfo(made.ctx.state.map, C13).militia).toEqual([10, 0, 0]);
    expect(asked).toEqual([`${sectorId(C13)}:750`]);
    expect(t.assignment).toBe(Assignment.SQUAD_1);
  });
});

describe('promotions and defections', () => {
  it('promotes by kill points with the documented chances and rank fallback', () => {
    const rolls = new ScriptedRolls([49, 99, 74, 49, 0]);
    const made = context('yes', rolls);
    militia(made, D13, 5, 2, 0);
    expect(checkOneMilitiaForPromotion(made.ctx, D13, MilitiaRank.GREEN, 1)).toEqual({ rank: 0, promotions: 0 });
    expect(checkOneMilitiaForPromotion(made.ctx, D13, MilitiaRank.GREEN, 2)).toEqual({ rank: 0, promotions: 1 });
    expect(checkOneMilitiaForPromotion(made.ctx, D13, MilitiaRank.GREEN, 3)).toEqual({ rank: 0, promotions: 0 });
    expect(checkOneMilitiaForPromotion(made.ctx, D13, MilitiaRank.GREEN, 7)).toEqual({ rank: 0, promotions: 2 });
    expect(sectorInfo(made.ctx.state.map, D13).militia).toEqual([3, 3, 1]);
    militia(made, D13, 0, 1, 0);
    expect(checkOneMilitiaForPromotion(made.ctx, D13, MilitiaRank.GREEN, 5)).toEqual({ rank: 1, promotions: 1 });
    expect(rolls.ranges).toEqual([100, 100, 100, 100, 100]);
  });

  it('counts promotions after a battle and resets the kill points', () => {
    const made = context('yes', new ScriptedRolls([0, 0]));
    militia(made, D13, 3, 0, 0);
    const soldiers = [
      { soldierClass: SoldierClass.GREEN_MILITIA, inSector: true, life: 20, militiaKills: 3 },
      { soldierClass: SoldierClass.ARMY, inSector: true, life: 20, militiaKills: 9 },
      { soldierClass: SoldierClass.GREEN_MILITIA, inSector: true, life: 0, militiaKills: 9 },
    ];
    handleMilitiaPromotions(made.ctx, D13, soldiers);
    expect(made.ctx.state.economy.militiaPromotions).toEqual({ total: 1, greenToElite: 0, greenToRegular: 1, regularToElite: 0 });
    expect(soldiers[0]?.militiaKills).toBe(0);
    expect(sectorInfo(made.ctx.state.map, D13).militia).toEqual([2, 1, 0]);
  });

  it('removes defectors rank by rank', () => {
    const made = context('yes', new ScriptedRolls([49, 50, 74, 75, 89]));
    militia(made, D13, 2, 2, 1);
    handleMilitiaDefections(made.ctx, D13);
    expect(sectorInfo(made.ctx.state.map, D13).militia).toEqual([1, 1, 0]);
  });
});
