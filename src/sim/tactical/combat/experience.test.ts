import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from '../content.ts';
import { StatKind } from '../profiles.ts';
import { Team } from '../soldier.ts';
import { StatCause, statChange } from './experience.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const TOP_RATING = 100;

describe('stat gains (Campaign.cc ProcessStatChange)', () => {
  it('rolls PreRandom once per chance even when the chance is zero, so a top skill still moves the pre stream', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    const p = progressFor(MERC_PROFILE);
    sim.state.profiles.set(MERC_PROFILE, p);
    p.stats.marksmanship = TOP_RATING;
    const pre = new ScriptedStream([], 0);
    Object.assign(sim.state, { pre });
    statChange(sim.state, s, StatKind.MARKSMANSHIP, 3, StatCause.SUCCESS);
    expect(pre.requested).toEqual([100, 100, 100]);
    expect(p.gains.marksmanship).toBe(0);
  });
});
