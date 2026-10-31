import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { idiv } from '../../../core/int.ts';
import type { TacticalContent } from '../content.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { effectiveMechanical } from '../skills.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { SkillCheckReason, skillCheck } from './skill-check.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CHECKER_AT = gridNo(80, 80);
const CHECKER = 4;
const BUDDY = 5;
const NO_BUDDY = -1;
const NEUTRAL_MORALE = 50;
const NEAR = gridNo(94, 80);
const TOO_FAR = gridNo(95, 80);
const UNJAM_BASE = 30;
const FAILING_ROLL = 50;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly checker: Soldier;
  readonly said: [number, number][];
}

function scene(): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const checker = spawnSoldier(sim, 0, Team.OUR, CHECKER_AT, Direction.SOUTH, { profile: CHECKER });
  checker.morale = NEUTRAL_MORALE;
  const said: [number, number][] = [];
  t.narrative = { ...t.narrative, sayQuote: (s, quote) => said.push([s.id, quote]) };
  return { sim, t, checker, said };
}

function buddy(s: Scene, id: number, at: number, slot: number, profile = BUDDY): Soldier {
  const buddies = [NO_BUDDY, NO_BUDDY, NO_BUDDY];
  buddies[slot] = s.checker.profile;
  s.t.profiles.set(profile, testProfile(profile, { buddies }));
  return spawnSoldier(s.sim, id, Team.OUR, at, Direction.SOUTH, { profile });
}

function unjam(s: Scene, roll: number, mod = 0): number {
  const pre = s.t.pre as unknown as { int(n: number): number };
  pre.int = () => roll;
  return skillCheck(s.t, s.checker, SkillCheckReason.UNJAM_GUN, mod);
}

const unjamSkill = (s: Scene) => UNJAM_BASE + idiv(effectiveMechanical(s.checker), 2);

describe("a buddy's comment on a skill check passed with a low roll (SkillCheck.cc SkillCheck)", () => {
  it('comes from each buddy within 15 tiles for a roll below 15 + skill / 20 - modifier / 20', () => {
    const s = scene();
    const near = buddy(s, 1, NEAR, 0);
    const chance = 15 + idiv(unjamSkill(s), 20);
    expect(unjam(s, chance)).toBeGreaterThanOrEqual(0);
    expect(s.said).toEqual([]);
    unjam(s, chance - 1);
    expect(s.said).toEqual([[near.id, MercQuote.BUDDY_1_GOOD]]);
  });

  it('truncates each twentieth toward zero, so a bonus of 30 costs one point, not two', () => {
    const s = scene();
    const near = buddy(s, 1, NEAR, 1);
    const chance = 15 + idiv(unjamSkill(s), 20) - 1;
    unjam(s, chance, 30);
    expect(s.said).toEqual([]);
    unjam(s, chance - 1, 30);
    expect(s.said).toEqual([[near.id, MercQuote.BUDDY_2_GOOD]]);
  });

  it('says the learned-to-like line and skips a buddy 15 tiles away, a merc who is no buddy and a failed check', () => {
    const s = scene();
    const learned = buddy(s, 1, NEAR, 2);
    buddy(s, 2, TOO_FAR, 0, BUDDY + 1);
    spawnSoldier(s.sim, 3, Team.OUR, gridNo(82, 80), Direction.SOUTH, { profile: BUDDY + 2 });
    unjam(s, 0);
    expect(s.said).toEqual([[learned.id, MercQuote.LEARNED_TO_LIKE_WITNESSED]]);
    expect(unjam(s, 99, -99)).toBeLessThan(0);
    expect(s.said).toHaveLength(1);
  });
});

describe('the definite can’t-do quote (SkillCheck.cc SkillCheck)', () => {
  function pickLockWithoutKit(s: Scene): void {
    const pre = s.t.pre as unknown as { int(n: number): number };
    pre.int = () => FAILING_ROLL;
    expect(skillCheck(s.t, s.checker, SkillCheckReason.LOCKPICKING, 0)).toBeLessThan(0);
  }

  it('comes at the third failed attempt of an impossible check on the same spot for a merc wiser than 80, later for others', () => {
    const wise = scene();
    wise.checker.stats.wisdom = 90;
    for (let k = 0; k < 3; k++) pickLockWithoutKit(wise);
    expect(wise.said).toEqual([[wise.checker.id, MercQuote.DEFINITE_CANT_DO]]);
    const plain = scene();
    plain.checker.stats.wisdom = 70;
    for (let k = 0; k < 3; k++) pickLockWithoutKit(plain);
    expect(plain.said).toEqual([]);
    pickLockWithoutKit(plain);
    expect(plain.said).toEqual([[plain.checker.id, MercQuote.DEFINITE_CANT_DO]]);
  });

  it('passes a check with no chance at all on a roll of 0: the margin is 0, not below it', () => {
    const s = scene();
    const pre = s.t.pre as unknown as { int(n: number): number };
    pre.int = () => 0;
    expect(skillCheck(s.t, s.checker, SkillCheckReason.LOCKPICKING, 0)).toBe(0);
    expect(s.checker.skillCheckAttempts).toBe(0);
  });

  it('counts the attempts again after a move', () => {
    const s = scene();
    s.checker.stats.wisdom = 90;
    pickLockWithoutKit(s);
    pickLockWithoutKit(s);
    s.checker.gridNo = gridNo(81, 80);
    pickLockWithoutKit(s);
    expect([s.checker.skillCheckAttempts, s.said]).toEqual([1, []]);
  });
});
