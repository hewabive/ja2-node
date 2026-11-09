import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { sharedStubPackDir } from '../../../tests/support/stub-pack.ts';
import { type LoadedWorld, loadWorld } from '../../app/world/world-loader.ts';
import { Orientation, type StructureDef } from '../../content/formats/jsd.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { type Level, levelTilesAt } from '../../content/world/level.ts';
import { placeWorldStructures } from '../../content/world/placement.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { layerWith, syntheticStructure } from '../../content/world/synthetic.ts';
import { buildTileDatabase, type TileSurface } from '../../content/world/tile-database.ts';
import { parseTileTables, tileIndex, tileIndexFromTypeSubIndex, typeIndex } from '../../content/world/tile-tables.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { rowOf } from './geometry.ts';
import {
  changedRevealTiles,
  computeReveal,
  followWireframes,
  NO_REVEAL,
  NodeFlags,
  type RevealInputs,
  type RevealWorld,
  type WallWireframes,
} from './reveal.ts';
import { StaticScene, StaticSegment, type StaticWorld } from './static-scene.ts';

const ROOM = 1;

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));
const surfaces: TileSurface[] = tables.types.map((t) => ({
  type: t.index,
  path: `t${t.index}.sti`,
  frames: Array.from({ length: t.count }, () => ({ offsetX: 0, offsetY: 0, width: 40 })),
  auxData: null,
  structures: null,
}));
const AT = 80 * WORLD_COLS + 80;

interface SyntheticMap {
  readonly structs?: ReadonlyMap<number, readonly number[]>;
  readonly roofs?: ReadonlyMap<number, readonly number[]>;
  readonly rooms?: ReadonlyMap<number, number>;
  readonly defs: ReadonlyMap<number, StructureDef>;
}

function syntheticRevealWorld(m: SyntheticMap): RevealWorld {
  const tiles = buildTileDatabase(tables, surfaces).map((te) => {
    const structure = m.defs.get(te.index);
    return structure ? { ...te, structure } : te;
  });
  const empty = layerWith(() => []);
  const rooms = new Uint8Array(WORLD_MAX);
  for (const [g, room] of m.rooms ?? []) rooms[g] = room;
  const level = {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms,
    layers: {
      land: empty,
      objects: empty,
      structs: layerWith((g) => m.structs?.get(g) ?? []),
      shadows: empty,
      roofs: layerWith((g) => m.roofs?.get(g) ?? []),
      onRoof: empty,
      topmost: empty,
    },
  } as Level;
  const placed = placeWorldStructures(level, tiles);
  return { level: placed.level, tiles, tables, structures: placed.structures, basement: false };
}

describe('slanted roof ceilings', () => {
  it("adds the ceiling graphic on the view's ceiling tiles and reports the tiles whose ceiling came or went", () => {
    const w = syntheticRevealWorld({ defs: new Map() });
    const ceiling = tileIndex(tables, 'SLANTROOFCEILING1');
    const before = computeReveal(w, new Set(), new Set([AT, AT + 1]));
    const after = computeReveal(w, new Set(), new Set([AT + 1, AT + 2]));
    expect([before.ceilings(AT), before.ceilings(AT + 2)]).toEqual([[ceiling], []]);
    expect(changedRevealTiles(before, after, w.level).sort((a, b) => a - b)).toEqual([AT, AT + 2]);
  });
});

describe('room reveals find a structure by its base tile', () => {
  it('shows a single-tile obstacle of a revealed room through', () => {
    const crate = tileIndex(tables, 'FIRSTOSTRUCT1');
    const w = syntheticRevealWorld({
      structs: new Map([[AT, [crate]]]),
      rooms: new Map([[AT, ROOM]]),
      defs: new Map([[crate, syntheticStructure(StructureFlags.GENERIC)]]),
    });
    expect(computeReveal(w, new Set([ROOM])).nodeFlags('structs', AT, 0)).toBe(NodeFlags.SHOW_THROUGH);
  });

  it('hides a slanted roof whose base tile alone lies in the revealed room', () => {
    const slanted = tileIndex(tables, 'FIRSTSLANTROOF1');
    const roof = syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE, {
      tiles: [
        [0, 0],
        [1, 0],
      ],
    });
    const w = syntheticRevealWorld({ roofs: new Map([[AT, [slanted]]]), rooms: new Map([[AT, ROOM]]), defs: new Map([[slanted, roof]]) });
    expect(computeReveal(w, new Set([ROOM])).nodeFlags('roofs', AT, 0)).toBe(NodeFlags.HIDDEN | NodeFlags.SHOW_THROUGH);
  });

  it("draws a wall end piece's broken-wall wireframe towards a roofed tile", () => {
    const endPiece = tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'FIRSTWALL'), 48);
    const roofTile = tileIndex(tables, 'FIRSTROOF1');
    const w = syntheticRevealWorld({
      structs: new Map([[AT, [endPiece]]]),
      roofs: new Map([[AT + WORLD_COLS, [roofTile]]]),
      defs: new Map([
        [endPiece, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT)],
        [roofTile, syntheticStructure(StructureFlags.NORMAL_ROOF)],
      ]),
    });
    const wires = computeReveal(w, new Set())
      .wireframes(AT)
      .map((n) => n.tile);
    expect(wires).toContain(tileIndex(tables, 'WIREFRAMES12'));
    expect(wires).not.toContain(tileIndex(tables, 'WIREFRAMES6'));
  });
});

