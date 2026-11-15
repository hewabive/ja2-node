import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { Direction, gridNo, rangeInCellCoords } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { layerWith, syntheticMap, syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { idiv } from '../../core/int.ts';
import { createItem } from '../items/object.ts';
import { AnimHeight, initNewSoldierAnim, states } from './animation.ts';
import { soldierToLocationChanceToGetThrough } from './combat/bullets.ts';
import { soldierToVirtualSoldierLos } from './combat/positions.ts';
import type { TacticalContent } from './content.ts';
import { coverAroundGridNo, displayCoverStance, sightAroundGridNo, type TileCover } from './display-cover.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { Opp } from './perception/opp.ts';
import { createSoldier, type Soldier, Team, Visible } from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FLAT_ROOF_TILE_TYPE = 64;
const SLANTED_ROOF_TILE_TYPE = 68;
const NO_ROOFS = { showAllRoofs: false, revealed: () => false };

interface WorldOptions {
  readonly walls?: readonly number[];
  readonly obstacles?: readonly number[];
  readonly roofStructures?: readonly number[];
  readonly bareRoofs?: readonly number[];
  readonly flatRoofs?: readonly number[];
  readonly rooms?: readonly number[];
}

function newState(o: WorldOptions = {}): TacticalState {
  const base = syntheticWorld(
    testDoorCosts(),
    (structures) => {
      for (const g of o.walls ?? []) structures.add(g, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
      for (const g of o.roofStructures ?? []) structures.add(g, 1, syntheticStructure(StructureFlags.ROOF));
      for (const g of o.obstacles ?? []) structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
    },
    new Set([...(o.flatRoofs ?? []), ...(o.bareRoofs ?? [])]),
  );
  for (const g of o.rooms ?? []) base.level.rooms[g] = 1;
  const flat = new Set(o.flatRoofs ?? []);
  const bare = new Set(o.bareRoofs ?? []);
  const level = { ...base.level, layers: { ...base.level.layers, roofs: layerWith((g) => (flat.has(g) ? [0] : bare.has(g) ? [1] : [])) } };
  const tiles = [{ type: FLAT_ROOF_TILE_TYPE }, { type: SLANTED_ROOF_TILE_TYPE }];
  const world = { ...base, level, tiles, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 7).state;
}

function spawn(t: TacticalState, id: number, team: number, at: number, gun: string | null = 'GLOCK_17'): Soldier {
  const s = createSoldier({
    id,
    team,
    name: `S${id}`,
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
      experience: 3,
    },
    life: 80,
    gridNo: at,
    direction: Direction.SOUTH,
    state: states(content.animations).STANDING,
  });
  if (gun) s.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get(gun)?.index ?? 0, 100);
  s.visible = Visible.SEEN;
  s.uiMovementMode = states(content.animations).WALKING;
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  return s;
}

function knownToTeam(t: TacticalState, opp: Soldier, value: number = Opp.SEEN_CURRENTLY): void {
  const table = t.perception.publicOpp[Team.OUR];
  if (table) table[opp.id] = value;
}

function coverAt(tiles: readonly TileCover[], g: number): number | undefined {
  return tiles.find((tile) => tile.gridNo === g)?.cover;
}

function rangeShare(t: TacticalState, gun: string, range: number): number {
  const max = t.content.items.byName.get(gun)?.weapon?.range ?? 0;
  return Math.min(100, Math.max(0, Math.trunc((Math.fround((max - range) / max) + 0.3) * 100)));
}

