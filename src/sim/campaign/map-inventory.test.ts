import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadMerchantTestContent, type MerchantTestContent } from '../../../tests/support/merchants.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import type { StashEntryView } from '../../protocol/map-inventory.ts';
import { attachObject, createItem, createItems, createMoney, emptyObject, type ItemObject } from '../items/object.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { getSectorFlagStatus, resetSectorFlag } from '../strategic/map/sectors.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import { WeaponMode } from '../tactical/combat/types.ts';
import { createKeyObject, sectorByte } from '../tactical/doors/keys.ts';
import { AP_RELOAD_GUN, apsToReloadGunWithAmmo, InvSlot } from '../tactical/inventory.ts';
import { leaveTacticalSector } from '../tactical/sector-presence.ts';
import { Body, NOWHERE, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { enterCombatMode } from '../tactical/turns/turns.ts';
import { unseenVictim } from '../tactical/unseen-sources.ts';
import { addItemToPool, removeWorldItem, trashWorldItems, Visibility, type WorldItem, WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { MercKind } from './roster.ts';
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
const KEY_ID = 1;

function onTheMap(mercs = 2): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed: 8,
    mercs,
    garrison: { admins: 0, troops: 0, elites: 0 },
    merchants: merchants.content,
  });
  landFirstSquad(c);
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return c;
}