describe('the tiles revealed at the last load (SaveLoadMap.cc SetMapRevealedStatus)', () => {
  const crate = tileIndex(tables, 'FIRSTOSTRUCT1');
  const roofTile = tileIndex(tables, 'FIRSTROOF1');
  const outdoors = () =>
    syntheticRevealWorld({
      structs: new Map([[AT, [crate]]]),
      roofs: new Map([[AT, [roofTile]]]),
      defs: new Map([
        [crate, syntheticStructure(StructureFlags.GENERIC)],
        [roofTile, syntheticStructure(StructureFlags.NORMAL_ROOF)],
      ]),
    });

  it('take the roof off a revealed tile outside any room and show its obstacle through, as a room reveal does', () => {
    const revealed = computeReveal(outdoors(), new Set(), new Set(), [[AT, 1]]);
    expect([revealed.nodeFlags('roofs', AT, 0), revealed.nodeFlags('structs', AT, 0)]).toEqual([NodeFlags.HIDDEN, NodeFlags.SHOW_THROUGH]);
    expect(computeReveal(outdoors(), new Set()).nodeFlags('roofs', AT, 0)).toBe(0);
  });

  it('count as revealed for the wall wire frames towards them, which then follow the option', () => {
    const wall = tileIndex(tables, 'FIRSTWALL1');
    const w = syntheticRevealWorld({
      structs: new Map([[AT, [wall]]]),
      roofs: new Map([[AT + WORLD_COLS, [roofTile]]]),
      defs: new Map([
        [wall, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT)],
        [roofTile, syntheticStructure(StructureFlags.NORMAL_ROOF)],
      ]),
    });
    const wallWire = tileIndex(tables, 'WIREFRAMES6');
    const optional = (runs: readonly (readonly [number, number])[]) =>
      computeReveal(w, new Set(), new Set(), runs)
        .wireframes(AT)
        .find((n) => n.tile === wallWire)?.optional;
    expect(optional([])).toBe(false);
    expect(optional([[AT + WORLD_COLS, 1]])).toBe(true);
  });
});

describe('the wall wire frames worked out again during a stay (Render_Fun.cc RemoveRoomRoof, WorldDef.cc CalculateWorldWireFrameTiles)', () => {
  const wall = tileIndex(tables, 'FIRSTWALL1');
  const roofTile = tileIndex(tables, 'FIRSTROOF1');
  const nearRoom = AT;
  const farWall = AT + 20;
  const roomTile = nearRoom - WORLD_COLS;
  const w = syntheticRevealWorld({
    structs: new Map([
      [nearRoom, [wall]],
      [farWall, [wall]],
    ]),
    roofs: new Map([
      [nearRoom + WORLD_COLS, [roofTile]],
      [farWall + WORLD_COLS, [roofTile]],
    ]),
    rooms: new Map([[roomTile, ROOM]]),
    defs: new Map([
      [wall, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT)],
      [roofTile, syntheticStructure(StructureFlags.NORMAL_ROOF)],
    ]),
  });
  const wallWire = tileIndex(tables, 'WIREFRAMES6');
  const followsTheOption = (wires: WallWireframes) =>
    [nearRoom, farWall].map((g) => wires.at(g).find((n) => n.tile === wallWire)?.optional);
  const inputs = (
    rooms: readonly number[],
    tiles: readonly (readonly [number, number])[],
    atLoad: readonly (readonly [number, number])[] = [],
  ): RevealInputs => ({
    revealedRooms: new Set(rooms),
    revealedAtLoad: atLoad,
    revealedTiles: tiles,
  });
  const fresh = inputs([], []);
  const seen = inputs(
    [],
    [
      [nearRoom + WORLD_COLS, 1],
      [farWall + WORLD_COLS, 1],
    ],
  );
  const roomSeen = inputs(
    [ROOM],
    [
      [roomTile, 1],
      [nearRoom + WORLD_COLS, 1],
      [farWall + WORLD_COLS, 1],
    ],
  );
  const afterSight = () => {
    const loaded = followWireframes(w, null, fresh);
    return { inputs: seen, wireframes: followWireframes(w, { inputs: fresh, wireframes: loaded }, seen) };
  };

  it('leave the wire frames as the load worked them out while sight only reveals tiles outside rooms', () => {
    expect(followsTheOption(afterSight().wireframes)).toEqual([false, false]);
  });

  it('work them out again within two tiles of a room a look reveals, counting every tile sight revealed outside rooms', () => {
    expect(followsTheOption(followWireframes(w, afterSight(), roomSeen))).toEqual([true, false]);
  });

  it('work them out again within two tiles of a structure an explosion changed (Explosion_Control.cc SpreadEffect)', () => {
    expect(followsTheOption(followWireframes(w, afterSight(), seen, [nearRoom]))).toEqual([true, false]);
  });

  it('work every one out against the tiles revealed at the load, then those near a room revealed since, when the client has no history', () => {
    expect(followsTheOption(followWireframes(w, null, roomSeen))).toEqual([true, false]);
    const farAtLoad = inputs([ROOM], roomSeen.revealedTiles, [[farWall + WORLD_COLS, 1]]);
    expect(followsTheOption(followWireframes(w, null, farAtLoad))).toEqual([true, true]);
  });

  it('start afresh once a tile is no longer revealed, as at a load', () => {
    const lit = followWireframes(w, afterSight(), roomSeen);
    expect(followsTheOption(followWireframes(w, { inputs: roomSeen, wireframes: lit }, fresh))).toEqual([false, false]);
  });

  it('report every tile revealed so far, those of sight too, to the roof checks of the picking (WorldMan.cc IsRoofVisible)', () => {
    const { wireframes } = afterSight();
    const reveal = computeReveal(w, new Set(), new Set(), [], wireframes);
    expect([reveal.revealed[nearRoom + WORLD_COLS], reveal.revealed[farWall + WORLD_COLS], reveal.revealed[roomTile]]).toEqual([1, 1, 0]);
  });
});

