import { beforeAll, describe, expect, it, vi } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { SimEvent } from '../../events.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { type Soldier, Team, Visible } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { bulletViews } from '../world-view.ts';
import { handleItem, ItemHandle } from './attack.ts';
import type { Bullet } from './bullets.ts';
import { processUpdateStats } from './experience.ts';
import { eventSoldierGotHit, tellCriticalHit } from './hit.ts';
import { bulletImpact } from './impact.ts';
import { AimShot, Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const EMPTY_GROUND = gridNo(84, 90);

function shotAtTheGround(prepare: (sim: TacticalSim) => void = () => {}) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
  prepare(sim);
  expect(sim.dispatch({ type: 'attack', soldier: 0, target: EMPTY_GROUND }).ok).toBe(true);
  let last = bulletViews(
    sim.state,
    () => true,
    () => 0,
  );
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 2000 && !events.some((e) => e.type === 'bulletImpact'); tick++) {
    const flying = bulletViews(
      sim.state,
      () => true,
      () => 0,
    );
    if (flying.length > 0) last = flying;
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, merc, events, last: last[0] };
}

function impactOf(events: readonly SimEvent[]) {
  const impact = events.find((e) => e.type === 'bulletImpact');
  if (impact?.type !== 'bulletImpact') throw new Error('no impact');
  return impact;
}

describe('bullet impacts (Weapons.cc StructureHit)', () => {
  it('raises dust where a missed bullet stops on the ground, and frees the shooter when the miss animation ends', () => {
    const { sim, events, last } = shotAtTheGround();
    const impact = impactOf(events);
    expect(impact).toMatchObject({ soldier: 0, effect: 'dust' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'bulletStopped', reason: 'ground', gridNo: impact.gridNo }));
    expect(Math.abs(impact.x - (last?.x ?? 0))).toBeLessThanOrEqual(10);
    expect(Math.abs(impact.y - (last?.y ?? 0))).toBeLessThanOrEqual(10);
    expect(impact.z).toBeLessThanOrEqual(last?.z ?? 0);
    expect(sim.state.missAnimations).toHaveLength(1);
    expect(sim.state.turn.attackBusyCount).toBeGreaterThan(0);
  });

  it('splashes in low and deep water only', () => {
    const { events } = shotAtTheGround();
    const where = impactOf(events).gridNo;
    const effectIn = (terrain: number) =>
      impactOf(
        shotAtTheGround((sim) => {
          sim.state.world.terrain[where] = terrain;
        }).events,
      ).effect;
    expect(effectIn(Terrain.LOW_WATER)).toBe('splash');
    expect(effectIn(Terrain.DEEP_WATER)).toBe('splash');
    expect(effectIn(Terrain.MED_WATER)).toBe('dust');
  });

  it('bursts a miniboom where an HE round stops and frees the shooter at once', () => {
    const { sim, events } = shotAtTheGround((s) => {
      const gun = s.state.soldiers[0]?.inv[InvSlot.HAND];
      if (gun) gun.gunAmmoType = AmmoType.HE;
    });
    expect(impactOf(events).effect).toBe('miniboom');
    expect(sim.state.missAnimations).toHaveLength(0);
    expect(sim.state.bullets.filter((b) => !b.toDelete)).toHaveLength(0);
  });
});

