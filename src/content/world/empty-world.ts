import { LAYER_NAMES, type LayerName, type MapDef, type MapInformation, type TileLayer } from '../formats/map.ts';
import { WORLD_MAX } from './grid.ts';
import type { Level, LevelLayer } from './level.ts';
import { compileWorldMovementCosts, type MovementWorld } from './movement-costs.ts';
import { RestrictedScroll } from './render-bounds.ts';
import { WorldStructures } from './structures.ts';
import type { TacticalWorld } from './tactical-world.ts';
import type { TileTables } from './tile-tables.ts';

export const EMPTY_WORLD_PATH = '';

const NO_GRIDNO = -1;

const NO_MAP_INFORMATION: MapInformation = {
  northGridNo: NO_GRIDNO,
  eastGridNo: NO_GRIDNO,
  southGridNo: NO_GRIDNO,
  westGridNo: NO_GRIDNO,
  numIndividuals: 0,
  mapVersion: 0,
  restrictedScrollId: RestrictedScroll.NONE,
  editorSmoothingType: 0,
  centerGridNo: NO_GRIDNO,
  isolatedGridNo: NO_GRIDNO,
};

const NO_TILE_TABLES: TileTables = {
  numberOfTiles: 0,
  types: [],
  shadowBuddies: [],
  doorAnimations: { open: [], openShadow: [], closed: [], closedShadow: [] },
  fullBaseTileValues: [],
  tileNames: [],
  tileIndexByName: new Map(),
  typeIndexByName: new Map(),
};

function layers<T>(layer: T): Readonly<Record<LayerName, T>> {
  return Object.fromEntries(LAYER_NAMES.map((name) => [name, layer])) as Record<LayerName, T>;
}

function emptyMap(heights: Uint8Array, rooms: Uint8Array, offsets: Uint32Array): MapDef {
  const tileLayer: TileLayer = { offsets, types: new Uint8Array(0), subIndices: new Uint16Array(0) };
  return {
    majorVersion: 0,
    minorVersion: 0,
    flags: 0,
    tilesetId: 0,
    heights,
    worldFlags: new Uint8Array(WORLD_MAX),
    layers: layers(tileLayer),
    rooms,
    items: [],
    ambient: null,
    lights: null,
    info: NO_MAP_INFORMATION,
    placements: [],
    exitGrids: [],
    doors: [],
    edgepoints: null,
    schedules: [],
    trailingBytes: 0,
  };
}

export function emptyTacticalWorld(): TacticalWorld {
  const heights = new Uint8Array(WORLD_MAX);
  const rooms = new Uint8Array(WORLD_MAX);
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const levelLayer: LevelLayer = { offsets, tiles: new Uint16Array(0) };
  const level: Level = { tilesetId: 0, heights, rooms, layers: layers(levelLayer) };
  const map = emptyMap(heights, rooms, offsets);
  const movement: MovementWorld = {
    map,
    level,
    structures: new WorldStructures(heights),
    terrain: new Uint8Array(WORLD_MAX),
    exitGrids: new Set(),
    doorCosts: { rules: [] },
  };
  return {
    ...movement,
    mapPath: EMPTY_WORLD_PATH,
    map,
    tables: NO_TILE_TABLES,
    tiles: [],
    level,
    structures: movement.structures,
    terrain: movement.terrain,
    costs: compileWorldMovementCosts(movement),
    rejectedStructs: 0,
  };
}
