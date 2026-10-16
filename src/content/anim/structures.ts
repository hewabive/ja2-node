// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Data.cc gAnimStructureDatabase, InitAnimationSystem, InternalGetAnimationStructureRef

import { parseStructureFile, type StructureDef, type StructureFile, type StructureTile } from '../formats/jsd.ts';
import { StructureFlags, StructureTileFlags } from '../world/structures.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const AnimStruct = { S: 0, C: 1, P: 2, F: 3, FB: 4, DEFAULT: 5, NONE: 120 } as const;
export const NUM_ANIM_STRUCTS = 6;

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

export async function loadAnimStructures(read: ReadFile): Promise<AnimStructures> {
  const bytesByName = new Map<string, Uint8Array | null>();
  const fetch = async (name: string): Promise<Uint8Array | null> => {
    if (!bytesByName.has(name)) {
      const bytes = (await read(`${ANIM_STRUCTURE_DIR}${name}.jsd`)) ?? (await read(`${STUB_ANIM_STRUCTURE_DIR}${name}.jsd`));
      bytesByName.set(name, bytes);
    }
    return bytesByName.get(name) ?? null;
  };
  const result: (StructureFile | null)[][] = [];
  for (let body = 0; body < ANIM_STRUCTURE_FILES.length; body++) {
    const row: (StructureFile | null)[] = [];
    const names = ANIM_STRUCTURE_FILES[body] ?? [];
    for (let type = 0; type < NUM_ANIM_STRUCTS; type++) {
      const bytes = await fetch(names[type] ?? '');
      if (!bytes) {
        row.push(null);
        continue;
      }
      const file = parseStructureFile(bytes);
      row.push(body <= LAST_MERC_BODY && type === AnimStruct.P ? withPassableNonBaseTiles(file) : file);
    }
    result.push(row);
  }
  return result;
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
};

export function stubAnimStructureFiles(): ReadonlyMap<string, StructureDef[]> {
  return new Map(
    Object.entries(STUB_SHAPES).map(([name, shape]) => [name, Array.from({ length: 8 }, (_, d) => syntheticPerson(d, shape))]),
  );
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