describe('the sounds of a miss (Weapons.cc StructureHit, ShotMiss; Structure.cc DamageStructure)', () => {
  it('draws nothing from the gameplay generator for the curse of a miss, which the browser draws', () => {
    const draws: number[] = [];
    shotAtTheGround((sim) => {
      const draw = sim.state.rng.int.bind(sim.state.rng);
      vi.spyOn(sim.state.rng, 'int').mockImplementation((n: number) => {
        draws.push(n);
        return draw(n);
      });
    });
    expect(draws).not.toContain(40);
  });

  it('names the material a bullet strikes, before the miss it plays', () => {
    const wall = Array.from({ length: 9 }, (_, k) => gridNo(77 + k, 80));
    const sim = newCombatSim(content, wall);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: EMPTY_GROUND }).ok).toBe(true);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 2000 && !events.some((e) => e.type === 'bulletImpact'); tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    const struck = events.findIndex((e) => e.type === 'structureStruck');
    expect(events[struck]).toMatchObject({ soldier: 0, material: 12 });
    expect(events.findIndex((e) => e.type === 'bulletImpact')).toBeGreaterThan(struck);
  });

  it('tells the shot and the miss of a shooter out of sight without naming him, the miss with his weapon for its sound (D16)', () => {
    const wall = Array.from({ length: 9 }, (_, k) => gridNo(77 + k, 80));
    const sim = newCombatSim(content, wall);
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 70), Direction.SOUTH);
    shooter.visible = -1;
    sim.state.inCombat = true;
    const gun = shooter.inv[InvSlot.HAND]?.item ?? 0;
    expect(handleItem(sim.state, shooter, EMPTY_GROUND, 0, gun)).toBe(ItemHandle.OK);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 2000 && !events.some((e) => e.type === 'bulletImpact'); tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    const told = events.filter((e) => ['shotFired', 'structureStruck', 'bulletImpact', 'bulletStopped'].includes(e.type));
    expect(told.map((e) => e.type)).toEqual(['shotFired', 'bulletStopped', 'structureStruck', 'bulletImpact']);
    for (const e of told) expect(e).not.toHaveProperty('soldier');
    expect(told).toMatchObject([{ item: gun }, { item: gun, material: 12 }, { material: 12 }, { item: gun }]);
  });
});

describe('what a hit tells the player (Soldier_Control.cc EVENT_SoldierGotHit, InternalDoMercBattleSound)', () => {
  it('gives the life of a soldier the squad sees, and only the voice and body of one out of sight', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    const seen = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.NORTH);
    const hidden = spawnSoldier(sim, 21, Team.ENEMY, gridNo(90, 90), Direction.NORTH);
    seen.visible = 1;
    hidden.visible = -1;
    hidden.battleSoundId = 2;
    for (const victim of [seen, hidden]) eventSoldierGotHit(sim.state, victim, 0, 5, 0, victim.direction, 0, merc, 0, AimShot.TORSO);
    const hits = sim.drainEvents().filter((e) => e.type === 'soldierHit');
    expect(hits[0]).toMatchObject({ soldier: seen.id, gridNo: seen.gridNo, conscious: true, life: seen.life, damage: expect.any(Number) });
    expect(hits[0]).not.toHaveProperty('unseen');
    expect(hits[1]).toMatchObject({ soldier: hidden.id, gridNo: hidden.gridNo, conscious: true, unseen: { voice: 'bad2', bodyType: 0 } });
    expect(hits[1]).not.toHaveProperty('life');
    expect(hits[1]).not.toHaveProperty('damage');
  });
});

describe('the fall of a leg hit (Soldier_Control.cc SoldierGotHitGunFire)', () => {
  it("tells every standing soldier a leg hit knocks over, one out of sight by his own name or his team's default (D16)", () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(70, 70), Direction.SOUTH);
    const seen = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.NORTH);
    const hidden = spawnSoldier(sim, 21, Team.ENEMY, gridNo(90, 90), Direction.NORTH);
    const named = spawnSoldier(sim, 22, Team.ENEMY, gridNo(95, 90), Direction.NORTH);
    seen.visible = Visible.SEEN;
    hidden.name = '';
    const gun = merc.inv[InvSlot.HAND]?.item ?? 0;
    for (const victim of [mate, seen, hidden, named])
      eventSoldierGotHit(sim.state, victim, gun, 5, 0, victim.direction, 0, merc, Special.LEG_FALLDOWN, AimShot.LEGS);
    expect(sim.drainEvents().filter((e) => e.type === 'knockedOver')).toEqual([
      { type: 'knockedOver', tick: 0, soldier: mate.id },
      { type: 'knockedOver', tick: 0, soldier: seen.id },
      { type: 'knockedOver', tick: 0, defaultName: 'enemy' },
      { type: 'knockedOver', tick: 0, name: 'S22' },
    ]);
  });

  it('tells nothing for a leg hit without the fall', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.SOUTH);
    const victim = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.NORTH);
    const gun = merc.inv[InvSlot.HAND]?.item ?? 0;
    eventSoldierGotHit(sim.state, victim, gun, 5, 0, victim.direction, 0, merc, Special.NONE, AimShot.LEGS);
    expect(sim.drainEvents().filter((e) => e.type === 'knockedOver')).toEqual([]);
  });
});

