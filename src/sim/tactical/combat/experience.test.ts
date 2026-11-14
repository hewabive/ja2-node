import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from '../content.ts';
import { StatKind } from '../profiles.ts';
import { Team } from '../soldier.ts';
import { processUpdateStats, profileUpdateStats, StatCause, statChange } from './experience.ts';

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

describe('the stat deltas (Campaign.cc ChangeStat)', () => {
  const ONE_POINT_OF_WISDOM = 50;
  const TWO_POINTS_OF_MARKSMANSHIP = 50;

  it('moves the delta of a merc on our team with every point his stat changes, but not a change made off the team', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    const p = progressFor(MERC_PROFILE);
    sim.state.profiles.set(MERC_PROFILE, p);
    Object.assign(p.gains, { wisdom: ONE_POINT_OF_WISDOM, marksmanship: TWO_POINTS_OF_MARKSMANSHIP });
    processUpdateStats(sim.state, s);
    expect([p.stats.wisdom, p.deltas.wisdom, p.stats.marksmanship, p.deltas.marksmanship]).toEqual([61, 1, 62, 2]);
    p.gains.wisdom = ONE_POINT_OF_WISDOM;
    profileUpdateStats(sim.state, p);
    expect([p.stats.wisdom, p.deltas.wisdom]).toEqual([62, 1]);
  });
});

describe("the stat line (Campaign.cc ChangeStat's DisplayStatChange event and QUOTE_EXPERIENCE_GAIN)", () => {
  const ONE_POINT_OF_MARKSMANSHIP = 25;
  const ONE_LEVEL_AT_THREE = 1050;
  const ONE_POINT_OF_HEALTH = 50;

  function merc(rolls: number[]) {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    const p = progressFor(MERC_PROFILE);
    sim.state.profiles.set(MERC_PROFILE, p);
    const picks: number[] = [];
    const lines: [number, string, number][] = [];
    sim.state.narrative = {
      ...sim.state.narrative,
      cosmeticPick: (n) => {
        picks.push(n);
        return rolls.shift() ?? n - 1;
      },
      sayStatChange: (m, stat, change) => lines.push([m.id, stat, change]) > 0,
    };
    sim.drainEvents();
    const changes = () => sim.drainEvents().filter((e) => e.type === 'statChanged');
    return { sim, s, p, picks, lines, changes };
  }

  it('queues the line and the quote for a skill on a cosmetic Random(100) < 25, the message waiting in the queue', () => {
    const m = merc([24]);
    m.p.gains.marksmanship = ONE_POINT_OF_MARKSMANSHIP;
    processUpdateStats(m.sim.state, m.s);
    expect([m.picks, m.lines]).toEqual([[100], [[m.s.id, 'marksmanship', 1]]]);
    expect(m.changes()).toEqual([expect.objectContaining({ soldier: m.s.id, stat: 'marksmanship', change: 1, queued: true })]);
  });

  it('prints the message at once from 25 up, with no line', () => {
    const m = merc([25]);
    m.p.gains.marksmanship = ONE_POINT_OF_MARKSMANSHIP;
    processUpdateStats(m.sim.state, m.s);
    expect([m.picks, m.lines]).toEqual([[100], []]);
    expect(m.changes()).toEqual([expect.not.objectContaining({ queued: true })]);
  });

  it('always queues it for a level, without a draw, and never for health', () => {
    const m = merc([]);
    Object.assign(m.p.gains, { experience: ONE_LEVEL_AT_THREE, lifeMax: ONE_POINT_OF_HEALTH });
    processUpdateStats(m.sim.state, m.s);
    expect([m.picks, m.lines]).toEqual([[], [[m.s.id, 'experience', 1]]]);
    expect(m.changes().map((e) => [e.stat, 'queued' in e])).toEqual([
      ['lifeMax', false],
      ['experience', true],
    ]);
  });

  it('has a merc who loses a level say his experience-gain line too', () => {
    const m = merc([]);
    m.p.gains.experience = -ONE_LEVEL_AT_THREE;
    processUpdateStats(m.sim.state, m.s);
    expect(m.lines).toEqual([[m.s.id, 'experience', -1]]);
  });

  it('prints the message at once when no dialogue queue takes the line', () => {
    const m = merc([0]);
    m.sim.state.narrative = { ...m.sim.state.narrative, sayStatChange: () => false };
    m.p.gains.marksmanship = ONE_POINT_OF_MARKSMANSHIP;
    processUpdateStats(m.sim.state, m.s);
    expect(m.changes()).toEqual([expect.not.objectContaining({ queued: true })]);
  });
});
