import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, FakeCrew, loadEconomyTestContent, setTownNames } from '../../../../tests/support/economy.ts';
import { parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import { CampaignSim } from '../../campaign/campaign-sim.ts';
import { initSquads } from '../forces/squads.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { createStrategicState } from '../state.ts';
import { CompressMode, EventKind, NUM_SEC_IN_DAY, NUM_SEC_IN_HOUR, Warp } from '../time/constants.ts';
import { addPeriodStrategicEvent } from '../time/event-queue.ts';
import { warpGameTime, worldTotalMinutes } from '../time/world-clock.ts';
import { Assignment, Town } from './constants.ts';
import { addStartingCash } from './init.ts';
import { setTownLoyalty } from './loyalty.ts';
import { assignSoldiers } from './set-assignment.ts';

const C13 = parseSectorString('C13');
const START = NUM_SEC_IN_DAY + 8 * NUM_SEC_IN_HOUR;
const HOURS = 9;

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function campaign() {
  const state = createStrategicState({ worldSeconds: START });
  state.atLeastOneMercHired = true;
  const crew = new FakeCrew();
  const continued: number[] = [];
  const sim = new CampaignSim(state, null, {
    strategic: { content: content.strategic },
    economy: {
      economy: content.economy,
      items: content.items,
      crew,
      decisions: {
        militiaPayment: () => 'yes',
        militiaContinue: (p) => {
          continued.push(p.sector);
          return 'no';
        },
      },
    },
  });
  const ctx = sim.economy;
  if (!ctx) throw new Error('no economy');
  crew.economy = ctx;
  initializeMapStructure(ctx);
  initStrategicMovementCosts(ctx);
  initSquads(ctx);
  setTownNames(ctx);
  addStartingCash(ctx);
  setTownLoyalty(ctx, Town.DRASSEN, 40);
  addPeriodStrategicEvent(state.queue, state.clock, EventKind.HOURLY_UPDATE, 60, 0);
  crew.add({ id: 0, sector: C13, stats: { wisdom: 80, leadership: 70, expLevel: 4 } });
  crew.add({ id: 1, sector: C13, stats: { wisdom: 60, leadership: 50, expLevel: 2 } });
  expect(assignSoldiers(ctx, [0, 1], { kind: 'trainMilitia' })).toEqual([{ ok: true, militia: 'paid' }, { ok: true }]);
  return { sim, ctx, crew, continued };
}

const MAX_TICKS = 100_000;

function runCompressed(made: ReturnType<typeof campaign>, until: number): number {
  let stops = 0;
  for (let tick = 0; tick < MAX_TICKS && made.ctx.state.clock.seconds < until; tick++) {
    if (!made.ctx.state.clock.compressionOn) {
      stops++;
      expect(made.sim.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 })).toEqual({ ok: true });
    }
    made.sim.step();
  }
  return stops;
}

function snapshot(made: ReturnType<typeof campaign>) {
  const info = sectorInfo(made.ctx.state.map, C13);
  return {
    minute: worldTotalMinutes(made.ctx.state.clock),
    militia: [...info.militia],
    percent: info.militiaTrainingPercentDone,
    hundredths: info.militiaTrainingHundredths,
    paid: info.militiaTrainingPaid,
    balance: made.ctx.state.finances.balance,
    ledger: made.ctx.state.finances.ledger.map((r) => [r.code, r.secondCode, r.amount]),
    drassen: { ...made.ctx.state.economy.towns[Town.DRASSEN] },
    crew: made.crew.all().map((m) => [m.assignment, m.breathMax, m.nothingToDo, m.doneQuoteSaid]),
    statChanges: made.crew.statChanges.map((c) => [c.id, c.stat, c.chances]),
    continued: [...made.continued],
  };
}

describe('militia training on the strategic clock', () => {
  it('trains a paid Drassen sector to completion with two trainers', () => {
    const made = campaign();
    expect(made.ctx.state.finances.balance).toBe(35000 - 750);
    expect(runCompressed(made, START + HOURS * NUM_SEC_IN_HOUR)).toBe(2);
    const s = snapshot(made);
    expect(s.militia).toEqual([10, 0, 0]);
    expect(s.paid).toBe(false);
    expect(s.percent).toBe(0);
    expect(s.continued).toEqual([sectorId(C13)]);
    expect(s.crew.map((c) => c[0])).toEqual([Assignment.SQUAD_1, Assignment.SQUAD_1]);
    expect(s.drassen.rating).toBe(43);
    expect(s.statChanges.length).toBeGreaterThan(0);
  });

  it('gives the same result when the time is warped', () => {
    const stepped = campaign();
    runCompressed(stepped, START + HOURS * NUM_SEC_IN_HOUR);
    const warped = campaign();
    warpGameTime(warped.sim.clockContext, START + HOURS * NUM_SEC_IN_HOUR - warped.ctx.state.clock.seconds, Warp.NORMAL);
    const a = snapshot(stepped);
    const b = snapshot(warped);
    expect({ ...b, minute: 0 }).toEqual({ ...a, minute: 0 });
  });
});