const PERCENT = 100;
const SURE_HIT = 0;
const NO_FLUKE = 25;
const PLAIN_ROLL = 0;
const FIVE_POINTS = 4;
const BEYOND_MESSY_DEATH = gridNo(80, 90);
const CRITS_OF_66: Readonly<Record<number, number>> = { [AimShot.HEAD]: 44, [AimShot.TORSO]: 66 };
const CRITS_OF_62_IN_THE_LEGS = 124;
const CRITICAL_ROLL_OF_33 = 32;
const CRITICAL_ROLL_OF_31 = 30;

function impactAt(location: number, draws: readonly number[], prepare: (target: Soldier, firer: Soldier) => void = () => {}) {
  const sim = newCombatSim(content);
  const firer = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const target = spawnSoldier(sim, 20, Team.ENEMY, BEYOND_MESSY_DEATH, Direction.NORTH);
  prepare(target, firer);
  const pre = new ScriptedStream(draws);
  Object.assign(sim.state, { pre });
  const impactIn = CRITS_OF_66[location] ?? CRITS_OF_62_IN_THE_LEGS;
  const impact = bulletImpact(sim.state, firer, target, location, impactIn, 0, Special.NONE);
  return { impact, target, pre };
}

function shotAtTheHead(sim: TacticalSim, shooter: Soldier, target: Soldier): SimEvent[] {
  const pre = sim.state.pre;
  Object.assign(sim.state, { pre: { int: (n: number) => (n === PERCENT ? SURE_HIT : pre.int(n)) } });
  shooter.aimShotLocation = AimShot.HEAD;
  shooter.oppList[target.id] = Opp.SEEN_CURRENTLY;
  expect(handleItem(sim.state, shooter, target.gridNo, 0, shooter.inv[InvSlot.HAND]?.item ?? 0)).toBe(ItemHandle.OK);
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 2000 && !events.some((e) => e.type === 'soldierHit'); tick++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  expect(events).toContainEqual(expect.objectContaining({ type: 'soldierHit', location: 'head' }));
  return events;
}

