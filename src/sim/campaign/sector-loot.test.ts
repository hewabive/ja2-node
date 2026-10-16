import { beforeAll, describe, expect, it } from 'vitest';
import { scripted } from '../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { createItem } from '../items/object.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { getSectorFlagStatus } from '../strategic/map/sectors.ts';
import { createStrategicState } from '../strategic/state.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { createSoldier, Team } from '../tactical/soldier.ts';
import { Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { sectorKey } from './sector-diff.ts';
import { addDeadSoldierToUnloadedSector, addItemsToUnloadedSector, stealFromUnloadedSector } from './sector-loot.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SECTOR = { x: 13, y: 4, z: 0 };

function enemy() {
  return createSoldier({
    id: 255,
    team: Team.ENEMY,
    name: 'troop',
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'REDVEST', pants: 'GREENPANTS' },
    stats: {
      agility: 60,
      dexterity: 60,
      strength: 60,
      wisdom: 60,
      leadership: 60,
      marksmanship: 60,
      mechanical: 60,
      explosives: 60,
      medical: 60,
      experience: 3,
    },
    life: 0,
    gridNo: -1,
    direction: 3,
    state: 0,
  });
}

describe('drops and corpses in unloaded sectors', () => {
  it('records a dead soldier as a sweet-spot corpse with reachable visible items', () => {
    const state = createStrategicState();
    const gun = content.items.byName.get('GLOCK_17')?.index ?? 0;
    const s = enemy();
    addDeadSoldierToUnloadedSector(state, content, SECTOR, {
      soldier: s,
      gridNo: 12000,
      level: 0,
      deathAnimation: 'FALLBACK_HIT_DEATH',
      items: [createItem(content.items, gun, 90)],
    });
    const diff = state.sectorDiffs.get(sectorKey(SECTOR));
    expect(diff?.items).toHaveLength(1);
    expect(diff?.items?.[0]).toMatchObject({ gridNo: 12000, visible: Visibility.VISIBLE, exists: true });
    expect(diff?.items?.[0]?.flags).toBe(WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE);
    expect(diff?.corpses?.[0]).toMatchObject({ gridNo: 12000, direction: 3, findSweetSpot: true });
    expect(getSectorFlagStatus(state.map, SECTOR, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(true);
    expect(getSectorFlagStatus(state.map, SECTOR, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS)).toBe(true);
  });

  it('reuses the first non-existing slot and lets thieves take visible reachable items below the chance', () => {
    const state = createStrategicState();
    const gun = content.items.byName.get('GLOCK_17')?.index ?? 0;
    const item = () => createItem(content.items, gun, 90);
    addItemsToUnloadedSector(state, SECTOR, 100, [item(), item(), item()], 0, WorldItemFlags.REACHABLE, Visibility.VISIBLE);
    addItemsToUnloadedSector(state, SECTOR, 200, [item()], 0, 0, Visibility.VISIBLE);
    const stolen = stealFromUnloadedSector(state, SECTOR, 30, scripted([29, 30, 0]));
    expect(stolen).toBe(2);
    const items = state.sectorDiffs.get(sectorKey(SECTOR))?.items ?? [];
    expect(items.map((wi) => wi.exists)).toEqual([false, true, false, true]);
    addItemsToUnloadedSector(state, SECTOR, 300, [item()], 0, 0, Visibility.VISIBLE);
    expect(items[0]?.gridNo).toBe(300);
  });
});
