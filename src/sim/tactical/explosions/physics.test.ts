import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, explosivesBusy, objectOf, stepWithExplosives } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import type { SimEvent } from '../../events.ts';
import { minAPsToThrow } from '../combat/ap.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { SkillTrait, type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { HEIGHT_UNITS, stepThrownObjects, toGridNo } from './physics.ts';
import { ThrowAction } from './state.ts';
import { calcMaxTossRange, calcThrownChanceToHit, releaseThrow } from './throwing.ts';
import { calculateLaunchItemParamsForThrow, predictLanding, randomGridFromRadius } from './trajectory.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const THROWER = gridNo(80, 80);

function simWithWallRow(row: number): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (let x = 76; x <= 84; x++)
      structures.add(gridNo(x, row), 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT, { armour: 12 }));
  });
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

interface Landing {
  readonly gridNo: number;
  readonly events: SimEvent[];
}

function grenadier(sim: TacticalSim, strength = 70): Soldier {
  const s = spawnSoldier(sim, 0, Team.OUR, THROWER, Direction.SOUTH);
  s.stats.strength = strength;
  s.inv[InvSlot.HAND] = objectOf(sim.state, 'HAND_GRENADE');
  return s;
}

function throwAndLand(sim: TacticalSim, s: Soldier, target: number, missBy = 0): Landing {
  const t = sim.state;
  const grenade = s.inv[InvSlot.HAND];
  if (!grenade) throw new Error('no grenade');
  calculateLaunchItemParamsForThrow(t, s, target, 0, 0, grenade, missBy, ThrowAction.ARM_ITEM, null);
  t.turn.attackBusyCount++;
  const o = releaseThrow(t, s);
  if (!o) throw new Error('nothing thrown');
  let landed = o.gridNo;
  const events: SimEvent[] = [];
  while (t.explosives.objects.includes(o)) {
    stepWithExplosives(sim);
    if (o.alive || t.explosives.objects.includes(o)) landed = toGridNo(o.position);
    events.push(...sim.drainEvents());
  }
  return { gridNo: landed, events };
}

describe('throw parameters', () => {
  it('computes the toss range from strength, weight, breath and the throwing trait', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const grenade = t.content.items.byName.get('HAND_GRENADE')?.index ?? 0;
    const rock = t.content.items.byName.get('ROCK')?.index ?? 0;
    const glGrenade = t.content.items.byName.get('GL_HE_GRENADE')?.index ?? 0;
    expect(calcMaxTossRange(t, s, grenade, true)).toBe(22);
    expect(calcMaxTossRange(t, s, rock, true)).toBe(9);
    expect(calcMaxTossRange(t, s, glGrenade, true)).toBe(50);
    s.breath = 50;
    expect(calcMaxTossRange(t, s, grenade, true)).toBe(17);
    s.breath = 100;
    s.skillTrait1 = SkillTrait.THROWING;
    expect(calcMaxTossRange(t, s, grenade, true)).toBe(24);
  });

  it('charges the target change and the aim formula with raw dexterity', () => {
    const sim = newCombatSim(content);
    const s = grenadier(sim);
    expect(minAPsToThrow(sim.state, s, gridNo(80, 88))).toBe(13);
    s.lastTarget = gridNo(80, 88);
    expect(minAPsToThrow(sim.state, s, gridNo(80, 88))).toBe(12);
  });

  it('rates a thrown attack by dexterity, marksmanship and half the toss range', () => {
    const sim = newCombatSim(content);
    const s = grenadier(sim);
    expect(calcThrownChanceToHit(sim.state, s, gridNo(80, 88), 0)).toBe(83);
    expect(calcThrownChanceToHit(sim.state, s, gridNo(80, 88), 2)).toBe(99);
    expect(calcThrownChanceToHit(sim.state, s, gridNo(80, 98), 0)).toBe(39);
    expect(calcThrownChanceToHit(sim.state, s, gridNo(80, 110), 0)).toBe(1);
  });
});