describe('the lines of a hit (Weapons.cc BulletImpact)', () => {
  it('costs a critical head hit wisdom, a critical torso hit dexterity or strength and a leg hit agility', () => {
    const head = impactAt(AimShot.HEAD, [NO_FLUKE, CRITICAL_ROLL_OF_33, FIVE_POINTS]);
    expect(head.impact).toEqual({ damage: 66, special: Special.NONE, statLoss: { stat: 'wisdom', points: 5 } });
    expect(head.target.stats.wisdom).toBe(65);
    expect(head.target.statDamage.wisdom).toBe(5);
    expect(head.pre.requested).toEqual([51, 33, 33]);
    expect(impactAt(AimShot.TORSO, [NO_FLUKE, CRITICAL_ROLL_OF_33, 0, 49]).impact.statLoss).toEqual({ stat: 'dexterity', points: 1 });
    expect(impactAt(AimShot.TORSO, [NO_FLUKE, CRITICAL_ROLL_OF_33, 0, 50]).impact.statLoss).toEqual({ stat: 'strength', points: 1 });
    expect(impactAt(AimShot.LEGS, [NO_FLUKE, CRITICAL_ROLL_OF_31, 0]).impact.statLoss).toEqual({ stat: 'agility', points: 1 });
    expect(impactAt(AimShot.LEGS, [NO_FLUKE, CRITICAL_ROLL_OF_31 - 1]).impact).not.toHaveProperty('statLoss');
  });

  it('tells a head hit that costs no wisdom, critical or not', () => {
    expect(impactAt(AimShot.HEAD, [NO_FLUKE, PLAIN_ROLL]).impact).toEqual({ damage: 66, special: Special.NONE, headHit: true });
    const witless = impactAt(AimShot.HEAD, [NO_FLUKE, CRITICAL_ROLL_OF_33, FIVE_POINTS], (target) =>
      Object.assign(target.stats, { wisdom: 1 }),
    );
    expect(witless.impact).toEqual({ damage: 66, special: Special.NONE, headHit: true });
    expect(witless.target.stats.wisdom).toBe(1);
    expect(impactAt(AimShot.TORSO, [NO_FLUKE, PLAIN_ROLL]).impact).not.toHaveProperty('headHit');
  });

  it("tells the head hit of a shot's first pellet but of no later one: BulletHitMerc counts the pellet after BulletImpact reads the count", () => {
    const buckshot = (pelletsBefore: number) => (target: Soldier, firer: Soldier) => {
      Object.assign(target, { numPelletsHitBy: pelletsBefore });
      Object.assign(firer.inv[InvSlot.HAND] ?? {}, { gunAmmoType: AmmoType.BUCKSHOT });
    };
    expect(impactAt(AimShot.HEAD, [NO_FLUKE, PLAIN_ROLL], buckshot(0)).impact).toMatchObject({ headHit: true });
    expect(impactAt(AimShot.HEAD, [NO_FLUKE, PLAIN_ROLL], buckshot(1)).impact).not.toHaveProperty('headHit');
  });

  it('tells the stat a critical hit costs only of a visible soldier with a name, as the original prints it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const target = spawnSoldier(sim, 20, Team.ENEMY, BEYOND_MESSY_DEATH, Direction.NORTH);
    const lost = { damage: 10, special: Special.NONE, statLoss: { stat: 'agility', points: 2 } } as const;
    target.visible = Visible.SEEN;
    tellCriticalHit(t, target, lost);
    target.visible = Visible.LIMBO;
    tellCriticalHit(t, target, lost);
    Object.assign(target, { visible: Visible.SEEN, team: Team.OUR, name: '' });
    tellCriticalHit(t, target, lost);
    expect(sim.drainEvents()).toEqual([expect.objectContaining({ type: 'statLost', soldier: 20, stat: 'agility', points: 2 })]);
  });

  it('names a soldier hit in the head when the squad sees him', () => {
    const sim = newCombatSim(content);
    const shooter = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 84), Direction.NORTH);
    target.visible = Visible.SEEN;
    const told = shotAtTheHead(sim, shooter, target).filter((e) => e.type === 'headHit');
    expect(told).toEqual([expect.objectContaining({ soldier: target.id })]);
  });

  it("tells the head hit of a soldier out of sight by his own name or his team's default, never by his id (D16)", () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(10, 10), Direction.SOUTH);
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
    const civilian = spawnSoldier(sim, 116, Team.CIV, gridNo(80, 84), Direction.NORTH);
    civilian.name = '';
    sim.state.inCombat = true;
    const told = shotAtTheHead(sim, shooter, civilian).filter((e) => e.type === 'headHit');
    expect(told).toEqual([{ type: 'headHit', tick: expect.any(Number), defaultName: 'civilian' }]);
    const named = spawnSoldier(sim, 117, Team.CIV, gridNo(84, 84), Direction.NORTH);
    const again = shotAtTheHead(sim, shooter, named).filter((e) => e.type === 'headHit');
    expect(again).toEqual([{ type: 'headHit', tick: expect.any(Number), name: 'S117' }]);
  });
});

