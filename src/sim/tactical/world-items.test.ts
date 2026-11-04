import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf } from '../../../tests/support/explosives.ts';
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
import type { TacticalState } from './state.ts';
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

const WORLD_ITEM_BYTES = 52;
const OBJECT_OFFSET = 8;
const DETONATOR_BYTE = 5;
const BOMB_ITEM_BYTE = 6;
const ACTION_BYTE = 10;
const OBJECT_FLAGS_BYTE = 28;
const TRAP_BYTE = 30;

interface RecordFields {
  readonly flags?: number;
  readonly visible?: number;
  readonly trap?: number;
  readonly detonator?: number;
  readonly bombItem?: number;
  readonly action?: number;
  readonly objectFlags?: number;
  readonly nonExistChance?: number;
}

function mapRecord(t: TacticalState, name: string, g: number, fields: RecordFields = {}): MapItem {
  const raw = new Uint8Array(WORLD_ITEM_BYTES);
  const v = new DataView(raw.buffer);
  v.setUint16(OBJECT_OFFSET, itemId(t, name), true);
  v.setUint8(OBJECT_OFFSET + 2, 1);
  v.setInt8(OBJECT_OFFSET + 4, 100);
  v.setUint8(OBJECT_OFFSET + DETONATOR_BYTE, fields.detonator ?? 0);
  v.setUint16(OBJECT_OFFSET + BOMB_ITEM_BYTE, fields.bombItem ?? 0, true);
  v.setUint8(OBJECT_OFFSET + ACTION_BYTE, fields.action ?? 0);
  v.setUint8(OBJECT_OFFSET + OBJECT_FLAGS_BYTE, fields.objectFlags ?? 0);
  v.setInt8(OBJECT_OFFSET + TRAP_BYTE, fields.trap ?? 0);
  return {
    gridNo: g,
    level: 0,
    item: itemId(t, name),
    flags: fields.flags ?? 0,
    renderZHeightAboveLevel: 0,
    visible: fields.visible ?? Visibility.INVISIBLE,
    nonExistChance: fields.nonExistChance ?? 0,
    raw,
  };
}

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
