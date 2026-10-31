import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { type Soldier, Team } from '../soldier.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';

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
