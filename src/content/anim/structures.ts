// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Data.cc gAnimStructureDatabase, InitAnimationSystem, InternalGetAnimationStructureRef

import { parseStructureFile, type StructureDef, type StructureFile, type StructureTile } from '../formats/jsd.ts';
import { WORLD_COLS } from '../world/grid.ts';
import { StructureFlags, StructureTileFlags } from '../world/structures.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const AnimStruct = { S: 0, C: 1, P: 2, F: 3, FB: 4, DEFAULT: 5, NONE: 120 } as const;
export const NUM_ANIM_STRUCTS = 6;
const NUM_DIRECTIONS = 8;

const ANIM_STRUCTURE_DIR = 'anims/structdata/';
export const STUB_ANIM_STRUCTURE_DIR = `stubs/${ANIM_STRUCTURE_DIR}`;

const merc = ['m_stand', 'm_crouch', 'm_prone', 'm_fall', 'm_fallback', 'm_crouch'];
const aaaaab = (a: string, b: string) => [a, a, a, a, a, b];
const aaaaaa = (a: string) => [a, a, a, a, a, a];

export const ANIM_STRUCTURE_FILES: readonly (readonly string[])[] = [
  merc,
  merc,
  merc,
  merc,
  aaaaab('mn_breat', 'm_crouch'),
  aaaaab('mn_breat', 'm_crouch'),
  aaaaab('mn_breat', 'm_crouch'),
  aaaaab('mn_breat', 'm_crouch'),
  aaaaab('l_breath', 'm_crouch'),
  aaaaaa('i_breath'),
  aaaaab('q_ready', 'm_crouch'),
  merc,
  merc,
  merc,
  merc,
  ['k_stand', 'k_crouch', 'k_crouch', 'm_prone', 'm_prone', 'm_prone'],
  ['k_stand', 'k_crouch', 'k_crouch', 'm_prone', 'm_prone', 'm_prone'],
  ['m_crouch', 'm_crouch', 'm_crouch', 'm_fall', 'm_fallback', 'm_crouch'],
  aaaaab('cw_breath', 'm_crouch'),
  ['cr_stand', 'cr_crouch', 'cr_prone', 'cr_prone', 'cr_prone', 'm_crouch'],
  aaaaab('ct_breath', 'm_crouch'),
  aaaaaa('j_r_bret'),
  aaaaab('hmmv', 'm_crouch'),
  aaaaab('tnk_sht', 'm_crouch'),
  aaaaab('tnk2_rot', 'm_crouch'),
  aaaaab('hmmv', 'm_crouch'),
  aaaaab('hmmv', 'm_crouch'),
  aaaaab('hmmv', 'm_crouch'),
];

const LAST_MERC_BODY = 3;

export type AnimStructures = readonly (readonly (StructureFile | null)[])[];

function withPassableNonBaseTiles(file: StructureFile): StructureFile {
  return {
    ...file,
    structures: file.structures.map((def) =>
      def
        ? {
            ...def,
            tiles: def.tiles.map(
              (tile): StructureTile => (tile.posRelToBase !== 0 ? { ...tile, flags: tile.flags | StructureTileFlags.PASSABLE } : tile),
            ),
          }
        : null,
    ),
  };
}

async function readAnimStructure(read: ReadFile, name: string): Promise<Uint8Array | null> {
  return (await read(`${ANIM_STRUCTURE_DIR}${name}.jsd`)) ?? (await read(`${STUB_ANIM_STRUCTURE_DIR}${name}.jsd`));
}

export async function loadAnimStructures(read: ReadFile): Promise<AnimStructures> {
  const names = [...new Set(ANIM_STRUCTURE_FILES.flat())].filter((name) => name !== '');
  const bytesByName = new Map(await Promise.all(names.map(async (name) => [name, await readAnimStructure(read, name)] as const)));
  return ANIM_STRUCTURE_FILES.map((files, body) =>
    Array.from({ length: NUM_ANIM_STRUCTS }, (_, type) => {
      const bytes = bytesByName.get(files[type] ?? '');
      if (!bytes) return null;
      const file = parseStructureFile(bytes);
      return body <= LAST_MERC_BODY && type === AnimStruct.P ? withPassableNonBaseTiles(file) : file;
    }),
  );
}

const STATES_USING_STANDING_STRUCT = ['FALLFORWARD_FROMHIT_STAND', 'GENERIC_HIT_STAND', 'FALLFORWARD_FROMHIT_CROUCH', 'STANDING_BURST_HIT'];

export function animStructType(surfaceStruct: number, stateName: string): number {
  if (surfaceStruct === AnimStruct.NONE) return AnimStruct.NONE;
  return STATES_USING_STANDING_STRUCT.includes(stateName) ? AnimStruct.S : surfaceStruct;
}

const PERSON_FLAGS = StructureFlags.MOBILE | StructureFlags.TRANSPARENT | StructureFlags.GENERIC;
const CENTRE = 12;
const ORTHOGONAL = [7, 11, 13, 17];

function personShape(centre: number, sides: number): Uint8Array {
  const shape = new Uint8Array(25);
  shape[CENTRE] = centre;
  for (const c of ORTHOGONAL) shape[c] = sides;
  return shape;
}

function syntheticPerson(number: number, shape: Uint8Array): StructureDef {
  return {
    number,
    armour: 0,
    hitPoints: 0,
    density: 100,
    flags: PERSON_FLAGS,
    wallOrientation: 0,
    destructionPartner: 0,
    partnerDelta: 0,
    zTileOffsetX: 0,
    zTileOffsetY: 0,
    tiles: [{ posRelToBase: 0, xRelToBase: 0, yRelToBase: 0, shape, flags: 0, vehicleHitLocation: 0 }],
  };
}

