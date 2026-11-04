import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation, type StructureDef, type StructureFile } from '../../../content/formats/jsd.ts';
import type { StiAppData } from '../../../content/formats/sti.ts';
import { gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import type { Level } from '../../../content/world/level.ts';
import { compileWorldMovementCosts, type MovementWorld } from '../../../content/world/movement-costs.ts';
import { placeWorldStructures } from '../../../content/world/placement.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { layerWith, syntheticMap, syntheticStructure } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { buildTileDatabase, type TileSurface } from '../../../content/world/tile-database.ts';
import { parseTileTables, tileIndexFromTypeSubIndex, typeIndex } from '../../../content/world/tile-tables.ts';
import type { TacticalContent } from '../content.ts';
import { applyMapChanges, MapChangeKind, objectLayerAt, sectorTempFileChanges, structLayerAt } from '../map-changes.ts';
import type { TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { tileChangeViews } from '../world-view.ts';
import { explosiveDamageGridNo } from './structure-damage.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/tiles.json'), 'utf8')));
const tile = (type: string, subIndex: number) => tileIndexFromTypeSubIndex(tables, typeIndex(tables, type), subIndex);

const WOUND = 200;
const BLAST_CENTRE = 0;
const NO_MULTI_FLAG = -1;
const STURDY = 255;
const FRAIL = 1;
const CRATE_DEBRIS_PARTNER = 44;
const WALL_DEBRIS_PARTNER = 5;
const FOUNTAIN_DEBRIS_PARTNER = 1;
const DAMAGED_FENCE = 2;
const WALL_END_FRAMES = 55;

const LEFT = Orientation.OUTSIDE_LEFT;
const RIGHT = Orientation.OUTSIDE_RIGHT;

function wall(orientation: number, extra: Partial<StructureDef> = {}): StructureDef {
  return { ...syntheticStructure(StructureFlags.WALL, orientation, { edge: true }), hitPoints: FRAIL, ...extra };
}

function aux(wallOrientation: number): StiAppData {
  return { wallOrientation, numberOfTiles: 0, tileLocationIndex: 0, currentFrame: 0, numberOfFrames: 0, flags: 0 };
}

function surface(
  type: string,
  file: string,
  frames: number,
  defs: Readonly<Record<number, StructureDef>> = {},
  orientations: Readonly<Record<number, number>> = {},
): TileSurface {
  const structures: (StructureDef | null)[] = Array.from({ length: frames }, (_, k) => {
    const def = defs[k + 1];
    return def ? { ...def, number: k } : null;
  });
  const structureFile: StructureFile = { structureCount: frames, auxData: null, tileLocations: [], structures };
  return {
    type: typeIndex(tables, type),
    path: `tilesets/0/${file}`,
    frames: Array.from({ length: frames }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
    auxData: Array.from({ length: frames }, (_, k) => aux(orientations[k + 1] ?? defs[k + 1]?.wallOrientation ?? Orientation.NONE)),
    structures: structureFile,
  };
}

const WALL_ENDS: Readonly<Record<number, StructureDef>> = {
  48: wall(LEFT, { hitPoints: STURDY }),
  49: wall(LEFT, { hitPoints: STURDY }),
  50: wall(RIGHT, { hitPoints: STURDY }),
  51: wall(RIGHT, { hitPoints: STURDY }),
  52: wall(Orientation.INSIDE_LEFT, { hitPoints: STURDY }),
  53: wall(Orientation.INSIDE_LEFT, { hitPoints: STURDY }),
  54: wall(Orientation.INSIDE_RIGHT, { hitPoints: STURDY }),
  55: wall(Orientation.INSIDE_RIGHT, { hitPoints: STURDY }),
};

const fence = (extra: Partial<StructureDef>) => ({ ...syntheticStructure(StructureFlags.FENCE, RIGHT, { edge: true }), ...extra });
const generic = (extra: Partial<StructureDef>) => ({ ...syntheticStructure(StructureFlags.GENERIC), ...extra });

const SURFACES: readonly TileSurface[] = [
  surface('FIRSTWALL', 'wall.sti', WALL_END_FRAMES, {
    1: wall(LEFT),
    2: wall(RIGHT, { hitPoints: STURDY }),
    3: wall(LEFT, { destructionPartner: WALL_DEBRIS_PARTNER }),
    4: wall(LEFT, { hitPoints: STURDY }),
    ...WALL_ENDS,
  }),
  surface('FIRSTWALLDECAL', 'decal1.sti', 10, {}, { 1: LEFT }),
  surface('FIFTHWALLDECAL', 'decal5.sti', 10),
  surface('FIRSTEXPLDEBRIS', 'debris1.sti', 40),
  surface('SECONDEXPLDEBRIS', 'debris2.sti', 40),
  surface('FENCESTRUCT', 'fence.sti', 2, {
    1: fence({ hitPoints: FRAIL, destructionPartner: -DAMAGED_FENCE }),
    2: fence({ hitPoints: STURDY }),
  }),
  surface('FIRSTOSTRUCT', 'fount1.sti', 5, { 5: generic({ hitPoints: FRAIL, destructionPartner: FOUNTAIN_DEBRIS_PARTNER }) }),
  surface('SECONDOSTRUCT', 'crate.sti', 1, {
    1: {
      ...syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, {
        tiles: [
          [0, 0],
          [1, 0],
        ],
      }),
      hitPoints: FRAIL,
      destructionPartner: CRATE_DEBRIS_PARTNER,
    },
  }),
];

