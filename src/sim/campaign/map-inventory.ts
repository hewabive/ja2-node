// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc MapInvenPoolSlotsPrimary, BuildStashForSelectedSector,
// @src IsMapScreenWorldItemVisibleInMapInventory, BeginInventoryPoolPtr, GetObjFromInventoryStashSlot,
// @src RemoveObjectFromStashSlot, PlaceObjectInInventoryStash, CanPlayerUseSectorInventory, SaveSeenAndUnseenItems,
// @src CreateDestroyMapInventoryPoolButtons (the reachability of the loaded sector's items); MapScreen.cc
// @src MAPInvClickCallbackPrimary, MAPBeginItemPointer, MapCharacterHasAccessibleInventory, MAPInvClickCamoCallback (no
// @src items applied on the map screen), TrashCanBtnCallback and TrashItemMessageBoxCallBack (the trash can destroys the
// @src cursor item); Map_Screen_Interface.cc MapscreenCanPassItemToChar (item-passing.ts); Tactical/Interface_Items.cc
// @src RemoveMoney (on the map screen a money split goes into the map cursor, SetMapCursorItem, to be placed into a
// @src pocket); Tactical/Items.cc ReloadGun (the line and the sound for a merc off the loaded map, 2026-11-14);
// @src MapInvenPoolSlotsPrimary's SetMapCursorItem (what a merc's item swaps out of a pool slot or leaves over stays in
// @src the cursor: parked with him as moveItem parks its leftover, 2026-11-14); MapScreen.cc ChangeSelectedMapSector
// @src and Map_Screen_Interface_Map.cc IsTheCursorAllowedToHighLightThisSector (the inventory opens on the selected
// @src sector, never on the edge of the world, 2026-11-14); MapScreen.cc HandleModShift (SHIFT+S
// @src StackAndSortMapInventoryPool and SHIFT+R RefillMercItemsFromMapInventoryPool over the pool's order, their checks in
// @src their order, stash-repack.ts, 2026-11-15); MAPInvClickCallbackPrimary's PlaceObject and
// @src HandleTacticalEffectsOfEquipmentChange for a merc off the loaded map too (Tactical/Items.cc CollectKey,
// @src UpdateRobotControllerGivenController, EnsureConsistentWeaponMode; Interface_Panels.cc the launcher reset,
// @src 2026-11-15), and its hand part by bInSector, for a helicopter passenger over the loaded sector too (2026-11-15);
// @src Tactical/Points.cc EnoughPoints and DeductPoints (INCOMBAT for any merc on any screen), Tactical/Items.cc ReloadGun
// @src (the old magazine of a merc off the loaded map dropped into his own sector), MapScreen.cc
// @src MAPInternalInitItemDescriptionBox and Interface_Items.cc
// @src DeleteItemDescriptionBox (the box session, its AP_RELOAD_GUN charged as it closes or as the map screen ends,
// @src EndMapScreen) (2026-11-16); MAPInvClickCallbackPrimary's PlaceObject of a pool item into a head slot, its
// @src STR_CANT_USE_TWO_ITEMS for a face item that does not go with the other one (Items.cc:1898-1915, 2026-11-19).

