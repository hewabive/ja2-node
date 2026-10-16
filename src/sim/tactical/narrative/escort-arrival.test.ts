import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import type { SectorRef } from '../state.ts';
import { Profile } from './constants.ts';
import { CHOPPER_GRIDNO, DRASSEN_AIRPORT } from './escort-arrival.ts';
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
