// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/externalized/strategic/{MovementCostsModel,TraversibilityMapping,TownModel,SectorLandTypes,UndergroundSectorModel,
// @src SamSiteModel,SamSiteAirControlModel,StrategicMapSecretModel,CacheSectorsModel,BloodCatPlacementsModel,BloodCatSpawnsModel}.cc;
// @src src/game/Strategic/Strategic_Movement_Costs.cc InitStrategicMovementCosts. See docs/16 §1.6–§1.7.

import { FormatError } from '../binary/errors.ts';
import {
  asArray,
  asBool,
  asInt,
  asObject,
  asString,
  intArray,
  intArrayByDifficulty,
  type JsonObject,
  optionalBool,
} from './json-fields.ts';
import { MAP_SIDE, parseSectorId, SECTOR_COUNT } from './sector-ids.ts';

export const StrategicMove = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3, THROUGH: 4 } as const;
export const TRAVERSABILITY_DIRECTIONS = 5;

export const AdjacentSector = { NONE: 0, NORTH: 0x01, EAST: 0x02, SOUTH: 0x04, WEST: 0x08 } as const;
const ADJACENCY_LETTERS: Readonly<Record<string, number>> = {
  N: AdjacentSector.NORTH,
  E: AdjacentSector.EAST,
  S: AdjacentSector.SOUTH,
  W: AdjacentSector.WEST,
};

export type TraversabilityMap = ReadonlyMap<string, number>;

export interface MovementCosts {
  readonly traversability: readonly (readonly number[])[];
  readonly travelRatings: readonly number[];
}

export interface Town {
  readonly townId: number;
  readonly internalName: string;
  readonly sectors: readonly number[];
  readonly militiaMapBaseSector: number;
  readonly isMilitiaTrainingAllowed: boolean;
}

export interface SectorDescription {
  readonly sector: number;
  readonly z: number;
  readonly landType: number;
}

export interface UndergroundTemplate {
  readonly sector: number;
  readonly z: number;
  readonly adjacentSectors: number;
  readonly numTroops: readonly number[];
  readonly numElites: readonly number[];
  readonly numCreatures: readonly number[];
  readonly numTroopsVariance: readonly number[];
  readonly numElitesVariance: readonly number[];
  readonly numCreaturesVariance: readonly number[];
}

export interface SamSite {
  readonly sector: number;
  readonly gridNos: readonly number[];
}

export interface MapSecret {
  readonly sector: number;
  readonly isSamSite: boolean;
  readonly secretLandType: number;
  readonly foundLandType: number;
}

export interface CacheSectors {
  readonly sectors: readonly number[];
  readonly numTroops: readonly number[];
  readonly numTroopsVariance: readonly number[];
}

export interface BloodCatPlacement {
  readonly sector: number;
  readonly placements: number;
}

export interface BloodCatSpawn {
  readonly sector: number;
  readonly isLair: boolean;
  readonly isArena: boolean;
  readonly spawnsByDifficulty: readonly [number, number, number];
}

export function parseTraversabilityMap(json: unknown): TraversabilityMap {
  const o = asObject(json, 'traversibility ratings');
  return new Map(Object.entries(o).map(([k, v]) => [k, asInt(v, `traversibility rating ${k}`)]));
}

function terrain(map: TraversabilityMap, value: unknown, what: string): number {
  const id = map.get(asString(value, what));
  if (id === undefined) throw new FormatError(`${what}: unknown traversability ${String(value)}`);
  return id;
}

function terrainGrid(map: TraversabilityMap, value: unknown, rows: number, cols: number, what: string): number[][] {
  const grid = asArray(value, what).map((row, r) => asArray(row, `${what}[${r}]`).map((c, k) => terrain(map, c, `${what}[${r}][${k}]`)));
  if (grid.length !== rows || grid.some((row) => row.length !== cols)) throw new FormatError(`${what}: expected ${rows}×${cols}`);
  return grid;
}

export function parseMovementCosts(json: unknown, map: TraversabilityMap): MovementCosts {
  const o = asObject(json, 'movement costs');
  const we = terrainGrid(map, o.traverseWE, MAP_SIDE, MAP_SIDE + 1, 'traverseWE');
  const ns = terrainGrid(map, o.traverseNS, MAP_SIDE + 1, MAP_SIDE, 'traverseNS');
  const through = terrainGrid(map, o.traverseThrough, MAP_SIDE, MAP_SIDE, 'traverseThrough');
  const ratings = asArray(o.travelRatings, 'travelRatings').map((row, r) => intArray(row, `travelRatings[${r}]`, MAP_SIDE));
  if (ratings.length !== MAP_SIDE) throw new FormatError('travelRatings: expected 16 rows');
  const traversability: number[][] = [];
  const travelRatings: number[] = [];
  for (let y = 1; y <= MAP_SIDE; y++) {
    for (let x = 1; x <= MAP_SIDE; x++) {
      const at = (grid: number[][], row: number, col: number) => grid[row]?.[col] ?? 0;
      traversability.push([at(ns, y - 1, x - 1), at(we, y - 1, x), at(ns, y, x - 1), at(we, y - 1, x - 1), at(through, y - 1, x - 1)]);
      travelRatings.push((ratings[y - 1]?.[x - 1] ?? 0) & 0xff);
    }
  }
  return { traversability, travelRatings };
}

