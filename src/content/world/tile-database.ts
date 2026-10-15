// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/TileDef.cc CreateTileDatabase; TileDat.cc SetSpecificDatabaseValues;
// @src src/game/TileEngine/Tile_Surface.cc LoadTileSurface, SetRaisedObjectFlag

import { Orientation, type StructureDef, type StructureFile, type TileLocation } from '../formats/jsd.ts';
import type { StiAppData } from '../formats/sti.ts';
import { StructureFlags } from './structures.ts';
import { isShorePiece, surfaceTerrainTable, Terrain } from './terrain.ts';
import { type TileTables, tileIndex, typeIndex } from './tile-tables.ts';
import { type FrameGeometry, tileSurfaceZStrips, type ZStripInfo } from './zstrip.ts';

export const TileFlags = {
  WALL: 1 << 0,
  ANIMATED: 1 << 1,
  DYNAMIC: 1 << 2,
  IGNORE_WORLD_HEIGHT: 1 << 3,
  FULL3D: 1 << 4,
  MULTI_Z: 1 << 5,
  OBJECTLAYER_USEZHEIGHT: 1 << 6,
  ROOFSHADOW: 1 << 7,
  ROOF: 1 << 8,
  HAS_SHADOW_BUDDY: 1 << 9,
  AFRAME: 1 << 10,
  CLIFFHANG: 1 << 11,
  UNDERFLOW_FILLER: 1 << 12,
} as const;

const MATERIAL_PLYWOOD_WALL = 2;
const AUX_FULL_TILE = 0x01;
const AUX_ANIMATED_TILE = 0x02;
const DOOR_ANIMATION_FRAMES = 5;
const WALL_AFRAME_START = 31;
const WALL_AFRAME_END = 34;
const RAISED_OBJECT_FILES = new Set([
  'bones',
  'bones2',
  'grass2',
  'grass3',
  'l_weed3',
  'litter',
  'miniweed',
  'sblast',
  'sweeds',
  'twigs',
  'wing',
]);
const RAISED_OBJECT_TYPES = ['DEBRISWOOD', 'DEBRISWEEDS', 'DEBRIS2MISC', 'ANOTHERDEBRIS'];

export interface TileSurface {
  readonly type: number;
  readonly path: string;
  readonly frames: readonly FrameGeometry[];
  readonly auxData: readonly StiAppData[] | null;
  readonly structures: StructureFile | null;
}

export interface TileElement {
  readonly index: number;
  readonly type: number;
  readonly surfacePath: string;
  readonly regionIndex: number;
  readonly flags: number;
  readonly wallOrientation: number;
  readonly fullTile: number;
  readonly buddy: number;
  readonly terrain: number;
  readonly structure: StructureDef | null;
  readonly structureFile: StructureFile | null;
  readonly zStrip: ZStripInfo | null;
  readonly tileLocations: readonly TileLocation[];
  readonly animationFrames: readonly number[] | null;
}

interface MutableTile {
  index: number;
  type: number;
  surfacePath: string;
  regionIndex: number;
  flags: number;
  wallOrientation: number;
  fullTile: number;
  buddy: number;
  terrain: number;
  structure: StructureDef | null;
  structureFile: StructureFile | null;
  zStrip: ZStripInfo | null;
  tileLocations: readonly TileLocation[];
  animationFrames: number[] | null;
}

function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file).toLowerCase();
}

function isRaisedObjectSurface(tables: TileTables, s: TileSurface): boolean {
  return RAISED_OBJECT_TYPES.some((t) => typeIndex(tables, t) === s.type) && RAISED_OBJECT_FILES.has(baseName(s.path));
}

function between(tables: TileTables, first: string, last: string, index: number): boolean {
  return tileIndex(tables, first) <= index && index <= tileIndex(tables, last);
}

function typeBetween(tables: TileTables, first: string, last: string, type: number): boolean {
  return typeIndex(tables, first) <= type && type <= typeIndex(tables, last);
}

function animate(te: MutableTile, forward: boolean): void {
  te.animationFrames = Array.from({ length: DOOR_ANIMATION_FRAMES }, (_, k) => (forward ? te.index + k : te.index - k));
}

