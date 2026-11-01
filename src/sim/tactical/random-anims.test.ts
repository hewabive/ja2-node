import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, type SpawnOptions, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { randomAnimOpcode } from './random-anims.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const AT = gridNo(80, 80);
const RANDOM_ANIM_CHECK = 491;
const DICE = 100;
const PASSES_PER_CHECK = 3;
const INJURED = 29;
const BELOW_OKLIFE = 14;
const RIFLE = 'M14';
const PISTOL = 'GLOCK_17';
const EMPTY_HANDS = 'NOTHING';
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY] ?? 0;
const CIV_ID = TEAM_FIRST_ID[Team.CIV] ?? 0;
const LOOP_BUDGET_TICKS = 20_000;

interface Scene {
  readonly t: TacticalState;
  readonly s: Soldier;
  readonly draws: number[];
  readonly script: number[];
}

function scene(team: number, options: SpawnOptions = {}): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const id = team === Team.OUR ? 0 : team === Team.CIV ? CIV_ID : ENEMY_ID;
  const s = spawnSoldier(sim, id, team, AT, Direction.SOUTH, options);
  const draws: number[] = [];
  const script: number[] = [];
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    draws.push(n);
    const v = script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
  return { t, s, draws, script };
}

function check(sc: Scene, roll?: number) {
  if (roll !== undefined) sc.script.push(roll);
  return randomAnimOpcode(sc.t, sc.s, RANDOM_ANIM_CHECK);
}

function passes(sc: Scene, count: number, roll: number) {
  const outcomes = [];
  for (let k = 0; k < count; k++) outcomes.push(check(sc, k === count - 1 ? roll : undefined));
  return outcomes;
}

describe('code 491, the random idle animation check (Soldier_Ani.cc AdjustToNextAnimationFrame)', () => {
  it('draws Random(100) on every third pass of the breathing loop, and on every pass below 30 life', () => {
    const calm = scene(Team.ENEMY, { gun: RIFLE });
    expect(passes(calm, PASSES_PER_CHECK, 50)).toEqual(['continue', 'continue', 'continue']);
    expect([calm.draws, calm.s.timeOfLastRandomAction]).toEqual([[DICE], 0]);
    const hurt = scene(Team.ENEMY, { gun: RIFLE, life: INJURED });
    check(hurt, 10);
    check(hurt, 10);
    expect(hurt.draws).toEqual([DICE, DICE]);
  });

  it('neither counts nor draws below OKLIFE, and counts but draws nothing in water', () => {
    const dying = scene(Team.ENEMY, { life: BELOW_OKLIFE });
    passes(dying, PASSES_PER_CHECK, 0);
    expect([dying.draws, dying.s.timeOfLastRandomAction]).toEqual([[], 0]);
    const wading = scene(Team.ENEMY);
    wading.s.overTerrain = Terrain.LOW_WATER;
    passes(wading, PASSES_PER_CHECK, 0);
    expect([wading.draws, wading.s.timeOfLastRandomAction]).toEqual([[], 0]);
  });

  it('lets an enemy with a rifle look around on 20 to 23', () => {
    const looks = scene(Team.ENEMY, { gun: RIFLE });
    expect(passes(looks, PASSES_PER_CHECK, 23)).toEqual(['continue', 'continue', 'stop']);
    expect(animName(content, looks.s.state)).toBe('FEM_LOOK');
    const rests = scene(Team.ENEMY, { gun: RIFLE });
    passes(rests, PASSES_PER_CHECK, 24);
    expect(animName(content, rests.s.state)).toBe('STANDING');
  });

  it('keeps the casual animations for our mercs out of combat', () => {
    const merc = scene(Team.OUR, { gun: RIFLE });
    passes(merc, PASSES_PER_CHECK, 0);
    expect(animName(content, merc.s.state)).toBe('REG_SPIT');
    const enemy = scene(Team.ENEMY, { gun: RIFLE });
    passes(enemy, PASSES_PER_CHECK, 0);
    const fighting = scene(Team.OUR, { gun: RIFLE });
    fighting.t.inCombat = true;
    passes(fighting, PASSES_PER_CHECK, 0);
    expect([animName(content, enemy.s.state), animName(content, fighting.s.state)]).toEqual(['STANDING', 'STANDING']);
  });

  it('never plays one with a one-handed gun in hand, after the draw: "Don\'t EVER do a trivial anim"', () => {
    const pistol = scene(Team.OUR, { gun: PISTOL });
    expect(passes(pistol, PASSES_PER_CHECK, 30)).toEqual(['continue', 'continue', 'continue']);
    expect([pistol.draws, animName(content, pistol.s.state)]).toEqual([[DICE], 'STANDING']);
    const hurt = scene(Team.OUR, { gun: PISTOL, life: INJURED });
    expect(check(hurt, 50)).toBe('continue');
    expect(animName(content, hurt.s.state)).toBe('STANDING');
    const empty = scene(Team.OUR, { gun: EMPTY_HANDS });
    passes(empty, PASSES_PER_CHECK, 30);
    expect(animName(content, empty.s.state)).toBe('REG_PULL');
  });

  it('plays only the hurt idle below 30 life, on 40 to 100', () => {
    const hurt = scene(Team.ENEMY, { gun: RIFLE, life: INJURED });
    check(hurt, 22);
    expect(animName(content, hurt.s.state)).toBe('STANDING');
    check(hurt, 40);
    expect(animName(content, hurt.s.state)).toBe('MERC_HURT_IDLE_ANIM');
  });

  it("turns a big merc's head with the second big merc animation: every BIGMALE gets the threaten stance at creation", () => {
    const big = scene(Team.ENEMY, { gun: RIFLE, body: Body.BIGMALE });
    passes(big, PASSES_PER_CHECK, 30);
    expect(animName(content, big.s.state)).toBe('BIGMERC_IDLE_NECK');
  });

  it("holds an animal's idle sound at code 491 for a frame, so the next pass counts again from 1", () => {
    const crow = scene(Team.CIV, { body: Body.CROW, gun: EMPTY_HANDS });
    expect(passes(crow, PASSES_PER_CHECK, 0)).toEqual(['continue', 'continue', 'stop']);
    expect(check(crow)).toBe('continue');
    expect([crow.draws, crow.s.timeOfLastRandomAction, animName(content, crow.s.state)]).toEqual([[DICE], 1, 'CROW_EAT']);
  });

  it('leaves the eating animation to our cows: a civilian cow only moos', () => {
    const cow = scene(Team.CIV, { body: Body.COW, gun: EMPTY_HANDS });
    expect(passes(cow, PASSES_PER_CHECK, 50)).toEqual(['continue', 'continue', 'continue']);
    expect(animName(content, cow.s.state)).toBe('STANDING');
  });

  it('runs at the end of every pass of the standing loop of a soldier in the sector', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, AT, Direction.SOUTH, { gun: RIFLE });
    const counts: number[] = [];
    for (let tick = 0; tick < LOOP_BUDGET_TICKS && counts.length < PASSES_PER_CHECK + 1; tick++) {
      sim.step();
      if (s.timeOfLastRandomAction !== (counts.at(-1) ?? 0)) counts.push(s.timeOfLastRandomAction);
    }
    expect(counts).toEqual([1, 2, 0, 1]);
  });
});
