import { FormatError } from '../binary/errors.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { CREATURE_LAIRS_PATH, type CreatureLair, parseCreatureLairs } from './creature-lairs.ts';
import { parseJsoncBytes } from './jsonc.ts';
import {
  type BloodCatPlacement,
  type BloodCatSpawn,
  type CacheSectors,
  type MapSecret,
  type MovementCosts,
  parseBloodCatPlacements,
  parseBloodCatSpawns,
  parseCacheSectors,
  parseMapSecrets,
  parseMovementCosts,
  parseSamAirControl,
  parseSamSites,
  parseSectorDescriptions,
  parseTowns,
  parseTraversabilityMap,
  parseUndergroundTemplates,
  type SamSite,
  type SectorDescription,
  type Town,
  type UndergroundTemplate,
} from './map-tables.ts';
import { NPC_PLACEMENTS_PATH, type NpcPlacement, PROFILE_INFO_PATH, parseNpcPlacements } from './npc-placements.ts';
import { parseStrategicPolicy, parseVehicleTypes, type StrategicPolicy, type VehicleType } from './policy.ts';
import { parseShippingDestinations, SHIPPING_DESTINATIONS_PATH, type ShippingDestinations } from './shipping.ts';
import {
  parseSectorFacilities,
  parseTravelTable,
  SECTOR_FACILITIES_PATH,
  type SectorFacility,
  STRATEGIC_TRAVEL_PATH,
  type TravelTable,
} from './travel-table.ts';

export const STRATEGIC_CONTENT_PATHS = {
  traversability: 'externalized/strategic-map-traversibility-ratings.json',
  movementCosts: 'externalized/strategic-map-movement-costs.json',
  towns: 'externalized/strategic-map-towns.json',
  sectorDescriptions: 'externalized/strategic-map-sectors-descriptions.json',
  underground: 'externalized/strategic-map-underground-sectors.json',
  samSites: 'externalized/strategic-map-sam-sites.json',
  samAirControl: 'externalized/strategic-map-sam-sites-air-control.json',
  secrets: 'externalized/strategic-map-secrets.json',
  cacheSectors: 'externalized/strategic-map-cache-sectors.json',
  bloodCatPlacements: 'externalized/strategic-bloodcat-placements.json',
  bloodCatSpawns: 'externalized/strategic-bloodcat-spawns.json',
  creatureLairs: CREATURE_LAIRS_PATH,
  vehicles: 'externalized/vehicles.json',
  policy: 'externalized/game.json',
  travel: STRATEGIC_TRAVEL_PATH,
  facilities: SECTOR_FACILITIES_PATH,
  shipping: SHIPPING_DESTINATIONS_PATH,
  npcPlacements: NPC_PLACEMENTS_PATH,
  profileInfo: PROFILE_INFO_PATH,
} as const;

export type StrategicContentSources = { readonly [K in keyof typeof STRATEGIC_CONTENT_PATHS]: unknown };

export interface StrategicContent {
  readonly movementCosts: MovementCosts;
  readonly towns: readonly Town[];
  readonly sectorDescriptions: readonly SectorDescription[];
  readonly underground: readonly UndergroundTemplate[];
  readonly samSites: readonly SamSite[];
  readonly samAirControl: readonly number[];
  readonly secrets: readonly MapSecret[];
  readonly cacheSectors: CacheSectors;
  readonly bloodCatPlacements: readonly BloodCatPlacement[];
  readonly bloodCatSpawns: readonly BloodCatSpawn[];
  readonly creatureLairs: readonly CreatureLair[];
  readonly vehicles: readonly VehicleType[];
  readonly policy: StrategicPolicy;
  readonly travel: TravelTable;
  readonly facilities: readonly SectorFacility[];
  readonly shipping: ShippingDestinations;
  readonly npcPlacements: readonly NpcPlacement[];
}

export function parseStrategicContent(sources: StrategicContentSources): StrategicContent {
  const terrain = parseTraversabilityMap(sources.traversability);
  return {
    movementCosts: parseMovementCosts(sources.movementCosts, terrain),
    towns: parseTowns(sources.towns),
    sectorDescriptions: parseSectorDescriptions(sources.sectorDescriptions, terrain),
    underground: parseUndergroundTemplates(sources.underground),
    samSites: parseSamSites(sources.samSites),
    samAirControl: parseSamAirControl(sources.samAirControl),
    secrets: parseMapSecrets(sources.secrets, terrain),
    cacheSectors: parseCacheSectors(sources.cacheSectors),
    bloodCatPlacements: parseBloodCatPlacements(sources.bloodCatPlacements),
    bloodCatSpawns: parseBloodCatSpawns(sources.bloodCatSpawns),
    creatureLairs: parseCreatureLairs(sources.creatureLairs),
    vehicles: parseVehicleTypes(sources.vehicles),
    policy: parseStrategicPolicy(sources.policy),
    travel: parseTravelTable(sources.travel),
    facilities: parseSectorFacilities(sources.facilities),
    shipping: parseShippingDestinations(sources.shipping),
    npcPlacements: parseNpcPlacements(sources.npcPlacements, sources.profileInfo),
  };
}

async function readJsonc(read: ReadFile, path: string): Promise<unknown> {
  const bytes = await read(path);
  if (!bytes) throw new FormatError(`missing ${path}`);
  return parseJsoncBytes(bytes);
}

export async function loadStrategicContent(read: ReadFile): Promise<StrategicContent> {
  const keys = Object.keys(STRATEGIC_CONTENT_PATHS) as (keyof typeof STRATEGIC_CONTENT_PATHS)[];
  const values = await Promise.all(keys.map((key) => readJsonc(read, STRATEGIC_CONTENT_PATHS[key])));
  return parseStrategicContent(Object.fromEntries(keys.map((key, i) => [key, values[i]])) as StrategicContentSources);
}
