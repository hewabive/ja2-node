import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { handleMoraleEvent, MoraleEvent } from './combat/morale.ts';
import type { TacticalContent } from './content.ts';
import {
  DRUG_RULES,
  type DrugKind,
  DrunkLevel,
  drugView,
  drunkLevel,
  handleEndTurnDrugAdjustments,
  mercUnderTheInfluence,
  updateRegenCounters,
} from './drugs.ts';
import { calcActionPoints } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { beginMercTurn } from './turns/turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const DRUG_CAP = 127;

interface Patient {
  readonly t: TacticalState;
  readonly s: Soldier;
}

function patient(id = 0): Patient {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, id, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
  return { t: sim.state, s };
}

function dose(s: Soldier, kind: DrugKind): void {
  const c = s.drugs[kind];
  const rules = DRUG_RULES[kind];
  if (c.future + rules.effect < DRUG_CAP) c.future += rules.effect;
  c.rate = rules.travelRate;
  if (c.sideEffect + rules.sideEffect < DRUG_CAP) c.sideEffect += rules.sideEffect;
  c.sideEffectRate = 0;
}

function turns(p: Patient, kind: DrugKind, count: number): { effect: number; sideEffect: number }[] {
  const seen = [];
  for (let k = 0; k < count; k++) {
    handleEndTurnDrugAdjustments(p.t, p.s);
    seen.push({ effect: p.s.drugs[kind].effect, sideEffect: p.s.drugs[kind].sideEffect });
  }
  return seen;
}

describe('a drug course turn by turn (Drugs_And_Alcohol.cc HandleEndTurnDrugAdjustments)', () => {
  it('peaks one adrenaline dose at 16, not 15: the rate of 4 overshoots the future 15, then wears off by 2', () => {
    const p = patient();
    dose(p.s, 'adrenaline');
    const course = turns(p, 'adrenaline', 13);
    expect(course.map((c) => c.effect)).toEqual([4, 8, 12, 16, 14, 12, 10, 8, 6, 4, 2, 0, 0]);
    expect(course.map((c) => c.sideEffect)).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 18]);
  });

  it('raises a drink by 2 a turn to 8, wears it off by 2 and leaves a hangover of 10 that goes by 1 a turn', () => {
    const p = patient();
    dose(p.s, 'alcohol');
    const course = turns(p, 'alcohol', 18);
    expect(course.map((c) => c.effect)).toEqual([2, 4, 6, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(course.map((c) => c.sideEffect)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('ends one dose with two crash morale events: the side effect over the dose amount, plus one', () => {
    const p = patient();
    dose(p.s, 'adrenaline');
    turns(p, 'adrenaline', 12);
    const twin = patient();
    handleMoraleEvent(twin.t, twin.s, MoraleEvent.DRUGS_CRASH);
    handleMoraleEvent(twin.t, twin.s, MoraleEvent.DRUGS_CRASH);
    expect(twin.s.tacticalMoraleMod).toBe(-20);
    expect(p.s.tacticalMoraleMod).toBe(twin.s.tacticalMoraleMod);
    const drinker = patient();
    dose(drinker.s, 'alcohol');
    turns(drinker, 'alcohol', 8);
    expect(drinker.s.tacticalMoraleMod).toBe(-20);
  });

  it('refreshes morale only while the effect rises: the peak bonus stays through the wear-off until the crash', () => {
    const p = patient();
    p.s.morale = 50;
    dose(p.s, 'adrenaline');
    const morale = [];
    for (let k = 0; k < 12; k++) {
      handleEndTurnDrugAdjustments(p.t, p.s);
      morale.push(p.s.morale);
    }
    expect(morale).toEqual([56, 62, 68, 74, 74, 74, 74, 74, 74, 74, 74, 30]);
  });

  it('wraps a stacked effect past 127, as the INT8 field does', () => {
    const p = patient();
    const c = p.s.drugs.adrenaline;
    Object.assign(c, { future: 20, rate: 4, effect: 124 });
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect(c.effect).toBe(-128);
  });

  it('steps first at a turn start, so the new APs take the effect it just reached (Soldier_Control.cc EVENT_BeginMercTurn)', () => {
    const p = patient();
    p.t.inCombat = true;
    const sober = calcActionPoints(p.t, p.s);
    dose(p.s, 'adrenaline');
    p.s.actionPoints = 0;
    beginMercTurn(p.t, p.s);
    expect([p.s.drugs.adrenaline.effect, p.s.actionPoints]).toEqual([4, sober + 4]);
  });

  it('regenerates 10 life a turn up to the maximum, trimming the bleeding to the wound left', () => {
    const p = patient();
    Object.assign(p.s, { lifeMax: 80, life: 50, bleeding: 25, regenerationCounter: 2 });
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect([p.s.life, p.s.bleeding, p.s.regenerationCounter]).toEqual([60, 20, 1]);
    Object.assign(p.s, { life: 75 });
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect([p.s.life, p.s.bleeding, p.s.regenerationCounter]).toEqual([80, 0, 0]);
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect(p.s.regenerationCounter).toBe(0);
  });
});

describe('the drunk level (Drugs_And_Alcohol.cc GetDrunkLevel)', () => {
  it('counts drinks of 8: an effect up to 31 feels good, 32 to 39 is borderline, 40 and more drunk', () => {
    const { s } = patient();
    const levelAt = (effect: number) => {
      s.drugs.alcohol.effect = effect;
      return drunkLevel(s);
    };
    expect([levelAt(0), levelAt(1), levelAt(31), levelAt(32), levelAt(39), levelAt(40)]).toEqual([
      DrunkLevel.SOBER,
      DrunkLevel.FEELING_GOOD,
      DrunkLevel.FEELING_GOOD,
      DrunkLevel.BORDERLINE,
      DrunkLevel.BORDERLINE,
      DrunkLevel.DRUNK,
    ]);
  });

  it('is hungover right after a drink, until the next turn start: the effect is still 0 and the side effect 10', () => {
    const p = patient();
    dose(p.s, 'alcohol');
    expect(drunkLevel(p.s)).toBe(DrunkLevel.HUNGOVER);
    expect(mercUnderTheInfluence(p.s)).toBe(true);
    expect(drugView(p.s)).toEqual({ drunk: 'hungover' });
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect(drugView(p.s)).toEqual({ drunk: 'feelingGood' });
  });

  it('shows a fresh adrenaline dose as the crash until the next turn start: only the side effect is set', () => {
    const p = patient();
    expect([drugView(p.s), mercUnderTheInfluence(p.s)]).toEqual([{}, false]);
    dose(p.s, 'adrenaline');
    expect([drugView(p.s), mercUnderTheInfluence(p.s)]).toEqual([{ adrenaline: 'crash' }, true]);
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect(drugView(p.s)).toEqual({ adrenaline: 'active' });
  });
});

describe('the regeneration boosters of the day (Hourly_Update.cc UpdateRegenCounters)', () => {
  it('forgets one booster per call, never below 0', () => {
    const a = patient(0).s;
    const b = patient(1).s;
    a.regenBoostersUsedToday = 2;
    updateRegenCounters([a, b]);
    expect([a.regenBoostersUsedToday, b.regenBoostersUsedToday]).toEqual([1, 0]);
  });
});
