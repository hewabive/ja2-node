import type { MineDef } from '../../src/content/strategic/economy-content.ts';
import type { Town } from '../../src/content/strategic/map-tables.ts';
import { parseSectorString, sectorId } from '../../src/content/strategic/sector-ids.ts';
import type { StrategicSectorView, StrategicView } from '../../src/protocol/view.ts';
import { type MapFacts, mineIndexAt } from '../../src/ui/screens/map/facts.ts';
import type { UiTextService } from '../../src/ui/text/text-service.ts';

export const DRASSEN = 2;
export const CAMBRIA = 3;
export const NO_MINE = -1;

export function sectorNumber(name: string): number {
  return sectorId(parseSectorString(name));
}

export const KEY_TEXT: UiTextService = {
  string: (table, index) => `${table}[${index}]`,
  edt: () => null,
};

function town(townId: number, internalName: string, sectors: readonly string[], base: string, militia: boolean): Town {
  return {
    townId,
    internalName,
    sectors: sectors.map(sectorNumber),
    militiaMapBaseSector: sectorNumber(base),
    isMilitiaTrainingAllowed: militia,
    townPoint: { x: 0, y: 0 },
  };
}

const TOWNS: readonly Town[] = [
  town(DRASSEN, 'Drassen', ['B13', 'C13', 'D13'], 'B13', true),
  town(CAMBRIA, 'Cambria', ['F8', 'F9', 'G8', 'G9', 'H8'], 'F7', false),
];

const MINES: readonly MineDef[] = [
  {
    mineId: 0,
    entranceSector: sectorNumber('D13'),
    associatedTownId: DRASSEN,
    mineType: 0,
    headMinerAssigned: false,
    noDepletion: false,
    delayDepletion: false,
    minimumMineProduction: 0,
    mineSectors: [
      { sector: sectorNumber('D13'), z: 1 },
      { sector: sectorNumber('E13'), z: 1 },
    ],
  },
];

export function testFacts(samSectors: readonly string[] = ['D15']): MapFacts {
  const townOf = new Map(TOWNS.flatMap((t) => t.sectors.map((s) => [s, t.townId] as const)));
  return {
    towns: TOWNS,
    secrets: [],
    samSectors: samSectors.map(sectorNumber),
    mines: MINES,
    underground: [],
    usesLoyalty: [false, false, true, true],
    traversability: () => 1,
    landType: () => null,
    townOf: (sector) => townOf.get(sector) ?? 0,
    facilities: () => 0,
    town: (id) => TOWNS.find((t) => t.townId === id) ?? null,
    mineAt: (sector, z) => mineIndexAt(MINES, sector, z),
    secretAt: () => null,
  };
}

export function sectorView(sector: string, fields: Partial<StrategicSectorView> = {}): StrategicSectorView {
  return { sector, visited: true, town: 0, playerControlled: true, enemies: null, militia: [0, 0, 0], ...fields };
}

export function strategicView(sectors: readonly StrategicSectorView[], fields: Partial<StrategicView> = {}): StrategicView {
  return {
    flow: 'strategic',
    worldSector: 'A9',
    balance: 0,
    mercs: [],
    groups: [],
    sectors,
    towns: [{ town: DRASSEN, loyalty: 50 }],
    ...fields,
  } as unknown as StrategicView;
}