const TILES = buildTileDatabase(
  tables,
  tables.types.map((t) => SURFACES.find((s) => s.type === t.index) ?? null),
);

type Layout = ReadonlyMap<number, readonly number[]>;

function wreckWorld(structs: Layout, objects: Layout = new Map()): TacticalWorld {
  const empty = layerWith(() => []);
  const level: Level = {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: {
      land: layerWith(() => [0]),
      objects: layerWith((g) => objects.get(g) ?? []),
      structs: layerWith((g) => structs.get(g) ?? []),
      shadows: empty,
      roofs: empty,
      onRoof: empty,
    },
  };
  const placed = placeWorldStructures(level, TILES);
  const movement: Omit<MovementWorld, 'map'> = {
    level: placed.level,
    structures: placed.structures,
    terrain: new Uint8Array(WORLD_MAX).fill(Terrain.FLAT_GROUND),
    exitGrids: new Set(),
    doorCosts: testDoorCosts(),
  };
  const world = { ...movement, costs: compileWorldMovementCosts(movement), tables, tiles: TILES };
  return { ...world, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld;
}

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function simOver(structs: Layout, objects?: Layout): TacticalState {
  return new TacticalSim(wreckWorld(structs, objects), content, 1).state;
}

function recordMainDraws(t: TacticalState): number[][] {
  const draws: number[][] = [];
  const draw = t.rng.int.bind(t.rng);
  vi.spyOn(t.rng, 'int').mockImplementation((n: number) => {
    const v = draw(n);
    draws.push([n, v]);
    return v;
  });
  return draws;
}

function blast(t: TacticalState, g: number): void {
  explosiveDamageGridNo(t, g, WOUND, BLAST_CENTRE, false, NO_MULTI_FLAG, null, 0, { gridNos: new Set() });
}

function defsAt(t: TacticalState, g: number): (StructureDef | undefined)[] {
  return t.world.structures
    .at(g)
    .filter((s) => has(s.flags, StructureFlags.BASE_TILE))
    .map((s) => s.def);
}

const CRATE = gridNo(60, 60);
const WALL = gridNo(70, 60);
const FENCE = gridNo(80, 60);
const FOUNTAIN = gridNo(90, 60);

describe('explosion debris (ExplosiveDamageStructureAtGridNo, Explosion_Control.cc:427)', () => {
  it('drops a debris object, drawn with a main Random(3), on every tile of a destroyed structure with a positive partner that has no debris yet', () => {
    const debrisBefore = tile('FIRSTEXPLDEBRIS', 7);
    const t = simOver(new Map([[CRATE, [tile('SECONDOSTRUCT', 1)]]]), new Map([[CRATE + 1, [debrisBefore]]]));
    const draws = recordMainDraws(t);
    blast(t, CRATE);
    expect(draws).toHaveLength(1);
    const [range, roll] = draws[0] ?? [];
    expect(range).toBe(3);
    const dropped = tile('SECONDEXPLDEBRIS', CRATE_DEBRIS_PARTNER - 40) + (roll ?? 0);
    expect(objectLayerAt(t, CRATE)).toEqual([dropped]);
    expect(objectLayerAt(t, CRATE + 1)).toEqual([debrisBefore]);
    expect(tileChangeViews(t).filter((c) => c.kind === 'object')).toEqual([{ kind: 'object', gridNo: CRATE, level: 0, tile: dropped }]);
  });

  it("drops debris on a destroyed wall's tile and on the tile across it", () => {
    const t = simOver(new Map([[WALL, [tile('FIRSTWALL', 3)]]]));
    const draws = recordMainDraws(t);
    blast(t, WALL);
    const first = tile('FIRSTEXPLDEBRIS', WALL_DEBRIS_PARTNER);
    expect(draws.map(([range]) => range)).toEqual([3, 3]);
    expect(objectLayerAt(t, WALL)).toEqual([first + (draws[0]?.[1] ?? 0)]);
    expect(objectLayerAt(t, WALL + 160)).toEqual([first + (draws[1]?.[1] ?? 0)]);
  });

  it('keeps the debris at the next entry, written to the temp file with AddObjectToHead', () => {
    const structs = new Map([[CRATE, [tile('SECONDOSTRUCT', 1)]]]);
    const left = simOver(structs);
    blast(left, CRATE);
    const entered = simOver(structs);
    applyMapChanges(entered, sectorTempFileChanges(left.mapChanges));
    expect(objectLayerAt(entered, CRATE)).toEqual(objectLayerAt(left, CRATE));
    expect(objectLayerAt(entered, CRATE + 1)).toEqual(objectLayerAt(left, CRATE + 1));
    expect(tileChangeViews(entered)).toEqual(tileChangeViews(left));
  });
});

describe('fence partners (HandleFencePartnerCheck, Explosion_Control.cc:257)', () => {
  it('swaps the fence pieces on both sides of a wrecked fence to their damaged partner', () => {
    const pieces = [FENCE - 160, FENCE, FENCE + 160];
    const t = simOver(new Map(pieces.map((g) => [g, [tile('FENCESTRUCT', 1)]])));
    blast(t, FENCE);
    const damaged = TILES[tile('FENCESTRUCT', DAMAGED_FENCE)]?.structure;
    expect(pieces.map((g) => defsAt(t, g))).toEqual([[damaged], [damaged], [damaged]]);
    expect(t.mapChanges.filter((c) => c.gridNo !== FENCE).map((c) => [c.kind, c.gridNo])).toEqual([
      [MapChangeKind.REMOVE, FENCE + 160],
      [MapChangeKind.ADD, FENCE + 160],
      [MapChangeKind.REMOVE, FENCE - 160],
      [MapChangeKind.ADD, FENCE - 160],
    ]);
  });
});

describe('wall decals (RemoveAllStructsOfTypeRange, Explosion_Control.cc:498)', () => {
  it('takes the decals off a destroyed wall without writing their removal to the temp file, so they hang there again at the next entry', () => {
    const decals = [tile('FIRSTWALLDECAL', 2), tile('FIFTHWALLDECAL', 1)];
    const structs = new Map([[WALL, [tile('FIRSTWALL', 1), ...decals]]]);
    const t = simOver(structs);
    blast(t, WALL);
    expect(structLayerAt(t, WALL)).toEqual([]);
    expect(
      tileChangeViews(t)
        .filter((c) => c.gridNo === WALL && c.kind === 'remove')
        .map((c) => c.tile),
    ).toEqual([...decals, tile('FIRSTWALL', 1)]);
    const entered = simOver(structs);
    applyMapChanges(entered, sectorTempFileChanges(t.mapChanges));
    expect(structLayerAt(entered, WALL)).toEqual(decals);
  });
});

describe('wall end pieces (ReplaceWall, Explosion_Control.cc:293)', () => {
  it('replaces the walls of the same side beside a destroyed wall with end pieces, at the head where a crossing wall stands', () => {
    const west = WALL - 1;
    const east = WALL + 1;
    const t = simOver(
      new Map([
        [west, [tile('FIRSTWALL', 1)]],
        [WALL, [tile('FIRSTWALL', 1)]],
        [east, [tile('FIRSTWALL', 2), tile('FIRSTWALL', 4)]],
      ]),
    );
    blast(t, WALL);
    expect(defsAt(t, west)).toEqual([TILES[tile('FIRSTWALL', 48)]?.structure]);
    expect(defsAt(t, east)).toEqual([TILES[tile('FIRSTWALL', 2)]?.structure, TILES[tile('FIRSTWALL', 49)]?.structure]);
    expect(structLayerAt(t, west)).toEqual([tile('FIRSTWALL', 48)]);
    expect(structLayerAt(t, east)).toEqual([tile('FIRSTWALL', 49), tile('FIRSTWALL', 2)]);
    expect(tileChangeViews(t).filter((c) => c.gridNo !== WALL)).toEqual([
      { kind: 'remove', gridNo: west, level: 0, tile: tile('FIRSTWALL', 1) },
      { kind: 'append', gridNo: west, level: 0, tile: tile('FIRSTWALL', 48) },
      { kind: 'remove', gridNo: east, level: 0, tile: tile('FIRSTWALL', 4) },
      { kind: 'add', gridNo: east, level: 0, tile: tile('FIRSTWALL', 49) },
    ]);
  });

  it('lets the end piece take the place of a decal on the same side of the wall beside, as AddWallToStructLayer replaces a parallel node', () => {
    const west = WALL - 1;
    const decal = tile('FIRSTWALLDECAL', 1);
    const structs = new Map([
      [west, [tile('FIRSTWALL', 1), decal]],
      [WALL, [tile('FIRSTWALL', 1)]],
    ]);
    const t = simOver(structs);
    blast(t, WALL);
    expect(structLayerAt(t, west)).toEqual([tile('FIRSTWALL', 48)]);
    const entered = simOver(structs);
    applyMapChanges(entered, sectorTempFileChanges(t.mapChanges));
    expect(structLayerAt(entered, west)).toEqual([tile('FIRSTWALL', 48)]);
  });
});

describe('the fountain (Explosion_Control.cc:531)', () => {
  it('drains a destroyed fount1.sti fountain, taking each of the first three water pieces twice', () => {
    const water = [1, 2, 3].map((k) => tile('FIRSTOSTRUCT', k));
    const t = simOver(new Map([[FOUNTAIN, [water[0] ?? 0, water[0] ?? 0, water[0] ?? 0, ...water.slice(1), tile('FIRSTOSTRUCT', 5)]]]));
    blast(t, FOUNTAIN);
    expect(structLayerAt(t, FOUNTAIN)).toEqual([water[0]]);
    expect(t.mapChanges.filter((c) => c.kind === MapChangeKind.REMOVE_STRUCT_TILE).map((c) => c.tile)).toEqual([
      water[0],
      water[0],
      water[1],
      water[2],
    ]);
  });
});
