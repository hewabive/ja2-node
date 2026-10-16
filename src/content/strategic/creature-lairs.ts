// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/strategic/CreatureLairModel.cc (deserialize, creatureHabitatFromString, insertionCodeFromString);
// @src src/game/Strategic/Creature_Spreading.h CreatureHabitat. See docs/17 §12.1.

import { FormatError } from '../binary/errors.ts';
import { asArray, asInt, asObject, asString } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const CREATURE_LAIRS_PATH = 'externalized/strategic-map-creature-lairs.json';

export const CreatureHabitat = {
  QUEEN_LAIR: 0,
  LAIR: 1,
  LAIR_ENTRANCE: 2,
  INNER_MINE: 3,
  OUTER_MINE: 4,
  FEEDING_GROUNDS: 5,
  MINE_EXIT: 6,
} as const;

const HABITATS: Readonly<Record<string, number>> = CreatureHabitat;

export const LairInsertionCode = {
  NORTH: 0,
  SOUTH: 1,
  EAST: 2,
  WEST: 3,
  GRIDNO: 4,
  ARRIVING_GAME: 5,
  CHOPPER: 6,
  PRIMARY_EDGEINDEX: 7,
  SECONDARY_EDGEINDEX: 8,
  CENTER: 9,
} as const;

const INSERTION_CODES: Readonly<Record<string, number>> = LairInsertionCode;

export interface CreatureLairSector {
  readonly sector: number;
  readonly z: number;
  readonly habitat: number;
}

export interface CreatureAttackSector {
  readonly sector: number;
  readonly chance: number;
  readonly insertionCode: number;
  readonly insertionGridNo: number;
}

export interface CreatureLair {
  readonly lairId: number;
  readonly associatedMineId: number;
  readonly entranceSector: number;
  readonly entranceSectorLevel: number;
  readonly sectors: readonly CreatureLairSector[];
  readonly attackSectors: readonly CreatureAttackSector[];
  readonly warpExitSector: number;
  readonly warpExitGridNo: number;
}

function habitatOf(value: unknown, what: string): number {
  const habitat = HABITATS[asString(value, what)];
  if (habitat === undefined) throw new FormatError(`${what}: unrecognized creature habitat ${String(value)}`);
  return habitat;
}

function insertionOf(value: unknown, what: string): number {
  const code = INSERTION_CODES[asString(value, what)];
  if (code === undefined) throw new FormatError(`${what}: unrecognized insertion code ${String(value)}`);
  return code;
}

function lairSectors(value: unknown, what: string): CreatureLairSector[] {
  const sectors = asArray(value, what).map((entry, i) => {
    const row = asArray(entry, `${what}[${i}]`);
    return {
      sector: parseSectorId(asString(row[0], `${what}[${i}][0]`)),
      z: asInt(row[1], `${what}[${i}][1]`),
      habitat: habitatOf(row[2], `${what}[${i}][2]`),
    };
  });
  if (sectors.length === 0) throw new FormatError(`${what}: lair has no lair sectors`);
  return sectors;
}

function attackSectors(value: unknown, what: string): CreatureAttackSector[] {
  const attacks = asArray(value, what).map((entry, i) => {
    const o = asObject(entry, `${what}[${i}]`);
    return {
      sector: parseSectorId(asString(o.sector, `${what}[${i}].sector`)),
      chance: asInt(o.chance, `${what}[${i}].chance`),
      insertionCode: insertionOf(o.insertionCode, `${what}[${i}].insertionCode`),
      insertionGridNo: o.insertionGridNo === undefined ? 0 : asInt(o.insertionGridNo, `${what}[${i}].insertionGridNo`),
    };
  });
  if (attacks.length === 0) throw new FormatError(`${what}: lair has no town attack sectors`);
  return attacks;
}

export function parseCreatureLairs(json: unknown): CreatureLair[] {
  return asArray(json, 'creature lairs').map((v, i) => {
    const what = `creature lairs[${i}]`;
    const o = asObject(v, what);
    const entrance = asArray(o.entranceSector, `${what}.entranceSector`);
    const warp = asObject(o.warpExit, `${what}.warpExit`);
    return {
      lairId: asInt(o.lairId, `${what}.lairId`),
      associatedMineId: asInt(o.associatedMineId, `${what}.associatedMineId`),
      entranceSector: parseSectorId(asString(entrance[0], `${what}.entranceSector[0]`)),
      entranceSectorLevel: asInt(entrance[1], `${what}.entranceSector[1]`),
      sectors: lairSectors(o.sectors, `${what}.sectors`),
      attackSectors: attackSectors(o.attackSectors, `${what}.attackSectors`),
      warpExitSector: parseSectorId(asString(warp.sector, `${what}.warpExit.sector`)),
      warpExitGridNo: asInt(warp.gridNo, `${what}.warpExit.gridNo`),
    };
  });
}

export function lairContainsSector(lair: CreatureLair, sector: number, z: number): boolean {
  return lair.sectors.some((s) => s.sector === sector && s.z === z);
}
