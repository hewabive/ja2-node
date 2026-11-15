import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf } from '../../../tests/support/explosives.ts';
import { type MapItemFields, mapItemRecord } from '../../../tests/support/map-items.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import type { MapItem } from '../../content/formats/map.ts';
import { gridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { ObjectFlags } from '../items/object.ts';
import { bombItemOf, Detonator, detonatorOf, ItemAction } from './bombs/bomb-object.ts';
import { hasMineFlag, MineFlag } from './bombs/mine-flags.ts';
import { worldBombItems } from './bombs/world-bombs.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { Profile } from './narrative/constants.ts';
import type { ProfileProgress } from './profiles.ts';
import type { SectorRef, TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';
import {
  addItemToPool,
  flatRoofAboveGridNo,
  loadWorldItemsFromMap,
  removeWorldItem,
  trashWorldItems,
  Visibility,
  WorldItemFlags,
} from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const mapRecord = (t: TacticalState, name: string, g: number, fields: MapItemFields = {}): MapItem =>
  mapItemRecord(t.content.items, name, g, fields);

function mapItem(t: TacticalState, name: string, x: number, nonExistChance: number): MapItem {
  return mapRecord(t, name, gridNo(x, 80), { nonExistChance });
}

describe('map items (LoadWorldItemsFromMap)', () => {
  it('rolls PreRandom(100) for every item, even one sure to exist', () => {
    const t = newCombatSim(content).state;
    const records = [mapItem(t, 'CANTEEN', 80, 0), mapItem(t, 'CROWBAR', 81, 0), mapItem(t, 'WIRECUTTERS', 82, 100)];
    expect(countDraws(t, () => loadWorldItemsFromMap(t, records))).toEqual({ pre: 3, main: 0 });
    expect(t.worldItems.map((wi) => wi.object.item)).toEqual([itemId(t, 'CANTEEN'), itemId(t, 'CROWBAR')]);
  });

  it('arms a hidden explosive that goes off under pressure, buries it and marks its tile for the enemy (ArmBomb)', () => {
    const t = newCombatSim(content).state;
    const g = gridNo(80, 80);
    loadWorldItemsFromMap(t, [mapRecord(t, 'MINE', g, { visible: Visibility.HIDDEN_ITEM, trap: 5 })]);
    const [mine] = t.worldItems;
    expect(mine && [mine.flags & WorldItemFlags.ARMED_BOMB, mine.visible]).toEqual([WorldItemFlags.ARMED_BOMB, Visibility.BURIED]);
    expect(mine && [detonatorOf(mine.object), bombItemOf(mine.object), mine.object.flags & ObjectFlags.ARMED_BOMB]).toEqual([
      Detonator.PRESSURE,
      itemId(t, 'MINE'),
      ObjectFlags.ARMED_BOMB,
    ]);
    expect([hasMineFlag(t, g, MineFlag.ENEMY), hasMineFlag(t, g, MineFlag.PLAYER)]).toEqual([true, false]);
    expect(worldBombItems(t)).toEqual([mine]);
  });

  it('leaves a seen or untrapped explosive unarmed', () => {
    const t = newCombatSim(content).state;
    loadWorldItemsFromMap(t, [
      mapRecord(t, 'MINE', gridNo(80, 80), { visible: Visibility.INVISIBLE, trap: 5 }),
      mapRecord(t, 'MINE', gridNo(81, 80), { visible: Visibility.HIDDEN_ITEM }),
    ]);
    expect(t.worldItems.map((wi) => wi.flags & WorldItemFlags.ARMED_BOMB)).toEqual([0, 0]);
    expect([t.mineFlags.some((f) => f !== 0), t.worldBombs]).toEqual([false, []]);
  });

  it("marks no tile for the enemy where the map stored a mine armed already: only the map's tile flags mark F9's", () => {
    const t = newCombatSim(content).state;
    const g = gridNo(80, 80);
    const armed = { flags: WorldItemFlags.ARMED_BOMB, visible: Visibility.BURIED, trap: 5, detonator: Detonator.PRESSURE };
    loadWorldItemsFromMap(t, [mapRecord(t, 'MINE', g, { ...armed, bombItem: itemId(t, 'MINE'), objectFlags: ObjectFlags.ARMED_BOMB })]);
    expect(worldBombItems(t).map((wi) => wi.gridNo)).toEqual([g]);
    expect(hasMineFlag(t, g, MineFlag.ENEMY)).toBe(false);
  });

  it('loads a pit unarmed and buried with no detonator, its tile marked for civilians and creatures', () => {
    const t = newCombatSim(content).state;
    const g = gridNo(80, 80);
    const pit = {
      flags: WorldItemFlags.ARMED_BOMB,
      visible: Visibility.VISIBLE,
      detonator: Detonator.PRESSURE,
      action: ItemAction.LARGE_PIT,
    };
    loadWorldItemsFromMap(t, [mapRecord(t, 'ACTION_ITEM', g, pit)]);
    const [loaded] = t.worldItems;
    expect(loaded && [loaded.flags & WorldItemFlags.ARMED_BOMB, loaded.visible, detonatorOf(loaded.object)]).toEqual([
      0,
      Visibility.BURIED,
      0,
    ]);
    expect([hasMineFlag(t, g, MineFlag.ENEMY), t.worldBombs]).toEqual([true, []]);
  });

  it('buries a loose switch as a pressure plate, over a switch structure as a hand-worked switch (InternalAddItemToPool)', () => {
    const t = newCombatSim(content).state;
    const plate = gridNo(80, 80);
    const wallSwitch = gridNo(82, 80);
    t.world.structures.add(wallSwitch, 0, syntheticStructure(StructureFlags.SWITCH | StructureFlags.OPENABLE, Orientation.OUTSIDE_LEFT));
    const armed = { flags: WorldItemFlags.ARMED_BOMB, visible: Visibility.HIDDEN_ITEM, detonator: Detonator.REMOTE };
    loadWorldItemsFromMap(t, [mapRecord(t, 'SWITCH', plate, armed), mapRecord(t, 'SWITCH', wallSwitch, armed)]);
    expect(t.worldItems.map((wi) => [wi.visible, detonatorOf(wi.object)])).toEqual([
      [Visibility.BURIED, Detonator.PRESSURE],
      [Visibility.BURIED, Detonator.SWITCH],
    ]);
  });
});

describe('the ownership markers of absent terrorists and the Queen (DeleteWorldItemsBelongingToTerroristsWhoAreNotThere, DeleteWorldItemsBelongingToQueenIfThere)', () => {
  const B2: SectorRef = { x: 2, y: 2, z: 0 };
  const PALACE: SectorRef = { x: 3, y: 16, z: 0 };
  const PALACE_BASEMENT: SectorRef = { x: 3, y: 16, z: 1 };
  const NOWHERE_YET: SectorRef = { x: 0, y: 0, z: 0 };
  const CIVILIAN_OWNER = 200;
  const ROCKET_RIFLE_SLOT = 7;
  const ROCKET_CLIP_SLOT = 11;
  const marker = gridNo(80, 80);
  const elsewhere = gridNo(90, 80);

  function placedIn(id: number, at: SectorRef, overrides: Partial<ProfileProgress> = {}): ProfileProgress {
    return testProfile(id, { sectorX: at.x, sectorY: at.y, sectorZ: at.z, ...overrides });
  }

  function loadedIn(here: SectorRef | null, profiles: readonly ProfileProgress[], records: (t: TacticalState) => MapItem[]): TacticalState {
    const t = newCombatSim(content).state;
    t.sector = here;
    for (const p of profiles) t.profiles.set(p.id, p);
    loadWorldItemsFromMap(t, records(t));
    return t;
  }

  const names = (t: TacticalState, g: number) => t.worldItems.filter((wi) => wi.gridNo === g).map((wi) => wi.object.item);

  function queenWithRocketRifle(at: SectorRef, rifleCount = 1): ProfileProgress {
    const q = placedIn(Profile.QUEEN, at);
    q.inventory[ROCKET_RIFLE_SLOT] = itemId(newCombatSim(content).state, 'ROCKET_RIFLE');
    q.inventoryCount[ROCKET_RIFLE_SLOT] = rifleCount;
    q.inventoryStatus[ROCKET_RIFLE_SLOT] = 100;
    q.inventory[ROCKET_CLIP_SLOT] = itemId(newCombatSim(content).state, 'CLIPROCKET_AP');
    q.inventoryCount[ROCKET_CLIP_SLOT] = 2;
    return q;
  }

  function queensCrate(t: TacticalState): MapItem[] {
    return [
      ...['SPECTRA_VEST_18', 'SPECTRA_LEGGINGS_18', 'SPECTRA_HELMET_18'].map((name) => mapRecord(t, name, marker)),
      mapRecord(t, 'OWNERSHIP', marker, { owner: Profile.QUEEN, visible: Visibility.HIDDEN_ITEM }),
      mapRecord(t, 'AUTO_ROCKET_RIFLE', marker),
      mapRecord(t, 'CLIPROCKET_HEAT', marker),
      mapRecord(t, 'CANTEEN', elsewhere),
    ];
  }

  it("takes every item off the tile of a terrorist's marker, the marker too, when his profile is not in the loaded sector, and keeps the gear of one placed there", () => {
    const beside = gridNo(85, 80);
    const t = loadedIn(B2, [placedIn(Profile.SLAY, B2), placedIn(Profile.ANNIE, NOWHERE_YET)], (t) => [
      mapRecord(t, 'OWNERSHIP', marker, { owner: Profile.SLAY }),
      mapRecord(t, 'CROWBAR', marker),
      mapRecord(t, 'OWNERSHIP', beside, { owner: Profile.ANNIE }),
      mapRecord(t, 'WIRECUTTERS', beside),
      mapRecord(t, 'CANTEEN', beside),
      mapRecord(t, 'CANTEEN', elsewhere),
    ]);
    expect(names(t, marker)).toEqual([itemId(t, 'OWNERSHIP'), itemId(t, 'CROWBAR')]);
    expect(names(t, beside)).toEqual([]);
    expect(names(t, elsewhere)).toEqual([itemId(t, 'CANTEEN')]);
  });

  it('leaves the gear of a marker owned by a profile that is no terrorist, or by a civilian group, where its owner is not', () => {
    const t = loadedIn(B2, [placedIn(Profile.KINGPIN, NOWHERE_YET)], (t) => [
      mapRecord(t, 'OWNERSHIP', marker, { owner: Profile.KINGPIN }),
      mapRecord(t, 'CROWBAR', marker),
      mapRecord(t, 'OWNERSHIP', elsewhere, { owner: CIVILIAN_OWNER }),
      mapRecord(t, 'CANTEEN', elsewhere),
    ]);
    expect([names(t, marker), names(t, elsewhere)]).toEqual([
      [itemId(t, 'OWNERSHIP'), itemId(t, 'CROWBAR')],
      [itemId(t, 'OWNERSHIP'), itemId(t, 'CANTEEN')],
    ]);
  });

  it("keeps an absent terrorist's gear on a map loaded outside a sector, as the sandbox loads one", () => {
    const t = loadedIn(null, [], (t) => [mapRecord(t, 'OWNERSHIP', marker, { owner: Profile.SLAY }), mapRecord(t, 'CROWBAR', marker)]);
    expect(names(t, marker)).toEqual([itemId(t, 'OWNERSHIP'), itemId(t, 'CROWBAR')]);
  });

  it("hands the Queen who fled to P3_B1 the automatic rocket rifle for her rocket rifle and the armour on her marker's tile, and takes every item of the tile away", () => {
    const queen = queenWithRocketRifle(PALACE_BASEMENT);
    const t = loadedIn(PALACE_BASEMENT, [queen], queensCrate);
    const id = (name: string) => itemId(t, name);
    expect(names(t, marker)).toEqual([]);
    expect(names(t, elsewhere)).toEqual([id('CANTEEN')]);
    expect([InvSlot.HELMET, InvSlot.VEST, InvSlot.LEGS, ROCKET_RIFLE_SLOT, ROCKET_CLIP_SLOT].map((k) => queen.inventory[k])).toEqual([
      id('SPECTRA_HELMET_18'),
      id('SPECTRA_VEST_18'),
      id('SPECTRA_LEGGINGS_18'),
      id('AUTO_ROCKET_RIFLE'),
      id('CLIPROCKET_AP'),
    ]);
    expect([
      queen.inventoryCount[ROCKET_RIFLE_SLOT],
      queen.inventoryStatus[ROCKET_RIFLE_SLOT],
      queen.inventoryCount[InvSlot.HELMET],
    ]).toEqual([1, 100, 0]);
  });

  it('swaps no rocket rifle a slot names without holding one: the slot of no objects is passed over, and the automatic rifle still goes', () => {
    const queen = queenWithRocketRifle(PALACE_BASEMENT, 0);
    const t = loadedIn(PALACE_BASEMENT, [queen], queensCrate);
    expect(queen.inventory[ROCKET_RIFLE_SLOT]).toBe(itemId(t, 'ROCKET_RIFLE'));
    expect(names(t, marker)).toEqual([]);
  });

  it('leaves her crate full and her gear as it was while she has not fled to the basement, and upgrades nothing in the palace above', () => {
    const atHome = queenWithRocketRifle(PALACE);
    const basement = loadedIn(PALACE_BASEMENT, [atHome], queensCrate);
    expect(names(basement, marker)).toHaveLength(6);
    const palace = loadedIn(PALACE, [atHome], queensCrate);
    expect(names(palace, marker)).toHaveLength(6);
    expect(atHome.inventory[ROCKET_RIFLE_SLOT]).toBe(itemId(palace, 'ROCKET_RIFLE'));
    expect(atHome.inventory[InvSlot.HELMET]).toBe(0);
  });
});

describe('the world bomb list (AddBombToWorld, RemoveBombFromWorldByItemIndex, TrashWorldItems)', () => {
  it('puts a new bomb in the first free slot', () => {
    const t = newCombatSim(content).state;
    const arm = (x: number) => addItemToPool(t, gridNo(x, 80), objectOf(t, 'MINE'), Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    const first = arm(80);
    arm(81);
    addItemToPool(t, gridNo(82, 80), objectOf(t, 'MINE'), Visibility.VISIBLE, 0);
    if (!first) throw new Error('no bomb');
    removeWorldItem(t, first);
    expect(t.worldBombs.map((b) => b.exists)).toEqual([false, true]);
    arm(83);
    expect(t.worldBombs.map((b) => [b.exists, b.item.gridNo])).toEqual([
      [true, gridNo(83, 80)],
      [true, gridNo(81, 80)],
    ]);
  });

  it('empties both lists when the items are trashed', () => {
    const t = newCombatSim(content).state;
    addItemToPool(t, gridNo(80, 80), objectOf(t, 'MINE'), Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    addItemToPool(t, gridNo(81, 80), objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 0);
    trashWorldItems(t);
    expect([t.worldItems, t.worldBombs]).toEqual([[], []]);
  });
});

describe('items on structures (STRUCTURE_HASITEMONTOP)', () => {
  const table = gridNo(80, 80);
  const onTop = (t: TacticalState, g: number) => t.world.structures.find(g, StructureFlags.HASITEMONTOP) !== null;

  it('marks a generic structure an item is put on and clears it when the last item leaves the tile', () => {
    const t = newCombatSim(content).state;
    t.world.structures.add(table, 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: 2 }));
    const first = addItemToPool(t, table, objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 0);
    const second = addItemToPool(t, table, objectOf(t, 'CROWBAR'), Visibility.VISIBLE, 0);
    if (!first || !second) throw new Error('no items');
    expect([first.zHeight > 0, onTop(t, table)]).toEqual([true, true]);
    removeWorldItem(t, first);
    expect(onTop(t, table)).toBe(true);
    removeWorldItem(t, second);
    expect(onTop(t, table)).toBe(false);
  });

  it('marks no openable structure: its items lie inside', () => {
    const t = newCombatSim(content).state;
    t.world.structures.add(table, 0, syntheticStructure(StructureFlags.GENERIC | StructureFlags.OPENABLE, Orientation.NONE, { height: 2 }));
    addItemToPool(t, table, objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 0);
    expect(onTop(t, table)).toBe(false);
  });

  it('keeps the mark on the tile an item was dropped on when the item rolls to the base of a long table: the pickup clears the base alone', () => {
    const t = newCombatSim(content).state;
    const long = syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, {
      height: 2,
      tiles: [
        [0, 0],
        [1, 0],
      ],
    });
    t.world.structures.add(table, 0, long);
    const dropped = addItemToPool(t, table + 1, objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 0);
    if (!dropped) throw new Error('no item');
    expect([dropped.gridNo, onTop(t, table), onTop(t, table + 1)]).toEqual([table, false, true]);
    removeWorldItem(t, dropped);
    expect(onTop(t, table + 1)).toBe(true);
  });

  it('clears the marks of the pools the trash empties', () => {
    const t = newCombatSim(content).state;
    t.world.structures.add(table, 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: 2 }));
    addItemToPool(t, table, objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 0);
    trashWorldItems(t);
    expect(onTop(t, table)).toBe(false);
  });
});

