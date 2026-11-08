import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { spawnCreature } from '../../../../tests/support/creatures.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { VehicleSeat } from '../../strategic/forces/constants.ts';
import type { TacticalContent } from '../content.ts';
import { MercQuote, QuoteSaidFlag } from '../narrative/merc-quotes.ts';
import type { QuoteSaidRecord } from '../narrative/port.ts';
import { Opp } from '../perception/opp.ts';
import { Body, OKLIFE, Personality, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { seatWithNoVehicleOnTheMap } from '../vehicle-passengers.ts';
import { beginMercTurn } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const FRIEND_PROFILE = 6;
const MERC_AT = gridNo(80, 80);
const CREATURE_ID = 30;
const PHOBIC_LIMIT = -20;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
}

function scene(trait: number, team: number = Team.OUR): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  t.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
  const merc = spawnSoldier(sim, 0, team, MERC_AT, Direction.SOUTH, { profile: MERC_PROFILE });
  merc.personalityTrait = trait;
  const said: [number, number][] = [];
  const flags = new Map<number, QuoteSaidRecord>();
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    quoteSaidFlags: (s) => {
      const record = flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      flags.set(s.id, record);
      return record;
    },
  };
  const s: Scene = { sim, t, merc, said, draws: [], script: [], flags };
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    s.draws.push(n);
    const v = s.script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
  return s;
}

function seesCreature(s: Scene): void {
  spawnCreature(s.sim, CREATURE_ID, Body.YAM_MONSTER, gridNo(80, 90), Direction.NORTH);
  s.merc.oppList[CREATURE_ID] = Opp.SEEN_CURRENTLY;
  s.merc.ai.oppCount = 1;
}

function friendAt(s: Scene, at: number): Soldier {
  return spawnSoldier(s.sim, 1, Team.OUR, at, Direction.SOUTH, { profile: FRIEND_PROFILE });
}

function lowMorale(s: Soldier, tacticalModifier: number): void {
  s.tacticalMoraleMod = tacticalModifier;
  s.morale = 50 + tacticalModifier;
}

const personalityQuote = (s: Scene) => [[s.merc.id, MercQuote.PERSONALITY_TRAIT]];
const personalityFlag = (s: Scene) => (s.flags.get(s.merc.id)?.quoteSaidFlags ?? 0) & QuoteSaidFlag.PERSONALITY;

