import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import type { SectorRef } from '../state.ts';
import { Profile } from './constants.ts';
import { CHOPPER_GRIDNO, DRASSEN_AIRPORT, handleEscortArrival, TOURISTS_PLANE_GRIDNO } from './escort-arrival.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const COLS = 160;
const START = CHOPPER_GRIDNO + 20 * COLS;
const NORTH = 0;

interface Calls {
  readonly facts: number[];
  readonly records: [number, number][];
  readonly setUps: SectorRef[];
}

function escortPort(calls: Calls, epc: boolean): NarrativePort {
  return {
    ...NO_NARRATIVE_PORT,
    isEpc: () => epc,
    setFactTrue: (id) => calls.facts.push(id),
    triggerNpcRecord: (profile, record) => calls.records.push([profile, record]),
    setUpHelicopterForPlayer: (sector) => calls.setUps.push(sector),
  };
}

function walkSkyrider(options: { epc?: boolean; sector?: SectorRef; profile?: number } = {}) {
  const sim = newCombatSim(content);
  const calls: Calls = { facts: [], records: [], setUps: [] };
  sim.state.narrative = escortPort(calls, options.epc ?? true);
  sim.state.sector = options.sector ?? DRASSEN_AIRPORT;
  const s = spawnSoldier(sim, 0, Team.OUR, START, NORTH);
  Object.assign(s, { profile: options.profile ?? Profile.SKYRIDER });
  expect(sim.dispatch({ type: 'move', soldier: 0, to: CHOPPER_GRIDNO, mode: 'walk' }).ok).toBe(true);
  runUntilIdle(sim);
  return { s, calls };
}

describe('the escorted Skyrider reaching his chopper (Overhead.cc HandleAtNewGridNo)', () => {
  it('stops him strictly within 11 tiles of 8842, sets the fact, triggers record 15 and sets the helicopter up in B13', () => {
    const { s, calls } = walkSkyrider();
    expect(pythSpacesAway(s.gridNo, CHOPPER_GRIDNO)).toBe(10);
    expect(calls.facts[0]).toBe(43);
    expect(calls.records[0]).toEqual([Profile.SKYRIDER, 15]);
    expect(calls.setUps[0]).toEqual(DRASSEN_AIRPORT);
  });

  it('ignores Skyrider when he is not an escort, another profile, or another sector', () => {
    for (const options of [{ epc: false }, { profile: Profile.PABLO }, { sector: { x: 13, y: 3, z: 0 } }]) {
      const { s, calls } = walkSkyrider(options);
      expect(s.gridNo).toBe(CHOPPER_GRIDNO);
      expect(calls.setUps).toEqual([]);
    }
  });
});

const PLANE_NEAR = TOURISTS_PLANE_GRIDNO + 5 * COLS;
const PLANE_FAR = TOURISTS_PLANE_GRIDNO + 45 * COLS;
const SOME_MERC = 10;
const CAMBRIA: SectorRef = { x: 8, y: 7, z: 0 };
const SAN_MONA_LEATHER_SHOP: SectorRef = { x: 6, y: 3, z: 0 };

interface TouristWorld {
  readonly calls: Calls;
  readonly sim: ReturnType<typeof newCombatSim>;
}

function touristWorld(options: { facts?: number[]; quest?: number; epcs?: number[]; sector?: SectorRef } = {}): TouristWorld {
  const sim = newCombatSim(content);
  const calls: Calls = { facts: [], records: [], setUps: [] };
  const facts = new Set(options.facts ?? []);
  const epcs = new Set(options.epcs ?? []);
  sim.state.narrative = {
    ...escortPort(calls, false),
    isEpc: (s) => epcs.has(s.id),
    fact: (id) => facts.has(id),
    questStatus: () => options.quest ?? QuestStatus.NOT_STARTED,
  };
  sim.state.sector = options.sector ?? DRASSEN_AIRPORT;
  return { calls, sim };
}

function tourist(w: TouristWorld, id: number, profile: number, at: number) {
  const s = spawnSoldier(w.sim, id, Team.OUR, at, NORTH);
  Object.assign(s, { profile });
  return s;
}

