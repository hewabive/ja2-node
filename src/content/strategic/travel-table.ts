// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc GetSectorMvtTimeForGroup (table data); Strategic_Pathing.cc;
// @src Map_Screen_Helicopter.h; Campaign_Init.cc InitKnowFacilitiesFlags. Tables in data/tables.

import { FormatError } from '../binary/errors.ts';
import { asArray, asInt, asObject, asString } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const STRATEGIC_TRAVEL_PATH = 'tables/strategic-travel.json';
export const SECTOR_FACILITIES_PATH = 'tables/sector-facilities.json';

export interface TransportTravel {
  readonly name: string;
  readonly mask: number;
  readonly baseMinutes: number;
  readonly modifiers: ReadonlyMap<number, number> | null;
}

export interface TravelTable {
  readonly townMinutes: number;
  readonly flatStrategicTravelTime: number;
  readonly airspaceCostSafe: number;
  readonly airspaceCostUnsafe: number;
  readonly transports: readonly TransportTravel[];
}

export interface SectorFacility {
  readonly sector: number;
  readonly flags: number;
}

export function parseTravelTable(json: unknown): TravelTable {
  const o = asObject(json, 'strategic travel');
  const terrain = asObject(o.traversability, 'strategic travel.traversability');
  const terrainId = (name: string) => {
    const id = terrain[name];
    if (id === undefined) throw new FormatError(`strategic travel: unknown terrain ${name}`);
    return asInt(id, `terrain ${name}`);
  };
  const airspace = asObject(o.airspaceCost, 'strategic travel.airspaceCost');
  return {
    townMinutes: asInt(o.townMinutes, 'townMinutes'),
    flatStrategicTravelTime: asInt(o.flatStrategicTravelTime, 'flatStrategicTravelTime'),
    airspaceCostSafe: asInt(airspace.safe, 'airspaceCost.safe'),
    airspaceCostUnsafe: asInt(airspace.unsafe, 'airspaceCost.unsafe'),
    transports: asArray(o.transports, 'transports').map((v, i) => {
      const t = asObject(v, `transports[${i}]`);
      const modifiers =
        t.modifiers === null
          ? null
          : new Map(Object.entries(asObject(t.modifiers, `transports[${i}].modifiers`)).map(([k, m]) => [terrainId(k), asInt(m, k)]));
      return {
        name: asString(t.name, `transports[${i}].name`),
        mask: asInt(t.mask, `transports[${i}].mask`),
        baseMinutes: asInt(t.baseMinutes, `transports[${i}].baseMinutes`),
        modifiers,
      };
    }),
  };
}

export function parseSectorFacilities(json: unknown): SectorFacility[] {
  const o = asObject(json, 'sector facilities');
  const flags = asObject(o.flags, 'sector facilities.flags');
  return asArray(o.sectors, 'sector facilities.sectors').map((v, i) => {
    const e = asObject(v, `sector facilities[${i}]`);
    const facility = asString(e.facility, 'facility');
    if (flags[facility] === undefined) throw new FormatError(`sector facilities: unknown facility ${facility}`);
    return { sector: parseSectorId(asString(e.sector, 'sector')), flags: asInt(flags[facility], facility) };
  });
}
