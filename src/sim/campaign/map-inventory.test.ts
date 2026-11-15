import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadMerchantTestContent, type MerchantTestContent } from '../../../tests/support/merchants.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import type { StashEntryView } from '../../protocol/map-inventory.ts';
import { createItem, createItems, createMoney, type ItemObject } from '../items/object.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { getSectorFlagStatus, resetSectorFlag } from '../strategic/map/sectors.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { unseenVictim } from '../tactical/unseen-sources.ts';
import { addItemToPool, trashWorldItems, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { type DiffWorldItem, sectorKey } from './sector-diff.ts';

let kit: CampaignKit;
let merchants: MerchantTestContent;

beforeAll(async () => {
  const [sectors, economy, army, shops] = await Promise.all([
    loadStubSectorKit(),
    loadEconomyTestContent(),
    loadArmyTestContent(),
    loadMerchantTestContent(),
  ]);
  kit = { sectors, economy, army };
  merchants = shops;
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const FAR_TILE = 12000;

function onTheMap(): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed: 8,
    mercs: 2,
    garrison: { admins: 0, troops: 0, elites: 0 },
    merchants: merchants.content,
  });
  landFirstSquad(c);
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return c;
}

function onTheMapWithA9Unloaded(): CampaignSim {
  const c = onTheMap();
  for (const m of c.battle?.roster.all() ?? []) m.betweenSectors = true;
  expect(c.sectors?.checkAndHandleUnloadingOfCurrentWorld()).toBe(true);
  for (const m of c.battle?.roster.all() ?? []) m.betweenSectors = false;
  return c;
}

function mercIds(c: CampaignSim): number[] {
  return (c.battle?.roster.all() ?? []).map((m) => m.id);
}

function loaded(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

const itemIndex = (name: string) => kit.sectors.content.items.byName.get(name)?.index ?? -1;
const one = (name: string, status = 100) => createItem(kit.sectors.content.items, itemIndex(name), status);
const some = (name: string, count: number) => createItems(kit.sectors.content.items, itemIndex(name), 100, count);

function stashOn(c: CampaignSim, objects: readonly ItemObject[], flags: number = WorldItemFlags.REACHABLE): void {
  const t = loaded(c);
  trashWorldItems(t);
  objects.forEach((o, k) => {
    addItemToPool(t, FAR_TILE + 2 * k, o, Visibility.VISIBLE, 0, flags, 0);
  });
}

function stashAtTheMerc(c: CampaignSim, objects: readonly ItemObject[], flags: number = WorldItemFlags.REACHABLE): number {
  const t = loaded(c);
  const gridNo = t.soldiers[mercIds(c)[0] as number]?.gridNo ?? FAR_TILE;
  trashWorldItems(t);
  for (const o of objects) addItemToPool(t, gridNo, o, Visibility.VISIBLE, 0, flags, 0);
  return gridNo;
}

function clumsyWireman(c: CampaignSim): number {
  const merc = c.battle?.roster.get(mercIds(c)[0] as number);
  if (!merc) throw new Error('no merc');
  merc.soldier.stats.mechanical = 0;
  merc.soldier.inv[InvSlot.BIGPOCK1] = one('LAME_BOY');
  merc.soldier.inv[InvSlot.BIGPOCK2] = one('COPPER_WIRE');
  c.drainEvents();
  return merc.id;
}

function failedAttach(c: CampaignSim, merc: number) {
  expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket2', to: 'bigPocket1' })).toMatchObject({
    ok: true,
    data: { result: 'failedCheck' },
  });
  return c.drainEvents().filter((e) => e.type === 'skillCheckFailed');
}

function stash(c: CampaignSim, sector = 'A9'): StashEntryView[] {
  const answer = c.dispatch({ type: 'inventory', sector });
  if (!answer.ok) throw new Error(answer.reason);
  return (answer.data as { stash: StashEntryView[] }).stash;
}

const listed = (entries: readonly StashEntryView[]) => entries.map((e) => [e.index, e.item, e.count]);