const WINDOW_ROWS = [84, 87] as const;
const WINDOW_COLUMNS = Array.from({ length: 9 }, (_, k) => 76 + k);
const SHOOTER_AT = gridNo(80, 80);
const TARGET_AT = gridNo(80, 92);
const FIRST_SOLDIER_OF: Readonly<Record<number, number>> = { [Team.OUR]: 0, [Team.ENEMY]: 20, [Team.MILITIA]: 84 };
const MAX_FLIGHT_TICKS = 2000;

const rowOf = (g: number) => Math.trunc(g / WORLD_COLS);

function windowsAcrossTheLine(shooterTeam: number, inCombat: boolean) {
  const sim = newCombatSim(content, [], 3, new Set(), (world) => {
    for (const row of WINDOW_ROWS)
      for (const col of WINDOW_COLUMNS)
        world.structures.add(gridNo(col, row), 0, syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_LEFT));
  });
  const targetTeam = shooterTeam === Team.ENEMY ? Team.OUR : Team.ENEMY;
  const shooter = spawnSoldier(sim, FIRST_SOLDIER_OF[shooterTeam] ?? 0, shooterTeam, SHOOTER_AT, Direction.SOUTH, { marksmanship: 90 });
  const target = spawnSoldier(sim, FIRST_SOLDIER_OF[targetTeam] ?? 0, targetTeam, TARGET_AT, Direction.NORTH);
  sim.state.inCombat = inCombat;
  shooter.oppList[target.id] = Opp.SEEN_CURRENTLY;
  expect(handleItem(sim.state, shooter, target.gridNo, 0, shooter.inv[InvSlot.HAND]?.item ?? 0)).toBe(ItemHandle.OK);
  const events: SimEvent[] = [];
  let bullet: Bullet | undefined;
  const fly = (until: (b: Bullet) => boolean) => {
    for (let tick = 0; tick < MAX_FLIGHT_TICKS && !(bullet && until(bullet)); tick++) {
      sim.step();
      events.push(...sim.drainEvents());
      bullet ??= sim.state.bullets[0];
    }
  };
  return { sim, shooter, target, events, fly };
}

function passedBothWindowRows(events: readonly SimEvent[], target: number): boolean {
  return events.some(
    (e) =>
      (e.type === 'soldierHit' && e.soldier === target) ||
      ((e.type === 'bulletStopped' || e.type === 'bulletImpact') && rowOf(e.gridNo) > WINDOW_ROWS[1]),
  );
}

const locatedAt = (events: readonly SimEvent[]) => events.flatMap((e) => (e.type === 'bulletLocated' ? [e] : []));

describe('the stat a critical hit costs, in the profile (Weapons.cc BulletImpact; Campaign.cc ChangeStat)', () => {
  const MERC_PROFILE = 5;
  const ONE_POINT_OF_AGILITY = 50;

  function mercWithProfile() {
    const sim = newCombatSim(content);
    const firer = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
    const merc = spawnSoldier(sim, 0, Team.OUR, BEYOND_MESSY_DEATH, Direction.NORTH, { profile: MERC_PROFILE });
    const p = progressFor(MERC_PROFILE);
    p.stats.agility = merc.stats.agility;
    sim.state.profiles.set(MERC_PROFILE, p);
    Object.assign(sim.state, { pre: new ScriptedStream([NO_FLUKE, CRITICAL_ROLL_OF_31, FIVE_POINTS]) });
    return { sim, firer, merc, p };
  }

  it("keeps a merc's critical loss through his next gain in that stat: the profile's stat goes down with his, its delta too", () => {
    const { sim, firer, merc, p } = mercWithProfile();
    const impact = bulletImpact(sim.state, firer, merc, AimShot.LEGS, CRITS_OF_62_IN_THE_LEGS, 0, Special.NONE);
    expect(impact.statLoss).toEqual({ stat: 'agility', points: 5 });
    expect([merc.stats.agility, p.stats.agility, p.deltas.agility]).toEqual([65, 65, -5]);
    p.gains.agility = ONE_POINT_OF_AGILITY;
    processUpdateStats(sim.state, merc);
    expect([merc.stats.agility, p.stats.agility, p.deltas.agility]).toEqual([66, 66, -4]);
  });

  it('writes no profile for a soldier without one', () => {
    const { sim, firer, p } = mercWithProfile();
    const nobody = spawnSoldier(sim, 1, Team.OUR, BEYOND_MESSY_DEATH + 2, Direction.NORTH);
    expect(bulletImpact(sim.state, firer, nobody, AimShot.LEGS, CRITS_OF_62_IN_THE_LEGS, 0, Special.NONE).statLoss).toEqual({
      stat: 'agility',
      points: 5,
    });
    expect([nobody.stats.agility, p.stats.agility, p.deltas.agility]).toEqual([65, 70, 0]);
  });
});

