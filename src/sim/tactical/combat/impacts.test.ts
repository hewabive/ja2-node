import { beforeAll, describe, expect, it, vi } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { SimEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { bulletViews } from '../world-view.ts';
import { handleItem, ItemHandle } from './attack.ts';
import type { Bullet } from './bullets.ts';
import { eventSoldierGotHit } from './hit.ts';
import { AimShot } from './types.ts';

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