describe('the map screen inventory', () => {
  it('tells the reload of a merc off the loaded map, as ReloadGun prints its line for any merc (Items.cc:1300)', () => {
    const c = onTheMapWithA9Unloaded();
    expect(c.tactical).toBeNull();
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'unload', soldier: merc, to: 'bigPocket2' })).toMatchObject({ ok: true });
    c.drainEvents();
    const tick = c.tick;
    expect(c.dispatch({ type: 'reload', soldier: merc, ammo: InvSlot.BIGPOCK1 })).toMatchObject({ ok: true });
    expect(c.drainEvents().filter((e) => e.type === 'reloaded')).toEqual([
      { type: 'reloaded', soldier: merc, item: itemIndex('GLOCK_17'), mapScreen: true, tick },
    ]);
  });

  it("curses a failed attach of a merc off the loaded map on the map screen, in his voice there (SkillCheck's DoMercBattleSound, Items.cc:1555)", () => {
    const c = onTheMapWithA9Unloaded();
    const merc = clumsyWireman(c);
    const soldier = c.battle?.roster.get(merc)?.soldier;
    if (!soldier) throw new Error('no merc');
    const tick = c.tick;
    expect(failedAttach(c, merc)).toEqual([
      { type: 'skillCheckFailed', soldier: merc, mapScreen: true, cry: { ...unseenVictim(soldier), team: Team.OUR }, tick },
    ]);
  });

  it('curses a failed attach of a merc of the loaded sector on the map screen, where the view shows him (SkillCheck)', () => {
    const c = onTheMap();
    const merc = clumsyWireman(c);
    const tick = c.tick;
    expect(failedAttach(c, merc)).toEqual([{ type: 'skillCheckFailed', soldier: merc, mapScreen: true, tick }]);
  });

  it("lists the stash in the pool's order, the item's category, kind and price and the better first object first, storage order for ties (SortSectorInventory, Map_Screen_Interface_Map_Inventory.cc:686)", () => {
    const c = onTheMap();
    stashOn(c, [some('CLIP9_15', 2), one('M870'), one('GLOCK_17', 50), one('CLIP9_15'), one('GLOCK_17', 90)]);
    expect(listed(stash(c))).toEqual([
      [4, 'GLOCK_17', 1],
      [2, 'GLOCK_17', 1],
      [1, 'M870', 1],
      [0, 'CLIP9_15', 2],
      [3, 'CLIP9_15', 1],
    ]);
  });

  it('keeps the index of every stash entry while another leaves it, and gives a freed index to the next new entry, as the world item list does (GetFreeWorldItemIndex)', () => {
    const c = onTheMap();
    stashAtTheMerc(c, [one('M870'), one('GLOCK_17'), some('CLIP9_15', 2)]);
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'ground', item: 1, to: 'bigPocket3' })).toMatchObject({ ok: true });
    expect(listed(stash(c))).toEqual([
      [0, 'M870', 1],
      [2, 'CLIP9_15', 2],
    ]);
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'bigPocket3', to: 'ground' })).toMatchObject({
      ok: true,
      data: { stashIndex: 1 },
    });
    expect(listed(stash(c))).toContainEqual([1, 'GLOCK_17', 1]);
  });

  it('writes the pool back into the loaded sector in its order on close, the unseen after it and a gridno of 0 taking the one before it (SaveSeenAndUnseenItems, ReBuildWorldItemStashForLoadedSector)', () => {
    const c = onTheMap();
    stashOn(c, [one('M870'), one('GLOCK_17'), some('CLIP9_15', 2), one('CANTEEN')]);
    const t = loaded(c);
    const hidden = addItemToPool(t, FAR_TILE + 40, one('CROWBAR'), Visibility.HIDDEN_ITEM, 0);
    const unset = t.worldItems[1];
    if (!hidden || !unset) throw new Error('no items');
    unset.gridNo = 0;
    expect(c.dispatch({ type: 'arrangeStash', sector: 'A9', order: [2, 1, 99] })).toEqual({
      ok: true,
      data: { sector: 'A9', entries: 4 },
    });
    const after = loaded(c).worldItems;
    expect(after.map((wi) => [wi.id, kit.sectors.content.items.byIndex.get(wi.object.item)?.name, wi.gridNo, wi.visible])).toEqual([
      [0, 'CLIP9_15', FAR_TILE + 4, Visibility.VISIBLE],
      [1, 'GLOCK_17', FAR_TILE + 4, Visibility.VISIBLE],
      [2, 'M870', FAR_TILE, Visibility.VISIBLE],
      [3, 'CANTEEN', FAR_TILE + 6, Visibility.VISIBLE],
      [4, 'CROWBAR', FAR_TILE + 40, Visibility.HIDDEN_ITEM],
    ]);
  });

  it('writes the pool of a sector off the map back in its order, behind the unseen records and without the empty ones (SaveWorldItemsToTempItemFile, AddWorldItemsToUnLoadedSector)', () => {
    const c = onTheMapWithA9Unloaded();
    const record = (object: ItemObject, gridNo: number, visible: number, exists = true): DiffWorldItem => ({
      exists,
      gridNo,
      level: 0,
      object,
      flags: WorldItemFlags.REACHABLE,
      zHeight: 0,
      visible,
    });
    const diff = c.state.sectorDiffs.get(sectorKey(A9));
    if (!diff) throw new Error('no A9 diff');
    diff.items = [
      record(one('M870'), FAR_TILE, Visibility.VISIBLE),
      record(one('GLOCK_17'), FAR_TILE + 2, Visibility.VISIBLE, false),
      record(one('CROWBAR'), FAR_TILE + 4, Visibility.INVISIBLE),
      record(some('CLIP9_15', 2), -1, Visibility.VISIBLE),
    ];
    resetSectorFlag(c.state.map, A9, SectorFlag.ITEM_TEMP_FILE_EXISTS);
    expect(c.dispatch({ type: 'arrangeStash', sector: 'A9', order: [3, 0] })).toMatchObject({ ok: true });
    const items = c.state.sectorDiffs.get(sectorKey(A9))?.items ?? [];
    expect(items.map((wi) => [wi.exists, kit.sectors.content.items.byIndex.get(wi.object.item)?.name, wi.gridNo, wi.flags])).toEqual([
      [true, 'CROWBAR', FAR_TILE + 4, WorldItemFlags.REACHABLE],
      [true, 'CLIP9_15', -1, WorldItemFlags.REACHABLE | WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT],
      [true, 'M870', FAR_TILE, WorldItemFlags.REACHABLE],
    ]);
    expect(getSectorFlagStatus(c.state.map, A9, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(true);
    expect(listed(stash(c))).toEqual([
      [2, 'M870', 1],
      [1, 'CLIP9_15', 2],
    ]);
  });

  it("marks the item file of a sector off the map when a merc drops into its stash, so the items come with its first load (AddItemsToUnLoadedSector's SaveWorldItemsToTempItemFile)", () => {
    const c = onTheMapWithA9Unloaded();
    resetSectorFlag(c.state.map, A9, SectorFlag.ITEM_TEMP_FILE_EXISTS);
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'bigPocket1', to: 'ground' })).toMatchObject({ ok: true });
    expect(getSectorFlagStatus(c.state.map, A9, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(true);
  });

  it("moves a pool item between pool slots as the original's pool cursor does: onto an empty slot with its gridno and the merc's level, stacked, money poured, a different item swapped into the cursor (MapInvenPoolSlotsPrimary, PlaceObjectInInventoryStash)", () => {
    const c = onTheMap();
    const money = (amount: number) => createMoney(kit.sectors.content.items, amount);
    const flags: number = WorldItemFlags.REACHABLE | WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO;
    const tile = stashAtTheMerc(c, [one('GLOCK_17'), some('CLIP9_15', 2), one('CLIP9_15'), money(100), money(50)], flags);
    const merc = mercIds(c)[0] as number;
    const within = (item: number, more: Record<string, unknown>) =>
      c.dispatch({ type: 'moveItem', soldier: merc, from: 'ground', item, to: 'ground', ...more });
    expect(within(1, { count: 1, stashIndex: 2 })).toMatchObject({ ok: true, data: { item: 'CLIP9_15', count: 1, stashIndex: 2 } });
    expect(within(4, { stashIndex: 3 })).toMatchObject({ ok: true, data: { stashIndex: 3 } });
    expect(stash(c).find((e) => e.index === 3)).toMatchObject({ item: 'MONEY', money: 150 });
    expect(within(0, { stashIndex: 0 })).toMatchObject({ ok: true, data: { item: 'GLOCK_17', stashIndex: 0 } });
    const moved = loaded(c).worldItems.find((wi) => wi.id === 0);
    expect(moved).toMatchObject({ gridNo: tile, level: loaded(c).soldiers[merc]?.level, flags: WorldItemFlags.REACHABLE });
    expect(within(1, { stashIndex: 0 })).toMatchObject({ ok: true, data: { item: 'CLIP9_15', stashIndex: 0, leftover: 1 } });
    expect(listed(stash(c))).toEqual([
      [1, 'GLOCK_17', 1],
      [2, 'CLIP9_15', 2],
      [0, 'CLIP9_15', 1],
      [3, 'MONEY', 1],
    ]);
    expect(
      c
        .drainEvents()
        .filter((e) => e.type === 'itemMoved')
        .map((e) => [e.from, e.to]),
    ).toEqual([
      ['ground', 'ground'],
      ['ground', 'ground'],
      ['ground', 'ground'],
      ['ground', 'ground'],
    ]);
  });

  it('throws a pool item away from the trash can, one object or the stack (TrashCanBtnCallback)', () => {
    const c = onTheMap();
    stashAtTheMerc(c, [some('CLIP9_15', 2), one('GLOCK_17')]);
    const merc = mercIds(c)[0] as number;
    c.drainEvents();
    expect(c.dispatch({ type: 'discardItem', soldier: merc, slot: 'ground', item: 0, count: 1 })).toEqual({
      ok: true,
      data: { item: 'CLIP9_15', count: 1 },
    });
    expect(c.dispatch({ type: 'discardItem', soldier: merc, slot: 'ground', item: 1 })).toMatchObject({ ok: true, data: { count: 1 } });
    expect(listed(stash(c))).toEqual([[0, 'CLIP9_15', 1]]);
    expect(c.drainEvents().filter((e) => e.type === 'itemDiscarded')).toHaveLength(2);
  });

  it('refuses to put anything onto a pool item out of reach, as the pool slot click checks the item it lands on first (MapInvenPoolSlotsPrimary)', () => {
    const c = onTheMap();
    stashOn(c, [one('GLOCK_17'), one('M870')]);
    for (const wi of loaded(c).worldItems) wi.flags = 0;
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'ground', stashIndex: 1 })).toMatchObject({
      ok: false,
      data: { refusal: 'unreachable' },
    });
    expect(c.dispatch({ type: 'arrangeStash', sector: 'A9', order: [0, 0] })).toMatchObject({
      ok: false,
      data: { refusal: 'badStashOrder' },
    });
  });
});