describe('show misses at a window (Bullets.cc LocateBullet, LOS.cc MoveBullet)', () => {
  it("names the window our bullet passes first in combat, and only that one: fLocated is the bullet's", () => {
    const { shooter, target, events, fly } = windowsAcrossTheLine(Team.OUR, true);
    fly((b) => b.toDelete);
    expect(passedBothWindowRows(events, target.id)).toBe(true);
    expect(locatedAt(events)).toMatchObject([{ soldier: shooter.id }]);
    expect(rowOf(locatedAt(events)[0]?.gridNo ?? 0)).toBe(WINDOW_ROWS[0]);
  });

  it('follows the bullets of the friendly side, so militia ones too, never the enemy ones; an unseen shooter goes unnamed', () => {
    const militia = windowsAcrossTheLine(Team.MILITIA, true);
    militia.fly((b) => b.toDelete);
    expect(locatedAt(militia.events)).toMatchObject([{ gridNo: expect.any(Number) }]);
    expect(locatedAt(militia.events)[0]).not.toHaveProperty('soldier');
    const enemy = windowsAcrossTheLine(Team.ENEMY, true);
    enemy.fly((b) => b.toDelete);
    expect(passedBothWindowRows(enemy.events, enemy.target.id)).toBe(true);
    expect(locatedAt(enemy.events)).toEqual([]);
  });

  it('marks the bullet located at its first window out of combat too, so a fight starting in its flight sees no later window', () => {
    const { sim, target, events, fly } = windowsAcrossTheLine(Team.OUR, false);
    let flying: Bullet | undefined;
    fly((b) => {
      flying = b;
      return b.tileY > WINDOW_ROWS[0];
    });
    expect(flying?.tileY).toBeLessThan(WINDOW_ROWS[1]);
    expect(flying?.located).toBe(true);
    sim.state.inCombat = true;
    fly((b) => b.toDelete);
    expect(passedBothWindowRows(events, target.id)).toBe(true);
    expect(locatedAt(events)).toEqual([]);
  });
});

describe('missile trails (Bullets.cc AddMissileTrail)', () => {
  it('leaves a smoke trail every ten steps of a LAW rocket, leaving its random delay to the browser', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 60), Direction.SOUTH, { gun: 'ROCKET_LAUNCHER' });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 90) }).ok).toBe(true);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 3000 && !events.some((e) => e.type === 'explosion'); tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    const trails = events.flatMap((e) => (e.type === 'missileTrail' ? [e] : []));
    expect(trails.length).toBeGreaterThan(5);
    expect(trails.every((e) => e.trail === 'smoke' && e.delay === undefined)).toBe(true);
    const rows = trails.map((e) => Math.trunc(e.y / 10));
    expect(rows.slice(1).every((row, k) => row >= (rows[k] ?? row))).toBe(true);
  });
});
