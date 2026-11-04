import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, type SpawnOptions, spawnSoldier } from '../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { anim, animName } from './anim-states.ts';
import { changeSoldierState } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { loadTacticalContent } from './load-content.ts';
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

const DRINK = 8;

function drink(s: Soldier, drinks: number, hangover = 0): void {
  s.drugs.alcohol.effect = drinks * DRINK;
  s.drugs.alcohol.sideEffect = hangover;
}

describe('code 491 on drink (Soldier_Ani.cc AdjustToNextAnimationFrame, GetDrunkLevel >= BORDERLINE)', () => {
  it('draws on every pass once borderline, hungover included, but on every third while he only feels good', () => {
    const borderline = scene(Team.OUR, { gun: RIFLE });
    drink(borderline.s, 4);
    check(borderline, 10);
    check(borderline, 10);
    const hungover = scene(Team.OUR, { gun: RIFLE });
    drink(hungover.s, 0, 10);
    check(hungover, 10);
    const merry = scene(Team.OUR, { gun: RIFLE });
    drink(merry.s, 3);
    check(merry);
    expect([borderline.draws, hungover.draws, merry.draws]).toEqual([[DICE, DICE], [DICE], []]);
  });

  it('plays only the drunk idle once borderline, on 40 to 100, and never below borderline', () => {
    const borderline = scene(Team.OUR, { gun: RIFLE });
    drink(borderline.s, 4);
    expect(check(borderline, 0)).toBe('continue');
    expect(animName(content, borderline.s.state)).toBe('STANDING');
    expect(check(borderline, 40)).toBe('stop');
    expect(animName(content, borderline.s.state)).toBe('DRUNK_IDLE');
    const merry = scene(Team.OUR, { gun: RIFLE });
    drink(merry.s, 3);
    passes(merry, PASSES_PER_CHECK, 40);
    expect(animName(content, merry.s.state)).toBe('STANDING');
  });

  it('plays the drunk idle for a hungover merc too: HUNGOVER is 4, above BORDERLINE', () => {
    const hungover = scene(Team.ENEMY, { gun: RIFLE, body: Body.BIGMALE });
    drink(hungover.s, 0, 1);
    expect(check(hungover, 99)).toBe('stop');
    expect(animName(content, hungover.s.state)).toBe('DRUNK_IDLE');
  });

  it('has no drunk idle for a woman: drunk or hungover, she draws on every pass and never idles', () => {
    const drunk = scene(Team.OUR, { gun: RIFLE, body: Body.REGFEMALE });
    drink(drunk.s, 5);
    const hungover = scene(Team.OUR, { gun: RIFLE, body: Body.REGFEMALE });
    drink(hungover.s, 0, 10);
    const rolls = [0, 20, 50, 99];
    expect([...rolls.map((r) => check(drunk, r)), ...rolls.map((r) => check(hungover, r))]).toEqual(new Array(8).fill('continue'));
    expect([drunk.draws.length, hungover.draws.length, animName(content, drunk.s.state)]).toEqual([4, 4, 'STANDING']);
  });

  it('breaks off after the draw with a one-handed gun in hand, drunk or not', () => {
    const pistol = scene(Team.OUR, { gun: PISTOL });
    drink(pistol.s, 5);
    expect(check(pistol, 60)).toBe('continue');
    expect([pistol.draws, animName(content, pistol.s.state)]).toEqual([[DICE], 'STANDING']);
  });

  it('runs a drunk merc through the drunk idle and back to standing in the sector', () => {
    expect(drunkIdlePlayed(content, Body.REGMALE)).toEqual(['STANDING', 'DRUNK_IDLE', 'STANDING']);
  });
});

function drunkIdlePlayed(rules: TacticalContent, body: number): string[] {
  const sim = newCombatSim(rules);
  const s = spawnSoldier(sim, 0, Team.OUR, AT, Direction.SOUTH, { gun: RIFLE, body });
  drink(s, 5);
  const rng = sim.state.rng as unknown as { int(n: number): number };
  rng.int = () => DICE - 1;
  const played = [animName(rules, s.state)];
  for (let tick = 0; tick < LOOP_BUDGET_TICKS && played.length < 3; tick++) {
    sim.step();
    const name = animName(rules, s.state);
    if (played.at(-1) !== name) played.push(name);
  }
  return played;
}

describe.skipIf(!ORIGINAL_DATA_DIR)('the drunk idle with the original scripts', () => {
  let data: DataVfs;
  let original: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    original = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  it('plays from code 491 for the regular, big and stocky man and returns to standing', () => {
    for (const body of [Body.REGMALE, Body.BIGMALE, Body.STOCKYMALE])
      expect(drunkIdlePlayed(original, body)).toEqual(['STANDING', 'DRUNK_IDLE', 'STANDING']);
  });
});

describe('a random idle animation on our turn (Handle_UI.cc SetUIBusy: only orders lock the turn)', () => {
  it('neither locks the interface nor keeps the other mercs and the turn waiting while our merc looks around', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const looker = spawnSoldier(sim, 0, Team.OUR, AT, Direction.SOUTH, { gun: RIFLE, body: Body.REGFEMALE });
    spawnSoldier(sim, 1, Team.OUR, gridNo(82, 80), Direction.SOUTH);
    spawnSoldier(sim, ENEMY_ID, Team.ENEMY, gridNo(80, 120), Direction.NORTH);
    t.inCombat = true;
    changeSoldierState(t, looker, anim(content, 'FEM_LOOK'));
    expect([animName(content, looker.state), sim.uiLocked(), sim.isBusy(looker)]).toEqual(['FEM_LOOK', false, false]);
    expect(sim.dispatch({ type: 'select', soldier: 1 })).toMatchObject({ ok: true });
    expect(sim.dispatch({ type: 'endTurn' })).toMatchObject({ ok: true });
  });
});
