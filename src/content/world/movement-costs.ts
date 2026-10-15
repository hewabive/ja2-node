// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc CompileWorldTerrainIDs, CompileTileMovementCosts, CompileWorldMovementCosts,
// @src RecompileLocalMovementCostsFromRadius; src/game/Tactical/PathAI.h TRAVELCOST_*. See docs/07 §2.

import { FormatError } from '../binary/errors.ts';
import { Orientation } from '../formats/jsd.ts';
import { DIRECTION_COUNT, Direction, directionIncrement, isVisibleTile, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from './grid.ts';
import { type Level, levelTilesAt } from './level.ts';
import {
  has,
  ORIENT_LEFT,
  ORIENT_RIGHT,
  STRUCTURE_ON_GROUND,
  StructureFlags,
  type StructureInstance,
  structureHeight,
  type WorldStructures,
} from './structures.ts';
import { TERRAIN_MOVEMENT_COST, Terrain, Tileset } from './terrain.ts';
import type { TileElement } from './tile-database.ts';
import { type TileTables, tileIndex } from './tile-tables.ts';

export const DOOR_COSTS_PATH = 'tables/door-costs.json';

export const TravelCost = {
  NONE: 0,
  DIRTROAD: 9,
  FLAT: 10,
  GRASS: 12,
  THICK: 16,
  DEBRIS: 20,
  SHORE: 30,
  KNEEDEEP: 36,
  DEEPWATER: 50,
  FENCE: 40,
  DOORS_CLOSED_W_SW: 212,
  DOORS_CLOSED_HERE_E: 219,
  DOOR_CLOSED_HERE: 220,
  DOOR_CLOSED_N: 221,
  DOOR_CLOSED_W: 222,
  DOOR_OPEN_HERE: 223,
  DOOR_OPEN_NW_W: 237,
  NOT_STANDING: 248,
  OFF_MAP: 249,
  BLOCKED: 249,
  CAVEWALL: 250,
  HIDDENOBSTACLE: 251,
  DOOR: 252,
  OBSTACLE: 253,
  WALL: 254,
  EXITGRID: 255,
} as const;

const MATERIAL_SANDBAG = 18;
const LEVELS = 2;

export function isDoorTravelCost(c: number): boolean {
  return c >= TravelCost.DOORS_CLOSED_W_SW && c <= TravelCost.DOOR_OPEN_NW_W;
}

export function isOpenDoorTravelCost(c: number): boolean {
  return c >= TravelCost.DOOR_OPEN_HERE && c <= TravelCost.DOOR_OPEN_NW_W;
}

export function isClosedDoorTravelCost(c: number): boolean {
  return c >= TravelCost.DOORS_CLOSED_W_SW && c <= TravelCost.DOOR_CLOSED_W;
}

type DoorKind = 'DDOOR_LEFT' | 'DDOOR_RIGHT' | 'GARAGEDOOR' | 'STANDARD';

export interface DoorCostRule {
  readonly kind: DoorKind;
  readonly orientation: string;
  readonly tile: 'any' | 'base' | 'nonBase';
  readonly notSliding: boolean;
  readonly set: readonly (readonly [number, number, number, number])[];
}

export interface DoorCostTable {
  readonly rules: readonly DoorCostRule[];
}

export function parseDoorCostTable(json: unknown): DoorCostTable {
  const t = json as DoorCostTable;
  if (!Array.isArray(t?.rules)) throw new FormatError('malformed door cost table');
  return { rules: t.rules };
}

const ORIENTATION_NAMES: Readonly<Record<number, string>> = {
  [Orientation.INSIDE_LEFT]: 'INSIDE_LEFT',
  [Orientation.INSIDE_RIGHT]: 'INSIDE_RIGHT',
  [Orientation.OUTSIDE_LEFT]: 'OUTSIDE_LEFT',
  [Orientation.OUTSIDE_RIGHT]: 'OUTSIDE_RIGHT',
};

export class MovementCosts {
  readonly values = new Uint8Array(WORLD_MAX * DIRECTION_COUNT * LEVELS);

  get(g: number, d: number, level: number): number {
    return this.values[(g * DIRECTION_COUNT + d) * LEVELS + level] ?? TravelCost.OFF_MAP;
  }

  raise(g: number, d: number, level: number, cost: number): void {
    if (g < 0 || g >= WORLD_MAX) return;
    const i = (g * DIRECTION_COUNT + d) * LEVELS + level;
    if ((this.values[i] ?? 0) < cost) this.values[i] = cost;
  }

  force(g: number, d: number, level: number, cost: number): void {
    if (g < 0 || g >= WORLD_MAX) return;
    this.values[(g * DIRECTION_COUNT + d) * LEVELS + level] = cost;
  }

  clearTile(g: number): void {
    this.values.fill(0, g * DIRECTION_COUNT * LEVELS, (g + 1) * DIRECTION_COUNT * LEVELS);
  }
}

export interface MovementWorld {
  readonly level: Level;
  readonly structures: WorldStructures;
  readonly terrain: Uint8Array;
  readonly exitGrids: ReadonlySet<number>;
  readonly doorCosts: DoorCostTable;
}

export function compileWorldTerrainIds(level: Level, db: readonly TileElement[], tables: TileTables): Uint8Array {
  const terrain = new Uint8Array(WORLD_MAX);
  const poolTiles =
    level.tilesetId === Tileset.TEMP_19
      ? new Set(['ANOTHERDEBRIS4', 'ANOTHERDEBRIS6', 'ANOTHERDEBRIS7'].map((n) => tileIndex(tables, n)))
      : null;
  for (let g = 0; g < WORLD_MAX; g++) {
    if (!isVisibleTile(g)) continue;
    const firstObject = levelTilesAt(level.layers.objects, g)[0];
    if (firstObject !== undefined && poolTiles?.has(firstObject)) {
      terrain[g] = Terrain.LOW_WATER;
      continue;
    }
    let te = firstObject !== undefined ? db[firstObject] : undefined;
    if (!te || te.terrain === Terrain.NONE) {
      const land = levelTilesAt(level.layers.land, g)[0];
      te = land !== undefined ? db[land] : undefined;
    }
    if (!te) continue;
    if (te.tileLocations.length > 1) {
      for (const loc of te.tileLocations) {
        const t = g + loc.x + loc.y * WORLD_COLS;
        if (t >= 0 && t < WORLD_MAX) terrain[t] = te.terrain;
      }
    } else {
      terrain[g] = te.terrain;
    }
  }
  return terrain;
}

function doorKind(flags: number): DoorKind {
  if (has(flags, StructureFlags.DDOOR_LEFT)) return 'DDOOR_LEFT';
  if (has(flags, StructureFlags.DDOOR_RIGHT)) return 'DDOOR_RIGHT';
  if (has(flags, StructureFlags.GARAGEDOOR)) return 'GARAGEDOOR';
  return 'STANDARD';
}

function doorOrientationKey(kind: DoorKind, orientation: number): string | null {
  if (kind !== 'GARAGEDOOR') return ORIENTATION_NAMES[orientation] ?? null;
  if (orientation & ORIENT_LEFT) return 'LEFT';
  if (orientation & ORIENT_RIGHT) return 'RIGHT';
  return null;
}

function compileDoor(costs: MovementCosts, w: MovementWorld, g: number, s: StructureInstance): void {
  const kind = doorKind(s.flags);
  const orientation = doorOrientationKey(kind, s.wallOrientation);
  if (!orientation) return;
  const base = has(s.flags, StructureFlags.BASE_TILE);
  const sliding = has(s.flags, StructureFlags.SLIDINGDOOR);
  for (const rule of w.doorCosts.rules) {
    if (rule.kind !== kind || rule.orientation !== orientation) continue;
    if ((rule.tile === 'base' && !base) || (rule.tile === 'nonBase' && base) || (rule.notSliding && sliding)) continue;
    for (const [dx, dy, d, c] of rule.set) costs.raise(g + dx + dy * WORLD_COLS, d, 0, c);
  }
}

function setAll(costs: MovementCosts, g: number, level: number, c: number): void {
  for (let d = 0; d < DIRECTION_COUNT; d++) costs.raise(g, d, level, c);
}

function setDirs(costs: MovementCosts, g: number, values: readonly number[]): void {
  values.forEach((c, d) => {
    costs.raise(g, d, 0, c);
  });
}

function compileFence(costs: MovementCosts, g: number, orientation: number): void {
  const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;
  const F = TravelCost.FENCE;
  const O = TravelCost.OBSTACLE;
  if (orientation & ORIENT_LEFT) {
    setDirs(costs, g, [F, O, O, O, F, O, O, O]);
    if (costs.get(g - WORLD_COLS, NORTH, 0) < TravelCost.BLOCKED) costs.force(g - WORLD_COLS, NORTH, 0, TravelCost.NONE);
    costs.raise(g - WORLD_COLS + 1, NORTHEAST, 0, O);
    costs.raise(g + 1, EAST, 0, O);
    costs.raise(g + WORLD_COLS + 1, SOUTHEAST, 0, O);
    if (costs.get(g + WORLD_COLS, SOUTH, 0) < TravelCost.BLOCKED) costs.force(g + WORLD_COLS, SOUTH, 0, TravelCost.NONE);
    costs.raise(g + WORLD_COLS - 1, SOUTHWEST, 0, O);
    costs.raise(g - 1, WEST, 0, O);
    costs.raise(g - WORLD_COLS - 1, NORTHWEST, 0, O);
  } else if (orientation & ORIENT_RIGHT) {
    setDirs(costs, g, [O, O, F, O, O, O, F, O]);
    costs.raise(g - WORLD_COLS, NORTH, 0, O);
    costs.raise(g - WORLD_COLS + 1, NORTHEAST, 0, O);
    if (costs.get(g + 1, EAST, 0) < TravelCost.BLOCKED) costs.force(g + 1, EAST, 0, TravelCost.NONE);
    costs.raise(g + WORLD_COLS + 1, SOUTHEAST, 0, O);
    costs.raise(g + WORLD_COLS, SOUTH, 0, O);
    costs.raise(g + WORLD_COLS - 1, SOUTHWEST, 0, O);
    if (costs.get(g - 1, WEST, 0) < TravelCost.BLOCKED) costs.force(g - 1, WEST, 0, TravelCost.NONE);
    costs.raise(g - WORLD_COLS - 1, NORTHWEST, 0, O);
  } else {
    setAll(costs, g, 0, O);
  }
}

function compileWall(costs: MovementCosts, g: number, orientation: number): void {
  const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;
  const W = TravelCost.WALL;
  if (orientation & ORIENT_LEFT) {
    costs.raise(g, NORTHEAST, 0, W);
    costs.raise(g, NORTH, 0, W);
    costs.raise(g, NORTHWEST, 0, W);
    costs.raise(g + WORLD_COLS, SOUTHEAST, 0, W);
    costs.raise(g + WORLD_COLS, SOUTH, 0, W);
    costs.raise(g + WORLD_COLS, SOUTHWEST, 0, W);
    costs.raise(g - 1, NORTHWEST, 0, W);
    costs.raise(g + 1, NORTHEAST, 0, W);
    costs.raise(g + WORLD_COLS - 1, SOUTHWEST, 0, W);
    costs.raise(g + WORLD_COLS + 1, SOUTHEAST, 0, W);
  } else if (orientation & ORIENT_RIGHT) {
    costs.raise(g, SOUTHWEST, 0, W);
    costs.raise(g, WEST, 0, W);
    costs.raise(g, NORTHWEST, 0, W);
    costs.raise(g + 1, SOUTHEAST, 0, W);
    costs.raise(g + 1, EAST, 0, W);
    costs.raise(g + 1, NORTHEAST, 0, W);
    costs.raise(g - WORLD_COLS + 1, NORTHEAST, 0, W);
    costs.raise(g - WORLD_COLS, NORTHWEST, 0, W);
    costs.raise(g + WORLD_COLS + 1, SOUTHEAST, 0, W);
    costs.raise(g + WORLD_COLS, SOUTHWEST, 0, W);
  }
}

function compileGroundStructure(costs: MovementCosts, w: MovementWorld, g: number, s: StructureInstance): void {
  const { NORTH, EAST, SOUTH, WEST } = Direction;
  if (has(s.flags, StructureFlags.PASSABLE)) {
    if (has(s.flags, StructureFlags.WIREFENCE) && has(s.flags, StructureFlags.OPEN)) {
      const N = TravelCost.NOT_STANDING;
      const O = TravelCost.OBSTACLE;
      if (s.wallOrientation & ORIENT_LEFT) setDirs(costs, g, [N, N, O, N, N, N, O, N]);
      else if (s.wallOrientation & ORIENT_RIGHT) setDirs(costs, g, [O, N, N, N, O, N, N, N]);
    }
    return;
  }
  if (has(s.flags, StructureFlags.BLOCKSMOVES)) {
    if (has(s.flags, StructureFlags.FENCE) && !has(s.flags, StructureFlags.SPECIAL)) {
      compileFence(costs, g, s.wallOrientation);
    } else if (s.def.armour === MATERIAL_SANDBAG && structureHeight(s) < 2) {
      setAll(costs, g, 0, TravelCost.OBSTACLE);
      const st = w.structures;
      if (!st.find(g - WORLD_COLS, StructureFlags.OBSTACLE) && !st.find(g + WORLD_COLS, StructureFlags.OBSTACLE)) {
        costs.force(g, NORTH, 0, TravelCost.FENCE);
        costs.force(g, SOUTH, 0, TravelCost.FENCE);
      }
      if (!st.find(g - 1, StructureFlags.OBSTACLE) && !st.find(g + 1, StructureFlags.OBSTACLE)) {
        costs.force(g, EAST, 0, TravelCost.FENCE);
        costs.force(g, WEST, 0, TravelCost.FENCE);
      }
    } else if (has(s.flags, StructureFlags.CAVEWALL)) {
      setAll(costs, g, 0, TravelCost.CAVEWALL);
    } else {
      setAll(costs, g, 0, TravelCost.OBSTACLE);
    }
    return;
  }
  if (has(s.flags, StructureFlags.ANYDOOR)) {
    compileDoor(costs, w, g, s);
    return;
  }
  if (has(s.flags, StructureFlags.WALLSTUFF)) compileWall(costs, g, s.wallOrientation);
}

export function compileTileMovementCosts(costs: MovementCosts, w: MovementWorld, g: number): void {
  if (g < 0 || g >= WORLD_MAX) return;
  const heights = w.level.heights;
  const list = w.structures.at(g);
  if (isVisibleTile(g)) {
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      if (heights[g] !== heights[g + directionIncrement(d)]) costs.raise(g, d, 0, TravelCost.OBSTACLE);
    }
    if (w.exitGrids.has(g)) setAll(costs, g, 0, TravelCost.EXITGRID);
  } else {
    setAll(costs, g, 0, TravelCost.OFF_MAP);
    setAll(costs, g, 1, TravelCost.OFF_MAP);
    if (list.length === 0) return;
  }
  const terrainCost = TERRAIN_MOVEMENT_COST[w.terrain[g] ?? 0] ?? TravelCost.FLAT;
  const hasRoof = levelTilesAt(w.level.layers.roofs, g).length > 0;
  if (list.length > 0) {
    if (levelTilesAt(w.level.layers.land, g).length > 0) setAll(costs, g, 0, terrainCost);
    let structuresOnRoof = false;
    for (const s of list) {
      if (s.cubeOffset === STRUCTURE_ON_GROUND) compileGroundStructure(costs, w, g, s);
      else if (!has(s.flags, StructureFlags.PASSABLE | StructureFlags.NORMAL_ROOF | StructureFlags.PERSON)) structuresOnRoof = true;
    }
    setAll(costs, g, 1, hasRoof && !structuresOnRoof ? TravelCost.FLAT : TravelCost.OBSTACLE);
  } else {
    setAll(costs, g, 0, terrainCost);
    setAll(costs, g, 1, hasRoof ? TravelCost.FLAT : TravelCost.OBSTACLE);
  }
}

export function compileWorldMovementCosts(w: MovementWorld): MovementCosts {
  const costs = new MovementCosts();
  for (let g = 0; g < WORLD_MAX; g++) compileTileMovementCosts(costs, w, g);
  return costs;
}

function rowColToPos(y: number, x: number): number {
  return y < 0 || y >= WORLD_ROWS || x < 0 || x >= WORLD_COLS ? -1 : y * WORLD_COLS + x;
}

export function recompileLocalMovementCosts(costs: MovementCosts, w: MovementWorld, centre: number, radius = 4): void {
  if (radius === 0) {
    costs.clearTile(centre);
    compileTileMovementCosts(costs, w, centre);
    return;
  }
  const cx = centre % WORLD_COLS;
  const cy = Math.trunc(centre / WORLD_COLS);
  for (let y = cy - radius; y < cy + radius; y++) {
    for (let x = cx - radius; x < cx + radius; x++) {
      const g = rowColToPos(y, x);
      if (g >= 0) costs.clearTile(g);
    }
  }
  for (let y = cy - radius - 1; y < cy + radius + 1; y++) {
    for (let x = cx - radius - 1; x < cx + radius + 1; x++) compileTileMovementCosts(costs, w, rowColToPos(y, x));
  }
}
