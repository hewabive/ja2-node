import { beforeAll, describe, expect, it } from 'vitest';
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

describe('missile trails (Bullets.cc AddMissileTrail)', () => {
  it('leaves a smoke trail every ten steps of a LAW rocket, each drawing its delay from Random', () => {
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
    expect(trails.every((e) => e.trail === 'smoke' && e.delay >= 100 && e.delay < 200)).toBe(true);
    expect(new Set(trails.map((e) => e.delay)).size).toBeGreaterThan(1);
    const rows = trails.map((e) => Math.trunc(e.y / 10));
    expect(rows.slice(1).every((row, k) => row >= (rows[k] ?? row))).toBe(true);
  });
});