function onTheMapWithA9Unloaded(mercs = 2): CampaignSim {
  const c = onTheMap(mercs);
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

function a9Records(c: CampaignSim, objects: readonly (readonly [ItemObject, Partial<DiffWorldItem>?])[]): void {
  const diff = c.state.sectorDiffs.get(sectorKey(A9));
  if (!diff) throw new Error('no A9 diff');
  diff.items = objects.map(([object, more]) => ({
    exists: true,
    gridNo: FAR_TILE,
    level: 0,
    object,
    flags: WorldItemFlags.REACHABLE,
    zHeight: 0,
    visible: Visibility.VISIBLE,
    ...more,
  }));
}

function emptyHandedMercs(c: CampaignSim): number[] {
  const ids = mercIds(c);
  for (const id of ids) {
    const inv = c.battle?.roster.get(id)?.soldier.inv ?? [];
    inv.forEach((_, slot) => {
      inv[slot] = emptyObject();
    });
  }
  return ids;
}

function carry(c: CampaignSim, merc: number, slot: number, o: ItemObject): void {
  const inv = c.battle?.roster.get(merc)?.soldier.inv;
  if (!inv) throw new Error('no merc');
  inv[slot] = o;
}

function clips(statuses: readonly number[], name = 'CLIP9_15'): ItemObject {
  const o = some(name, statuses.length);
  o.status = [...statuses];
  return o;
}

const UNREACHABLE = { flags: 0 };

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

  it("runs over the loaded sector's items by world item index as the pool opens and closes: ties listed and the unseen written back in index order, an item that took a freed index before older ones (BuildStashForSelectedSector over gWorldItems)", () => {
    const c = onTheMap();
    stashOn(c, [one('GLOCK_17'), one('M870'), one('GLOCK_17')]);
    const t = loaded(c);
    const hide = (name: string, k: number) => addItemToPool(t, FAR_TILE + 20 + 2 * k, one(name), Visibility.HIDDEN_ITEM, 0) as WorldItem;
    removeWorldItem(t, t.worldItems[1] as WorldItem);
    addItemToPool(t, FAR_TILE + 10, one('GLOCK_17'), Visibility.VISIBLE, 0, WorldItemFlags.REACHABLE, 0);
    const crowbar = hide('CROWBAR', 0);
    hide('CANTEEN', 1);
    removeWorldItem(t, crowbar);
    hide('M870', 2);
    expect(listed(stash(c))).toEqual([
      [0, 'GLOCK_17', 1],
      [1, 'GLOCK_17', 1],
      [2, 'GLOCK_17', 1],
    ]);
    expect(c.dispatch({ type: 'arrangeStash', sector: 'A9', order: [] })).toMatchObject({ ok: true });
    const names = (wi: WorldItem) => [wi.id, kit.sectors.content.items.byIndex.get(wi.object.item)?.name, wi.gridNo];
    expect(loaded(c).worldItems.map(names)).toEqual([
      [0, 'GLOCK_17', FAR_TILE],
      [1, 'GLOCK_17', FAR_TILE + 10],
      [2, 'GLOCK_17', FAR_TILE + 4],
      [3, 'M870', FAR_TILE + 24],
      [4, 'CANTEEN', FAR_TILE + 22],
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
      [0, 'CLIP9_15', 1],
      [2, 'CLIP9_15', 2],
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

  it("parks what a merc's item swaps out of a pool slot with him and names it as the leftover, which the original keeps in the cursor: back in the pocket the item left when that moves nothing else, else in a free one (MapInvenPoolSlotsPrimary, PlaceObjectInInventoryStash)", () => {
    const c = onTheMap();
    stashAtTheMerc(c, [one('M870'), one('GLOCK_17')]);
    const merc = mercIds(c)[0] as number;
    const soldier = () => c.battle?.roster.get(merc)?.soldier;
    const held = soldier();
    if (!held) throw new Error('no merc');
    held.inv.forEach((_, slot) => {
      held.inv[slot] = emptyObject();
    });
    held.inv[InvSlot.HAND] = one('CROWBAR');
    held.inv[InvSlot.BIGPOCK1] = some('CLIP9_15', 3);
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'ground', stashIndex: 0 })).toEqual({
      ok: true,
      data: {
        item: 'CROWBAR',
        count: 1,
        sector: 'A9',
        stashIndex: 0,
        leftover: { item: 'M870', soldier: merc, slot: InvSlot.HAND, count: 'all' },
      },
    });
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'bigPocket1', to: 'ground', stashIndex: 1, count: 1 })).toMatchObject({
      ok: true,
      data: { item: 'CLIP9_15', stashIndex: 1, leftover: { item: 'GLOCK_17', soldier: merc, count: 'all' } },
    });
    const after = soldier();
    expect(after?.inv[InvSlot.BIGPOCK1]).toMatchObject({ item: itemIndex('CLIP9_15'), count: 2 });
    const ring = after?.keyRing;
    if (!ring) throw new Error('no key ring');
    ring[0] = { keyId: 1, count: 1 };
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: { ring: 0 }, to: 'ground', stashIndex: 0 })).toMatchObject({
      ok: true,
      data: { item: 'KEY_1', stashIndex: 0, leftover: { item: 'CROWBAR', soldier: merc, count: 'all' } },
    });
    expect(listed(stash(c)).map(([index, item]) => [index, item])).toEqual(
      expect.arrayContaining([
        [0, 'KEY_1'],
        [1, 'CLIP9_15'],
      ]),
    );
  });

  it("puts the leftover of a merc of the loaded sector off its tiles at the loaded map's centre, as AddItemToPool takes NOWHERE (Handle_Items.cc:1441-1446)", () => {
    const c = onTheMap();
    stashAtTheMerc(c, [one('M870')]);
    const merc = mercIds(c)[1] as number;
    const held = c.battle?.roster.get(merc)?.soldier;
    if (!held) throw new Error('no merc');
    leaveTacticalSector(loaded(c), held);
    held.inv.forEach((_, slot) => {
      held.inv[slot] = one('SILENCER');
    });
    const before = loaded(c).worldItems.length;
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'smallPocket1', to: 'ground', stashIndex: 0 })).toMatchObject({
      ok: true,
      data: { item: 'SILENCER', stashIndex: 0 },
    });
    const centre = loaded(c).world.map?.info.centerGridNo ?? NOWHERE;
    expect(
      loaded(c)
        .worldItems.slice(before)
        .map((wi) => [wi.gridNo, kit.sectors.content.items.byIndex.get(wi.object.item)?.name]),
    ).toEqual([[centre, 'M870']]);
  });

  it('opens the inventory of every sector the map can select, one never visited and the levels below included, and of none on the edge of the world (ChangeSelectedMapSector, IsTheCursorAllowedToHighLightThisSector)', () => {
    const c = onTheMap();
    const merc = mercIds(c)[0] as number;
    const query = (sector: string, z = 0) => c.dispatch({ type: 'inventory', sector, ...(z ? { z } : {}) });
    expect(query('P1')).toMatchObject({ ok: true, data: { sector: 'P1', stash: [], mercs: [] } });
    expect(query('A9', 3)).toMatchObject({ ok: true, data: { sector: 'A9', z: 3, stash: [] } });
    const edge = { ok: false, data: { refusal: 'edgeOfWorld' } };
    expect(query('P16')).toMatchObject(edge);
    expect(query('A4', 1)).toMatchObject(edge);
    expect(c.dispatch({ type: 'arrangeStash', sector: 'A5', order: [] })).toMatchObject(edge);
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'ground', sector: 'N13' })).toMatchObject(edge);
    expect(c.dispatch({ type: 'discardItem', soldier: merc, slot: 'ground', item: 0, sector: 'O14' })).toMatchObject(edge);
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

  it('stacks and sorts the pool as SHIFT+S does: guns unloaded and attachments taken off, rounds, kit charges and money poured into full objects, stacks filled to the per pocket count, then the pool order (StackAndSortMapInventoryPool)', () => {
    const c = onTheMap();
    const gun = one('GLOCK_17', 80);
    gun.gunShotsLeft = 10;
    gun.attachments[0] = { item: itemIndex('SILENCER'), status: 90 };
    const money = (amount: number) => createMoney(kit.sectors.content.items, amount);
    const kits = clips([70, 50], 'FIRSTAIDKIT');
    stashAtTheMerc(c, [gun, clips([7, 15]), clips([4]), money(15000), one('FIRSTAIDKIT', 60), money(9000), kits]);
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9' })).toEqual({ ok: true, data: { sector: 'A9', entries: 6 } });
    const pool = stash(c).map((e) => [e.item, e.count, e.status, e.money ?? e.ammo?.shots ?? null]);
    expect(pool).toEqual([
      ['GLOCK_17', 1, [80], 0],
      ['CLIP9_15', 3, [15, 15, 6], null],
      ['FIRSTAIDKIT', 2, [100, 80], null],
      ['SILENCER', 1, [90], null],
      ['MONEY', 1, [100], 20000],
      ['MONEY', 1, [100], 4000],
    ]);
    expect(stash(c).find((e) => e.item === 'GLOCK_17')).toMatchObject({ ammo: { item: 'CLIP9_15', shots: 0 } });
  });

  it('leaves alone in a stack-and-sort what cannot merge without a loss, items out of reach, keys and another level, while the empties of a pour vanish and a group of empties only stacks (StackAndSortMapInventoryPool)', () => {
    const c = onTheMapWithA9Unloaded();
    const key = (id: number) => Object.assign(one('KEY_1'), { keyId: id });
    a9Records(c, [
      [clips([5])],
      [clips([5]), UNREACHABLE],
      [clips([0])],
      [clips([5]), { level: 1 }],
      [key(1)],
      [clips([4])],
      [one('GLOCK_17'), UNREACHABLE],
      [clips([0], 'CLIP9_30')],
      [clips([0], 'CLIP9_30')],
      [key(2)],
    ]);
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9' })).toMatchObject({ ok: true, data: { entries: 7 } });
    const pool = stash(c).map((e) => [e.item, e.count, e.status, e.reachable, e.level, e.ammo?.shots ?? null]);
    expect(pool).toEqual([
      ['GLOCK_17', 1, [100], false, 0, 15],
      ['CLIP9_30', 2, [0, 0], true, 0, null],
      ['CLIP9_15', 1, [9], true, 0, null],
      ['CLIP9_15', 1, [5], true, 1, null],
      ['CLIP9_15', 1, [5], false, 0, null],
      ['KEY_1', 1, [100], true, 0, null],
      ['KEY_1', 1, [100], true, 0, null],
    ]);
  });

  it('stacks and sorts only where a merc of ours stands, not during a battle there, on the map screen (StackAndSortMapInventoryPool, CanPlayerUseSectorInventory, IsOurTeamInSectorShownInInventory)', () => {
    const c = onTheMap();
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'P1' })).toMatchObject({ ok: false, data: { refusal: 'noMercInSector' } });
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9', order: [1, 1] })).toMatchObject({
      ok: false,
      data: { refusal: 'badStashOrder' },
    });
    const t = loaded(c);
    t.turn.enemyInSector = true;
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9' })).toMatchObject({ ok: false, data: { refusal: 'battleInSector' } });
    t.turn.enemyInSector = false;
    for (const m of c.battle?.roster.all() ?? []) m.betweenSectors = true;
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9' })).toMatchObject({ ok: false, data: { refusal: 'noMercInSector' } });
    for (const m of c.battle?.roster.all() ?? []) m.betweenSectors = false;
    expect(c.dispatch({ type: 'tacticalScreen' })).toMatchObject({ ok: true });
    const onTactical = { ok: false, data: { refusal: 'mapScreenOnly' } };
    expect(c.dispatch({ type: 'stackAndSortStash', sector: 'A9' })).toMatchObject(onTactical);
    expect(c.dispatch({ type: 'refillFromStash', sector: 'A9', item: 0 })).toMatchObject(onTactical);
  });

  it("tops up the mercs' copies of the pointed-at magazine as SHIFT+R does: the pointed stack first, then the others in the pool's order, each from its last object, mercs by id and pockets in order, one on the road left out (RefillMercItemsFromMapInventoryPool)", () => {
    const c = onTheMapWithA9Unloaded(3);
    const [first, second, third] = emptyHandedMercs(c) as [number, number, number];
    carry(c, first, InvSlot.BIGPOCK1, clips([5, 15]));
    carry(c, second, InvSlot.SMALLPOCK1, clips([2]));
    carry(c, third, InvSlot.BIGPOCK1, clips([0]));
    const away = c.battle?.roster.get(third);
    if (!away) throw new Error('no merc');
    away.betweenSectors = true;
    a9Records(c, [[clips([15, 3])], [clips([8])], [clips([9]), UNREACHABLE], [one('CANTEEN', 50)], [clips([7])]]);
    expect(c.dispatch({ type: 'refillFromStash', sector: 'A9', item: 1, order: [4, 0] })).toEqual({
      ok: true,
      data: { sector: 'A9', item: 'CLIP9_15', points: 23 },
    });
    const pocket = (id: number, slot: number) => c.battle?.roster.get(id)?.soldier.inv[slot];
    expect(pocket(first, InvSlot.BIGPOCK1)).toMatchObject({ count: 2, status: [15, 15] });
    expect(pocket(second, InvSlot.SMALLPOCK1)).toMatchObject({ count: 1, status: [15] });
    expect(pocket(third, InvSlot.BIGPOCK1)).toMatchObject({ count: 1, status: [0] });
    expect(stash(c).map((e) => [e.index, e.item, e.status])).toEqual([
      [0, 'CLIP9_15', [10]],
      [2, 'CLIP9_15', [9]],
      [3, 'CANTEEN', [50]],
    ]);
  });

  it('takes from the pointed-at stack even when it carries an attachment, which keeps every other stack out of a refill (quirk, RefillMercItemsFromMapInventoryPool)', () => {
    const c = onTheMapWithA9Unloaded();
    const [first, second] = emptyHandedMercs(c) as [number, number];
    carry(c, first, InvSlot.BIGPOCK1, clips([0]));
    carry(c, second, InvSlot.BIGPOCK1, clips([0]));
    const fitted = () => {
      const o = clips([15]);
      o.attachments[0] = { item: itemIndex('SILENCER'), status: 90 };
      return o;
    };
    a9Records(c, [[fitted()], [fitted()]]);
    expect(c.dispatch({ type: 'refillFromStash', sector: 'A9', item: 0 })).toMatchObject({ ok: true, data: { points: 15 } });
    const pocket = (id: number) => c.battle?.roster.get(id)?.soldier.inv[InvSlot.BIGPOCK1];
    expect([pocket(first)?.status, pocket(second)?.status]).toEqual([[15], [0]]);
  });

  it('refills only from a reachable magazine, kit or medical kit, on the map screen and not during a battle there (RefillMercItemsFromMapInventoryPool)', () => {
    const c = onTheMapWithA9Unloaded();
    a9Records(c, [[clips([5]), UNREACHABLE], [one('GLOCK_17')], [one('CANTEEN', 50)]]);
    const refill = (item: unknown) => c.dispatch({ type: 'refillFromStash', sector: 'A9', item });
    expect(refill(0)).toMatchObject({ ok: false, data: { refusal: 'unreachable' } });
    expect(refill(1)).toMatchObject({ ok: false, data: { refusal: 'notRefillable' } });
    expect(refill(7)).toMatchObject({ ok: false, data: { refusal: 'badStashIndex' } });
    expect(refill(2)).toMatchObject({ ok: true, data: { item: 'CANTEEN', points: 0 } });
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

  it('refuses a hand swap as tactical only: the original swaps hands by the tactical key and panel alone (SwapHandItems, Turn_Based_Input.cc:3390, Interface_Panels.cc:3098)', () => {
    for (const c of [onTheMap(), onTheMapWithA9Unloaded()]) {
      const merc = mercIds(c)[0] as number;
      const inv = c.battle?.roster.get(merc)?.soldier.inv ?? [];
      carry(c, merc, InvSlot.SECOND_HAND, one('M870'));
      const hands = () => [inv[InvSlot.HAND]?.item, inv[InvSlot.SECOND_HAND]?.item];
      const before = hands();
      expect(c.dispatch({ type: 'swapHands', soldier: merc })).toMatchObject({ ok: false, data: { refusal: 'tacticalOnly' } });
      expect(hands()).toEqual(before);
    }
  });
});

