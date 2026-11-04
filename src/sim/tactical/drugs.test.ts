import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NOTHING } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, createItems, type ItemObject } from '../items/object.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { handleMoraleEvent, MoraleEvent } from './combat/morale.ts';
import type { TacticalContent } from './content.ts';
import {
  applyDrugs,
  type DrugKind,
  DrunkLevel,
  drugView,
  drunkLevel,
  handleEndTurnDrugAdjustments,
  mercUnderTheInfluence,
  updateRegenCounters,
} from './drugs.ts';
import { NO_NARRATIVE_PORT } from './narrative/port.ts';
import { calcActionPoints } from './points.ts';
import type { ProfileProgress } from './profiles.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { beginMercTurn } from './turns/turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const FULL = 100;

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

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const DOSES: Readonly<Record<DrugKind, string>> = { adrenaline: 'ADRENALINE_BOOSTER', alcohol: 'ALCOHOL' };

function take(p: Patient, name: string, statuses: readonly number[] = [FULL]): ItemObject {
  const o = createItems(content.items, item(name), FULL, statuses.length);
  o.status.splice(0, statuses.length, ...statuses);
  expect(applyDrugs(p.t, p.s, o)).toBe(true);
  return o;
}

function lifetimeRecord(p: Patient, profile = MERC_PROFILE): ProfileProgress {
  const record = p.t.profiles.get(profile);
  if (!record) throw new Error(`no profile ${profile}`);
  return record;
}

function rollingPre(p: Patient, roll: number): number[] {
  const ranges: number[] = [];
  Object.assign(p.t, {
    pre: {
      int: (n: number) => {
        ranges.push(n);
        return roll;
      },
    },
  });
  return ranges;
}

function boostedBy(statuses: readonly number[], usedToday = 0, counter = 0, roll = 0): { counter: number; ranges: number[] } {
  const p = patient();
  const ranges = rollingPre(p, roll);
  Object.assign(p.s, { regenerationCounter: counter, regenBoostersUsedToday: usedToday });
  take(p, 'REGEN_BOOSTER', statuses);
  expect(p.s.regenBoostersUsedToday).toBe(usedToday + 1);
  return { counter: p.s.regenerationCounter, ranges };
}

function dose(p: Patient, kind: DrugKind): void {
  take(p, DOSES[kind]);
}