function applySpecificValues(tables: TileTables, db: MutableTile[], te: MutableTile, raised: boolean): void {
  const i = te.index;
  const type = te.type;
  for (const b of tables.shadowBuddies) {
    if (type === b.shadowType) {
      te.buddy = i - b.firstShadowTile + b.firstStructureTile;
      te.flags |= db[te.buddy]?.flags ?? 0;
      break;
    }
    if (type === b.structureType) {
      te.buddy = i - b.firstStructureTile + b.firstShadowTile;
      te.flags |= TileFlags.HAS_SHADOW_BUDDY;
      break;
    }
  }
  if (between(tables, 'FIRSTDOOR1', 'FOURTHDOORSH20', i)) {
    const d = tables.doorAnimations;
    if (d.open.includes(i) || d.openShadow.includes(i)) animate(te, true);
    if (d.closed.includes(i) || d.closedShadow.includes(i)) animate(te, false);
  }
  if (i === tileIndex(tables, 'FIRSTMISS1')) animate(te, true);
  if (between(tables, 'FIRSTMISS1', 'FIRSTMISS5', i)) te.flags |= TileFlags.DYNAMIC;
  if (['WINDOWSHATTER1', 'WINDOWSHATTER6', 'WINDOWSHATTER11', 'WINDOWSHATTER16'].some((n) => tileIndex(tables, n) === i)) animate(te, true);
  if (between(tables, 'WINDOWSHATTER1', 'WINDOWSHATTER20', i)) te.flags |= TileFlags.DYNAMIC;
  if (type === typeIndex(tables, 'BODYEXPLOSION')) te.flags |= TileFlags.DYNAMIC;
  if (raised) te.flags |= TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (between(tables, 'FIRSTFULLSTRUCT1', 'SECONDFULLSTRUCT12', i)) {
    const position = (i - (tables.types[type]?.start ?? 0)) % 3;
    if (position === 0) te.flags |= TileFlags.FULL3D;
    if (position === 1) te.flags |= TileFlags.DYNAMIC;
  }
  if (between(tables, 'FIRSTCLIFFHANG1', 'FIRSTCLIFFSHADOW17', i)) {
    if (type === typeIndex(tables, 'FIRSTCLIFFHANG')) te.flags |= TileFlags.CLIFFHANG;
    te.flags |= TileFlags.IGNORE_WORLD_HEIGHT;
  }
  if (between(tables, 'FIRSTWALL1', 'FOURTHWALL65', i)) te.flags |= TileFlags.WALL;
  if (between(tables, 'FIRSTWALL1', 'FOURTHWALL47', i)) {
    const start = tables.types[type]?.start ?? 0;
    if (start + WALL_AFRAME_START <= i && i <= start + WALL_AFRAME_END) te.flags |= TileFlags.AFRAME;
  }
  if (between(tables, 'FOOTPRINTS1', 'THIRDPOINTERS2', i)) te.flags |= TileFlags.DYNAMIC | TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (typeIndex(tables, 'FOOTPRINTS') <= type && type < typeIndex(tables, 'WIREFRAMES')) te.flags |= TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (typeBetween(tables, 'HUMANBLOOD', 'CREATUREBLOOD', type)) te.flags |= TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (typeBetween(tables, 'GUNS', 'P2ITEMS', type) || type === typeIndex(tables, 'P3ITEMS')) te.flags |= TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (typeBetween(tables, 'FIRSTEXPLDEBRIS', 'SECONDEXPLDEBRIS', type)) te.flags |= TileFlags.OBJECTLAYER_USEZHEIGHT;
  if (i === tileIndex(tables, 'MOCKFLOOR1')) te.flags |= TileFlags.DYNAMIC;
  if (type === typeIndex(tables, 'BULLETTILE')) te.flags |= TileFlags.DYNAMIC;
  if (between(tables, 'FIRSTFLOOR1', 'FOURTHFLOOR8', i)) te.fullTile = 1;
  if (i <= tileIndex(tables, 'DEEPWATERTEXTURE10')) te.fullTile = tables.fullBaseTileValues[i] ?? 0;
  if (isShorePiece(tables, i)) te.terrain = Terrain.FLAT_GROUND;
  if (
    typeBetween(tables, 'FIRSTROOF', 'SECONDSLANTROOF', type) ||
    type === typeIndex(tables, 'FIRSTHIGHROOF') ||
    type === typeIndex(tables, 'SECONDHIGHROOF')
  ) {
    te.flags |= TileFlags.ROOF;
  }
}

function withFlags(def: StructureDef, set: number, clear: number): StructureDef {
  return { ...def, flags: ((def.flags & ~clear) | set) >>> 0 };
}

