// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc zCorpseFilenames, GetCorpseStructIndex, AddRottingCorpse (structure part),
// @src TurnSoldierIntoCorpse (the corpses with a fixed direction); Animation_Control.cc gubAnimSurfaceCorpseID.

import { FormatError } from '../binary/errors.ts';
import { parseStructureFile, type StructureDef, type StructureFile } from '../formats/jsd.ts';
import { StructureFlags } from '../world/structures.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const CORPSES_TABLE_PATH = 'tables/corpses.json';
const TILE_CACHE_DIR = 'tilecache/';
export const STUB_TILE_CACHE_DIR = `stubs/${TILE_CACHE_DIR}`;
export const NO_CORPSE = 0;
const DIRECTIONS = 8;

export interface CorpseTable {
  readonly types: readonly string[];
  readonly files: readonly string[];
  readonly noBloodFiles: readonly string[];
  readonly twoDirectionsFrom8: readonly number[];
  readonly fourDirectionsFrom8: readonly number[];
  readonly animationCorpse: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface CorpseContent {
  readonly table: CorpseTable;
  readonly structures: ReadonlyMap<string, StructureFile>;
}

const FIXED_DIRECTION = ['QUEEN_MONSTER_DEAD', 'BURNT_DEAD', 'EXPLODE_DEAD'];
const TWO_DIRECTIONS = ['ICECREAM_DEAD', 'HUMMER_DEAD'];
const FOUR_DIRECTIONS = ['SMERC_FALL', 'SMERC_FALLF', 'MMERC_FALL', 'MMERC_FALLF', 'FMERC_FALL', 'FMERC_FALLF'];

export function parseCorpseTable(json: unknown): CorpseTable {
  const t = json as CorpseTable;
  if (!Array.isArray(t?.types) || !Array.isArray(t.files) || t.files.length !== t.types.length)
    throw new FormatError('malformed corpse table');
  return t;
}

export function corpseTypeFor(table: CorpseTable, bodyType: number, state: number): number {
  return table.animationCorpse[String(bodyType)]?.[String(state)] ?? NO_CORPSE;
}

export function hasFixedCorpseDirection(table: CorpseTable, type: number): boolean {
  return FIXED_DIRECTION.includes(table.types[type] ?? '');
}

export function corpseStructIndex(table: CorpseTable, type: number, direction: number): number {
  const name = table.types[type] ?? '';
  const oneC = (d: number) => (d + 1) % DIRECTIONS;
  if (hasFixedCorpseDirection(table, type)) return 0;
  if (TWO_DIRECTIONS.includes(name)) return oneC(table.twoDirectionsFrom8[direction] ?? 0);
  if (FOUR_DIRECTIONS.includes(name)) return oneC(table.fourDirectionsFrom8[direction] ?? 0);
  return oneC(direction);
}

export function corpseFileBase(table: CorpseTable, type: number, bloodAndGore: boolean): string {
  const file = (bloodAndGore ? table.files : table.noBloodFiles)[type] ?? '';
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

export async function loadCorpseContent(read: ReadFile, tableJson: unknown): Promise<CorpseContent> {
  const table = parseCorpseTable(tableJson);
  const names = new Set<string>();
  for (let type = 1; type < table.types.length; type++) {
    names.add(corpseFileBase(table, type, true));
    names.add(corpseFileBase(table, type, false));
  }
  const loaded = await Promise.all(
    [...names]
      .filter((name) => name !== '')
      .map(
        async (name) => [name, (await read(`${TILE_CACHE_DIR}${name}.jsd`)) ?? (await read(`${STUB_TILE_CACHE_DIR}${name}.jsd`))] as const,
      ),
  );
  const structures = new Map<string, StructureFile>();
  for (const [name, bytes] of loaded) if (bytes) structures.set(name, parseStructureFile(bytes));
  return { table, structures };
}

const STUB_CORPSE_FLAGS = StructureFlags.CORPSE | StructureFlags.GENERIC;
const LYING_BODY_PROFILE = 0b0001;

function stubCorpse(number: number): StructureDef {
  return {
    number,
    armour: 0,
    hitPoints: 0,
    density: 100,
    flags: STUB_CORPSE_FLAGS,
    wallOrientation: 0,
    destructionPartner: 0,
    partnerDelta: 0,
    zTileOffsetX: 0,
    zTileOffsetY: 0,
    tiles: [
      {
        posRelToBase: 0,
        xRelToBase: 0,
        yRelToBase: 0,
        shape: new Uint8Array(25).fill(LYING_BODY_PROFILE),
        flags: 0,
        vehicleHitLocation: 0,
      },
    ],
  };
}

export function stubCorpseStructureFiles(table: CorpseTable): ReadonlyMap<string, StructureDef[]> {
  const out = new Map<string, StructureDef[]>();
  for (let type = 1; type < table.types.length; type++) {
    for (const gore of [true, false]) {
      const name = corpseFileBase(table, type, gore);
      if (name && !out.has(name))
        out.set(
          name,
          Array.from({ length: DIRECTIONS }, (_, d) => stubCorpse(d)),
        );
    }
  }
  return out;
}
