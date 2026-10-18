// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc MapInvenPoolSlotsPrimary, BuildStashForSelectedSector,
// @src IsMapScreenWorldItemVisibleInMapInventory, BeginInventoryPoolPtr, GetObjFromInventoryStashSlot,
// @src RemoveObjectFromStashSlot, PlaceObjectInInventoryStash, CanPlayerUseSectorInventory, SaveSeenAndUnseenItems,
// @src CreateDestroyMapInventoryPoolButtons (the reachability of the loaded sector's items); MapScreen.cc
// @src MAPInvClickCallbackPrimary, MAPBeginItemPointer, MapCharacterHasAccessibleInventory, MAPInvClickCamoCallback (no
// @src items applied on the map screen); Map_Screen_Interface.cc MapscreenCanPassItemToChar. See docs/04 §6.23.

import { ItemClass, NOTHING } from '../../content/items/items.ts';
import { parseSectorString, type Sector, sameSector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { cloneObject, deleteObject, getObjFrom, type ItemObject, removeObjects, stackObjects, swapObjects } from '../items/object.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { autoReload } from '../tactical/combat/reload.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { handleTacticalEffectsOfEquipmentChange } from '../tactical/hand-item.ts';
import { autoPlaceObject, type InventoryContext, InvSlot, itemIn, placeObject } from '../tactical/inventory.ts';
import {
  attachmentPosition,
  type InventoryCommand,
  InventoryRefusal,
  optionalSlot,
  outcomeResult,
  parseCount,
  parseSlot,
  refusal,
} from '../tactical/inventory-commands.ts';
import {
  attachItem,
  type Count,
  detachItem,
  moveItem,
  nailsRefuses,
  type PanelEnv,
  type PanelEvent,
  reloadWeapon,
  swapHands,
  takeObjects,
  unloadGun,
} from '../tactical/inventory-panel.ts';
import { type InventoryItemView, inventoryView } from '../tactical/inventory-view.ts';
import { handleAllReachableItemsInTheSector } from '../tactical/item-reachability.ts';
import { isCreatureOrBloodcat, NOWHERE, OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import { soldierInventoryContext } from '../tactical/soldier-inventory.ts';
import { teamMembers } from '../tactical/state.ts';
import { addItemToPool, removeWorldItem, Visibility, type WorldItem, WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { campaignCombatContext } from './off-map-combat.ts';
import type { RosterMerc } from './roster.ts';
import { type DiffWorldItem, emptySectorDiff, sectorKey, visibleItemCount } from './sector-diff.ts';

export const MAP_INVENTORY_COMMANDS: ReadonlySet<string> = new Set([
  'moveItem',
  'attach',
  'detach',
  'unload',
  'reload',
  'swapHands',
  'applyItem',
  'bandage',
]);

export const MapInventoryRefusal = {
  NO_SUCH_MERC: 'noSuchMerc',
  INACCESSIBLE: 'inaccessible',
  OTHER_SECTOR: 'otherSector',
  HOSTILE_SECTOR: 'hostileSector',
  BATTLE: 'battleInSector',
  NOT_IN_SECTOR: 'notInSector',
  BAD_STASH_INDEX: 'badStashIndex',
  UNREACHABLE: 'unreachable',
  TACTICAL_ONLY: 'tacticalOnly',
  BAD_SECTOR: 'badSector',
} as const;

type MapInventoryRefusal = (typeof MapInventoryRefusal)[keyof typeof MapInventoryRefusal];

const MAP_REFUSAL_TEXT: Readonly<Record<MapInventoryRefusal, string>> = {
  noSuchMerc: 'no such merc on the team',
  inaccessible:
    'that merc has no inventory to handle on the map screen (in transit, captured, an escort, a vehicle, the robot or below OK life)',
  otherSector: 'items pass only between mercs in the same sector (on the road: in the same squad or vehicle)',
  hostileSector: 'items cannot be passed while the loaded sector holds enemies',
  battleInSector: 'there is a battle in that sector: handle its items in tactical',
  notInSector: 'the merc must stand in the sector of that inventory, not on the road',
  badStashIndex: 'stash index must be one of the indices listed by the inventory query',
  unreachable: 'that item lies out of reach',
  tacticalOnly: 'this is done in tactical only',
  badSector: 'sector must be a sector such as A9',
};

const MONEY_STATUS = 100;

function contentOf(campaign: CampaignSim): TacticalContent {
  const content = campaign.battle?.content;
  if (!content) throw new Error('the map inventory needs the campaign roster');
  return content;
}

const mapRefusal = (code: MapInventoryRefusal): CommandResult => ({
  ok: false,
  reason: `${code}: ${MAP_REFUSAL_TEXT[code]}`,
  data: { refusal: code },
});

export interface StashEntryView {
  readonly index: number;
  readonly item: string;
  readonly count: number;
  readonly status: readonly number[];
  readonly money?: number;
  readonly reachable: boolean;
  readonly gridNo: number;
  readonly level: number;
}

interface StashSlot {
  readonly object: ItemObject;
  readonly gridNo: number;
  readonly level: number;
  readonly flags: number;
}

interface Stash {
  slots(): StashSlot[];
  take(index: number, count: Count): ItemObject | null;
  placeInto(index: number, cursor: ItemObject): void;
  add(o: ItemObject, gridNo: number, level: number): void;
}

function visibleInMapInventory(campaign: CampaignSim, o: ItemObject, visible: number): boolean {
  const items = contentOf(campaign).items;
  const hidden = ['SWITCH', 'ACTION_ITEM'].map((n) => items.byName.get(n)?.index ?? -2);
  return visible === Visibility.VISIBLE && !hidden.includes(o.item) && o.trap <= 0;
}

function slotLimit(campaign: CampaignSim, item: number): number {
  return contentOf(campaign).items.byIndex.get(item)?.perPocket ?? 0;
}

function placeIntoStashSlot(campaign: CampaignSim, slot: ItemObject, cursor: ItemObject): void {
  const limit = slotLimit(campaign, cursor.item);
  if (cursor.item !== slot.item) swapObjects(cursor, slot);
  else if (contentOf(campaign).items.byIndex.get(cursor.item)?.itemClass === ItemClass.MONEY) {
    slot.status[0] = MONEY_STATUS;
    slot.money += cursor.money;
    deleteObject(cursor);
  } else if (limit < 2) swapObjects(cursor, slot);
  else stackObjects(cursor, slot, Math.min(cursor.count, Math.max(0, limit - slot.count)));
}

function newStashObjects(campaign: CampaignSim, cursor: ItemObject): ItemObject[] {
  const limit = slotLimit(campaign, cursor.item);
  const out: ItemObject[] = [];
  while (cursor.count > 0) {
    const n = limit !== 0 && cursor.count > limit ? limit : cursor.count;
    const part = cloneObject(cursor);
    part.count = n;
    part.status = cursor.status.slice(0, n);
    out.push(part);
    removeObjects(cursor, n);
  }
  return out;
}

function stashFlags(gridNo: number): number {
  return WorldItemFlags.REACHABLE | (gridNo === NOWHERE ? WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT : 0);
}

function loadedStash(campaign: CampaignSim): Stash {
  const t = campaign.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  const visible = () => t.worldItems.filter((wi) => visibleInMapInventory(campaign, wi.object, wi.visible));
  return {
    slots: () => visible().map((wi) => ({ object: wi.object, gridNo: wi.gridNo, level: wi.level, flags: wi.flags })),
    take: (index, count) => {
      const wi = visible()[index] as WorldItem;
      if (count === 1 && wi.object.count > 1) return getObjFrom(wi.object, 0);
      removeWorldItem(t, wi);
      return cloneObject(wi.object);
    },
    placeInto: (index, cursor) => {
      const wi = visible()[index] as WorldItem;
      placeIntoStashSlot(campaign, wi.object, cursor);
      wi.flags |= WorldItemFlags.REACHABLE;
    },
    add: (o, gridNo, level) => {
      for (const part of newStashObjects(campaign, o)) addItemToPool(t, gridNo, part, Visibility.VISIBLE, level, stashFlags(gridNo), 0);
    },
  };
}

function unloadedStash(campaign: CampaignSim, sector: Sector): Stash {
  const state = campaign.state;
  const key = sectorKey(sector);
  const records = (): DiffWorldItem[] => {
    let diff = state.sectorDiffs.get(key);
    if (!diff) {
      diff = emptySectorDiff();
      state.sectorDiffs.set(key, diff);
    }
    diff.items ??= [];
    return diff.items;
  };
  const visibleIndices = () =>
    records()
      .map((wi, k) => [wi, k] as const)
      .filter(([wi]) => wi.exists && visibleInMapInventory(campaign, wi.object, wi.visible))
      .map(([, k]) => k);
  const recount = () => {
    if (sector.z === 0) sectorInfo(state.map, sector).visibleItems = visibleItemCount(records());
  };
  return {
    slots: () => visibleIndices().map((k) => records()[k] as DiffWorldItem),
    take: (index, count) => {
      const k = visibleIndices()[index] as number;
      const items = records();
      const record = items[k] as DiffWorldItem;
      const rest = cloneObject(record.object);
      const taken = count === 1 && rest.count > 1 ? getObjFrom(rest, 0) : cloneObject(rest);
      items[k] = count === 1 && record.object.count > 1 ? { ...record, object: rest } : { ...record, exists: false };
      recount();
      return taken;
    },
    placeInto: (index, cursor) => {
      const k = visibleIndices()[index] as number;
      const items = records();
      const record = items[k] as DiffWorldItem;
      const object = cloneObject(record.object);
      placeIntoStashSlot(campaign, object, cursor);
      items[k] = { ...record, object, flags: record.flags | WorldItemFlags.REACHABLE };
      recount();
    },
    add: (o, gridNo, level) => {
      const items = records();
      for (const object of newStashObjects(campaign, o)) {
        const record: DiffWorldItem = {
          exists: true,
          gridNo,
          level,
          object,
          flags: stashFlags(gridNo),
          zHeight: 0,
          visible: Visibility.VISIBLE,
        };
        const free = items.findIndex((wi) => !wi.exists);
        if (free === -1) items.push(record);
        else items[free] = record;
      }
      recount();
    },
  };
}

function isLoaded(campaign: CampaignSim, sector: Sector): boolean {
  const world = campaign.state.worldSector;
  return campaign.tactical !== null && world !== null && sameSector(world, sector);
}

function stashOf(campaign: CampaignSim, sector: Sector): Stash {
  if (!isLoaded(campaign, sector)) return unloadedStash(campaign, sector);
  const t = campaign.tactical?.state;
  if (t) handleAllReachableItemsInTheSector(t, teamMembers(t, Team.OUR));
  return loadedStash(campaign);
}

function enemyInLoadedSector(campaign: CampaignSim): boolean {
  return campaign.tactical?.state.turn.enemyInSector === true;
}

function battleIn(campaign: CampaignSim, sector: Sector): boolean {
  return isLoaded(campaign, sector) && enemyInLoadedSector(campaign);
}

function accessible(m: RosterMerc): boolean {
  return (
    m.assignment !== Assignment.IN_TRANSIT &&
    m.assignment !== Assignment.ASSIGNMENT_POW &&
    !m.isVehicle &&
    !m.isRobot &&
    !m.isEpc &&
    !isCreatureOrBloodcat(m.soldier) &&
    m.life >= OKLIFE
  );
}

function passRefusal(campaign: CampaignSim, from: RosterMerc, to: RosterMerc): MapInventoryRefusal | null {
  if (from === to) return null;
  if (enemyInLoadedSector(campaign)) return MapInventoryRefusal.HOSTILE_SECTOR;
  if (!sameSector(from.sector, to.sector)) return MapInventoryRefusal.OTHER_SECTOR;
  if (!to.betweenSectors) return null;
  if (!from.betweenSectors || from.assignment !== to.assignment) return MapInventoryRefusal.OTHER_SECTOR;
  if (to.assignment === Assignment.VEHICLE && to.vehicleId !== from.vehicleId) return MapInventoryRefusal.OTHER_SECTOR;
  return null;
}

function stashRefusal(campaign: CampaignSim, m: RosterMerc, sector: Sector): MapInventoryRefusal | null {
  if (!sameSector(m.sector, sector) || m.betweenSectors) return MapInventoryRefusal.NOT_IN_SECTOR;
  return battleIn(campaign, sector) ? MapInventoryRefusal.BATTLE : null;
}

export class MapInventory {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #merc(value: unknown): RosterMerc | null {
    const roster = this.#campaign.battle?.roster;
    return typeof value === 'number' ? (roster?.get(value) ?? null) : null;
  }

  #context(s: Soldier): InventoryContext {
    const t = this.#campaign.tactical?.state;
    if (t && s.placed && t.soldiers[s.id] === s) return { ...soldierInventoryContext(t, s), inCombat: false };
    return {
      items: contentOf(this.#campaign).items,
      inCombat: false,
      actionPoints: () => s.actionPoints,
      spendActionPoints: () => {},
      dropAtFeet: () => {},
    };
  }

  #dryContext(s: Soldier): InventoryContext {
    return {
      items: contentOf(this.#campaign).items,
      inCombat: false,
      actionPoints: () => s.actionPoints,
      spendActionPoints: () => {},
      dropAtFeet: () => {},
    };
  }

  #env(owner: RosterMerc): PanelEnv {
    const campaign = this.#campaign;
    const combat = campaignCombatContext(() => campaign, campaign.state, contentOf(campaign))();
    return {
      items: contentOf(campaign).items,
      combat: { ...combat, inCombat: false },
      inCombat: false,
      mapScreen: true,
      context: (s) => this.#context(s),
      equipmentChanged: (s, slot, oldItem, newItem) => {
        const t = campaign.tactical?.state;
        if (t && s.placed && t.soldiers[s.id] === s) handleTacticalEffectsOfEquipmentChange(t, s, slot, oldItem, newItem);
      },
      leftover: (s, o) => stashOf(campaign, owner.sector).add(o, s.gridNo, s.level),
      emit: (event: PanelEvent) => {
        this.#events.push({ ...event, tick: campaign.tick } as SimEvent);
      },
    };
  }

  dispatch(cmd: InventoryCommand): CommandResult | null {
    if (cmd.type === 'inventory') return this.#query(cmd);
    if (this.#campaign.state.flow !== 'strategic' || !MAP_INVENTORY_COMMANDS.has(cmd.type)) return null;
    const merc = this.#merc(cmd.soldier);
    if (!merc) return mapRefusal(MapInventoryRefusal.NO_SUCH_MERC);
    if (!accessible(merc)) return mapRefusal(MapInventoryRefusal.INACCESSIBLE);
    const s = merc.soldier;
    const env = this.#env(merc);
    switch (cmd.type) {
      case 'moveItem':
        return this.#move(merc, cmd);
      case 'attach':
        return this.#attach(merc, cmd);
      case 'detach': {
        const slot = parseSlot(cmd.slot);
        const to = optionalSlot(cmd.to);
        if (slot === null || typeof to === 'string') return refusal(InventoryRefusal.BAD_SLOT);
        const position = attachmentPosition(contentOf(this.#campaign).items, s.inv[slot], cmd.attachment);
        if (typeof position === 'string') return refusal(position);
        return outcomeResult(detachItem(env, s, slot, position, to));
      }
      case 'unload': {
        const slot = cmd.slot === undefined ? InvSlot.HAND : parseSlot(cmd.slot);
        const to = optionalSlot(cmd.to);
        if (slot === null || typeof to === 'string') return refusal(InventoryRefusal.BAD_SLOT);
        return outcomeResult(unloadGun(env, s, slot, to));
      }
      case 'reload': {
        const slot = cmd.slot === undefined ? InvSlot.HAND : parseSlot(cmd.slot);
        const ammo = optionalSlot(cmd.ammo);
        if (slot === null || typeof ammo === 'string') return refusal(InventoryRefusal.BAD_SLOT);
        return outcomeResult(reloadWeapon(env, s, slot, ammo, (soldier) => autoReload(this.#context(soldier), soldier)));
      }
      case 'swapHands':
        return outcomeResult(swapHands(env, this.#campaign.tactical?.state ?? null, s));
      default:
        return mapRefusal(MapInventoryRefusal.TACTICAL_ONLY);
    }
  }

  #target(merc: RosterMerc, value: unknown): RosterMerc | CommandResult {
    if (value === undefined) return merc;
    const other = this.#merc(value);
    if (!other) return mapRefusal(MapInventoryRefusal.NO_SUCH_MERC);
    if (!accessible(other)) return mapRefusal(MapInventoryRefusal.INACCESSIBLE);
    const refused = passRefusal(this.#campaign, merc, other);
    return refused ? mapRefusal(refused) : other;
  }

  #attach(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const from = parseSlot(cmd.item);
    const slot = parseSlot(cmd.to);
    if (from === null || slot === null) return refusal(InventoryRefusal.BAD_SLOT);
    const count = parseCount(cmd.count, 1);
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    const owner = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in owner)) return owner;
    const index = typeof cmd.index === 'number' ? cmd.index : 0;
    const env = this.#env(merc);
    return outcomeResult(
      attachItem(env, { attacher: merc.soldier, from, owner: owner.soldier, slot, index, count, permanent: cmd.permanent === true }),
    );
  }

  #move(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const count = parseCount(cmd.count, 'all');
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    if (cmd.from === 'ground') return this.#fromStash(merc, cmd, count);
    const from = parseSlot(cmd.from);
    if (from === null) return refusal(InventoryRefusal.BAD_SLOT);
    if (cmd.to === 'ground') return this.#toStash(merc, from, cmd, count);
    const to = parseSlot(cmd.to);
    if (to === null) return refusal(InventoryRefusal.BAD_SLOT);
    const target = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in target)) return target;
    const index = typeof cmd.index === 'number' && Number.isInteger(cmd.index) ? cmd.index : 0;
    if (index < 0 || index >= Math.max(1, merc.soldier.inv[from]?.count ?? 0)) return refusal(InventoryRefusal.BAD_INDEX);
    return outcomeResult(
      moveItem(this.#env(merc), { mover: merc.soldier, from, target: target.soldier, to, count, index, merge: undefined }),
    );
  }

  #stashIndex(stash: Stash, value: unknown): number | null {
    const slots = stash.slots();
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < slots.length ? value : null;
  }

  #stashSector(merc: RosterMerc, cmd: InventoryCommand): Sector | null {
    if (cmd.sector === undefined) return merc.sector;
    if (typeof cmd.sector !== 'string') return null;
    try {
      return parseSectorString(cmd.sector, typeof cmd.z === 'number' ? cmd.z : 0);
    } catch {
      return null;
    }
  }

  #toStash(merc: RosterMerc, from: number, cmd: InventoryCommand, count: Count): CommandResult {
    const sector = this.#stashSector(merc, cmd);
    if (!sector) return mapRefusal(MapInventoryRefusal.BAD_SECTOR);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const s = merc.soldier;
    const source = s.inv[from] as ItemObject;
    if (source.item === NOTHING) return refusal(InventoryRefusal.EMPTY_SLOT);
    if (nailsRefuses(contentOf(this.#campaign).items, s, from, NOTHING)) return refusal(InventoryRefusal.NAILS_VEST);
    const stash = stashOf(this.#campaign, sector);
    const into = cmd.stashIndex === undefined ? null : this.#stashIndex(stash, cmd.stashIndex);
    if (cmd.stashIndex !== undefined && into === null) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    const item = source.item;
    const cursor = takeObjects(source, count, 0) as ItemObject;
    const moved = cursor.count;
    this.#env(merc).equipmentChanged(s, from, item, NOTHING);
    if (into === null) stash.add(cursor, s.gridNo, s.level);
    else stash.placeInto(into, cursor);
    this.#returnToMerc(merc, from, cursor);
    this.#emitMove(merc, item, moved, from, 'ground');
    return { ok: true, data: { item: this.#name(item), count: moved, sector: sectorShortString(sector) } };
  }

  #fromStash(merc: RosterMerc, cmd: InventoryCommand, count: Count): CommandResult {
    const sector = this.#stashSector(merc, cmd);
    if (!sector) return mapRefusal(MapInventoryRefusal.BAD_SECTOR);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const to = parseSlot(cmd.to);
    if (to === null) return refusal(InventoryRefusal.BAD_SLOT);
    const stash = stashOf(this.#campaign, sector);
    const index = this.#stashIndex(stash, cmd.item);
    if (index === null) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    const slot = stash.slots()[index] as StashSlot;
    if (!(slot.flags & WorldItemFlags.REACHABLE)) return mapRefusal(MapInventoryRefusal.UNREACHABLE);
    const s = merc.soldier;
    if (nailsRefuses(contentOf(this.#campaign).items, s, to, slot.object.item)) return refusal(InventoryRefusal.NAILS_VEST);
    const preview = takeObjects(cloneObject(slot.object), count, 0) as ItemObject;
    if (!placeObject(this.#dryContext(s), { inv: s.inv.map(cloneObject) }, to, preview)) return refusal(InventoryRefusal.DOES_NOT_FIT);
    const sourceGridNo = slot.gridNo;
    const sourceLevel = slot.level;
    const cursor = stash.take(index, count) as ItemObject;
    const item = cursor.item;
    const moved = cursor.count;
    const old = itemIn(s.inv, to);
    placeObject(this.#context(s), s, to, cursor);
    this.#env(merc).equipmentChanged(s, to, old, item);
    if (cursor.count > 0) stash.add(cursor, sourceGridNo, sourceLevel);
    this.#emitMove(merc, item, moved, 'ground', to);
    return { ok: true, data: { item: this.#name(item), count: moved } };
  }

  #returnToMerc(merc: RosterMerc, from: number, cursor: ItemObject): void {
    if (cursor.count === 0) return;
    const ctx = this.#context(merc.soldier);
    placeObject(ctx, merc.soldier, from, cursor);
    if (cursor.count > 0) autoPlaceObject(ctx, merc.soldier, cursor);
    if (cursor.count > 0) stashOf(this.#campaign, merc.sector).add(cursor, merc.soldier.gridNo, merc.soldier.level);
  }

  #emitMove(merc: RosterMerc, item: number, count: number, from: number | 'ground', to: number | 'ground'): void {
    this.#events.push({ type: 'itemMoved', soldier: merc.id, item: this.#name(item), count, from, to, tick: this.#campaign.tick });
  }

  #name(item: number): string {
    return contentOf(this.#campaign).items.byIndex.get(item)?.name ?? String(item);
  }

  #querySector(cmd: InventoryCommand): Sector | null {
    if (typeof cmd.sector === 'string') {
      try {
        return parseSectorString(cmd.sector, typeof cmd.z === 'number' ? cmd.z : 0);
      } catch {
        return null;
      }
    }
    const merc = this.#merc(cmd.soldier);
    if (merc) return merc.sector;
    return this.#campaign.state.worldSector ?? this.#campaign.battle?.roster.all()[0]?.sector ?? null;
  }

  #query(cmd: InventoryCommand): CommandResult {
    const sector = this.#querySector(cmd);
    if (!sector) return mapRefusal(MapInventoryRefusal.BAD_SECTOR);
    const campaign = this.#campaign;
    const onMap = campaign.state.flow === 'strategic';
    const stash = stashOf(campaign, sector);
    const items = contentOf(campaign).items;
    const entries: StashEntryView[] = stash.slots().map((slot, index) => ({
      index,
      item: items.byIndex.get(slot.object.item)?.name ?? String(slot.object.item),
      count: slot.object.count,
      status: slot.object.status.slice(0, Math.max(1, slot.object.count)),
      ...(slot.object.money > 0 ? { money: slot.object.money } : {}),
      reachable: (slot.flags & WorldItemFlags.REACHABLE) !== 0,
      gridNo: slot.gridNo,
      level: slot.level,
    }));
    const mercs = (campaign.battle?.roster.all() ?? [])
      .filter((m) => sameSector(m.sector, sector) && !m.isVehicle)
      .map((m) => ({
        id: m.id,
        name: m.soldier.name,
        accessible: accessible(m),
        betweenSectors: m.betweenSectors,
        inventory: inventoryView(items, m.soldier.inv) as InventoryItemView[],
      }));
    const battle = battleIn(campaign, sector);
    const usable = onMap && !battle;
    const why = !onMap ? MapInventoryRefusal.TACTICAL_ONLY : battle ? MapInventoryRefusal.BATTLE : null;
    return {
      ok: true,
      data: { sector: sectorShortString(sector), z: sector.z, usable, ...(why ? { refusal: why } : {}), stash: entries, mercs },
    };
  }
}