function fixDoubleDoors(file: StructureFile, orientation0: number): { file: StructureFile; orientation0: number } {
  const s = file.structures;
  const ddoor = StructureFlags.DDOOR_LEFT | StructureFlags.DDOOR_RIGHT;
  const first = s[0];
  if (!first || !(first.flags & ddoor) || orientation0 !== Orientation.OUTSIDE_RIGHT || s[4]?.tiles.length !== 1)
    return { file, orientation0 };
  const fixed = [...s];
  const edit = (n: number, f: (d: StructureDef) => StructureDef) => {
    const d = fixed[n];
    if (d) fixed[n] = f(d);
  };
  edit(0, (d) => ({ ...d, wallOrientation: Orientation.INSIDE_RIGHT }));
  edit(4, (d) => ({ ...d, wallOrientation: Orientation.INSIDE_RIGHT, armour: MATERIAL_PLYWOOD_WALL }));
  edit(5, (d) => ({ ...d, wallOrientation: Orientation.INSIDE_LEFT }));
  edit(9, (d) => ({ ...d, wallOrientation: Orientation.INSIDE_LEFT }));
  for (const n of [10, 14]) edit(n, (d) => withFlags(d, StructureFlags.DDOOR_LEFT, StructureFlags.DDOOR_RIGHT));
  for (const n of [15, 19]) edit(n, (d) => withFlags(d, StructureFlags.DDOOR_RIGHT, StructureFlags.DDOOR_LEFT));
  return { file: { ...file, structures: fixed }, orientation0: Orientation.INSIDE_RIGHT };
}

export function buildTileDatabase(tables: TileTables, surfaces: readonly (TileSurface | null)[], tilesetId = 0): TileElement[] {
  const db: MutableTile[] = [];
  const surfaceTerrain = surfaceTerrainTable(tables, tilesetId);
  const firstDoorType = typeIndex(tables, 'FIRSTDOOR');
  const lastDoorType = typeIndex(tables, 'FOURTHDOOR');
  const fresh = (type: number, surfacePath: string, regionIndex: number): MutableTile => ({
    index: db.length,
    type,
    surfacePath,
    regionIndex,
    flags: 0,
    wallOrientation: 0,
    fullTile: 0,
    buddy: -1,
    terrain: Terrain.NONE,
    structure: null,
    structureFile: null,
    zStrip: null,
    tileLocations: [],
    animationFrames: null,
  });
  for (const t of tables.types) {
    const surface = surfaces[t.index] ?? null;
    if (!surface) {
      for (let k = 0; k < t.count; k++) db.push({ ...fresh(t.index, '', 0), flags: TileFlags.UNDERFLOW_FILLER });
      continue;
    }
    const zStrips = surface.structures ? tileSurfaceZStrips(surface.frames, surface.structures) : surface.frames.map(() => null);
    const raised = isRaisedObjectSurface(tables, surface);
    const regions = Math.min(surface.frames.length, t.count);
    let structureFile = surface.structures;
    for (let k = 0; k < regions; k++) {
      const te = fresh(t.index, surface.path, k);
      te.zStrip = zStrips[k] ?? null;
      if (te.zStrip) te.flags |= TileFlags.MULTI_Z;
      te.terrain = surfaceTerrain.get(t.index) ?? Terrain.NONE;
      const aux = surface.auxData?.[k];
      if (aux) {
        if (aux.flags & AUX_FULL_TILE) te.fullTile = 1;
        if (aux.flags & AUX_ANIMATED_TILE) {
          te.animationFrames = Array.from({ length: aux.numberOfFrames }, (_, f) => te.index - aux.currentFrame + f);
          te.flags |= TileFlags.ANIMATED;
        }
        te.wallOrientation = aux.wallOrientation;
        if (aux.numberOfTiles > 0) {
          const locations = surface.structures?.tileLocations ?? [];
          te.tileLocations = locations.slice(aux.tileLocationIndex, aux.tileLocationIndex + aux.numberOfTiles);
        }
      }
      applySpecificValues(tables, db, te, raised);
      if (structureFile?.structures[k] && k === 0 && firstDoorType <= t.index && t.index <= lastDoorType) {
        const fixed = fixDoubleDoors(structureFile, te.wallOrientation);
        structureFile = fixed.file;
        te.wallOrientation = fixed.orientation0;
      }
      te.structure = structureFile?.structures[k] ?? null;
      te.structureFile = structureFile;
      db.push(te);
    }
    for (let k = regions; k < t.count; k++) db.push({ ...fresh(t.index, surface.path, 0), flags: TileFlags.UNDERFLOW_FILLER });
  }
  return db;
}
