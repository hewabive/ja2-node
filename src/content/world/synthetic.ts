import { Orientation, type StructureDef } from '../formats/jsd.ts';
import { WORLD_COLS, WORLD_MAX } from './grid.ts';
import type { Level, LevelLayer } from './level.ts';
import { compileWorldMovementCosts, type DoorCostTable, type MovementCosts, type MovementWorld } from './movement-costs.ts';
import { WorldStructures } from './structures.ts';
import { Terrain } from './terrain.ts';

export function layerWith(at: (g: number) => readonly number[]): LevelLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    tiles.push(...at(g));
    offsets[g + 1] = tiles.length;
  }
  return { offsets, tiles: Uint16Array.from(tiles) };
}

export interface SyntheticStructureOptions {
  readonly armour?: number;
  readonly height?: number;
  readonly tiles?: readonly (readonly [number, number])[];
  readonly edge?: boolean;
}

const PROFILE_SIDE = 5;
const PROFILE_CELLS = PROFILE_SIDE * PROFILE_SIDE;
const FAR_EDGE = PROFILE_SIDE - 1;

function edgeCell(index: number, wallOrientation: number): boolean {
  const x = Math.trunc(index / PROFILE_SIDE);
  const y = index % PROFILE_SIDE;
  if (wallOrientation & (Orientation.INSIDE_LEFT | Orientation.OUTSIDE_LEFT)) return y === FAR_EDGE;
  if (wallOrientation & (Orientation.INSIDE_RIGHT | Orientation.OUTSIDE_RIGHT)) return x === FAR_EDGE;
  return true;
}

function profileShape(wallOrientation: number, height: number, edge: boolean): Uint8Array {
  const cubes = (1 << height) - 1;
  return Uint8Array.from({ length: PROFILE_CELLS }, (_, k) => (!edge || edgeCell(k, wallOrientation) ? cubes : 0));
}

export function syntheticStructure(
  flags: number,
  wallOrientation: number = Orientation.NONE,
  opts: SyntheticStructureOptions = {},
): StructureDef {
  const height = opts.height ?? 4;
  return {
    number: 0,
    armour: opts.armour ?? 0,
    hitPoints: 100,
    density: 100,
    flags,
    wallOrientation,
    destructionPartner: 0,
    partnerDelta: 0,
    zTileOffsetX: 0,
    zTileOffsetY: 0,
    tiles: (opts.tiles ?? [[0, 0]]).map(([x, y]) => ({
      posRelToBase: x + y * WORLD_COLS,
      xRelToBase: x,
      yRelToBase: y,
      shape: profileShape(wallOrientation, height, opts.edge === true),
      flags: 0,
      vehicleHitLocation: 0,
    })),
  };
}

export interface SyntheticWorld extends Omit<MovementWorld, 'map'> {
  readonly costs: MovementCosts;
}

export function syntheticWorld(
  doorCosts: DoorCostTable,
  place: (s: WorldStructures) => void = () => {},
  roofs: ReadonlySet<number> = new Set(),
): SyntheticWorld {
  const empty = layerWith(() => []);
  const level: Level = {
    tilesetId: 0,
    heights: new Uint8Array(WORLD_MAX),
    rooms: new Uint8Array(WORLD_MAX),
    layers: {
      land: layerWith(() => [0]),
      objects: empty,
      structs: empty,
      shadows: empty,
      roofs: layerWith((g) => (roofs.has(g) ? [0] : [])),
      onRoof: empty,
    },
  };
  const structures = new WorldStructures(level.heights);
  place(structures);
  const world: Omit<MovementWorld, 'map'> = {
    level,
    structures,
    terrain: new Uint8Array(WORLD_MAX).fill(Terrain.FLAT_GROUND),
    exitGrids: new Set(),
    doorCosts,
  };
  return { ...world, costs: compileWorldMovementCosts(world) };
}
