import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { MapModificationType } from '../../../content/formats/savegame-temp-files.ts';
import { DIRECTION_COUNT, gridNo } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { tileIndex, typeIndex } from '../../../content/world/tile-tables.ts';
import { tacticalViewParts } from '../../knowledge/sim-view.ts';
import { applyMapChanges, MapChangeKind, sectorTempFileChanges, structLayerAt } from '../map-changes.ts';
import { initLoadedWorld, loadSavedSectorChanges } from '../save-import.ts';
import type { TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { addBlueFlag, clearMineFlag, hasMineFlag, knownMineTiles, MineFlag, removeBlueFlag, setMineFlag } from './mine-flags.ts';

const A10 = 'stubs/world/maps/a10.dat';
const OPEN_GROUND = gridNo(80, 75);
const ROOF_LEVEL = 1;
const GROUND_LEVEL = 0;
const BLUE_FLAG_SUB_INDEX = 21;
const MAP_REDUNDENT = 0x01;
const MAP_REEVALUATE_REDUNDENCY = 0x02;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function freshA10(): TacticalSim {
  return new TacticalSim(kit.world(A10), kit.content, 1);
}

function blueFlagTile(t: TacticalState): number {
  return tileIndex(t.world.tables ?? kit.world(A10).tables, 'FIRSTSWITCHES21');
}

const costsInto = (t: TacticalState, g: number) => Array.from({ length: DIRECTION_COUNT }, (_, d) => t.world.costs.get(g, d, GROUND_LEVEL));

describe('blue flags (AddBlueFlag, RemoveBlueFlag)', () => {
  it('puts the flag at the tail of the tile as a map change and marks the tile for the player', () => {
    const t = freshA10().state;
    addBlueFlag(t, OPEN_GROUND, GROUND_LEVEL);
    const flag = blueFlagTile(t);
    expect(structLayerAt(t, OPEN_GROUND).at(-1)).toBe(flag);
    expect(t.mapChanges.map((c) => [c.kind, c.gridNo, c.tile])).toEqual([[MapChangeKind.APPEND_STRUCT_TILE, OPEN_GROUND, flag]]);
    expect([hasMineFlag(t, OPEN_GROUND, MineFlag.PLAYER), hasMineFlag(t, OPEN_GROUND, MineFlag.ENEMY)]).toEqual([true, false]);
    expect(knownMineTiles(t)).toEqual([OPEN_GROUND]);
  });

  it('blocks the flagged tile for everybody: the flag is a generic structure without cells, which the costs read as an obstacle', () => {
    const t = freshA10().state;
    expect(costsInto(t, OPEN_GROUND).every((c) => c < TravelCost.BLOCKED)).toBe(true);
    addBlueFlag(t, OPEN_GROUND, GROUND_LEVEL);
    const flag = t.world.structures.find(OPEN_GROUND, StructureFlags.GENERIC);
    expect(flag?.tile.shape.every((cells) => cells === 0)).toBe(true);
    expect(costsInto(t, OPEN_GROUND)).toEqual(Array(DIRECTION_COUNT).fill(TravelCost.OBSTACLE));
  });

  it('takes the flag off the ground, but on the roof level clears the mark alone: the flag was put on the ground and stays', () => {
    const ground = freshA10().state;
    addBlueFlag(ground, OPEN_GROUND, GROUND_LEVEL);
    removeBlueFlag(ground, OPEN_GROUND, GROUND_LEVEL);
    expect([structLayerAt(ground, OPEN_GROUND).includes(blueFlagTile(ground)), knownMineTiles(ground)]).toEqual([false, []]);
    const roof = freshA10().state;
    addBlueFlag(roof, OPEN_GROUND, ROOF_LEVEL);
    removeBlueFlag(roof, OPEN_GROUND, ROOF_LEVEL);
    expect([structLayerAt(roof, OPEN_GROUND).includes(blueFlagTile(roof)), knownMineTiles(roof)]).toEqual([true, []]);
  });

  it('keeps the flags out of the view of the tiles only the enemy knows', () => {
    const sim = freshA10();
    setMineFlag(sim.state, OPEN_GROUND, MineFlag.ENEMY);
    setMineFlag(sim.state, OPEN_GROUND + 1, MineFlag.PLAYER);
    expect(tacticalViewParts(sim).knownMines).toEqual([OPEN_GROUND + 1]);
    clearMineFlag(sim.state, OPEN_GROUND + 1, MineFlag.PLAYER);
    expect(tacticalViewParts(sim).knownMines).toEqual([]);
  });
});

describe('the mine flags of a loaded sector (SetBlueFlagFlags)', () => {
  it("takes at the load the mine flags the map stores in each tile's layer count byte, and none of its other flags (LoadWorld)", () => {
    const world = kit.world(A10);
    const worldFlags = new Uint8Array(world.map.worldFlags.length);
    worldFlags[OPEN_GROUND] = MAP_REEVALUATE_REDUNDENCY | MineFlag.ENEMY;
    worldFlags[OPEN_GROUND + 1] = MAP_REDUNDENT | MineFlag.PLAYER;
    worldFlags[OPEN_GROUND + 2] = MAP_REDUNDENT | MAP_REEVALUATE_REDUNDENCY;
    const t = new TacticalSim({ ...world, map: { ...world.map, worldFlags } }, kit.content, 1).state;
    const flagged = [...t.mineFlags.entries()].filter(([, flags]) => flags !== 0);
    expect(flagged).toEqual([
      [OPEN_GROUND, MineFlag.ENEMY],
      [OPEN_GROUND + 1, MineFlag.PLAYER],
    ]);
  });

  it('marks for the player, as a load ends, the tiles where the replayed map changes leave a blue flag, and no others', () => {
    const left = freshA10().state;
    addBlueFlag(left, OPEN_GROUND, GROUND_LEVEL);
    setMineFlag(left, OPEN_GROUND + 2, MineFlag.PLAYER);
    setMineFlag(left, OPEN_GROUND + 4, MineFlag.ENEMY);
    const entered = freshA10().state;
    applyMapChanges(entered, sectorTempFileChanges(left.mapChanges));
    initLoadedWorld(entered);
    expect(knownMineTiles(entered)).toEqual([OPEN_GROUND]);
    expect(entered.mineFlags.some((flags) => flags & MineFlag.ENEMY)).toBe(false);
  });

  it("marks the tiles of a native save's blue flags for the player", () => {
    const sim = freshA10();
    const flag = {
      type: MapModificationType.STRUCT,
      gridNo: OPEN_GROUND,
      imageType: typeIndex(kit.world(A10).tables, 'FIRSTSWITCHES'),
      subImageIndex: BLUE_FLAG_SUB_INDEX,
      extra: 0,
    };
    loadSavedSectorChanges(sim, { mapModifications: [flag], revealed: null, doorStatus: null });
    expect(knownMineTiles(sim.state)).toEqual([OPEN_GROUND]);
  });
});