export function parseTowns(json: unknown): Town[] {
  return asArray(json, 'towns')
    .map((v, i) => {
      const o = asObject(v, `towns[${i}]`);
      const sectors = asArray(o.sectors, `towns[${i}].sectors`).map((s) => parseSectorId(asString(s, `towns[${i}].sectors`)));
      return {
        townId: asInt(o.townId, `towns[${i}].townId`),
        internalName: asString(o.internalName, `towns[${i}].internalName`),
        sectors,
        militiaMapBaseSector:
          o.militiaMapBaseSector === undefined
            ? (sectors[0] ?? 0)
            : parseSectorId(asString(o.militiaMapBaseSector, 'militiaMapBaseSector')),
        isMilitiaTrainingAllowed: asBool(o.isMilitiaTrainingAllowed, `towns[${i}].isMilitiaTrainingAllowed`),
      };
    })
    .sort((a, b) => a.townId - b.townId);
}

export function parseSectorDescriptions(json: unknown, map: TraversabilityMap): SectorDescription[] {
  return asArray(json, 'sector descriptions').map((v, i) => {
    const o = asObject(v, `sector descriptions[${i}]`);
    return {
      sector: parseSectorId(asString(o.sector, 'sector')),
      z: o.sectorLevel === undefined ? 0 : asInt(o.sectorLevel, 'sectorLevel'),
      landType: terrain(map, o.landType, `sector descriptions[${i}].landType`),
    };
  });
}

function adjacency(o: JsonObject, what: string): number {
  if (o.adjacentSectors === undefined) return AdjacentSector.NONE;
  return asArray(o.adjacentSectors, what).reduce<number>((mask, v) => {
    const flag = ADJACENCY_LETTERS[asString(v, what)];
    if (flag === undefined) throw new FormatError(`${what}: '${String(v)}' is not a valid adjacency direction`);
    return mask | flag;
  }, AdjacentSector.NONE);
}

export function parseUndergroundTemplates(json: unknown): UndergroundTemplate[] {
  return asArray(json, 'underground sectors').map((v, i) => {
    const what = `underground sectors[${i}]`;
    const o = asObject(v, what);
    const z = asInt(o.sectorLevel, `${what}.sectorLevel`);
    if (z < 1 || z > 3) throw new FormatError(`${what}: sector level must be between 1 and 3`);
    return {
      sector: parseSectorId(asString(o.sector, `${what}.sector`)),
      z,
      adjacentSectors: adjacency(o, `${what}.adjacentSectors`),
      numTroops: intArrayByDifficulty(o, 'numTroops', what),
      numElites: intArrayByDifficulty(o, 'numElites', what),
      numCreatures: intArrayByDifficulty(o, 'numCreatures', what),
      numTroopsVariance: intArrayByDifficulty(o, 'numTroopsVariance', what),
      numElitesVariance: intArrayByDifficulty(o, 'numElitesVariance', what),
      numCreaturesVariance: intArrayByDifficulty(o, 'numCreaturesVariance', what),
    };
  });
}

export function parseSamSites(json: unknown): SamSite[] {
  return asArray(json, 'SAM sites').map((v, i) => {
    const o = asObject(v, `SAM sites[${i}]`);
    return { sector: parseSectorId(asString(o.sector, 'sector')), gridNos: intArray(o.gridNos, `SAM sites[${i}].gridNos`) };
  });
}

export function parseSamAirControl(json: unknown): number[] {
  const rows = asArray(json, 'SAM air control');
  if (rows.length !== MAP_SIDE) throw new FormatError('The SAM control table must have exactly 16 rows');
  const table = rows.flatMap((row, r) => intArray(row, `SAM air control[${r}]`, MAP_SIDE).map((v) => ((v << 24) >> 24) - 1));
  if (table.length !== SECTOR_COUNT) throw new FormatError('SAM air control: expected 256 values');
  return table;
}

export function parseMapSecrets(json: unknown, map: TraversabilityMap): MapSecret[] {
  return asArray(json, 'map secrets').map((v, i) => {
    const what = `map secrets[${i}]`;
    const o = asObject(v, what);
    return {
      sector: parseSectorId(asString(o.sector, `${what}.sector`)),
      isSamSite: optionalBool(o, 'isSAMSite', what),
      secretLandType: terrain(map, o.secretLandType, `${what}.secretLandType`),
      foundLandType: terrain(map, o.foundLandType, `${what}.foundLandType`),
    };
  });
}

export function parseCacheSectors(json: unknown): CacheSectors {
  const o = asObject(json, 'cache sectors');
  return {
    sectors: asArray(o.sectors, 'cache sectors.sectors').map((s) => parseSectorId(asString(s, 'cache sector'))),
    numTroops: intArrayByDifficulty(o, 'numTroops', 'cache sectors'),
    numTroopsVariance: intArrayByDifficulty(o, 'numTroopsVariance', 'cache sectors'),
  };
}

export function parseBloodCatPlacements(json: unknown): BloodCatPlacement[] {
  return asArray(json, 'bloodcat placements').map((v, i) => {
    const o = asObject(v, `bloodcat placements[${i}]`);
    return { sector: parseSectorId(asString(o.sector, 'sector')), placements: asInt(o.bloodCatPlacements, 'bloodCatPlacements') };
  });
}

export function parseBloodCatSpawns(json: unknown): BloodCatSpawn[] {
  return asArray(json, 'bloodcat spawns').map((v, i) => {
    const what = `bloodcat spawns[${i}]`;
    const o = asObject(v, what);
    return {
      sector: parseSectorId(asString(o.sector, `${what}.sector`)),
      isLair: asBool(o.isLair, `${what}.isLair`),
      isArena: asBool(o.isArena, `${what}.isArena`),
      spawnsByDifficulty: [
        asInt(o.bloodCatsSpawnsEasy, `${what}.bloodCatsSpawnsEasy`),
        asInt(o.bloodCatsSpawnsMedium, `${what}.bloodCatsSpawnsMedium`),
        asInt(o.bloodCatsSpawnsHard, `${what}.bloodCatsSpawnsHard`),
      ],
    };
  });
}
