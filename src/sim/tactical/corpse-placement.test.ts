import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { corpseFileBase } from '../../content/anim/corpses.ts';
import type { StructureDef } from '../../content/formats/jsd.ts';
import { gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { Corpse } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { findNearestAvailableGridNoForCorpse, placeLoadedCorpse } from './corpse-placement.ts';
import { Direction } from './directions.ts';
import { Insertion } from './insertion.ts';
import { WIDE_SWEET_SPOT_RADIUS } from './item-placement.ts';
import { NOWHERE } from './pathfinding.ts';
import type { TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SMERC_FWD = 3;
const CENTRE = gridNo(80, 80);
const NORTH_ENTRY = gridNo(80, 2);
const LAKE_APOTHEM = 5;
const CORPSE_STRUCTURE_FLAGS = StructureFlags.CORPSE | StructureFlags.GENERIC;

interface Layout {
  readonly blocked?: readonly number[];
  readonly water?: readonly number[];
}

function sectorWith({ blocked = [], water = [] }: Layout, withContent: TacticalContent = content): TacticalState {
  const base = syntheticWorld(testDoorCosts(), (structures) => {
    for (const g of blocked) structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
  });
  for (const g of water) base.terrain[g] = Terrain.LOW_WATER;
  const world = {
    ...base,
    map: { doors: [], placements: [], info: { centerGridNo: CENTRE, northGridNo: NORTH_ENTRY } },
    mapPath: 'synthetic',
  } as unknown as TacticalWorld;
  return new TacticalSim(world, withContent, 1).state;
}

function droppedCorpse(at: number, extra: Partial<Corpse> = {}): Corpse {
  return {
    gridNo: at,
    level: 0,
    bodyType: 0,
    direction: Direction.SOUTH,
    state: 0,
    profile: 200,
    type: SMERC_FWD,
    timeOfDeath: 0,
    headTaken: false,
    findSweetSpot: true,
    ...extra,
  };
}

function square(centre: number, apothem: number): number[] {
  const tiles: number[] = [];
  for (let dy = -apothem; dy <= apothem; dy++) for (let dx = -apothem; dx <= apothem; dx++) tiles.push(centre + dx + dy * WORLD_COLS);
  return tiles;
}

function withCorpseStructures(type: number, replace: (structures: (StructureDef | null)[]) => void): TacticalContent {
  const corpses = content.corpses;
  const name = corpseFileBase(corpses.table, type, true);
  const file = corpses.structures.get(name);
  if (!file) throw new Error(`no corpse structures ${name}`);
  const structures = [...file.structures];
  replace(structures);
  const files = new Map(corpses.structures);
  files.set(name, { ...file, structures });
  return { ...content, corpses: { ...corpses, structures: files } };
}

describe('where a loaded corpse goes (Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile)', () => {
  it('turns a sweet-spot corpse to the first direction its structure fits, counting from north (Rotting_Corpses.cc FindNearestAvailableGridNoForCorpse)', () => {
    const east = CENTRE + 1;
    const reachingEast = syntheticStructure(CORPSE_STRUCTURE_FLAGS, undefined, {
      tiles: [
        [0, 0],
        [1, 0],
      ],
    });
    const custom = withCorpseStructures(SMERC_FWD, (structures) => {
      structures[1] = reachingEast;
      structures[2] = syntheticStructure(CORPSE_STRUCTURE_FLAGS);
    });
    const t = sectorWith({ blocked: [east] }, custom);
    expect(placeLoadedCorpse(t, droppedCorpse(CENTRE))).toMatchObject({
      gridNo: CENTRE,
      direction: Direction.NORTHEAST,
      findSweetSpot: true,
    });
  });

  it('loses a corpse with no free tile within five: the wider retry searches around the NOWHERE the first search left (Tactical_Save.cc:650-652)', () => {
    const t = sectorWith({ water: square(CENTRE, LAKE_APOTHEM) });
    const corpse = droppedCorpse(CENTRE);
    expect(findNearestAvailableGridNoForCorpse(t, corpse, WIDE_SWEET_SPOT_RADIUS).gridNo).not.toBe(NOWHERE);
    expect(placeLoadedCorpse(t, corpse).gridNo).toBe(NOWHERE);
  });

  it('puts a corpse flagged for an entry point on the map entry tile, at every load', () => {
    const t = sectorWith({});
    const corpse = droppedCorpse(CENTRE, { findSweetSpot: false, entryPoint: Insertion.NORTH });
    expect(placeLoadedCorpse(t, corpse)).toMatchObject({ gridNo: NORTH_ENTRY, direction: Direction.SOUTH, entryPoint: Insertion.NORTH });
  });

  it('leaves a corpse without a placement flag on its tile', () => {
    const t = sectorWith({ blocked: [CENTRE] });
    const corpse = droppedCorpse(CENTRE, { findSweetSpot: false });
    expect(placeLoadedCorpse(t, corpse)).toBe(corpse);
  });
});