describe('phobias at the turn start (Soldier_Control.cc EVENT_BeginMercTurn)', () => {
  it('costs an insect-phobic merc five points of morale per turn while he sees a creature, with his quote once', () => {
    const s = scene(Personality.FEAR_OF_INSECTS);
    beginMercTurn(s.t, s.merc);
    expect([s.merc.tacticalMoraleMod, s.said]).toEqual([0, []]);
    seesCreature(s);
    beginMercTurn(s.t, s.merc);
    beginMercTurn(s.t, s.merc);
    expect([s.merc.tacticalMoraleMod, s.merc.morale]).toEqual([-10, 40]);
    expect(s.said).toEqual(personalityQuote(s));
    expect(s.draws).toEqual([]);
  });

  it('rolls Random(6 - level) for a claustrophobic merc underground: a 0 costs a point of morale and brings the quote', () => {
    const s = scene(Personality.CLAUSTROPHOBIC);
    s.t.sector = { x: 13, y: 9, z: 1 };
    s.script.push(1);
    beginMercTurn(s.t, s.merc);
    expect([s.merc.tacticalMoraleMod, s.said]).toEqual([0, []]);
    s.t.sector = { x: 13, y: 9, z: 3 };
    s.script.push(0);
    beginMercTurn(s.t, s.merc);
    expect(s.draws).toEqual([5, 3]);
    expect(s.merc.tacticalMoraleMod).toBe(-1);
    expect(s.said).toEqual(personalityQuote(s));
  });

  it('draws nothing for a claustrophobic merc above ground', () => {
    const s = scene(Personality.CLAUSTROPHOBIC);
    s.t.sector = { x: 13, y: 9, z: 0 };
    beginMercTurn(s.t, s.merc);
    expect([s.draws, s.merc.tacticalMoraleMod, s.said]).toEqual([[], 0, []]);
  });

  it('costs a nervous merc below 50 morale a point while no conscious teammate stands within 10 tiles', () => {
    const s = scene(Personality.NERVOUS);
    const friend = friendAt(s, gridNo(80, 90));
    lowMorale(s.merc, -1);
    beginMercTurn(s.t, s.merc);
    expect([s.merc.tacticalMoraleMod, s.said]).toEqual([-1, []]);
    friend.life = OKLIFE - 1;
    beginMercTurn(s.t, s.merc);
    expect(s.merc.tacticalMoraleMod).toBe(-2);
    expect(s.said).toEqual(personalityQuote(s));
  });

  it('spares a nervous merc alone at 50 morale or more', () => {
    const s = scene(Personality.NERVOUS);
    friendAt(s, gridNo(80, 91));
    beginMercTurn(s.t, s.merc);
    expect([s.merc.tacticalMoraleMod, s.said]).toEqual([0, []]);
    lowMorale(s.merc, -1);
    beginMercTurn(s.t, s.merc);
    expect(s.merc.tacticalMoraleMod).toBe(-2);
  });

  it("clears a nervous merc's quote flag among friends once his morale is above 45, so the quote comes again", () => {
    const s = scene(Personality.NERVOUS);
    const friend = friendAt(s, gridNo(80, 90));
    lowMorale(s.merc, -5);
    s.flags.set(s.merc.id, { quoteSaidFlags: QuoteSaidFlag.PERSONALITY, quoteSaidExtFlags: 0 });
    beginMercTurn(s.t, s.merc);
    expect(personalityFlag(s)).toBe(QuoteSaidFlag.PERSONALITY);
    lowMorale(s.merc, -4);
    beginMercTurn(s.t, s.merc);
    expect(personalityFlag(s)).toBe(0);
    friend.life = OKLIFE - 1;
    beginMercTurn(s.t, s.merc);
    expect(s.said).toEqual(personalityQuote(s));
  });

  it('still brings the quote but no morale loss once the tactical modifier is down to -20 (PHOBIC_LIMIT)', () => {
    const s = scene(Personality.FEAR_OF_INSECTS);
    seesCreature(s);
    lowMorale(s.merc, PHOBIC_LIMIT);
    beginMercTurn(s.t, s.merc);
    expect(s.merc.tacticalMoraleMod).toBe(PHOBIC_LIMIT);
    expect(s.said).toEqual(personalityQuote(s));
  });

  it('costs a nervous helicopter passenger above the sector a point alone, and keeps him company with another passenger aboard: both at NOWHERE, they are no tile apart (DistanceToClosestFriend, quirk)', () => {
    const s = scene(Personality.NERVOUS);
    const friend = friendAt(s, gridNo(80, 81));
    for (const aboard of [s.merc, friend]) aboard.vehicleSeat = VehicleSeat.PASSENGER;
    seatWithNoVehicleOnTheMap(s.t, s.merc);
    lowMorale(s.merc, -1);
    beginMercTurn(s.t, s.merc);
    expect(s.merc.tacticalMoraleMod).toBe(-2);
    seatWithNoVehicleOnTheMap(s.t, friend);
    beginMercTurn(s.t, s.merc);
    expect(s.merc.tacticalMoraleMod).toBe(-2);
  });

  it('leaves a phobic soldier of another team alone', () => {
    const s = scene(Personality.CLAUSTROPHOBIC, Team.MILITIA);
    s.t.sector = { x: 13, y: 9, z: 1 };
    beginMercTurn(s.t, s.merc);
    expect([s.draws, s.merc.tacticalMoraleMod, s.said]).toEqual([[], 0, []]);
  });
});