describe('the cover display (DisplayCover.cc CalculateCoverInRadiusAroundGridno)', () => {
  it('shows full cover where no enemy is known, the squad having neither seen him nor seeing him now', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 70));
    knownToTeam(t, enemy, Opp.HEARD_THIS_TURN);
    const tiles = coverAroundGridNo(t, merc, gridNo(80, 80), 0, 2);
    expect(tiles).toHaveLength(25);
    expect(tiles.every((tile) => tile.cover === 100)).toBe(true);
  });

  it('takes from 100 the share of a seen enemy his bullet gets through and his gun carries over the range', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 73));
    knownToTeam(t, enemy, Opp.SEEN_THIS_TURN);
    const target = gridNo(80, 81);
    const through = soldierToLocationChanceToGetThrough(t, enemy, target, 0, AnimHeight.STAND, null);
    const share = rangeShare(t, 'GLOCK_17', rangeInCellCoords(enemy.gridNo, target));
    expect(through).toBeGreaterThan(0);
    expect(share).toBeGreaterThan(5);
    expect(share).toBeLessThan(100);
    expect(coverAt(coverAroundGridNo(t, merc, gridNo(80, 80), 0, 2), target)).toBe(100 - idiv(through * share, 100));
  });

  it('weighs two enemies by their mean and the larger share twice', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const near = spawn(t, 20, Team.ENEMY, gridNo(80, 72));
    const far = spawn(t, 21, Team.ENEMY, gridNo(66, 80));
    knownToTeam(t, near);
    knownToTeam(t, far);
    const target = gridNo(80, 81);
    const shareOf = (opp: Soldier) =>
      idiv(
        soldierToLocationChanceToGetThrough(t, opp, target, 0, AnimHeight.STAND, null) *
          rangeShare(t, 'GLOCK_17', rangeInCellCoords(opp.gridNo, target)),
        100,
      );
    const a = shareOf(near);
    const b = shareOf(far);
    const highest = Math.max(a, b);
    const expected = Math.min(100, Math.max(0, 100 - (idiv(a + b, 2) - idiv(highest, 2) + highest)));
    expect(coverAt(coverAroundGridNo(t, merc, gridNo(80, 80), 0, 2), target)).toBe(expected);
  });

  it('ignores an enemy beyond the distance he sees or behind a wall', () => {
    const t = newState({ walls: [gridNo(80, 76)] });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const walled = spawn(t, 20, Team.ENEMY, gridNo(80, 74));
    const distant = spawn(t, 21, Team.ENEMY, gridNo(30, 80));
    knownToTeam(t, walled);
    knownToTeam(t, distant);
    expect(coverAt(coverAroundGridNo(t, merc, gridNo(80, 80), 0, 0), gridNo(80, 80))).toBe(100);
  });

  it('aims the fake bullet of the standing stance at cube 6, above the roofs: the stance is passed as the cube level', () => {
    const roofs = Array.from({ length: 9 }, (_, k) => gridNo(80, 68 + k));
    const t = newState({ roofStructures: roofs });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 84));
    const enemy = spawn(t, 20, Team.ENEMY, gridNo(80, 66));
    knownToTeam(t, enemy);
    const target = gridNo(80, 78);
    expect(soldierToVirtualSoldierLos(t, enemy, target, 0, AnimHeight.STAND, 26, true)).toBeGreaterThan(0);
    expect(soldierToLocationChanceToGetThrough(t, enemy, target, 0, AnimHeight.STAND, null)).toBe(0);
    expect(coverAt(coverAroundGridNo(t, merc, target, 0, 0), target)).toBe(100);
    merc.uiMovementMode = states(content.animations).SWATTING;
    expect(displayCoverStance(t, merc)).toBe(AnimHeight.CROUCH);
    expect(coverAt(coverAroundGridNo(t, merc, target, 0, 0), target)).toBeLessThan(100);
  });

  it('takes the stance from the movement mode, crouched for any mode it does not name', () => {
    const t = newState();
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const st = states(content.animations);
    const heights = [st.CRAWLING, st.SWATTING, st.RUNNING, st.HOPFENCE].map((mode) => {
      merc.uiMovementMode = mode;
      return displayCoverStance(t, merc);
    });
    expect(heights).toEqual([AnimHeight.PRONE, AnimHeight.CROUCH, AnimHeight.STAND, AnimHeight.CROUCH]);
  });

  it('leaves out tiles out of reach of the cursor tile and tiles where another team stands in sight, militia too', () => {
    const rock = gridNo(81, 81);
    const t = newState({ obstacles: [rock] });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    spawn(t, 1, Team.OUR, gridNo(80, 79));
    spawn(t, 40, Team.MILITIA, gridNo(79, 80));
    const tiles = coverAroundGridNo(t, merc, merc.gridNo, 0, 1).map((tile) => tile.gridNo);
    expect(tiles).toContain(gridNo(80, 79));
    expect(tiles).toContain(merc.gridNo);
    expect(tiles).not.toContain(gridNo(79, 80));
    expect(tiles).not.toContain(rock);
    expect(tiles).toHaveLength(7);
  });

  it('shows only tiles under a flat roof at the roof level, a roof of another kind a merc can walk on left out', () => {
    const flat = [gridNo(80, 80), gridNo(81, 80)];
    const bare = gridNo(82, 80);
    const t = newState({ flatRoofs: flat, bareRoofs: [bare] });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 84));
    const tiles = coverAroundGridNo(t, merc, gridNo(81, 80), 1, 1).map((tile) => tile.gridNo);
    expect(tiles).toEqual(flat);
  });
});

describe('the sight display (DisplayCover.cc CalculateVisibleToSoldierAroundGridno)', () => {
  it('counts the stances the merc sees at each tile, none behind a wall', () => {
    const t = newState({ walls: [gridNo(80, 83)] });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const tiles = sightAroundGridNo(t, merc, gridNo(80, 84), 1, NO_ROOMS_OPEN);
    expect(tiles.find((tile) => tile.gridNo === gridNo(81, 84))?.stances).toBe(3);
    expect(tiles.find((tile) => tile.gridNo === gridNo(80, 84))?.stances).toBe(0);
  });

  it('shows the roof of a flat-roofed room while its roof is drawn, the ground once it is revealed but at the roof level', () => {
    const roof = gridNo(80, 86);
    const outside = gridNo(81, 86);
    const t = newState({ flatRoofs: [roof, outside], rooms: [roof] });
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    const roofAt = (roofs: typeof NO_ROOFS) => sightAroundGridNo(t, merc, roof, 1, roofs).find((tile) => tile.gridNo === roof)?.roof;
    expect(roofAt(NO_ROOFS)).toBe(true);
    expect(roofAt({ showAllRoofs: false, revealed: () => true })).toBe(false);
    expect(roofAt({ showAllRoofs: true, revealed: () => true })).toBe(true);
    expect(sightAroundGridNo(t, merc, roof, 1, NO_ROOFS).find((tile) => tile.gridNo === outside)?.roof).toBe(false);
  });

  it('leaves out an unrevealed tile under a roof below ground', () => {
    const rock = gridNo(80, 86);
    const t = newState({ flatRoofs: [rock] });
    t.sector = { x: 9, y: 1, z: 1 };
    const merc = spawn(t, 0, Team.OUR, gridNo(80, 80));
    expect(sightAroundGridNo(t, merc, rock, 0, NO_ROOMS_OPEN).some((tile) => tile.gridNo === rock)).toBe(false);
    expect(
      sightAroundGridNo(t, merc, rock, 0, { showAllRoofs: false, revealed: () => true }).find((tile) => tile.gridNo === rock)?.roof,
    ).toBe(false);
  });
});

const NO_ROOMS_OPEN = NO_ROOFS;