describe('revealed rooms on the stub village', () => {
  let data: DataVfs;
  let world: LoadedWorld;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
    const available = new Set(data.vfs.list().map((f) => f.path));
    world = await loadWorld('stubs/world/maps/village.dat', available, (path) => data.vfs.read(path));
  });

  afterAll(async () => {
    await data?.close();
  });

  const revealWorld = () => ({
    level: world.level,
    tiles: world.tiles,
    tables: world.tables,
    structures: world.structures,
    basement: false,
  });
  const roomTiles = () => Array.from({ length: WORLD_MAX }, (_, g) => g).filter((g) => world.level.rooms[g] === ROOM);

  it('hides the roof of a revealed room and patches only the rows it touches', () => {
    const firstRoof = typeIndex(world.tables, 'FIRSTROOF');
    const revealed = computeReveal(revealWorld(), new Set([ROOM]));
    const tiles = roomTiles();
    expect(tiles.length).toBeGreaterThan(0);
    for (const g of tiles) {
      expect(revealed.revealed[g]).toBe(1);
      levelTilesAt(world.level.layers.roofs, g).forEach((t, i) => {
        if (world.tiles[t]?.type === firstRoof) expect(revealed.nodeFlags('roofs', g, i) & NodeFlags.HIDDEN).toBe(NodeFlags.HIDDEN);
      });
    }
    const changed = changedRevealTiles(computeReveal(revealWorld(), new Set()), revealed, world.level);
    expect(changed.length).toBeGreaterThan(0);
    expect(new Set(changed.map(rowOf)).size).toBeLessThan(80);
    const staticWorld: StaticWorld = {
      level: world.level,
      tiles: world.tiles,
      prepared: world.prepared,
      topY: 860,
      sprite: (tile) => ({ layer: 0, x: 0, y: tile, width: 40, height: 20, offsetX: 0, offsetY: 0, paletteBase: 0 }),
    };
    const state = { reveal: NO_REVEAL, openStructures: new Set<number>(), treeTops: true, wireframes: true, roofLevel: false };
    const scene = new StaticScene(staticWorld, state);
    const roofsBefore = roofCount(scene);
    scene.setState({ ...state, reveal: revealed }, changed.map(rowOf));
    expect(roofCount(scene)).toBeLessThan(roofsBefore);
    expect(roofCount(new StaticScene(staticWorld, { ...state, reveal: revealed }))).toBe(roofCount(scene));
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('wireframes on A9', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });

  afterAll(async () => {
    await data?.close();
  });

  it('outlines unrevealed buildings with mandatory wireframes and makes revealed walls follow the option', async () => {
    const available = new Set(data.vfs.list().map((f) => f.path));
    const w = await loadWorld('maps/a9.dat', available, (path) => data.vfs.read(path));
    const input = { level: w.level, tiles: w.tiles, tables: w.tables, structures: w.structures, basement: false };
    const hidden = computeReveal(input, new Set());
    const wired = [...hidden.touched].filter((g) => hidden.wireframes(g).length > 0);
    expect(wired.length).toBeGreaterThan(50);
    expect(wired.every((g) => hidden.wireframes(g).every((n) => !n.optional))).toBe(true);
    const rooms = new Set([...w.level.rooms].filter((r) => r !== 0));
    const open = computeReveal(input, rooms);
    expect([...open.touched].some((g) => open.wireframes(g).some((n) => n.optional))).toBe(true);
  });
});

function roofCount(scene: StaticScene): number {
  const a = scene.assemble();
  return (a.segmentStart[StaticSegment.ROOFS + 1] ?? 0) - (a.segmentStart[StaticSegment.ROOFS] ?? 0);
}
