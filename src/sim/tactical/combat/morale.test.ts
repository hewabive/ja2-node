import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import type { TacticalContent } from '../content.ts';
import { MercQuote, QuoteSaidFlag } from '../narrative/merc-quotes.ts';
import type { QuoteSaidRecord } from '../narrative/port.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { handleMoraleEvent, MoraleEvent, refreshSoldierMorale } from './morale.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const ROOF = 1;
const VETERAN_LEVEL = 8;

function moraleLostToBadNews(prepare: (s: Soldier) => void = () => {}): number {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
  prepare(s);
  const before = s.tacticalMoraleMod;
  handleMoraleEvent(sim.state, s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
  return before - s.tacticalMoraleMod;
}

describe('bad news (Morale.cc UpdateSoldierMorale)', () => {
  it('hits one point harder on a roof and no softer for a veteran: the original reads the map level where it meant the experience level', () => {
    const onTheGround = moraleLostToBadNews();
    expect(
      moraleLostToBadNews((s) => {
        s.level = ROOF;
      }),
    ).toBe(onTheGround + 1);
    expect(
      moraleLostToBadNews((s) => {
        s.stats.experience = VETERAN_LEVEL;
      }),
    ).toBe(onTheGround);
  });
});

const Attitude = { NORMAL: 0, OPTIMIST: 3, PESSIMIST: 4, COWARD: 9 } as const;

function crashedMorale(event: number, attitude: number): number {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE, { attitude }));
  handleMoraleEvent(sim.state, s, event);
  return s.tacticalMoraleMod;
}

describe('a drug crash (Morale.cc gbMoraleEvent MORALE_DRUGS_CRASH, MORALE_ALCOHOL_CRASH)', () => {
  it('is a tactical -10 with the attitude rules of bad news', () => {
    const attitudes = [Attitude.NORMAL, Attitude.OPTIMIST, Attitude.PESSIMIST, Attitude.COWARD];
    for (const event of [MoraleEvent.DRUGS_CRASH, MoraleEvent.ALCOHOL_CRASH])
      expect(attitudes.map((a) => crashedMorale(event, a))).toEqual([-10, -9, -11, -12]);
  });
});

describe('the morale of a soldier on drugs (Morale.cc RefreshSoldierMorale)', () => {
  it('adds the adrenaline effect at 150 and the drink at 160 percent, each truncated, and waits while he sleeps', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    s.drugs.adrenaline.effect = 7;
    s.drugs.alcohol.effect = 3;
    let asleep = true;
    sim.state.narrative = { ...sim.state.narrative, mercAsleep: () => asleep };
    refreshSoldierMorale(sim.state, s);
    expect(s.morale).toBe(50);
    asleep = false;
    refreshSoldierMorale(sim.state, s);
    expect(s.morale).toBe(50 + 10 + 4);
  });
});

describe('a sleeping merc (Morale.cc RefreshSoldierMorale)', () => {
  it('banks the modifier of a tactical event but keeps his morale until he is awake', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
    let asleep = true;
    sim.state.narrative = { ...sim.state.narrative, mercAsleep: (m) => m === s && asleep };
    const before = s.morale;
    handleMoraleEvent(sim.state, s, MoraleEvent.KILLED_ENEMY);
    expect(s.tacticalMoraleMod).toBeGreaterThan(0);
    expect(s.morale).toBe(before);
    asleep = false;
    handleMoraleEvent(sim.state, s, MoraleEvent.KILLED_ENEMY);
    expect(s.morale).toBeGreaterThan(before);
  });
});

interface Said {
  readonly quotes: [number, number, boolean][];
  readonly flags: Map<number, QuoteSaidRecord>;
}

function listen(t: TacticalState): Said {
  const said: Said = { quotes: [], flags: new Map() };
  t.narrative = {
    ...t.narrative,
    sayQuote: (m, quote, delayed) => said.quotes.push([m.id, quote, delayed === true]),
    quoteSaidFlags: (m) => {
      const record = said.flags.get(m.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      said.flags.set(m.id, record);
      return record;
    },
  };
  return said;
}

function moraleScene() {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
  return { t: sim.state, s, said: listen(sim.state) };
}

describe('who takes a tactical morale event (Morale.cc UpdateSoldierMorale)', () => {
  it('leaves an EPC and a merc held prisoner out', () => {
    const epc = moraleScene();
    epc.t.narrative = { ...epc.t.narrative, isEpc: (m) => m === epc.s };
    handleMoraleEvent(epc.t, epc.s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
    expect(epc.s.tacticalMoraleMod).toBe(0);
    const prisoner = moraleScene();
    prisoner.t.narrative = { ...prisoner.t.narrative, assignment: () => Assignment.ASSIGNMENT_POW };
    handleMoraleEvent(prisoner.t, prisoner.s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
    expect(prisoner.s.tacticalMoraleMod).toBe(0);
  });
});

describe('the low morale quote (Morale.cc UpdateSoldierMorale)', () => {
  it('comes once, delayed, when an event leaves morale below 35, and again only after morale rose above 65', () => {
    const { t, s, said } = moraleScene();
    s.tacticalMoraleMod = -12;
    handleMoraleEvent(t, s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
    expect([s.morale, said.quotes]).toEqual([35, []]);
    handleMoraleEvent(t, s, MoraleEvent.SUPPRESSED);
    handleMoraleEvent(t, s, MoraleEvent.SUPPRESSED);
    expect(s.morale).toBe(33);
    expect(said.quotes).toEqual([[s.id, MercQuote.STARTING_TO_WHINE, true]]);
    s.tacticalMoraleMod = 10;
    handleMoraleEvent(t, s, MoraleEvent.KILLED_ENEMY);
    expect(said.flags.get(s.id)?.quoteSaidFlags ?? 0).toBe(QuoteSaidFlag.LOW_MORAL);
    handleMoraleEvent(t, s, MoraleEvent.KILLED_ENEMY);
    expect(s.morale).toBeGreaterThan(65);
    expect(said.flags.get(s.id)?.quoteSaidFlags ?? 0).toBe(0);
  });

  it('waits while the merc sleeps, his morale held', () => {
    const { t, s, said } = moraleScene();
    t.narrative = { ...t.narrative, mercAsleep: (m) => m === s };
    s.tacticalMoraleMod = -20;
    s.morale = 30;
    handleMoraleEvent(t, s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
    expect(said.quotes).toEqual([]);
  });
});