describe('thrown object physics', () => {
  it('lands an exact throw on the target tile and blows up there', () => {
    for (const target of [gridNo(80, 83), gridNo(80, 88), gridNo(80, 95), gridNo(86, 86), gridNo(72, 84)]) {
      const sim = newCombatSim(content);
      const s = grenadier(sim);
      const landing = throwAndLand(sim, s, target);
      expect(landing.gridNo).toBe(target);
      expect(landing.events.find((e) => e.type === 'explosion')).toMatchObject({ gridNo: target, level: 0, owner: 0 });
    }
  });

  it('falls short of a target beyond the toss range', () => {
    const sim = newCombatSim(content);
    const s = grenadier(sim, 10);
    expect(calcMaxTossRange(sim.state, s, s.inv[InvSlot.HAND]?.item ?? 0, true)).toBe(12);
    const landing = throwAndLand(sim, s, gridNo(80, 100));
    const tilesThrown = Math.trunc(landing.gridNo / 160) - 80;
    expect(landing.gridNo % 160).toBe(80);
    expect(tilesThrown).toBeGreaterThanOrEqual(11);
    expect(tilesThrown).toBeLessThanOrEqual(13);
  });

  it('bounces a low lob off a wall but sends a long throw over it', () => {
    const wallRow = 82;
    const lob = simWithWallRow(wallRow);
    expect(Math.trunc(throwAndLand(lob, grenadier(lob), gridNo(80, 83)).gridNo / 160)).toBeLessThan(wallRow);
    const long = simWithWallRow(wallRow);
    expect(throwAndLand(long, grenadier(long), gridNo(80, 88)).gridNo).toBe(gridNo(80, 88));
  });

  it('runs the physics on a 20 ms cadence', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    calculateLaunchItemParamsForThrow(t, s, gridNo(80, 88), 0, 0, grenade, 0, ThrowAction.ARM_ITEM, null);
    const o = releaseThrow(t, s);
    if (!o) throw new Error('nothing thrown');
    const lifeSpans: number[] = [];
    for (let tick = 0; tick < 8; tick++) {
      stepThrownObjects(t);
      lifeSpans.push(o.lifeSpan);
      t.clockMs += 5;
    }
    expect(lifeSpans.map((v) => Math.round(v * 10))).toEqual([18, 18, 18, 18, 36, 36, 36, 36]);
  });

  it('scatters a missed throw with PreRandom inside the miss square', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const target = gridNo(80, 90);
    for (let k = 0; k < 20; k++) {
      const g = randomGridFromRadius(t, target, 2, 2);
      const dx = (g % 160) - 80;
      const dy = Math.trunc(g / 160) - 90;
      expect(Math.abs(dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      expect(g).not.toBe(target);
    }
    for (let k = 0; k < 20; k++) {
      const g = randomGridFromRadius(t, target, 3, 4);
      expect(Math.abs((g % 160) - 80)).toBe(3);
      expect(Math.abs(Math.trunc(g / 160) - 90)).toBe(3);
    }
  });

  it('draws only PreRandom for the miss and the landing of a throw', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    const params = countDraws(t, () =>
      calculateLaunchItemParamsForThrow(t, s, gridNo(80, 90), 0, 0, grenade, 0, ThrowAction.ARM_ITEM, null),
    );
    expect(params).toEqual({ pre: 0, main: 0 });
    t.turn.attackBusyCount++;
    const o = releaseThrow(t, s);
    if (!o) throw new Error('nothing thrown');
    let flight: { pre: number; main: number } = { pre: 0, main: 0 };
    let landing: { pre: number; main: number } = { pre: 0, main: 0 };
    while (t.explosives.objects.includes(o)) {
      const alive = o.alive;
      const draws = countDraws(t, () => stepThrownObjects(t));
      if (alive) flight = { pre: flight.pre + draws.pre, main: flight.main + draws.main };
      else landing = draws;
      t.clockMs += 5;
    }
    expect(flight).toEqual({ pre: 0, main: 0 });
    expect(landing).toEqual({ pre: 3, main: 0 });
    expect(explosivesBusy(t)).toBe(true);
  });
});

describe('landing prediction for the AI', () => {
  it('reports a clean throw at a standing target as getting through', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const target = gridNo(80, 88);
    spawnSoldier(sim, 20, Team.ENEMY, target, Direction.NORTH);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    const before = { rng: t.rng.state(), pre: t.pre.state() };
    const prediction = predictLanding(t, s, grenade, target, 0, true);
    expect(prediction).toEqual({ ok: true, gridNo: target, level: 0 });
    expect({ rng: t.rng.state(), pre: t.pre.state() }).toEqual(before);
    expect(t.explosives.objects).toEqual([]);
  });

  it('fails an open-ground throw because only structure hits record the end position', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    expect(predictLanding(t, s, grenade, gridNo(80, 88), 0, true)).toEqual({ ok: false, gridNo: 0, level: 0 });
    expect(HEIGHT_UNITS).toBe(256);
  });
});