describe("PlaceObject's side effects for a merc off the loaded map (MAPInvClickCallbackPrimary)", () => {
  function offTheMap(mercs = 2): { c: CampaignSim; merc: number; s: Soldier } {
    const c = onTheMapWithA9Unloaded(mercs);
    expect(c.tactical).toBeNull();
    const merc = mercIds(c)[0] as number;
    const s = c.battle?.roster.get(merc)?.soldier;
    if (!s) throw new Error('no merc');
    return { c, merc, s };
  }

  function launcherGun(): ItemObject {
    const items = kit.sectors.content.items;
    const gun = one('C7');
    expect(attachObject(items, gun, one('UNDER_GLAUNCHER'))).toBe(true);
    expect(attachObject(items, gun, one('GL_HE_GRENADE'))).toBe(true);
    return gun;
  }

  it('records a key he takes from the stash as found that day in his sector, as CollectKey does for any merc of ours (Items.cc:1849)', () => {
    const { c, merc } = offTheMap();
    const key = createKeyObject(kit.sectors.content, 1, KEY_ID);
    if (!key) throw new Error('no key item');
    carry(c, merc, InvSlot.SMALLPOCK1, emptyObject());
    a9Records(c, [[key]]);
    expect(c.state.keyTable[KEY_ID]?.dateFound).toBe(0);
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'ground', item: 0, to: 'smallPocket1' })).toMatchObject({ ok: true });
    expect(c.state.keyTable[KEY_ID]).toEqual({ dateFound: worldDay(c.state.clock), sectorFound: sectorByte(A9) });
  });

  it("makes him the robot's controller as he puts its remote control on, the robot beside him, as PlaceObject does for any merc of ours (UpdateRobotControllerGivenController, Items.cc:2072)", () => {
    const { c, merc } = offTheMap(3);
    const robot = c.battle?.roster.get(mercIds(c)[2] as number);
    if (!robot) throw new Error('no third merc');
    Object.assign(robot.record, { kind: MercKind.EPC });
    Object.assign(robot.soldier, { profile: Npc.ROBOT, bodyType: Body.ROBOTNOWEAPON });
    carry(c, merc, InvSlot.HEAD1, emptyObject());
    carry(c, merc, InvSlot.BIGPOCK1, one('ROBOT_REMOTE_CONTROL'));
    expect(robot.remoteHolder).toBeNull();
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'bigPocket1', to: 'head1' })).toMatchObject({ ok: true });
    expect(robot.remoteHolder).toBe(merc);
  });

  it('keeps his weapon mode true to his hand after a placement, as EnsureConsistentWeaponMode ends every PlaceObject (Items.cc:2081)', () => {
    const { c, merc, s } = offTheMap();
    carry(c, merc, InvSlot.HAND, one('C7'));
    carry(c, merc, InvSlot.BIGPOCK2, emptyObject());
    Object.assign(s, { weaponMode: WeaponMode.BURST, doBurst: 1 });
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'bigPocket2' })).toMatchObject({ ok: true });
    expect([s.weaponMode, s.doBurst]).toEqual([WeaponMode.NORMAL, 0]);
  });

  it('drops his launcher mode as the gun with the launcher leaves his hand, as HandleTacticalEffectsOfEquipmentChange does for any merc (Interface_Panels.cc:3777)', () => {
    const { c, merc, s } = offTheMap();
    carry(c, merc, InvSlot.HAND, launcherGun());
    Object.assign(s, { weaponMode: WeaponMode.ATTACHED, doBurst: 0 });
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'ground' })).toMatchObject({ ok: true });
    expect(s.weaponMode).toBe(WeaponMode.NORMAL);
  });

  it('leaves the burst mode on as a burst gun goes from the hand into the stash, which places nothing on the merc and so runs no EnsureConsistentWeaponMode (quirk, MapScreen.cc:3711)', () => {
    for (const c of [onTheMap(), onTheMapWithA9Unloaded()]) {
      const merc = mercIds(c)[0] as number;
      const s = c.battle?.roster.get(merc)?.soldier;
      if (!s) throw new Error('no merc');
      carry(c, merc, InvSlot.HAND, one('C7'));
      Object.assign(s, { weaponMode: WeaponMode.BURST, doBurst: 1 });
      expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'hand', to: 'ground' })).toMatchObject({ ok: true });
      expect([s.weaponMode, s.doBurst]).toEqual([WeaponMode.BURST, 1]);
    }
  });
});

