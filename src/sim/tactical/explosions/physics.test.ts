import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, explosivesBusy, itemId, objectOf, stepWithExplosives } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { RestrictedScroll } from '../../../content/world/render-bounds.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { SimEvent } from '../../events.ts';
import { attachObject, createItem } from '../../items/object.ts';
import { minAPsToThrow } from '../combat/ap.ts';
import { WeaponMode } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { SkillTrait, type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { bulletViews } from '../world-view.ts';
import { Collision, checkForCollision, HEIGHT_UNITS, stepThrownObjects, toGridNo } from './physics.ts';
import { ThrowAction } from './state.ts';
import { calcMaxTossRange, calcThrownChanceToHit, releaseThrow } from './throwing.ts';
import {
  calculateLaunchItemParamsForThrow,
  calculateObjectTrajectory,
  launchItemBasicParams,
  predictLanding,
  randomGridFromRadius,
} from './trajectory.ts';
import { vec3 } from './vec3.ts';

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

const everyoneShown = () => true;
const nobodyShown = () => false;
const firstSeenAtZero = () => 0;

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

describe("the original's quirks in the thrown chance to hit", () => {
  it("rates an underslung launcher by the rifle's status, not its own", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, THROWER, Direction.SOUTH, { gun: 'C7' });
    const rifle = s.inv[InvSlot.HAND];
    if (!rifle) throw new Error('no rifle');
    const launcher = createItem(t.content.items, itemId(t, 'UNDER_GLAUNCHER'), 100);
    expect(attachObject(t.content.items, rifle, launcher)).toBe(true);
    expect(attachObject(t.content.items, rifle, objectOf(t, 'GL_HE_GRENADE'))).toBe(true);
    s.weaponMode = WeaponMode.ATTACHED;
    const target = gridNo(80, 100);
    const chanceWith = (rifleStatus: number, launcherStatus: number) => {
      rifle.status[0] = rifleStatus;
      const slot = rifle.attachments.find((a) => a.item === itemId(t, 'UNDER_GLAUNCHER'));
      if (slot) slot.status = launcherStatus;
      return calcThrownChanceToHit(t, s, target, 0);
    };
    const sound = chanceWith(100, 100);
    expect(chanceWith(100, 20)).toBe(sound);
    expect(chanceWith(40, 100)).toBeLessThan(sound);
  });

  it('wraps a big wound penalty around as a signed byte, so a dying expert throws better', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    Object.assign(s.stats, { dexterity: 100, marksmanship: 100, experience: 1 });
    s.skillTrait1 = SkillTrait.THROWING;
    s.skillTrait2 = SkillTrait.THROWING;
    const target = gridNo(80, 81);
    s.lastTarget = target;
    const chanceAtLife = (life: number) => {
      s.life = life;
      s.bleeding = s.lifeMax - life;
      return calcThrownChanceToHit(t, s, target, 4);
    };
    expect(chanceAtLife(5)).toBeGreaterThan(chanceAtLife(10));
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

  it('tells where the blast is drawn and at what pace, and ripples where a grenade falls in water', () => {
    const target = gridNo(80, 88);
    const dry = throwAndLand(newCombatSim(content), grenadier(newCombatSim(content)), target);
    const blast = dry.events.find((e) => e.type === 'explosion');
    if (blast?.type !== 'explosion') throw new Error('no explosion');
    expect(blast).toMatchObject({ z: 0, animation: 'BLAST_1', delay: content.explosions.animations.get('BLAST_1')?.blastSpeed });
    expect([Math.trunc((blast.x ?? 0) / 10), Math.trunc((blast.y ?? 0) / 10)]).toEqual([80, 88]);
    expect(dry.events.filter((e) => e.type === 'thrownImpact').length).toBeGreaterThan(0);
    const mortarSim = newCombatSim(content);
    const mortarMan = grenadier(mortarSim);
    mortarMan.inv[InvSlot.HAND] = objectOf(mortarSim.state, 'MORTAR_SHELL');
    const whistles = throwAndLand(mortarSim, mortarMan, target).events.flatMap((e) => (e.type === 'mortarWhistle' ? [e.sounding] : []));
    expect(whistles).toEqual([true, false]);
    const sim = newCombatSim(content);
    sim.state.world.terrain[target] = Terrain.DEEP_WATER;
    const wet = throwAndLand(sim, grenadier(sim), target);
    expect(wet.events.find((e) => e.type === 'waterRipple')).toMatchObject({ gridNo: target });
  });

  it('shows a thrown grenade in flight by its item, high on the way and on the ground at the end', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = grenadier(sim);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    calculateLaunchItemParamsForThrow(t, s, gridNo(80, 90), 0, 0, grenade, 0, ThrowAction.ARM_ITEM, null);
    t.turn.attackBusyCount++;
    const o = releaseThrow(t, s);
    const heights: number[] = [];
    while (o && t.explosives.objects.includes(o)) {
      stepWithExplosives(sim);
      const [flying] = bulletViews(t, everyoneShown, firstSeenAtZero);
      if (flying) {
        expect(flying.item).toBe('HAND_GRENADE');
        expect(bulletViews(t, nobodyShown, firstSeenAtZero)).toEqual([]);
        heights.push(flying.z);
      }
    }
    expect(heights.length).toBeGreaterThan(5);
    expect(Math.max(...heights)).toBeGreaterThan(heights.at(-1) ?? 0);
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

describe('the force search behind throws', () => {
  it('ignores structures and draws nothing, so its results can be remembered per item table', () => {
    const open = newCombatSim(content);
    const walled = simWithWallRow(84);
    const flights = [open, walled].map((sim) => {
      const t = sim.state;
      const grenade = objectOf(t, 'HAND_GRENADE');
      const before = { rng: t.rng.state(), pre: t.pre.state() };
      const range = calculateObjectTrajectory(t, 0, grenade, vec3(805, 805, 191), vec3(0, 500, 350));
      expect({ rng: t.rng.state(), pre: t.pre.state() }).toEqual(before);
      expect(t.explosives.objects).toEqual([]);
      return range;
    });
    expect(flights[0]).toBeGreaterThan(40);
    expect(flights[1]).toBe(flights[0]);
  });

  it("caps every throw in a basement at the thrower's feet: the probe for the force cap starts off its smaller visible map", () => {
    const target = gridNo(80, 88);
    const surface = newCombatSim(content);
    expect(throwAndLand(surface, grenadier(surface), target).gridNo).toBe(target);
    const basement = newCombatSim(content);
    const basementMap = basement.state.world.map;
    if (!basementMap) throw new Error('no map');
    Object.assign(basementMap, { info: { restrictedScrollId: RestrictedScroll.BASEMENT } });
    expect(throwAndLand(basement, grenadier(basement), target).gridNo).toBe(THROWER);
    const surfaceAgain = newCombatSim(content);
    expect(throwAndLand(surfaceAgain, grenadier(surfaceAgain), target).gridNo).toBe(target);
  });
});

type Underground = 'caves' | 'basement';

function underground(sim: TacticalSim, kind: Underground): TacticalSim {
  const map = sim.state.world.map;
  if (!map) throw new Error('no map');
  Object.assign(map, { ambient: { basement: kind === 'basement', caves: kind === 'caves', lightLevel: 10 } });
  return sim;
}

describe('throws underground (caves and basements)', () => {
  const NEAR = gridNo(80, 88);
  const BEYOND_REACH = gridNo(80, 130);

  function paramsFrom(sim: TacticalSim, target: number) {
    const s = grenadier(sim);
    const grenade = s.inv[InvSlot.HAND];
    if (!grenade) throw new Error('no grenade');
    return launchItemBasicParams(sim.state, s, grenade, target, 0, 0, true);
  }

  it.each<Underground>(['caves', 'basement'])(
    'throws in %s as from under a roof: the flat indoor angle and twice the force cap',
    (kind) => {
      for (const target of [NEAR, BEYOND_REACH]) {
        const open = paramsFrom(newCombatSim(content), target);
        const roofed = paramsFrom(newCombatSim(content, [], 3, new Set([THROWER])), target);
        const below = paramsFrom(underground(newCombatSim(content), kind), target);
        expect(below).toEqual(roofed);
        expect(below.degrees).toBeLessThan(open.degrees);
      }
      const open = paramsFrom(newCombatSim(content), BEYOND_REACH);
      expect(paramsFrom(underground(newCombatSim(content), kind), BEYOND_REACH).force).toBe(open.force * 2);
    },
  );

  it.each<Underground>(['caves', 'basement'])(
    'stops an object crossing one storey up under the ceiling of %s, before a wall on the tile, where open ground lets it pass',
    (kind) => {
      const wall = gridNo(80, 84);
      const crossings = (sim: TacticalSim, g: number) => {
        const x = (g % 160) * 10 + 5;
        const y = Math.trunc(g / 160) * 10 + 5;
        const falling = checkForCollision(sim.state, x, y, HEIGHT_UNITS - 2, 0, 0, -4).code;
        const rising = checkForCollision(sim.state, x, y, HEIGHT_UNITS + 2, 0, 0, 4).code;
        return [falling, rising];
      };
      const open = newCombatSim(content, [wall]);
      expect(crossings(open, THROWER)).toEqual([Collision.NONE, Collision.NONE]);
      expect(crossings(open, wall)).toEqual([Collision.WALL_NORTHEAST, Collision.NONE]);
      const below = underground(newCombatSim(content, [wall]), kind);
      expect(crossings(below, THROWER)).toEqual([Collision.ROOF, Collision.INTERIOR_ROOF]);
      expect(crossings(below, wall)).toEqual([Collision.ROOF, Collision.INTERIOR_ROOF]);
    },
  );
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
