import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, gridX, gridY, pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { i16, idiv } from '../../../core/int.ts';
import { createItem } from '../../items/object.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import { soldierToLocationChanceToGetThrough } from '../combat/bullets.ts';
import { AiMorale } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { lightSetBaseLevel, lightSpriteCreate, lightSpritePosition, lightSpritePower, lightTrueLevel } from '../lighting/lighting.ts';
import { setSoldierPosition } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { calcActionPoints } from '../points.ts';
import { AlertStatus, Attitude, createSoldier, NOWHERE, Orders, type Soldier, SoldierClass, Team } from '../soldier.ts';
import { registerSoldier, type TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { calcPercentBetter, findBestNearbyCover, findNearbyDarkerSpot, findSpotMaxDistFromOpponents, inLightAtNight } from './cover.ts';
import { calcManThreatValue, calcMorale, rangeChangeDesire } from './morale.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const WALL_ROW = 84;

interface SpawnOptions {
  readonly id: number;
  readonly team: number;
  readonly at: number;
  readonly direction?: number;
  readonly experience?: number;
  readonly armed?: boolean;
  readonly soldierClass?: number;
}

function newSim(walls: readonly number[] = []): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of walls) structures.add(g, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT, { armour: 12 }));
  });
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 7);
}

function spawn(t: TacticalState, o: SpawnOptions): Soldier {
  const s = createSoldier({
    id: o.id,
    team: o.team,
    name: `S${o.id}`,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: {
      agility: 70,
      dexterity: 70,
      strength: 70,
      wisdom: 70,
      leadership: 50,
      marksmanship: 70,
      mechanical: 30,
      explosives: 30,
      medical: 30,
      experience: o.experience ?? 3,
    },
    life: 80,
    gridNo: o.at,
    direction: o.direction ?? Direction.SOUTH,
    state: states(content.animations).STANDING,
    soldierClass: o.soldierClass ?? SoldierClass.NONE,
    ai: { attitude: Attitude.CUNNINGSOLO },
  });
  if (o.armed !== false) s.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
  registerSoldier(t, s);
  setSoldierPosition(t, s, o.at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  s.actionPoints = calcActionPoints(content, s);
  return s;
}

function sees(viewer: Soldier, seen: Soldier): void {
  viewer.oppList[seen.id] = Opp.SEEN_CURRENTLY;
  viewer.lastKnownOpp[seen.id] = seen.gridNo;
  viewer.ai.oppCount = 1;
  viewer.ai.alertStatus = AlertStatus.BLACK;
}

describe('calcMorale', () => {
  it('makes an enemy soldier without a usable weapon hopeless', () => {
    const t = newSim().state;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80), armed: false });
    const merc = spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 86) });
    sees(guard, merc);
    expect(calcMorale(t, guard)).toBe(AiMorale.HOPELESS);
  });

  it('weighs the threat of a seen opponent against the threat the soldier poses to him', () => {
    const t = newSim().state;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80), soldierClass: SoldierClass.ARMY });
    const merc = spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 86), direction: Direction.NORTH, experience: 8 });
    sees(guard, merc);
    guard.ai.underFire = 1;
    guard.life = 50;
    guard.breath = 50;
    const theirs = i16(idiv(100 * calcManThreatValue(t, merc, guard.gridNo, false, guard), 100));
    const mine = i16(idiv(100 * calcManThreatValue(t, guard, merc.gridNo, false, guard), 100));
    const odds = i16(idiv(100 * idiv(theirs * mine, theirs), theirs));
    expect(odds).toBeGreaterThan(50);
    expect(odds).toBeLessThanOrEqual(150);
    expect(calcMorale(t, guard)).toBe(AiMorale.NORMAL);
    guard.life = 30;
    guard.breath = 30;
    expect(calcMorale(t, guard)).toBe(AiMorale.HOPELESS);
    guard.ai.attitude = Attitude.BRAVESOLO;
    expect(calcMorale(t, guard)).toBe(AiMorale.NORMAL);
  });

  it('adds the facing bonus and the experience, AP, health and weapon terms to the threat value', () => {
    const t = newSim().state;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80) });
    const merc = spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 86), direction: Direction.NORTH, experience: 8 });
    const deadliness = content.items.byName.get('GLOCK_17')?.weapon?.deadliness ?? 0;
    const base = 8 + calcActionPoints(content, merc) + idiv(merc.actionPoints, 2) + 8 + 14 + deadliness;
    expect(calcManThreatValue(t, merc, NOWHERE, false, guard)).toBe(base);
    expect(calcManThreatValue(t, merc, guard.gridNo, false, guard)).toBe(base + idiv(base, 20));
    merc.lastTarget = guard.gridNo;
    expect(calcManThreatValue(t, merc, guard.gridNo, false, guard)).toBe(base + idiv(base, 10));
  });

  it('turns morale and attitude into a range change desire', () => {
    const t = newSim().state;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80) });
    guard.ai.morale = AiMorale.FEARLESS;
    guard.ai.attitude = Attitude.AGGRESSIVE;
    expect(rangeChangeDesire(t, guard)).toBe(4);
    t.turn.consNumTurnsWeHaventSeenButEnemyDoes = 2;
    expect(rangeChangeDesire(t, guard)).toBe(6);
  });
});