import { ItemClass, NOTHING } from '../../content/items/items.ts';
import { parseSectorString, type Sector, sameSector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { cloneObject, type ItemObject } from '../items/object.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { isTheCursorAllowedToHighLightThisSector } from '../strategic/forces/routes.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import { autoReload } from '../tactical/combat/reload.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { collectKey, collectKeyFound, type KeyFinding, sectorByte } from '../tactical/doors/keys.ts';
import { handleTacticalEffectsOfEquipmentChange, resetAttachedModeWithoutLauncher } from '../tactical/hand-item.ts';
import { type InventoryContext, InvSlot, itemIn, placeObject } from '../tactical/inventory.ts';
import {
  attachmentPosition,
  attachThroughTheBox,
  detachThroughTheBox,
  type InventoryCommand,
  InventoryRefusal,
  moneyAmount,
  optionalSlot,
  outcomeResult,
  parseCombineCursor,
  parseCount,
  parseKeySpot,
  parseSlot,
  refusal,
} from '../tactical/inventory-commands.ts';
import {
  type Count,
  complainAboutFaceItem,
  dryInventoryContext,
  type LeftoverSpot,
  moveItem,
  nailsRefuses,
  type PanelEnv,
  type PanelEvent,
  parkLeftover,
  reloadWeapon,
  splitMoney,
  takeObjects,
  unloadGun,
} from '../tactical/inventory-panel.ts';
import { type InventoryItemView, inventoryView, slotView } from '../tactical/inventory-view.ts';
import { type ItemDescriptionBox, itemDescriptionBox } from '../tactical/item-description-box.ts';
import { type RingSource, returnKeysToRing, sourceObject, takeSourceObject } from '../tactical/item-source.ts';
import { type KeyRingWorld, moveKey } from '../tactical/key-ring-panel.ts';
import { type BreathRules, deductPoints } from '../tactical/points.ts';
import { refuse } from '../tactical/refusal.ts';
import { inSector, isCreatureOrBloodcat, OKLIFE, type Soldier } from '../tactical/soldier.ts';
import { afterPlacement, type PlacementEffects, soldierInventoryContext } from '../tactical/soldier-inventory.ts';
import { combineStacks } from '../tactical/stack-cleanup.ts';
import type { TacticalState } from '../tactical/state.ts';
import { WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { passBetweenHoldersRefused } from './item-passing.ts';
import { campaignCombatContext, voicedOnTheMapScreen } from './off-map-combat.ts';
import type { RosterMerc } from './roster.ts';
import { emptySlotShare, poolList, poolOrder, type Stash, type StashEntry, stashOf, takesWithoutSwap } from './stash.ts';
import { refillablePoints, refillMercItems, refillSources, stackedAndSorted, standsInStashSector } from './stash-repack.ts';

export const MAP_INVENTORY_COMMANDS: ReadonlySet<string> = new Set([
  'moveItem',
  'attach',
  'detach',
  'unload',
  'reload',
  'swapHands',
  'discardItem',
  'applyItem',
  'bandage',
  'splitMoney',
  'combineStack',
  'moveKey',
  'openItemDescription',
  'closeItemDescription',
]);

export const MapInventoryRefusal = {
  NO_SUCH_MERC: 'noSuchMerc',
  INACCESSIBLE: 'inaccessible',
  OTHER_SECTOR: 'otherSector',
  HOSTILE_SECTOR: 'hostileSector',
  BATTLE: 'battleInSector',
  NOT_IN_SECTOR: 'notInSector',
  BAD_STASH_INDEX: 'badStashIndex',
  BAD_STASH_ORDER: 'badStashOrder',
  UNREACHABLE: 'unreachable',
  TACTICAL_ONLY: 'tacticalOnly',
  BAD_SECTOR: 'badSector',
  EDGE_OF_WORLD: 'edgeOfWorld',
  NO_MERC_IN_SECTOR: 'noMercInSector',
  NOT_REFILLABLE: 'notRefillable',
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
  badStashOrder: 'order must list stash indices, each once',
  unreachable: 'that item lies out of reach',
  tacticalOnly: 'this is done in tactical only',
  badSector: 'sector must be a sector such as A9',
  edgeOfWorld: 'the map cannot select that sector, the edge of the world, so its inventory never opens',
  noMercInSector: 'none of our mercs stands in that sector (alive, no vehicle, not captured, in transit or on the road)',
  notRefillable: 'only magazines, kits and medical kits are refilled from the stash',
};

const NO_SLOT = -1;
const DISCARD_ITEM = 'discardItem';
const ARRANGE_STASH = 'arrangeStash';
const STACK_AND_SORT = 'stackAndSortStash';
const POOL_COMMANDS: ReadonlySet<string> = new Set([ARRANGE_STASH, STACK_AND_SORT, 'refillFromStash']);
const GROUND = 'ground';

function ringPosition(value: unknown): number | null {
  const spot = typeof value === 'object' && value !== null ? parseKeySpot(value) : null;
  return spot && 'ring' in spot ? spot.ring : null;
}

function contentOf(campaign: CampaignSim): TacticalContent {
  const content = campaign.battle?.content;
  if (!content) throw new Error('the map inventory needs the campaign roster');
  return content;
}

const mapRefusal = (code: MapInventoryRefusal): CommandResult => refuse(code, `${code}: ${MAP_REFUSAL_TEXT[code]}`);

export interface StashEntryView {
  readonly index: number;
  readonly item: string;
  readonly count: number;
  readonly status: readonly number[];
  readonly money?: number;
  readonly ammo?: InventoryItemView['ammo'];
  readonly attachments?: InventoryItemView['attachments'];
  readonly jammed?: true;
  readonly imprint?: number;
  readonly mission?: number;
  readonly reachable: boolean;
  readonly gridNo: number;
  readonly level: number;
}

function stashIndexOf(at: number | undefined): { stashIndex?: number } {
  return at === undefined ? {} : { stashIndex: at };
}

function leftoverOf(at: number | undefined): { leftover?: number } {
  return at === undefined ? {} : { leftover: at };
}

function spotOf(spot: LeftoverSpot | null): { leftover?: LeftoverSpot } {
  return spot ? { leftover: spot } : {};
}

function poolOrderOf(value: unknown): number[] | null {
  return value === undefined ? [] : stashOrder(value);
}

function stashOrder(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'number' && Number.isInteger(v))) return null;
  return new Set(value).size === value.length ? (value as number[]) : null;
}