describe('the roof an item is put on in the stub village (FlatRoofAboveGridNo)', () => {
  let kit: StubSectorKit;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  function roofTileOfType(t: TacticalState, type: string): number {
    const index = t.world.tables?.typeIndexByName.get(type);
    for (let g = 0; g < WORLD_MAX; g++) {
      const tiles = levelTilesAt(t.world.level.layers.roofs, g);
      if (tiles.length > 0 && tiles.every((tile) => t.world.tiles?.[tile]?.type === index)) return g;
    }
    throw new Error(`no ${type} tile`);
  }

  it('keeps an item on a flat roof and drops one over a slanted or high roof to the ground', () => {
    const t = new TacticalSim(kit.world('stubs/world/maps/village.dat'), kit.content, 1).state;
    const flat = roofTileOfType(t, 'SECONDROOF');
    const slanted = roofTileOfType(t, 'FIRSTSLANTROOF');
    const high = roofTileOfType(t, 'FIRSTHIGHROOF');
    expect([flat, slanted, high].map((g) => flatRoofAboveGridNo(t, g))).toEqual([true, false, false]);
    const levels = [flat, slanted, high].map((g) => addItemToPool(t, g, objectOf(t, 'CANTEEN'), Visibility.VISIBLE, 1)?.level);
    expect(levels).toEqual([1, 0, 0]);
  });
});