describe('taking a drug or a drink (Drugs_And_Alcohol.cc ApplyDrugs)', () => {
  it('doses adrenaline: 15 to come at a rate of 4 and a crash of 20 held back, one booster off the stack, one lifetime use', () => {
    const p = patient();
    const stack = take(p, 'ADRENALINE_BOOSTER', [FULL, FULL, FULL]);
    expect(p.s.drugs.adrenaline).toEqual({ future: 15, rate: 4, effect: 0, sideEffectRate: 0, sideEffect: 20 });
    expect(stack.count).toBe(2);
    expect(lifetimeRecord(p).numTimesDrugUseInLifetime).toBe(1);
  });

  it('restarts a course that wears off at the travel rate and holds its crash back, adding only while below 127', () => {
    const p = patient();
    Object.assign(p.s.drugs.adrenaline, { future: 0, rate: -2, effect: 10, sideEffectRate: 2, sideEffect: 86 });
    dose(p, 'adrenaline');
    expect(p.s.drugs.adrenaline).toEqual({ future: 15, rate: 4, effect: 10, sideEffectRate: 0, sideEffect: 106 });
    p.s.drugs.adrenaline.future = 111;
    dose(p, 'adrenaline');
    expect([p.s.drugs.adrenaline.future, p.s.drugs.adrenaline.sideEffect]).toEqual([126, 126]);
    Object.assign(p.s.drugs.adrenaline, { future: 112, sideEffect: 107 });
    dose(p, 'adrenaline');
    expect([p.s.drugs.adrenaline.future, p.s.drugs.adrenaline.sideEffect]).toEqual([112, 107]);
  });

  it('counts a lifetime use for adrenaline only, up to 255', () => {
    const p = patient();
    dose(p, 'alcohol');
    take(p, 'REGEN_BOOSTER');
    expect(lifetimeRecord(p).numTimesDrugUseInLifetime).toBe(0);
    lifetimeRecord(p).numTimesDrugUseInLifetime = 254;
    dose(p, 'adrenaline');
    dose(p, 'adrenaline');
    expect(lifetimeRecord(p).numTimesDrugUseInLifetime).toBe(255);
  });

  it('drinks 10 points of alcohol, 20 of wine and 100 of beer, from the last bottle of a stack on', () => {
    const p = patient();
    const alcohol = take(p, 'ALCOHOL', [50]);
    const wine = take(p, 'WINE', [50]);
    const beers = take(p, 'BEER', [FULL, 40]);
    expect([alcohol.status[0], wine.status[0], beers.count, beers.status[0]]).toEqual([40, 30, 1, 40]);
    expect(p.s.drugs.alcohol).toEqual({ future: 24, rate: 2, effect: 0, sideEffectRate: 0, sideEffect: 30 });
  });

  it('gives a full drink from a bottle with less left than its drink points', () => {
    const p = patient();
    const wine = take(p, 'WINE', [5]);
    expect([wine.item, wine.count]).toEqual([NOTHING, 0]);
    expect(p.s.drugs.alcohol).toMatchObject({ future: 8, sideEffect: 10 });
  });

  it('never has the heart attack: nine boosters at once lower no stat and drain no breath or APs', () => {
    const p = patient();
    const before = { stats: { ...p.s.stats }, breath: p.s.breath, breathRed: p.s.breathRed, actionPoints: p.s.actionPoints };
    for (let k = 0; k < 9; k++) dose(p, 'adrenaline');
    expect({ stats: p.s.stats, breath: p.s.breath, breathRed: p.s.breathRed, actionPoints: p.s.actionPoints }).toEqual(before);
    expect(p.s.drugs.adrenaline).toMatchObject({ sideEffectRate: 0, sideEffect: 120 });
  });

  it('turns a regeneration booster into 4 points per full status with no draw: 100 gives 4, 75 gives 3, 50 of a stack 2', () => {
    expect(boostedBy([FULL])).toEqual({ counter: 4, ranges: [] });
    expect(boostedBy([75])).toEqual({ counter: 3, ranges: [] });
    expect(boostedBy([FULL, 50])).toEqual({ counter: 2, ranges: [] });
  });

  it('draws PreRandom(25) against the status left over a whole point: 60 gives 3 on a roll under 10, else 2', () => {
    expect(boostedBy([60], 0, 0, 9)).toEqual({ counter: 3, ranges: [25] });
    expect(boostedBy([60], 0, 0, 10)).toEqual({ counter: 2, ranges: [25] });
  });

  it('takes the boosters used today off the points and keeps the counter at 4 at most', () => {
    expect(boostedBy([FULL], 2).counter).toBe(2);
    expect(boostedBy([FULL], 4, 1).counter).toBe(1);
    expect(boostedBy([FULL], 0, 3).counter).toBe(4);
  });

  it('applies nothing but drugs and drinks: a syringe is no drug', () => {
    const p = patient();
    const syringe = createItem(content.items, item('SYRINGE_3'), FULL);
    expect(applyDrugs(p.t, p.s, syringe)).toBe(false);
    expect([syringe.count, p.s.drugs.adrenaline.future, p.s.regenBoostersUsedToday]).toEqual([1, 0, 0]);
  });

  it("swaps sober Larry's profiles before his drug, which counts on the drunk profile; drunk Larry's own counter is zeroed", () => {
    const p = patient();
    const sober = testProfile(Npc.LARRY_NORMAL, { npcData: 9 });
    const drunk = testProfile(Npc.LARRY_DRUNK, { npcData: 5 });
    p.t.profiles.set(sober.id, sober);
    p.t.profiles.set(drunk.id, drunk);
    p.s.profile = Npc.LARRY_NORMAL;
    const swapped: Soldier[] = [];
    p.t.narrative = {
      ...NO_NARRATIVE_PORT,
      swapLarrysProfiles: (s) => {
        swapped.push(s);
        s.profile = Npc.LARRY_DRUNK;
      },
    };
    dose(p, 'adrenaline');
    expect(swapped).toEqual([p.s]);
    expect([sober.numTimesDrugUseInLifetime, drunk.numTimesDrugUseInLifetime, drunk.npcData]).toEqual([0, 1, 5]);
    dose(p, 'alcohol');
    expect(swapped).toHaveLength(1);
    expect([sober.npcData, drunk.npcData]).toEqual([9, 0]);
  });
});

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
    dose(p, 'adrenaline');
    const course = turns(p, 'adrenaline', 13);
    expect(course.map((c) => c.effect)).toEqual([4, 8, 12, 16, 14, 12, 10, 8, 6, 4, 2, 0, 0]);
    expect(course.map((c) => c.sideEffect)).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 18]);
  });

  it('raises a drink by 2 a turn to 8, wears it off by 2 and leaves a hangover of 10 that goes by 1 a turn', () => {
    const p = patient();
    dose(p, 'alcohol');
    const course = turns(p, 'alcohol', 18);
    expect(course.map((c) => c.effect)).toEqual([2, 4, 6, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(course.map((c) => c.sideEffect)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('ends one dose with two crash morale events: the side effect over the dose amount, plus one', () => {
    const p = patient();
    dose(p, 'adrenaline');
    turns(p, 'adrenaline', 12);
    const twin = patient();
    handleMoraleEvent(twin.t, twin.s, MoraleEvent.DRUGS_CRASH);
    handleMoraleEvent(twin.t, twin.s, MoraleEvent.DRUGS_CRASH);
    expect(twin.s.tacticalMoraleMod).toBe(-20);
    expect(p.s.tacticalMoraleMod).toBe(twin.s.tacticalMoraleMod);
    const drinker = patient();
    dose(drinker, 'alcohol');
    turns(drinker, 'alcohol', 8);
    expect(drinker.s.tacticalMoraleMod).toBe(-20);
  });

  it('refreshes morale only while the effect rises: the peak bonus stays through the wear-off until the crash', () => {
    const p = patient();
    p.s.morale = 50;
    dose(p, 'adrenaline');
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
    dose(p, 'adrenaline');
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
    dose(p, 'alcohol');
    expect(drunkLevel(p.s)).toBe(DrunkLevel.HUNGOVER);
    expect(mercUnderTheInfluence(p.s)).toBe(true);
    expect(drugView(p.s)).toEqual({ drunk: 'hungover' });
    handleEndTurnDrugAdjustments(p.t, p.s);
    expect(drugView(p.s)).toEqual({ drunk: 'feelingGood' });
  });

  it('shows a fresh adrenaline dose as the crash until the next turn start: only the side effect is set', () => {
    const p = patient();
    expect([drugView(p.s), mercUnderTheInfluence(p.s)]).toEqual([{}, false]);
    dose(p, 'adrenaline');
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