function isLoaded(campaign: CampaignSim, sector: Sector): boolean {
  const world = campaign.state.worldSector;
  return campaign.tactical !== null && world !== null && sameSector(world, sector);
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
  return passBetweenHoldersRefused(from, to) ? MapInventoryRefusal.OTHER_SECTOR : null;
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

  #placedIn(s: Soldier): TacticalState | null {
    const t = this.#inSectorOf(s);
    return t && s.placed ? t : null;
  }

  #inSectorOf(s: Soldier): TacticalState | null {
    const t = this.#campaign.tactical?.state;
    return t && inSector(s) && t.soldiers[s.id] === s ? t : null;
  }

  #context(s: Soldier): InventoryContext {
    const t = this.#placedIn(s);
    if (t) return soldierInventoryContext(t, s);
    return {
      ...this.#dryContext(s),
      spendActionPoints: (ap) => deductPoints(this.#breathRules(), s, ap, 0),
      dropAtFeet: (o) => this.#dropIntoHisSectorStash(s, o),
      collectKey: (o) => this.#collectKey(s, o),
      placed: (item) => afterPlacement(contentOf(this.#campaign).items, s, item, this.#offMapPlacementEffects()),
      reloaded: (gun) => {
        this.#events.push({ type: 'reloaded', soldier: s.id, item: gun, mapScreen: true, tick: this.#campaign.tick });
      },
    };
  }

  #dropIntoHisSectorStash(s: Soldier, o: ItemObject): void {
    const sector = this.#campaign.battle?.roster.get(s.id)?.sector;
    if (sector) stashOf(this.#campaign, sector).add(o, s.gridNo, s.level);
  }

  #offMapPlacementEffects(): PlacementEffects {
    const roster = this.#campaign.battle?.roster;
    return { robotRemotePlaced: (s) => roster?.updateRobotControllerGivenController(s.id) };
  }

  #dryContext(s: Soldier): InventoryContext {
    return dryInventoryContext(contentOf(this.#campaign).items, this.#inCombat(), s);
  }

  #inCombat(): boolean {
    return this.#campaign.tactical?.state.inCombat === true;
  }

  #breathRules(): BreathRules {
    return { inCombat: this.#inCombat(), content: contentOf(this.#campaign) };
  }

  #itemDescriptionBox(): ItemDescriptionBox {
    const roster = this.#campaign.battle?.roster;
    return itemDescriptionBox(this.#campaign.state.mapScreen, { ...this.#breathRules(), soldier: (id) => roster?.get(id)?.soldier });
  }

  closeItemDescriptionOffTheMapScreen(): void {
    const s = this.#campaign.state;
    if (s.flow !== 'strategic' && s.mapScreen.itemDescription) this.#itemDescriptionBox().close();
  }

  #env(owner: RosterMerc): PanelEnv {
    const campaign = this.#campaign;
    const combat = campaignCombatContext(() => campaign, campaign.state, contentOf(campaign))();
    return {
      items: contentOf(campaign).items,
      combat,
      inCombat: this.#inCombat(),
      mapScreen: true,
      context: (s) => this.#context(s),
      equipmentChanged: (s, slot, oldItem, newItem) => {
        const t = this.#inSectorOf(s);
        if (t) handleTacticalEffectsOfEquipmentChange(t, s, slot, oldItem, newItem);
        else resetAttachedModeWithoutLauncher(contentOf(campaign).items, s);
      },
      leftover: (s, o) => stashOf(campaign, owner.sector).add(o, s.gridNo, s.level),
      emit: (event: PanelEvent) => {
        this.#events.push(voicedOnTheMapScreen(campaign, { ...event, tick: campaign.tick } as SimEvent));
      },
    };
  }

  dispatch(cmd: InventoryCommand): CommandResult | null {
    if (cmd.type === 'inventory') return this.#query(cmd);
    if (cmd.type === DISCARD_ITEM && this.#campaign.state.flow !== 'strategic')
      return refuse('mapScreenOnly', 'the trash can is on the map screen only');
    if (POOL_COMMANDS.has(cmd.type))
      return this.#campaign.state.flow === 'strategic'
        ? this.#poolCommand(cmd)
        : refuse('mapScreenOnly', 'the sector inventory is on the map screen only');
    if (this.#campaign.state.flow !== 'strategic' || !MAP_INVENTORY_COMMANDS.has(cmd.type)) return null;
    if (cmd.type === 'closeItemDescription') return this.#closeItemDescription();
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
        return detachThroughTheBox(this.#itemDescriptionBox(), env, s, slot, position, to);
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
      case 'discardItem':
        return this.#discard(merc, cmd);
      case 'splitMoney':
        return this.#splitMoney(merc, cmd);
      case 'combineStack':
        return this.#combine(merc, cmd);
      case 'moveKey':
        return this.#moveKey(merc, cmd);
      case 'openItemDescription':
        return this.#openItemDescription(merc, cmd);
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
    const req = { attacher: merc.soldier, from, owner: owner.soldier, slot, index, count, permanent: cmd.permanent === true };
    return attachThroughTheBox(this.#itemDescriptionBox(), this.#env(merc), req);
  }

  #openItemDescription(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const slot = parseSlot(cmd.slot);
    if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
    const owner = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in owner)) return owner;
    if (itemIn(owner.soldier.inv, slot) === NOTHING) return refusal(InventoryRefusal.EMPTY_SLOT);
    this.#itemDescriptionBox().open(owner.soldier, slot, merc.soldier);
    return { ok: true, data: { soldier: owner.id, slot, payer: merc.id } };
  }

  #closeItemDescription(): CommandResult {
    if (!this.#campaign.state.mapScreen.itemDescription) return refuse('noItemDescription', 'no item description box is open');
    return { ok: true, data: { charged: this.#itemDescriptionBox().close() } };
  }

  #splitMoney(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const from = parseSlot(cmd.slot);
    const to = parseSlot(cmd.to);
    if (from === null || to === null) return refusal(InventoryRefusal.BAD_SLOT);
    const amount = moneyAmount(cmd.amount);
    if (amount === null) return refusal(InventoryRefusal.BAD_AMOUNT);
    const target = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in target)) return target;
    return outcomeResult(splitMoney(this.#env(merc), { mover: merc.soldier, from, amount, target: target.soldier, to }));
  }

  #combine(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const slot = parseSlot(cmd.slot);
    if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
    const owner = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in owner)) return owner;
    const cursor = parseCombineCursor(contentOf(this.#campaign), merc.soldier, cmd);
    if (typeof cursor === 'string') return refusal(cursor);
    return outcomeResult(combineStacks(this.#env(merc), { holder: merc.soldier, owner: owner.soldier, slot, cursor }));
  }

  #keyRingWorld(): KeyRingWorld {
    return {
      content: contentOf(this.#campaign),
      collectKey: (s, keys) => this.#collectKey(s, keys),
    };
  }

  #collectKey(s: Soldier, keys: ItemObject): void {
    const t = this.#placedIn(s);
    if (t) collectKey(t, s, keys);
    else collectKeyFound(this.#campaign.state.keyTable, s, keys, this.#keyFinding(s));
  }

  #keyFinding(s: Soldier): KeyFinding {
    const sector = this.#campaign.battle?.roster.get(s.id)?.sector;
    return { day: worldDay(this.#campaign.state.clock), sector: sector ? sectorByte(sector) : 0 };
  }

  #moveKey(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const from = parseKeySpot(cmd.from);
    const to = parseKeySpot(cmd.to);
    if (!from || !to) return refusal(InventoryRefusal.BAD_SPOT);
    const count = parseCount(cmd.count, 'all');
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    const index = 'slot' in from ? this.#stackIndex(merc.soldier.inv[from.slot], cmd.index) : 0;
    if (index === null) return refusal(InventoryRefusal.BAD_INDEX);
    const target = this.#target(merc, cmd.toSoldier);
    if (!('soldier' in target)) return target;
    const req = { mover: merc.soldier, from, count, index, target: target.soldier, to };
    const outcome = moveKey(this.#keyRingWorld(), this.#env(merc), req);
    return outcome.ok ? { ok: true, data: outcome.data } : refusal(outcome.refusal);
  }

  #stackIndex(o: ItemObject | undefined, value: unknown): number | null {
    const index = value ?? 0;
    return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < Math.max(1, o?.count ?? 0) ? index : null;
  }

  #move(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const count = parseCount(cmd.count, 'all');
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    if (cmd.from === GROUND) return cmd.to === GROUND ? this.#withinStash(merc, cmd, count) : this.#fromStash(merc, cmd, count);
    const ring = ringPosition(cmd.from);
    if (ring !== null && cmd.to === GROUND) return this.#keysToStash(merc, { ring, count }, cmd);
    const from = parseSlot(cmd.from);
    if (from === null) return refusal(InventoryRefusal.BAD_SLOT);
    if (cmd.to === GROUND) return this.#toStash(merc, from, cmd, count);
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

  #discardKeys(merc: RosterMerc, source: RingSource): CommandResult {
    const keys = takeSourceObject(contentOf(this.#campaign), merc.soldier, source);
    if (!keys) return refusal(InventoryRefusal.EMPTY_SLOT);
    const name = this.#name(keys.item);
    this.#events.push({ type: 'itemDiscarded', soldier: merc.id, item: name, count: keys.count, tick: this.#campaign.tick });
    return { ok: true, data: { item: name, count: keys.count } };
  }

  #keysToStash(merc: RosterMerc, source: RingSource, cmd: InventoryCommand): CommandResult {
    const sector = this.#openable(this.#stashSector(merc, cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const s = merc.soldier;
    if (!sourceObject(contentOf(this.#campaign), s, source)) return refusal(InventoryRefusal.EMPTY_SLOT);
    const stash = stashOf(this.#campaign, sector);
    const onto = this.#placementTarget(stash, cmd.stashIndex);
    if (typeof onto === 'string') return mapRefusal(onto);
    const keys = takeSourceObject(contentOf(this.#campaign), s, source) as ItemObject;
    const item = keys.item;
    const moved = keys.count;
    const at = onto ? this.#placeOnto(stash, onto, keys) : stash.add(keys, s.gridNo, s.level)[0];
    if (keys.item === item) returnKeysToRing(s, source, keys);
    const leftover = parkLeftover(this.#env(merc), s, NO_SLOT, keys);
    const name = this.#name(item);
    this.#events.push({
      type: 'keyMoved',
      soldier: merc.id,
      item: name,
      count: moved,
      from: { ring: source.ring },
      to: GROUND,
      tick: this.#campaign.tick,
    });
    return { ok: true, data: { item: name, count: moved, sector: sectorShortString(sector), ...stashIndexOf(at), ...spotOf(leftover) } };
  }

  #discard(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    if (cmd.slot === GROUND) return this.#discardFromStash(merc, cmd);
    const ring = ringPosition(cmd.slot);
    if (ring !== null) {
      const count = parseCount(cmd.count, 'all');
      return count === null ? refusal(InventoryRefusal.BAD_COUNT) : this.#discardKeys(merc, { ring, count });
    }
    const slot = parseSlot(cmd.slot);
    if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
    const count = parseCount(cmd.count, 'all');
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    const s = merc.soldier;
    const source = s.inv[slot] as ItemObject;
    if (source.item === NOTHING) return refusal(InventoryRefusal.EMPTY_SLOT);
    const index = typeof cmd.index === 'number' && Number.isInteger(cmd.index) ? cmd.index : 0;
    if (index < 0 || index >= Math.max(1, source.count)) return refusal(InventoryRefusal.BAD_INDEX);
    if (nailsRefuses(contentOf(this.#campaign).items, s, slot, NOTHING)) return refusal(InventoryRefusal.NAILS_VEST);
    const item = source.item;
    const discarded = takeObjects(contentOf(this.#campaign).items, source, count, index) as ItemObject;
    if (source.item === NOTHING) this.#env(merc).equipmentChanged(s, slot, item, NOTHING);
    return this.#discarded(merc, item, discarded.count);
  }

  #discardFromStash(merc: RosterMerc, cmd: InventoryCommand): CommandResult {
    const count = parseCount(cmd.count, 'all');
    if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
    const sector = this.#openable(this.#stashSector(merc, cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const stash = stashOf(this.#campaign, sector);
    const entry = stash.entry(cmd.item);
    if (!entry) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    if (!(entry.flags & WorldItemFlags.REACHABLE)) return mapRefusal(MapInventoryRefusal.UNREACHABLE);
    const item = entry.object.item;
    return this.#discarded(merc, item, stash.take(entry.index, count).count);
  }

  #discarded(merc: RosterMerc, item: number, count: number): CommandResult {
    const name = this.#name(item);
    this.#events.push({ type: 'itemDiscarded', soldier: merc.id, item: name, count, tick: this.#campaign.tick });
    return { ok: true, data: { item: name, count } };
  }

  #placementTarget(stash: Stash, value: unknown): StashEntry | null | MapInventoryRefusal {
    if (value === undefined) return null;
    const entry = stash.entry(value);
    if (!entry) return MapInventoryRefusal.BAD_STASH_INDEX;
    return entry.flags & WorldItemFlags.REACHABLE ? entry : MapInventoryRefusal.UNREACHABLE;
  }

  #placeOnto(stash: Stash, onto: StashEntry, cursor: ItemObject): number {
    stash.placeInto(onto.index, cursor);
    return onto.index;
  }

  #openable(sector: Sector | null): Sector | MapInventoryRefusal {
    if (!sector) return MapInventoryRefusal.BAD_SECTOR;
    return isTheCursorAllowedToHighLightThisSector(this.#campaign, sector) ? sector : MapInventoryRefusal.EDGE_OF_WORLD;
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
    const sector = this.#openable(this.#stashSector(merc, cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const s = merc.soldier;
    const source = s.inv[from] as ItemObject;
    if (source.item === NOTHING) return refusal(InventoryRefusal.EMPTY_SLOT);
    if (nailsRefuses(contentOf(this.#campaign).items, s, from, NOTHING)) return refusal(InventoryRefusal.NAILS_VEST);
    const stash = stashOf(this.#campaign, sector);
    const onto = this.#placementTarget(stash, cmd.stashIndex);
    if (typeof onto === 'string') return mapRefusal(onto);
    const item = source.item;
    const cursor = takeObjects(contentOf(this.#campaign).items, source, count, 0) as ItemObject;
    const moved = cursor.count;
    this.#env(merc).equipmentChanged(s, from, item, NOTHING);
    const at = onto ? this.#placeOnto(stash, onto, cursor) : stash.add(cursor, s.gridNo, s.level)[0];
    const leftover = parkLeftover(this.#env(merc), s, from, cursor);
    this.#emitMove(merc, item, moved, from, GROUND);
    const placed = { item: this.#name(item), count: moved, sector: sectorShortString(sector), ...stashIndexOf(at) };
    return { ok: true, data: { ...placed, ...spotOf(leftover) } };
  }

  #fromStash(merc: RosterMerc, cmd: InventoryCommand, count: Count): CommandResult {
    const sector = this.#openable(this.#stashSector(merc, cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const to = parseSlot(cmd.to);
    if (to === null) return refusal(InventoryRefusal.BAD_SLOT);
    const stash = stashOf(this.#campaign, sector);
    const entry = stash.entry(cmd.item);
    if (!entry) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    if (!(entry.flags & WorldItemFlags.REACHABLE)) return mapRefusal(MapInventoryRefusal.UNREACHABLE);
    const s = merc.soldier;
    if (nailsRefuses(contentOf(this.#campaign).items, s, to, entry.object.item)) return refusal(InventoryRefusal.NAILS_VEST);
    const preview = takeObjects(contentOf(this.#campaign).items, cloneObject(entry.object), count, 0) as ItemObject;
    if (!placeObject(this.#dryContext(s), { inv: s.inv.map(cloneObject) }, to, preview)) {
      complainAboutFaceItem(this.#env(merc), s, s, to, preview);
      return refusal(InventoryRefusal.DOES_NOT_FIT);
    }
    const cursor = stash.take(entry.index, count);
    const item = cursor.item;
    const moved = cursor.count;
    const old = itemIn(s.inv, to);
    placeObject(this.#context(s), s, to, cursor);
    this.#env(merc).equipmentChanged(s, to, old, item);
    const leftover = cursor.count > 0 ? this.#backIntoStash(stash, entry, cursor) : undefined;
    this.#emitMove(merc, item, moved, GROUND, to);
    return { ok: true, data: { item: this.#name(item), count: moved, ...leftoverOf(leftover) } };
  }

  #withinStash(merc: RosterMerc, cmd: InventoryCommand, count: Count): CommandResult {
    const sector = this.#openable(this.#stashSector(merc, cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const refused = stashRefusal(this.#campaign, merc, sector);
    if (refused) return mapRefusal(refused);
    const stash = stashOf(this.#campaign, sector);
    const from = stash.entry(cmd.item);
    if (!from) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    const onto = this.#placementTarget(stash, cmd.stashIndex);
    if (typeof onto === 'string') return mapRefusal(onto);
    if (!(from.flags & WorldItemFlags.REACHABLE)) return mapRefusal(MapInventoryRefusal.UNREACHABLE);
    const cursor = stash.take(from.index, count);
    const item = cursor.item;
    const moved = cursor.count;
    const target = onto ? stash.entry(onto.index) : null;
    const at = target
      ? this.#placeOnto(stash, target, cursor)
      : stash.add(emptySlotShare(this.#campaign, cursor), from.gridNo, merc.soldier.level)[0];
    const leftover = cursor.count > 0 ? this.#backIntoStash(stash, from, cursor) : undefined;
    this.#emitMove(merc, item, moved, GROUND, GROUND);
    return { ok: true, data: { item: this.#name(item), count: moved, ...stashIndexOf(at), ...leftoverOf(leftover) } };
  }

  #backIntoStash(stash: Stash, source: StashEntry, cursor: ItemObject): number | undefined {
    const slot = stash.entry(source.index);
    if (slot && takesWithoutSwap(this.#campaign, slot.object, cursor)) stash.placeInto(slot.index, cursor);
    if (cursor.count === 0) return source.index;
    return stash.add(cursor, source.gridNo, source.level)[0];
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

  #poolCommand(cmd: InventoryCommand): CommandResult {
    const sector = this.#openable(this.#querySector(cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const order = cmd.type === ARRANGE_STASH ? stashOrder(cmd.order) : poolOrderOf(cmd.order);
    if (!order) return mapRefusal(MapInventoryRefusal.BAD_STASH_ORDER);
    if (cmd.type === ARRANGE_STASH) return this.#arranged(sector, order);
    if (battleIn(this.#campaign, sector)) return mapRefusal(MapInventoryRefusal.BATTLE);
    return cmd.type === STACK_AND_SORT ? this.#stackAndSort(sector, order) : this.#refill(sector, order, cmd.item);
  }

  #arranged(sector: Sector, order: readonly number[]): CommandResult {
    const stash = stashOf(this.#campaign, sector);
    stash.writeBack(poolList(this.#campaign, stash.entries(), order));
    return { ok: true, data: { sector: sectorShortString(sector), entries: stash.entries().length } };
  }

  #roster(): readonly RosterMerc[] {
    return this.#campaign.battle?.roster.all() ?? [];
  }

  #stackAndSort(sector: Sector, order: readonly number[]): CommandResult {
    if (!this.#roster().some((m) => standsInStashSector(m, sector))) return mapRefusal(MapInventoryRefusal.NO_MERC_IN_SECTOR);
    const stash = stashOf(this.#campaign, sector);
    const pool = poolList(this.#campaign, stash.entries(), order);
    stash.writeBack(stackedAndSorted(this.#campaign, contentOf(this.#campaign).items, pool));
    return { ok: true, data: { sector: sectorShortString(sector), entries: stash.entries().length } };
  }

  #refill(sector: Sector, order: readonly number[], item: unknown): CommandResult {
    const stash = stashOf(this.#campaign, sector);
    const pointed = stash.entry(item);
    if (!pointed) return mapRefusal(MapInventoryRefusal.BAD_STASH_INDEX);
    if (!(pointed.flags & WorldItemFlags.REACHABLE)) return mapRefusal(MapInventoryRefusal.UNREACHABLE);
    const kind = pointed.object.item;
    const max = refillablePoints(contentOf(this.#campaign).items, kind);
    if (max === 0) return mapRefusal(MapInventoryRefusal.NOT_REFILLABLE);
    const sources = refillSources(poolList(this.#campaign, stash.entries(), order), pointed);
    const objects = sources.map((entry) => cloneObject(entry.object));
    const outcome = refillMercItems(this.#roster(), sector, kind, max, objects);
    for (const k of outcome.drawn) stash.update((sources[k] as StashEntry).index, objects[k] as ItemObject);
    return { ok: true, data: { sector: sectorShortString(sector), item: this.#name(kind), points: outcome.points } };
  }

  #query(cmd: InventoryCommand): CommandResult {
    const sector = this.#openable(this.#querySector(cmd));
    if (typeof sector === 'string') return mapRefusal(sector);
    const campaign = this.#campaign;
    const onMap = campaign.state.flow === 'strategic';
    const stash = stashOf(campaign, sector);
    const items = contentOf(campaign).items;
    const entries: StashEntryView[] = poolOrder(campaign, stash.entries()).map((entry) => {
      const view = slotView(items, NO_SLOT, entry.object);
      return {
        index: entry.index,
        item: items.byIndex.get(entry.object.item)?.name ?? String(entry.object.item),
        count: entry.object.count,
        status: entry.object.status.slice(0, Math.max(1, entry.object.count)),
        ...(items.byIndex.get(entry.object.item)?.itemClass === ItemClass.MONEY ? { money: entry.object.money } : {}),
        ...(view.ammo ? { ammo: view.ammo } : {}),
        ...(view.attachments ? { attachments: view.attachments } : {}),
        ...(view.jammed ? { jammed: view.jammed } : {}),
        ...(view.imprint !== undefined ? { imprint: view.imprint } : {}),
        ...(view.mission !== undefined ? { mission: view.mission } : {}),
        reachable: (entry.flags & WorldItemFlags.REACHABLE) !== 0,
        gridNo: entry.gridNo,
        level: entry.level,
      };
    });
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
