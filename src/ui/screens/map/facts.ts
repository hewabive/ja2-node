// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc GetSectorLandTypeString (secrets and SAM sites first, the special facilities, the
// @src town, the creature lair underground, the traversability), GetSectorIDString (the mine's town, "Mine" when detailed);
// @src src/game/Strategic/StrategicMap_Secrets.cc IsTownFound (a town whose base sector holds no secret is always known);
// @src src/externalized/strategic/TownModel.cc getBaseSector (the smallest sector of the town); src/game/Strategic/
// @src Player_Command.cc GetSectorFacilitiesFlags (sFacilitiesStrings joined by commas, "none" without facilities).

import type { EconomyContent, MineDef } from '../../../content/strategic/economy-content.ts';
import type { MapSecret, Town } from '../../../content/strategic/map-tables.ts';
import { MAP_SIDE, type Sector, sectorFromId, sectorId, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const LandType = { TOWN: 0, SAM_SITE: 32, CREATURE_LAIR: 35 } as const;
export const MineType = { SILVER: 0, GOLD: 1 } as const;

const THROUGH_STRATEGIC_MOVE = 4;
const BLANK_SECTOR = 0;
const LAND_TYPES = 'strategic-map-land-types';
const TOWN_NAMES = 'strategic-map-town-names';
const MINE_STRINGS = 'pwMineStrings';
const MINE_WORD = 0;
const FACILITY_STRINGS = 'sFacilitiesStrings';
const NO_FACILITIES = 0;
const UNDERGROUND_SEPARATOR = '-';

export interface UndergroundSector {
  readonly sector: number;
  readonly z: number;
}

export interface MapFacts {
  readonly towns: readonly Town[];
  readonly secrets: readonly MapSecret[];
  readonly samSectors: readonly number[];
  readonly mines: readonly MineDef[];
  readonly underground: readonly UndergroundSector[];
  readonly usesLoyalty: readonly boolean[];
  traversability(sector: number): number;
  landType(sector: number, z: number): number | null;
  townOf(sector: number): number;
  facilities(sector: number): number;
  town(id: number): Town | null;
  mineAt(sector: number, z: number): number;
  secretAt(sector: number): MapSecret | null;
}

export function mapFacts(content: StrategicContent, economy: EconomyContent): MapFacts {
  const townOfSector = new Map<number, number>();
  for (const t of content.towns) for (const s of t.sectors) townOfSector.set(s, t.townId);
  const landTypes = new Map(content.sectorDescriptions.map((d) => [`${d.sector}/${d.z}`, d.landType]));
  const facilities = new Map<number, number>();
  for (const f of content.facilities) facilities.set(f.sector, (facilities.get(f.sector) ?? 0) | f.flags);
  const secrets = new Map(content.secrets.map((s) => [s.sector, s]));
  const towns = new Map(content.towns.map((t) => [t.townId, t]));
  return {
    towns: content.towns,
    secrets: content.secrets,
    samSectors: content.samSites.map((s) => s.sector),
    mines: economy.mines,
    underground: content.underground.map((u) => ({ sector: u.sector, z: u.z })),
    usesLoyalty: economy.loyalty.usesLoyalty,
    traversability: (sector) => content.movementCosts.traversability[sector]?.[THROUGH_STRATEGIC_MOVE] ?? 0,
    landType: (sector, z) => landTypes.get(`${sector}/${z}`) ?? null,
    townOf: (sector) => townOfSector.get(sector) ?? BLANK_SECTOR,
    facilities: (sector) => facilities.get(sector) ?? 0,
    town: (id) => towns.get(id) ?? null,
    mineAt: (sector, z) => economy.mines.findIndex((m) => m.mineSectors.some((s) => s.sector === sector && s.z === z)),
    secretAt: (sector) => secrets.get(sector) ?? null,
  };
}

export function townBaseSector(town: Town): number {
  return Math.min(...town.sectors);
}

export function isSecretFound(facts: MapFacts, found: ReadonlySet<number>, sector: number): boolean {
  return facts.secretAt(sector) === null || found.has(sector);
}

export function isTownFound(facts: MapFacts, found: ReadonlySet<number>, town: number): boolean {
  const t = facts.town(town);
  if (!t) return false;
  return isSecretFound(facts, found, townBaseSector(t));
}

export function sectorLabel(s: Sector): string {
  const short = sectorShortString(s);
  return s.z ? `${short}${UNDERGROUND_SEPARATOR}${s.z}` : short;
}

export function parseSectorLabel(label: string): Sector | null {
  const m = /^([A-Pa-p])(\d{1,2})(?:-(\d))?$/.exec(label.trim());
  if (!m) return null;
  const x = Number(m[2]);
  const y = (m[1] as string).toUpperCase().charCodeAt(0) - 64;
  if (x < 1 || x > MAP_SIDE || y < 1 || y > MAP_SIDE) return null;
  return { x, y, z: m[3] === undefined ? 0 : Number(m[3]) };
}

export function foundSecrets(labels: readonly string[] | undefined): Set<number> {
  const found = new Set<number>();
  for (const label of labels ?? []) {
    const s = parseSectorLabel(label);
    if (s) found.add(sectorId(s));
  }
  return found;
}

export function sectorLandTypeString(
  facts: MapFacts,
  text: UiTextService,
  found: ReadonlySet<number>,
  sector: number,
  z: number,
  detailed: boolean,
): string {
  const secret = facts.secretAt(sector);
  if (z === 0 && secret) {
    const landType = found.has(sector) ? secret.foundLandType : secret.secretLandType;
    if (landType !== LandType.TOWN) return text.string(LAND_TYPES, secret.isSamSite && !detailed ? LandType.SAM_SITE : landType) ?? '';
  }
  if (z > 0 || detailed) {
    const landType = facts.landType(sector, z);
    if (landType !== null) return text.string(LAND_TYPES, landType) ?? '';
  }
  const town = facts.townOf(sector);
  if (town !== BLANK_SECTOR) return text.string(TOWN_NAMES, town) ?? '';
  if (z > 0) return text.string(LAND_TYPES, LandType.CREATURE_LAIR) ?? '';
  return text.string(LAND_TYPES, facts.traversability(sector)) ?? '';
}

export function sectorIdString(
  facts: MapFacts,
  text: UiTextService,
  found: ReadonlySet<number>,
  s: Sector,
  detailed: boolean,
  visitedUnderground: (s: Sector) => boolean,
): string {
  if (s.z !== 0 && !visitedUnderground(s)) return '';
  const id = sectorId(s);
  const mine = facts.mineAt(id, s.z);
  let place = '';
  if (mine !== -1) {
    const def = facts.mines[mine];
    place = def ? (text.string(TOWN_NAMES, def.associatedTownId) ?? '') : '';
    if (detailed) place += ` ${text.string(MINE_STRINGS, MINE_WORD) ?? ''}`;
  }
  if (place.length === 0) place = sectorLandTypeString(facts, text, found, id, s.z, detailed);
  return `${sectorShortString(s)}: ${place}`;
}

export function facilitiesString(text: UiTextService, flags: number): string {
  if (flags === 0) return text.string(FACILITY_STRINGS, NO_FACILITIES) ?? '';
  const names: string[] = [];
  for (let i = 0; flags >> i !== 0; i++) if (flags & (1 << i)) names.push(text.string(FACILITY_STRINGS, i + 1) ?? '');
  return names.join(',');
}

export function sectorOfId(id: number, z = 0): Sector {
  return sectorFromId(id, z);
}
