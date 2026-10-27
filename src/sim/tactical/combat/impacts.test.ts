import { beforeAll, describe, expect, it, vi } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { SimEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { bulletViews } from '../world-view.ts';
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