describe('John and Mary at the Drassen airport (Overhead.cc HandleJohnArrival, HandleMaryArrival)', () => {
  it('John with Mary close by: the fact and record 13', () => {
    const w = touristWorld({ facts: [Fact.MARY_ALIVE, Fact.JOHN_ALIVE], epcs: [1, 2] });
    tourist(w, 0, SOME_MERC, PLANE_NEAR + 3);
    const john = tourist(w, 1, Profile.JOHN, PLANE_NEAR);
    tourist(w, 2, Profile.MARY, PLANE_NEAR + 2);
    handleEscortArrival(w.sim.state, john);
    expect(w.calls.facts).toEqual([Fact.MARY_OR_JOHN_ARRIVED]);
    expect(w.calls.records).toEqual([[Profile.JOHN, 13]]);
  });

  it('John alone triggers record 12; Mary farther than 8 tiles keeps him waiting', () => {
    const alone = touristWorld({ facts: [Fact.JOHN_ALIVE], epcs: [1] });
    tourist(alone, 0, SOME_MERC, PLANE_NEAR + 3);
    handleEscortArrival(alone.sim.state, tourist(alone, 1, Profile.JOHN, PLANE_NEAR));
    expect(alone.calls.records).toEqual([[Profile.JOHN, 12]]);
    const apart = touristWorld({ facts: [Fact.MARY_ALIVE, Fact.JOHN_ALIVE], epcs: [1, 2] });
    tourist(apart, 0, SOME_MERC, PLANE_NEAR + 3);
    tourist(apart, 2, Profile.MARY, PLANE_NEAR + 12 * COLS);
    handleEscortArrival(apart.sim.state, tourist(apart, 1, Profile.JOHN, PLANE_NEAR));
    expect(apart.calls.records).toEqual([]);
  });

  it('Mary only arrives when John is dead, with a merc within 8 tiles and near the plane', () => {
    const widow = touristWorld({ facts: [Fact.MARY_ALIVE], epcs: [2] });
    tourist(widow, 0, SOME_MERC, PLANE_NEAR + 3);
    handleEscortArrival(widow.sim.state, tourist(widow, 2, Profile.MARY, PLANE_NEAR));
    expect(widow.calls.records).toEqual([[Profile.MARY, 13]]);
    const married = touristWorld({ facts: [Fact.MARY_ALIVE, Fact.JOHN_ALIVE], epcs: [2] });
    tourist(married, 0, SOME_MERC, PLANE_NEAR + 3);
    handleEscortArrival(married.sim.state, tourist(married, 2, Profile.MARY, PLANE_NEAR));
    expect(married.calls.records).toEqual([]);
    const lonely = touristWorld({ facts: [Fact.MARY_ALIVE], epcs: [2] });
    tourist(lonely, 0, SOME_MERC, PLANE_NEAR + 20 * COLS);
    handleEscortArrival(lonely.sim.state, tourist(lonely, 2, Profile.MARY, PLANE_NEAR));
    expect(lonely.calls.records).toEqual([]);
    const far = touristWorld({ facts: [Fact.MARY_ALIVE], epcs: [2] });
    handleEscortArrival(far.sim.state, tourist(far, 2, Profile.MARY, PLANE_FAR));
    expect(far.calls.records).toEqual([]);
  });

  it('any merc walking in B13 while the tourists quest runs checks the escorted pair', () => {
    const w = touristWorld({ facts: [Fact.JOHN_ALIVE], quest: QuestStatus.IN_PROGRESS, epcs: [1] });
    const merc = tourist(w, 0, SOME_MERC, PLANE_NEAR + 3);
    tourist(w, 1, Profile.JOHN, PLANE_NEAR);
    handleEscortArrival(w.sim.state, merc);
    expect(w.calls.records).toEqual([[Profile.JOHN, 12]]);
  });
});

describe('Maria and Joey (Overhead.cc HandleAtNewGridNo)', () => {
  it('Joey near Martha in Cambria stops and triggers record 10', () => {
    const w = touristWorld({ facts: [Fact.JOEY_NEAR_MARTHA], epcs: [1], sector: CAMBRIA });
    handleEscortArrival(w.sim.state, tourist(w, 1, Profile.JOEY, PLANE_NEAR));
    expect(w.calls.records).toEqual([[Profile.JOEY, 10]]);
  });

  it('Maria at the leather shop triggers Angel only while he stands in the shop', () => {
    const w = touristWorld({ facts: [Fact.MARIA_ESCORTED_AT_LEATHER_SHOP], epcs: [1], sector: SAN_MONA_LEATHER_SHOP });
    handleEscortArrival(w.sim.state, tourist(w, 1, Profile.MARIA, PLANE_NEAR));
    expect(w.calls.records).toEqual([]);
  });
});
