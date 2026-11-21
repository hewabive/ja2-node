import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { type SyntheticWorld, syntheticStructure } from '../../../content/world/synthetic.ts';
import type { SimEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { ZPos } from '../perception/los.ts';
import { NoiseKind } from '../perception/noise.ts';
import { setSoldierHeight } from '../roofs.ts';
import type { Soldier } from '../soldier.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { handleItem } from './attack.ts';
import { fireBulletGivenTarget } from './bullets.ts';
import { calculateSoldierZPos, locationChanceTargetZ, targetWorldZ } from './positions.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const RAISED_LAND_PIXELS = 80;
const RAISED_LAND_UNITS = 409;
const ROOF_STANDING_HEIGHT = 58;
const WALL_HEIGHT_UNITS = 256;
const SHOOTER = gridNo(80, 60);
const TARGET = gridNo(80, 70);
const EXACT_AIM = 10;
const FLIGHT_TICKS = 3000;
const centreX = (g: number) => (g % 160) * 10 + 5;
const centreY = (g: number) => Math.trunc(g / 160) * 10 + 5;
const raiseEverything = (world: SyntheticWorld) => world.level.heights.fill(RAISED_LAND_PIXELS);
const rowsOf = (from: number, to: number, column = 80) => Array.from({ length: to - from + 1 }, (_, k) => gridNo(column, from + k));

function shooter(sim: TacticalSim, gun = 'GLOCK_17', at = SHOOTER): Soldier {
  const s = spawnSoldier(sim, 0, Team.OUR, at, Direction.SOUTH, { gun });
  s.attackingWeapon = s.inv[InvSlot.HAND]?.item ?? 0;
  s.attackingHand = InvSlot.HAND;
  return s;
}

function fly(sim: TacticalSim, s: Soldier, target: number, endZ: number): SimEvent[] {
  fireBulletGivenTarget(sim.state, s, centreX(target), centreY(target), endZ, s.attackingWeapon, EXACT_AIM, false, false);
  const events: SimEvent[] = [];
  for (let tick = 0; tick < FLIGHT_TICKS && (sim.state.bullets.length > 0 || events.length === 0); tick++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function stopOf(events: readonly SimEvent[]) {
  const stop = events.find((e) => e.type === 'bulletStopped');
  if (stop?.type !== 'bulletStopped') throw new Error('the bullet never stopped');
  return stop;
}

describe('the roof check of a shot (LOS.cc:3342-3363 FireBulletGivenTarget, one storey of absolute height)', () => {
  it('never checks the roof on a shot between two roofs: a bullet that drops past its target falls through the roof to the floor', () => {
    const roofed = new Set(rowsOf(70, 100));
    const sim = newCombatSim(content, [], 3, roofed);
    const s = shooter(sim);
    setSoldierHeight(sim.state, s, ROOF_STANDING_HEIGHT);
    expect(calculateSoldierZPos(sim.state, s, ZPos.FIRING)).toBeGreaterThan(WALL_HEIGHT_UNITS);
    const stop = stopOf(fly(sim, s, TARGET, WALL_HEIGHT_UNITS + 4));
    expect(stop.reason).toBe('ground');
    expect(roofed.has(stop.gridNo)).toBe(true);
  });

  it('checks it on a shot from the ground up at a roof, which stops at the roof it crosses', () => {
    const roofed = new Set(rowsOf(65, 100));
    const sim = newCombatSim(content, [], 3, roofed);
    const s = shooter(sim);
    expect(stopOf(fly(sim, s, gridNo(80, 90), WALL_HEIGHT_UNITS + 64)).reason).toBe('roof');
  });

  it('never checks it on raised land, where both ends of a shot are above one storey: a shot up at a roof goes through it', () => {
    const roofed = new Set(rowsOf(65, 100));
    const sim = newCombatSim(content, [], 3, roofed, raiseEverything);
    const s = shooter(sim);
    const stop = stopOf(fly(sim, s, gridNo(80, 90), RAISED_LAND_UNITS + WALL_HEIGHT_UNITS + 64));
    expect(stop.reason).not.toBe('roof');
  });
});

describe('a rising bullet on raised land (LOS.cc:3547, :4247 MoveBullet, PROFILE_Z_SIZE * 2 of absolute height)', () => {
  it('leaves the world at once at two storeys of absolute height, where on flat land it flies on for tiles', () => {
    const rising = (heights?: (world: SyntheticWorld) => void) => {
      const sim = newCombatSim(content, [], 3, new Set(), heights);
      const s = shooter(sim);
      const startZ = calculateSoldierZPos(sim.state, s, ZPos.FIRING);
      return stopOf(fly(sim, s, TARGET, startZ + 128));
    };
    const rowsFlown = (stop: { gridNo: number }) => Math.trunc(stop.gridNo / 160) - Math.trunc(SHOOTER / 160);
    const raised = rising(raiseEverything);
    expect(raised.reason).toBe('offMap');
    expect(rowsFlown(raised)).toBeLessThanOrEqual(1);
    expect(rowsFlown(rising())).toBeGreaterThan(5);
  });
});

describe('the noise of a bullet impact (Weapons.cc:1576 StructureHit, 50 px of absolute height)', () => {
  it('is made on the roof level wherever a bullet stops above 50 px, so on raised land every impact is heard up there', () => {
    const impactLevel = (heights?: (world: SyntheticWorld) => void) => {
      const sim = newCombatSim(content, [], 3, new Set(), heights);
      const s = shooter(sim);
      const t = sim.state;
      t.turn.attackBusyCount = 1;
      const land = heights ? RAISED_LAND_UNITS : 0;
      fireBulletGivenTarget(t, s, centreX(TARGET), centreY(TARGET), land + 1, s.attackingWeapon, EXACT_AIM, false, false);
      for (let tick = 0; tick < FLIGHT_TICKS && !sim.drainEvents().some((e) => e.type === 'bulletStopped'); tick++) sim.step();
      return t.turn.deferredNoises.find((n) => n.kind === NoiseKind.BULLET_IMPACT)?.level;
    };
    expect(impactLevel()).toBe(0);
    expect(impactLevel(raiseEverything)).toBe(1);
  });
});

describe('a missile or spit that stops at a wall (Weapons.cc:1581-1608, :1618 StructureHit)', () => {
  const WALL = gridNo(80, 70);
  const NORTH_OF_WALL = gridNo(80, 60);
  const SOUTH_OF_WALL = gridNo(80, 80);
  const EAST_OF_WALL = gridNo(90, 70);
  const WEST_OF_WALL = gridNo(70, 70);

  function struckAt(from: number, toward: number, gun: string, wanted: SimEvent['type']): number[] {
    const sim = newCombatSim(content, [WALL]);
    const s = shooter(sim, gun, from);
    const hand = s.inv[InvSlot.HAND];
    if (gun.includes('SPIT') && hand) hand.gunAmmoType = AmmoType.MONSTER;
    const events = fly(sim, s, toward, calculateSoldierZPos(sim.state, s, ZPos.FIRING));
    return events.flatMap((e) => (e.type === wanted && 'gridNo' in e ? [e.gridNo] : []));
  }

  it('blows a LAW rocket up on the tile of the wall from whichever side it comes', () => {
    for (const [from, toward] of [
      [NORTH_OF_WALL, SOUTH_OF_WALL],
      [SOUTH_OF_WALL, NORTH_OF_WALL],
      [EAST_OF_WALL, WEST_OF_WALL],
      [WEST_OF_WALL, EAST_OF_WALL],
    ] as const) {
      expect(struckAt(from, toward, 'ROCKET_LAUNCHER', 'explosion')[0]).toBe(WALL);
    }
  });

  it("spreads a creature's spit on the tile of the wall from whichever side it comes", () => {
    for (const [from, toward] of [
      [NORTH_OF_WALL, SOUTH_OF_WALL],
      [SOUTH_OF_WALL, NORTH_OF_WALL],
      [EAST_OF_WALL, WEST_OF_WALL],
      [WEST_OF_WALL, EAST_OF_WALL],
    ] as const) {
      expect(struckAt(from, toward, 'CREATURE_YOUNG_MALE_SPIT', 'creatureGas')[0]).toBe(WALL);
    }
  });
});

describe('the height a shot at a tile aims at (Structure.cc:1041 GetStructureTargetHeight)', () => {
  const DOOR_TILE = gridNo(80, 70);
  const ROOF_TILE = gridNo(82, 70);
  const cubeCentre = (cube: number) => (cube - 0.5) * 64;

  function world() {
    const sim = newCombatSim(content, [], 3, new Set([ROOF_TILE, DOOR_TILE]), (w) => {
      w.structures.add(DOOR_TILE, 0, syntheticStructure(StructureFlags.DOOR, Orientation.OUTSIDE_RIGHT, { height: 4 }));
    });
    return sim.state;
  }

  it('counts the roof under an empty roof tile, so a shot at it aims at the roof itself', () => {
    const t = world();
    expect(targetWorldZ(t, ROOF_TILE, 1, 0)).toBe(cubeCentre(1 + 4));
    expect(locationChanceTargetZ(t, ROOF_TILE, 1, 0)).toBe(cubeCentre(1 + 4));
  });

  it('takes a door at three cubes on either level, one cube lower for the shot than for its chance to get through', () => {
    const t = world();
    expect(locationChanceTargetZ(t, DOOR_TILE, 0, 0)).toBe(cubeCentre(3));
    expect(targetWorldZ(t, DOOR_TILE, 0, 0)).toBe(cubeCentre(2));
    expect(locationChanceTargetZ(t, DOOR_TILE, 1, 0)).toBe(cubeCentre(3 + 4));
    expect(targetWorldZ(t, DOOR_TILE, 1, 0)).toBe(cubeCentre(2 + 4));
  });
});

describe('the target level of an attack not ordered from the interface (Handle_Items.cc:188, :392 HandleItem)', () => {
  it('keeps the level of his last target: only an order from the interface sets it', () => {
    const sim = newCombatSim(content);
    const s = shooter(sim);
    s.targetLevel = 0;
    handleItem(sim.state, s, TARGET, 1, s.attackingWeapon);
    expect(s.targetLevel).toBe(0);
    handleItem(sim.state, s, TARGET, 1, s.attackingWeapon, true);
    expect(s.targetLevel).toBe(1);
  });
});
