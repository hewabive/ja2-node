import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent } from '../../../tests/support/strategic.ts';
import { AdjacentSector, parseMovementCosts, parseTraversabilityMap, StrategicMove } from './map-tables.ts';
import { TransportMask } from './policy.ts';
import { parseSectorId } from './sector-ids.ts';
import type { StrategicContent } from './strategic-content.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const TOWN = 0;
const ROAD = 1;
const PLAINS = 2;
const EDGEOFWORLD = 12;

describe('strategic content from data/externalized', () => {
  it('builds the five traversabilities per sector from the 16×17 and 17×16 border grids', () => {
    const a9 = content.movementCosts.traversability[parseSectorId('A9')];
    expect(a9).toEqual([EDGEOFWORLD, TOWN, ROAD, PLAINS, TOWN]);
    const a10 = content.movementCosts.traversability[parseSectorId('A10')];
    expect(a10?.[StrategicMove.WEST]).toBe(a9?.[StrategicMove.EAST]);
    const b9 = content.movementCosts.traversability[parseSectorId('B9')];
    expect(b9?.[StrategicMove.NORTH]).toBe(a9?.[StrategicMove.SOUTH]);
    for (let x = 0; x < 16; x++) expect(content.movementCosts.traversability[x]?.[StrategicMove.NORTH]).toBe(EDGEOFWORLD);
  });

  it('places grid columns and rows exactly as InitStrategicMovementCosts reads them', () => {
    const map = parseTraversabilityMap({ E: 12, R: 1, P: 2, X: 0 });
    const we = Array.from({ length: 16 }, (_, r) =>
      Array.from({ length: 17 }, (_, c) => (c === 0 || c === 16 ? 'E' : r === 0 && c === 1 ? 'R' : 'P')),
    );
    const ns = Array.from({ length: 17 }, (_, r) =>
      Array.from({ length: 16 }, (_, c) => (r === 0 || r === 16 ? 'E' : r === 1 && c === 0 ? 'X' : 'P')),
    );
    const through = Array.from({ length: 16 }, () => new Array<string>(16).fill('P'));
    const ratings = Array.from({ length: 16 }, () => new Array<number>(16).fill(7));
    const costs = parseMovementCosts({ traverseWE: we, traverseNS: ns, traverseThrough: through, travelRatings: ratings }, map);
    expect(costs.traversability[0]).toEqual([EDGEOFWORLD, ROAD, TOWN, EDGEOFWORLD, PLAINS]);
    expect(costs.traversability[1]?.[StrategicMove.WEST]).toBe(ROAD);
    expect(costs.traversability[16]?.[StrategicMove.NORTH]).toBe(TOWN);
    expect(costs.travelRatings[0]).toBe(7);
    expect(() =>
      parseMovementCosts({ traverseWE: we.slice(1), traverseNS: ns, traverseThrough: through, travelRatings: ratings }, map),
    ).toThrow();
  });

  it('loads towns, underground templates, SAM sites, secrets and bloodcats', () => {
    expect(content.towns.map((t) => t.townId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(content.towns[0]?.sectors).toEqual([parseSectorId('A9'), parseSectorId('A10')]);
    expect(content.underground).toHaveLength(36);
    const k4 = content.underground.find((u) => u.sector === parseSectorId('K4'));
    expect(k4).toMatchObject({ z: 1, numTroops: [8, 10, 12], numTroopsVariance: [3, 3, 3], numCreatures: [0, 0, 0] });
    expect(content.underground.find((u) => u.sector === parseSectorId('F13') && u.z === 2)?.adjacentSectors).toBe(
      AdjacentSector.NORTH | AdjacentSector.SOUTH,
    );
    expect(content.samSites.map((s) => s.sector)).toEqual(['D2', 'D15', 'I8', 'N4'].map(parseSectorId));
    expect(content.samAirControl[parseSectorId('A9')]).toBe(-1);
    expect(content.samAirControl[parseSectorId('A1')]).toBe(0);
    expect(content.samAirControl[parseSectorId('P16')]).toBe(1);
    expect(content.secrets.filter((s) => s.isSamSite)).toHaveLength(4);
    expect(content.secrets.filter((s) => !s.isSamSite).map((s) => s.sector)).toEqual(['J9', 'K4'].map(parseSectorId));
    expect(content.bloodCatSpawns.find((b) => b.isLair)).toMatchObject({ sector: parseSectorId('I16'), spawnsByDifficulty: [14, 19, 26] });
    expect(content.cacheSectors.sectors).toHaveLength(5);
  });

  it('reads the policy values and vehicle movement types', () => {
    expect(content.policy).toEqual({
      squadSize: 6,
      startSector: parseSectorId('A9'),
      startSectorRevealed: true,
      mercOnlineMinDays: 1,
      mercOnlineMaxDays: 2,
    });
    expect(content.vehicles.map((v) => v.movementType)).toEqual([2, 2, 2, 2, 2, TransportMask.AIR]);
  });

  it('transcribes the travel table and the known facilities', () => {
    const { travel } = content;
    expect(travel.townMinutes).toBe(5);
    expect(travel.flatStrategicTravelTime).toBe(60);
    expect([travel.airspaceCostSafe, travel.airspaceCostUnsafe]).toEqual([100, 1000]);
    expect(travel.transports.map((t) => [t.name, t.mask, t.baseMinutes])).toEqual([
      ['FOOT', 1, 89],
      ['CAR', 2, 30],
      ['TRUCK', 4, 32],
      ['TRACKED', 8, 46],
      ['AIR', 16, 10],
    ]);
    expect(travel.transports[0]?.modifiers?.get(PLAINS)).toBe(85);
    expect(travel.transports[4]?.modifiers).toBeNull();
    expect(content.facilities).toHaveLength(12);
    expect(content.facilities[0]).toEqual({ sector: parseSectorId('G8'), flags: 1 });
  });
});