describe('the map screen inventory in combat (Points.cc EnoughPoints and DeductPoints test INCOMBAT, not the screen)', () => {
  const A10 = { x: 10, y: 1, z: 0 };
  const SPARE_AP = 3;
  const AP_PICKUP_ITEM = 3;
  const FULL_POCKETS = [
    InvSlot.SECOND_HAND,
    InvSlot.BIGPOCK1,
    InvSlot.BIGPOCK2,
    InvSlot.BIGPOCK3,
    InvSlot.BIGPOCK4,
    InvSlot.SMALLPOCK1,
    InvSlot.SMALLPOCK2,
    InvSlot.SMALLPOCK3,
    InvSlot.SMALLPOCK4,
    InvSlot.SMALLPOCK5,
    InvSlot.SMALLPOCK6,
    InvSlot.SMALLPOCK7,
    InvSlot.SMALLPOCK8,
  ];

  function onTheMapInCombat(): CampaignSim {
    const { campaign: c } = createTestCampaign(kit, {
      seed: 8,
      mercs: 2,
      garrison: { admins: 0, troops: 3, elites: 0 },
      merchants: merchants.content,
    });
    landFirstSquad(c);
    enterCombatMode(loaded(c), Team.OUR);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(loaded(c).inCombat).toBe(true);
    return c;
  }

  function soldierOf(c: CampaignSim, merc: number): Soldier {
    const s = c.battle?.roster.get(merc)?.soldier;
    if (!s) throw new Error('no merc');
    return s;
  }

  function takenOffTheLoadedMap(c: CampaignSim, merc: number): void {
    const m = c.battle?.roster.get(merc);
    if (!m) throw new Error('no merc');
    leaveTacticalSector(loaded(c), m.soldier);
    m.sector = { ...A10 };
  }

  function withScopes(c: CampaignSim, merc: number): void {
    carry(c, merc, InvSlot.BIGPOCK2, one('SILENCER'));
    carry(c, merc, InvSlot.BIGPOCK3, one('LASERSCOPE'));
  }

  function reloadCost(c: CampaignSim, merc: number): number {
    const inv = soldierOf(c, merc).inv;
    return apsToReloadGunWithAmmo(kit.sectors.content.items, inv[InvSlot.HAND] as ItemObject, inv[InvSlot.BIGPOCK2] as ItemObject);
  }

  it('charges a reload its APs and refuses it short of them, as ReloadGun does in combat on any screen (Items.cc:1095-1100)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'unload', soldier: merc, to: 'bigPocket2' })).toMatchObject({ ok: true });
    const cost = reloadCost(c, merc);
    soldierOf(c, merc).actionPoints = cost - 1;
    expect(c.dispatch({ type: 'reload', soldier: merc, ammo: 'bigPocket2' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
    soldierOf(c, merc).actionPoints = cost + SPARE_AP;
    expect(c.dispatch({ type: 'reload', soldier: merc, ammo: 'bigPocket2' })).toMatchObject({ ok: true });
    expect(soldierOf(c, merc).actionPoints).toBe(SPARE_AP);
  });

  it('charges a merc off the loaded map too, whose points every turn refreshes (TeamTurns.cc BeginTeamTurn)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[1] as number;
    takenOffTheLoadedMap(c, merc);
    expect(c.dispatch({ type: 'unload', soldier: merc, to: 'bigPocket2' })).toMatchObject({ ok: true });
    const cost = reloadCost(c, merc);
    soldierOf(c, merc).actionPoints = cost + SPARE_AP;
    expect(c.dispatch({ type: 'reload', soldier: merc, ammo: 'bigPocket2' })).toMatchObject({ ok: true });
    expect(soldierOf(c, merc).actionPoints).toBe(SPARE_AP);
  });

  function reloadWithPocketsFullAndPointsShort(c: CampaignSim, merc: number, sector: string): void {
    carry(c, merc, InvSlot.BIGPOCK1, clips([5]));
    const dropped = c.dispatch({ type: 'moveItem', soldier: merc, from: 'bigPocket1', to: 'ground' });
    expect(dropped).toMatchObject({ ok: true, data: { sector } });
    const stashIndex = (dropped.data as { stashIndex: number }).stashIndex;
    for (const slot of FULL_POCKETS) carry(c, merc, slot, one('SILENCER'));
    const gun = soldierOf(c, merc).inv[InvSlot.HAND] as ItemObject;
    gun.gunShotsLeft = 1;
    const cost = apsToReloadGunWithAmmo(kit.sectors.content.items, gun, clips([5]));
    soldierOf(c, merc).actionPoints = cost + AP_PICKUP_ITEM - 1;
    expect(c.dispatch({ type: 'moveItem', soldier: merc, from: 'ground', item: stashIndex, to: 'hand' })).toMatchObject({ ok: true });
    expect(soldierOf(c, merc).actionPoints).toBe(AP_PICKUP_ITEM - 1);
  }

  const magazines = (entries: readonly StashEntryView[]) => entries.map((e) => [e.item, e.status, e.gridNo]);

  it('drops the old magazine of a merc off the loaded map, his pockets full and his points short of the pickup, into his own sector (Items.cc:1235-1241)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[1] as number;
    takenOffTheLoadedMap(c, merc);
    const before = loaded(c).worldItems.length;
    reloadWithPocketsFullAndPointsShort(c, merc, 'A10');
    expect(loaded(c).worldItems.length).toBe(before);
    expect(magazines(stash(c, 'A10'))).toEqual([['CLIP9_15', [1], NOWHERE]]);
  });

  it('charges an attach outside a box as a box of its own, AP_RELOAD_GUN once, and refuses it short of that (Interface_Items.cc:1987, :2585)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[0] as number;
    withScopes(c, merc);
    soldierOf(c, merc).actionPoints = AP_RELOAD_GUN - 1;
    expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
    soldierOf(c, merc).actionPoints = AP_RELOAD_GUN + SPARE_AP;
    expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket2', to: 'hand' })).toMatchObject({ ok: true });
    expect(soldierOf(c, merc).actionPoints).toBe(SPARE_AP);
    expect(c.state.mapScreen.itemDescription).toBeNull();
  });

  it('keeps the box over the attachments made in it and charges its one AP_RELOAD_GUN as it closes (DeleteItemDescriptionBox)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[0] as number;
    withScopes(c, merc);
    soldierOf(c, merc).actionPoints = AP_RELOAD_GUN + SPARE_AP;
    expect(c.dispatch({ type: 'openItemDescription', soldier: merc, slot: 'hand' })).toMatchObject({ ok: true });
    expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: true,
      data: { inBox: true },
    });
    expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket3', to: 'hand' })).toMatchObject({
      ok: true,
      data: { inBox: true },
    });
    expect(c.dispatch({ type: 'detach', soldier: merc, slot: 'hand', attachment: 'LASERSCOPE' })).toMatchObject({
      ok: true,
      data: { inBox: true },
    });
    expect(soldierOf(c, merc).actionPoints).toBe(AP_RELOAD_GUN + SPARE_AP);
    expect(c.dispatch({ type: 'closeItemDescription' })).toEqual({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(soldierOf(c, merc).actionPoints).toBe(SPARE_AP);
  });

  it('closes the box with its charge as the map hands back to the loaded sector (EndMapScreen)', () => {
    const c = onTheMapInCombat();
    const merc = mercIds(c)[0] as number;
    withScopes(c, merc);
    soldierOf(c, merc).actionPoints = AP_RELOAD_GUN + SPARE_AP;
    expect(c.dispatch({ type: 'openItemDescription', soldier: merc, slot: 'hand' })).toMatchObject({ ok: true });
    expect(c.dispatch({ type: 'attach', soldier: merc, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: true,
      data: { inBox: true },
    });
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.mapScreen.itemDescription).toBeNull();
    expect(soldierOf(c, merc).actionPoints).toBe(SPARE_AP);
  });
});