const VEHICLE_FLAGS = StructureFlags.MOBILE | StructureFlags.TRANSPARENT | StructureFlags.VEHICLE;
const MATERIAL_THICKER_METAL = 22;
const MATERIAL_HEAVY_METAL = 23;
const PROFILE_CELLS = 25;
const LOW_BODY = 0b0011;
const TALL_BODY = 0b0111;
const TANK_HULL = TALL_BODY;
const TANK_TURRET = 0b1111;
const FACING_STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

interface StubVehicleShape {
  readonly armour: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  cubes(along: number, across: number): number;
}

const HUMMER_SHAPE: StubVehicleShape = {
  armour: MATERIAL_THICKER_METAL,
  halfLength: 2.5,
  halfWidth: 1.5,
  cubes: (along) => (along > 0 ? LOW_BODY : TALL_BODY),
};

const TANK_TURRET_HALF_LENGTH = 1.5;
const TANK_TURRET_HALF_WIDTH = 1;
const TANK_SHAPE: StubVehicleShape = {
  armour: MATERIAL_HEAVY_METAL,
  halfLength: 3.5,
  halfWidth: 1.5,
  cubes: (along, across) =>
    Math.abs(along) < TANK_TURRET_HALF_LENGTH && Math.abs(across) < TANK_TURRET_HALF_WIDTH ? TANK_TURRET : TANK_HULL,
};

const STUB_VEHICLE_SHAPES: Readonly<Record<string, StubVehicleShape>> = {
  hmmv: HUMMER_SHAPE,
  tnk_sht: TANK_SHAPE,
  tnk2_rot: TANK_SHAPE,
};

function directionOfStructure(number: number): number {
  return (number + NUM_DIRECTIONS - 1) % NUM_DIRECTIONS;
}

function vehicleTile(x: number, y: number, cubes: number): StructureTile {
  return {
    posRelToBase: x + y * WORLD_COLS,
    xRelToBase: x,
    yRelToBase: y,
    shape: new Uint8Array(PROFILE_CELLS).fill(cubes),
    flags: 0,
    vehicleHitLocation: 0,
  };
}

function vehicleFootprint(shape: StubVehicleShape, direction: number): StructureTile[] {
  const [fx, fy] = FACING_STEPS[direction] ?? [0, -1];
  const length = Math.hypot(fx, fy);
  const reach = Math.ceil(Math.max(shape.halfLength, shape.halfWidth) * Math.SQRT2);
  const tiles: StructureTile[] = [];
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      const along = (x * fx + y * fy) / length;
      const across = (y * fx - x * fy) / length;
      if (Math.abs(along) >= shape.halfLength || Math.abs(across) >= shape.halfWidth) continue;
      const tile = vehicleTile(x, y, shape.cubes(along, across));
      if (x === 0 && y === 0) tiles.unshift(tile);
      else tiles.push(tile);
    }
  }
  return tiles;
}

function syntheticVehicle(number: number, shape: StubVehicleShape): StructureDef {
  return {
    number,
    armour: shape.armour,
    hitPoints: 0,
    density: 100,
    flags: VEHICLE_FLAGS,
    wallOrientation: 0,
    destructionPartner: 0,
    partnerDelta: 0,
    zTileOffsetX: 0,
    zTileOffsetY: 0,
    tiles: vehicleFootprint(shape, directionOfStructure(number)),
  };
}

const STUB_SHAPES: Readonly<Record<string, Uint8Array>> = {
  m_stand: personShape(0b0111, 0b0011),
  m_crouch: personShape(0b0011, 0b0001),
  m_prone: personShape(0b0001, 0b0001),
  m_fall: personShape(0b0001, 0b0001),
  m_fallback: personShape(0b0001, 0b0001),
  k_stand: personShape(0b0011, 0b0001),
  mn_breat: personShape(0b0011, 0b0001),
  l_breath: personShape(0b0001, 0b0001),
  i_breath: personShape(0b0001, 0b0001),
  q_ready: personShape(0b0111, 0b0011),
  ct_breath: personShape(0b0011, 0b0001),
  cw_breath: personShape(0b0011, 0b0011),
  cr_stand: personShape(0b0001, 0b0001),
  cr_crouch: personShape(0b0001, 0b0001),
  cr_prone: personShape(0b0001, 0b0001),
  j_r_bret: personShape(0b0011, 0b0001),
};

export function stubAnimStructureFiles(): ReadonlyMap<string, StructureDef[]> {
  return new Map([
    ...Object.entries(STUB_SHAPES).map(([name, shape]): [string, StructureDef[]] => [
      name,
      Array.from({ length: NUM_DIRECTIONS }, (_, d) => syntheticPerson(d, shape)),
    ]),
    ...Object.entries(STUB_VEHICLE_SHAPES).map(([name, shape]): [string, StructureDef[]] => [
      name,
      Array.from({ length: NUM_DIRECTIONS }, (_, n) => syntheticVehicle(n, shape)),
    ]),
  ]);
}

export function stubAnimStructures(): AnimStructures {
  const files = new Map(
    [...stubAnimStructureFiles()].map(([name, structures]): [string, StructureFile] => [
      name,
      { structureCount: structures.length, auxData: null, tileLocations: [], structures },
    ]),
  );
  return ANIM_STRUCTURE_FILES.map((names) => names.map((n) => files.get(n) ?? null));
}