describe('findBestNearbyCover', () => {
  it('moves an outgunned soldier behind a wall that blocks the enemy line of fire', () => {
    const walls = Array.from({ length: 9 }, (_, k) => gridNo(76 + k, WALL_ROW));
    const sim = newSim(walls);
    const t = sim.state;
    t.inCombat = true;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(90, 81), soldierClass: SoldierClass.ARMY });
    const merc = spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 88), direction: Direction.NORTHEAST, experience: 8 });
    sees(guard, merc);
    guard.ai.morale = AiMorale.WORRIED;
    guard.actionPoints = 10;
    expect(soldierToLocationChanceToGetThrough(t, merc, guard.gridNo, 0, 3, guard)).toBeGreaterThan(0);
    expect(soldierToLocationChanceToGetThrough(t, guard, merc.gridNo, 0, 3, merc)).toBeGreaterThan(0);
    const before = { gridNo: guard.gridNo, x: guard.x, y: guard.y, mercGrid: merc.gridNo };
    const cover = findBestNearbyCover(t, guard, guard.ai.morale);
    expect(cover.gridNo).not.toBe(NOWHERE);
    expect(cover.percentBetter).toBeGreaterThanOrEqual(5);
    expect(cover.percentBetter).toBeLessThan(100);
    expect(gridY(cover.gridNo)).toBeLessThan(WALL_ROW);
    expect(spacesAway(guard.gridNo, cover.gridNo)).toBeLessThanOrEqual(6);
    for (let cube = 1; cube <= 3; cube++) expect(soldierToLocationChanceToGetThrough(t, merc, cover.gridNo, 0, cube, guard)).toBe(0);
    expect({ gridNo: guard.gridNo, x: guard.x, y: guard.y, mercGrid: merc.gridNo }).toEqual(before);
  });

  it('finds nothing when no opponent is known', () => {
    const t = newSim().state;
    t.inCombat = true;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(90, 81), soldierClass: SoldierClass.ARMY });
    spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 88) });
    guard.ai.alertStatus = AlertStatus.RED;
    expect(findBestNearbyCover(t, guard, AiMorale.NORMAL)).toEqual({ gridNo: NOWHERE, percentBetter: 0 });
  });

  it('computes the percentage improvement against the summed scales', () => {
    expect(calcPercentBetter(-300, 0, 600, 0)).toBe(50);
    expect(calcPercentBetter(10, 5, 100, 100)).toBe(0);
    expect(calcPercentBetter(0, 10, 0, 0)).toBe(0);
  });
});

describe('findSpotMaxDistFromOpponents', () => {
  it('runs to a reachable tile farther from the closest known opponent', () => {
    const t = newSim().state;
    t.inCombat = true;
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80) });
    const merc = spawn(t, { id: 0, team: Team.OUR, at: gridNo(80, 84) });
    sees(guard, merc);
    const spot = findSpotMaxDistFromOpponents(t, guard);
    expect(spot).not.toBe(NOWHERE);
    expect(pythSpacesAway(spot, merc.gridNo)).toBeGreaterThan(pythSpacesAway(guard.gridNo, merc.gridNo));
    expect(gridX(spot)).toBeGreaterThanOrEqual(70);
  });
});

describe('light at night', () => {
  function lamp(t: TacticalState, x: number, y: number): void {
    const l = lightSpriteCreate(t, 'L-R03.LHT');
    if (!l) throw new Error('no lamp');
    lightSpritePower(l, true);
    lightSpritePosition(t, l, x, y);
  }

  it('counts only outdoor tiles brighter than the night around them', () => {
    const t = newSim().state;
    lamp(t, 80, 80);
    expect(inLightAtNight(t, gridNo(80, 80), 0)).toBe(false);
    lightSetBaseLevel(t, 12);
    expect(inLightAtNight(t, gridNo(80, 80), 0)).toBe(true);
    expect(inLightAtNight(t, gridNo(90, 80), 0)).toBe(false);
    t.world.level.rooms[gridNo(80, 80)] = 3;
    expect(inLightAtNight(t, gridNo(80, 80), 0)).toBe(false);
  });

  it('sends a lit soldier to a nearby darker reachable tile', () => {
    const t = newSim().state;
    lightSetBaseLevel(t, 12);
    lamp(t, 80, 80);
    const guard = spawn(t, { id: 20, team: Team.ENEMY, at: gridNo(80, 80) });
    guard.ai.orders = Orders.SEEKENEMY;
    const spot = findNearbyDarkerSpot(t, guard);
    expect(spot).not.toBe(NOWHERE);
    expect(lightTrueLevel(t, spot, 0) - lightTrueLevel(t, guard.gridNo, 0)).toBeGreaterThanOrEqual(2);
    expect(spacesAway(spot, guard.gridNo)).toBeLessThanOrEqual(5);
    guard.ai.orders = Orders.STATIONARY;
    expect(findNearbyDarkerSpot(t, guard)).toBe(NOWHERE);
  });
});
