import { beforeAll, describe, expect, it } from 'vitest';
import { scripted } from '../../../tests/support/autoresolve.ts';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { getSectorFlagStatus } from '../strategic/map/sectors.ts';
import { createStrategicState } from '../strategic/state.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { SECOND_LEVEL_Z_OFFSET, setUnplacedSoldierHeight } from '../tactical/roofs.ts';
import { agedCorpse, ROTTING_STAGE2 } from '../tactical/rotting-corpses.ts';
import { createSoldier, Team } from '../tactical/soldier.ts';
import { Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { corpseViews } from '../tactical/world-view.ts';
import { restoreCorpses, sectorKey } from './sector-diff.ts';
import {
  addCorpsesToBloodcatLair,
  addDeadSoldierToUnloadedSector,
  addItemsToUnloadedSector,
  stealFromUnloadedSector,
} from './sector-loot.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SECTOR = { x: 13, y: 4, z: 0 };
const DROPPED_AT = gridNo(80, 80);
const NAMED_PROFILE = 59;
const ZEROED_PROFILE = 0;

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

const LAIR = { x: 16, y: 9, z: 0 };
const TWO_DAYS_MINUTES = 2880;
const DAY_THREE_NOON = 3 * 86400 + 12 * 3600;

describe('the corpses of a bloodcat lair', () => {
  it('lays three rotting JFK corpses two days dead on sweet spots, facing the one drawn way, with the zeroed profile 0', () => {
    const state = createStrategicState({ worldSeconds: DAY_THREE_NOON });
    addCorpsesToBloodcatLair(state, content.corpses.table, LAIR, 5);
    const corpses = state.sectorDiffs.get(sectorKey(LAIR))?.corpses ?? [];
    expect(corpses.map((c) => c.gridNo)).toEqual([14319, 9835, 11262]);
    for (const c of corpses)
      expect(c).toMatchObject({
        level: 0,
        bodyType: 0,
        direction: 5,
        profile: 0,
        type: content.corpses.table.types.indexOf('SMERC_JFK'),
        timeOfDeath: DAY_THREE_NOON / 60 - TWO_DAYS_MINUTES,
        findSweetSpot: true,
        palettes: ['BROWNHEAD', 'PINKSKIN', 'YELLOWVEST', 'GREENPANTS'],
      });
    expect(getSectorFlagStatus(state.map, LAIR, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS)).toBe(true);
  });

  it('wraps the unsigned time of death in the first two days, and the corpses still rot as two days dead', () => {
    const state = createStrategicState();
    addCorpsesToBloodcatLair(state, content.corpses.table, LAIR, 0);
    const [first] = state.sectorDiffs.get(sectorKey(LAIR))?.corpses ?? [];
    if (!first) throw new Error('no corpse');
    const now = state.clock.seconds / 60;
    expect(first.timeOfDeath).toBe(2 ** 32 + now - TWO_DAYS_MINUTES);
    expect(agedCorpse(first, now, false)?.type).toBe(ROTTING_STAGE2);
  });
});

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
      keys: [],
    });
    const diff = state.sectorDiffs.get(sectorKey(SECTOR));
    expect(diff?.items).toHaveLength(1);
    expect(diff?.items?.[0]).toMatchObject({ gridNo: 12000, visible: Visibility.VISIBLE, exists: true });
    expect(diff?.items?.[0]?.flags).toBe(WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE);
    expect(diff?.corpses?.[0]).toMatchObject({ gridNo: 12000, direction: 3, findSweetSpot: true });
    expect(getSectorFlagStatus(state.map, SECTOR, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(true);
    expect(getSectorFlagStatus(state.map, SECTOR, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS)).toBe(true);
  });

  it('lays the corpse of a soldier who stood on a roof on the ground at his whole height, as the definition sets no level, and his items on the roof level (Tactical_Save.cc AddDeadSoldierToUnLoadedSector)', () => {
    const state = createStrategicState();
    const gun = content.items.byName.get('GLOCK_17')?.index ?? 0;
    const s = enemy();
    setUnplacedSoldierHeight(s, SECOND_LEVEL_Z_OFFSET);
    addDeadSoldierToUnloadedSector(state, content, SECTOR, {
      soldier: s,
      gridNo: DROPPED_AT,
      level: s.level,
      deathAnimation: 'FALLBACK_HIT_DEATH',
      items: [createItem(content.items, gun, 90)],
      keys: [],
    });
    const diff = state.sectorDiffs.get(sectorKey(SECTOR));
    expect(diff?.items?.[0]?.level).toBe(1);
    expect(diff?.corpses?.[0]).toMatchObject({ level: 0, heightAdjustment: SECOND_LEVEL_Z_OFFSET });
    const t = newCombatSim(content).state;
    const nowMinute = worldTotalMinutes(state.clock);
    restoreCorpses(t, diff?.corpses ?? [], { nowMinute, inTown: false, loadingSave: false });
    expect(corpseViews(t)).toMatchObject([{ level: 0, heightAdjustment: SECOND_LEVEL_Z_OFFSET }]);
  });

  it('lays the corpse of a soldier with a profile under profile 0, not his own: the zeroed definition never gets it, so a search for his corpse by profile misses it (quirk, Tactical_Save.cc AddDeadSoldierToUnLoadedSector)', () => {
    const state = createStrategicState();
    const named = Object.assign(enemy(), { profile: NAMED_PROFILE });
    addDeadSoldierToUnloadedSector(state, content, SECTOR, {
      soldier: named,
      gridNo: DROPPED_AT,
      level: 0,
      deathAnimation: 'GENERIC_HIT_DEATH',
      items: [],
      keys: [],
    });
    expect(state.sectorDiffs.get(sectorKey(SECTOR))?.corpses?.map((c) => c.profile)).toEqual([ZEROED_PROFILE]);
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
