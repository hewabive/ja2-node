import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorId, parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Facility, SectorFlag } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector } from '../forces/groups.ts';
import { initStrategicLayerMap } from './init.ts';
import { findUndergroundSector, getSectorFlagStatus, mapFileNameForSector, sectorInfo, setSectorFlag } from './sectors.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

describe('new campaign map', () => {
  it('draws the underground enemies per node in file order: troops, elites, creatures', () => {
    const rolls = new ScriptedRolls([1, 2, 0, 1, 1, 4]);
    const ctx = testContext({ content, random: rolls });
    initStrategicLayerMap(ctx);
    expect(rolls.ranges).toEqual([2, 3, 2, 3, 2, 5]);
    const map = ctx.state.map;
    expect(map.underground).toHaveLength(36);
    expect(findUndergroundSector(map, { ...parseSectorString('J9'), z: 2 })?.numCreatures).toBe(6 + 1);
    expect(findUndergroundSector(map, { ...parseSectorString('K4'), z: 1 })).toMatchObject({ numTroops: 12, numElites: 6 });
    expect(findUndergroundSector(map, { ...parseSectorString('P3'), z: 1 })?.numElites).toBe(14);
  });

  it('sets up ownership, facilities, the visited start sector, groups, SAM sites and bloodcats', () => {
    const ctx = testContext({ content });
    initStrategicLayerMap(ctx, { initStrategicAI: (c) => createNewEnemyGroupDepartingFromSector(c, parseSectorId('C5'), 0, 3, 0) });
    const map = ctx.state.map;
    expect(map.elements.every((e) => e.enemyControlled)).toBe(true);
    expect(map.elements[strategicIndex(parseSectorString('A9'))]?.nameId).toBe(1);
    expect(getSectorFlagStatus(map, parseSectorString('A9'), SectorFlag.ALREADY_VISITED)).toBe(true);
    expect(sectorInfo(map, parseSectorString('G8')).facilities).toBe(Facility.HOSPITAL);
    expect(sectorInfo(map, parseSectorString('A9')).travelRating).toBe(content.movementCosts.travelRatings[8]);
    const f = ctx.state.forces;
    expect(f.groups[0]?.player).toBe(false);
    expect(f.squadGroupIds[0]).toBe(2);
    expect(f.vehicleGroupIds.at(-1)).toBe(31);
    expect(map.elements[strategicIndex(parseSectorString('D2'))]?.samCondition).toBe(100);
    expect(map.elements[strategicIndex(parseSectorString('A1'))]?.enemyAirControlled).toBe(true);
    expect(map.elements[strategicIndex(parseSectorString('A9'))]?.enemyAirControlled).toBe(false);
    expect(map.sectors[0]?.bloodCats).toBe(-1);
    expect(map.sectors[255]?.bloodCats).toBe(0);
    expect(sectorInfo(map, parseSectorString('I16'))).toMatchObject({ bloodCats: 19, bloodCatPlacements: 19 });
    expect(sectorInfo(map, parseSectorString('A15')).bloodCatPlacements).toBe(9);
    expect(map.secretsFound).toEqual([false, false, false, false, false, false]);
    expect(map.selectedSector).toEqual(parseSectorString('A9'));
  });

  it('uses the Tixa basement without the cave stairs when sci-fi is off', () => {
    const ctx = testContext({ content, stateOptions: { options: { sciFi: false } } });
    initStrategicLayerMap(ctx);
    const tixa = { ...parseSectorString('J9'), z: 1 };
    expect(mapFileNameForSector(ctx.state.map, tixa)).toBe('J9_b1_a.dat');
  });
});

describe('SetSectorFlag side effects', () => {
  it('reveals the Tixa prison and the Alma gun range and counts new sectors for player activity', () => {
    const ctx = testContext({ content });
    initStrategicLayerMap(ctx);
    const map = ctx.state.map;
    setSectorFlag(map, parseSectorString('J9'), SectorFlag.ALREADY_VISITED, 3);
    expect(sectorInfo(map, parseSectorString('J9')).facilities & Facility.PRISON).toBeTruthy();
    setSectorFlag(map, parseSectorString('H13'), SectorFlag.ALREADY_VISITED, 3);
    expect(sectorInfo(map, parseSectorString('I14')).facilities & Facility.GUN_RANGE).toBeTruthy();
    expect(map.activity.newSectorsVisitedToday).toBe(3);
    setSectorFlag(map, parseSectorString('H13'), SectorFlag.ALREADY_VISITED, 3);
    expect(map.activity.newSectorsVisitedToday).toBe(3);
    setSectorFlag(map, parseSectorString('C3'), SectorFlag.ALREADY_VISITED, 3);
    expect(map.activity.lastDayOfPlayerActivity).toBe(3);
    setSectorFlag(map, { x: 2, y: 2, z: 3 }, SectorFlag.ALREADY_LOADED, 3);
    expect(getSectorFlagStatus(map, { x: 2, y: 2, z: 3 }, SectorFlag.ALREADY_LOADED)).toBe(false);
  });
});
