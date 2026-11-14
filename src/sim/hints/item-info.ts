// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc RenderItemDescriptionBox (the weapon branch, the money branch, the amount of an
// @src ammo item or the status of any other, the weight), the gun title with the imprint, GenerateProsString,
// @src GenerateConsString, ItemDescAttachmentsCallbackSecondary (an attachment described as CreateItem of its item and
// @src status); src/game/Strategic/MapScreen.cc MAPInternalInitItemDescriptionBox (the object in the merc's slot).

import { ItemClass, type ItemTable, NOTHING, WEAPON_CLASSES } from '../../content/items/items.ts';
import { createItem, type ItemObject, MAX_ATTACHMENTS } from '../items/object.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { type Inventory, objectGrams } from '../tactical/inventory.ts';
import { parseSlot } from '../tactical/inventory-commands.ts';
import { itemImprint } from '../tactical/inventory-view.ts';
import {
  type AmmoButton,
  ammoButton,
  convertedWeight,
  type GunTitle,
  gunTitle,
  hasProsAndCons,
  itemCons,
  itemPros,
  type WeaponStats,
  weaponStats,
} from '../tactical/item-description.ts';
import { type HintRefusal, type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

const FULL_STATUS = 100;

export type ItemInfoKind = 'weapon' | 'money' | 'ammo' | 'other';

export interface ItemInfo {
  readonly item: number;
  readonly kind: ItemInfoKind;
  readonly count: number;
  readonly weight: number;
  readonly status?: number;
  readonly amount?: { readonly shots: number; readonly capacity: number };
  readonly money?: number;
  readonly weapon?: WeaponStats;
  readonly title?: GunTitle & { readonly imprint: number | null };
  readonly ammo?: AmmoButton;
  readonly pros?: readonly number[];
  readonly cons?: readonly number[];
}

export interface ItemInfoRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly slot?: unknown;
  readonly index?: unknown;
  readonly attachment?: unknown;
  readonly item?: unknown;
  readonly metric?: unknown;
}

function kindOf(cls: number): ItemInfoKind {
  if (cls & WEAPON_CLASSES) return 'weapon';
  if (cls === ItemClass.MONEY) return 'money';
  if (cls === ItemClass.AMMO) return 'ammo';
  return 'other';
}

function describe(table: ItemTable, o: ItemObject, index: number, metric: boolean): ItemInfo | null {
  const def = table.byIndex.get(o.item);
  if (!def || o.item === NOTHING) return null;
  const kind = kindOf(def.itemClass);
  const base = { item: o.item, kind, count: o.count, weight: convertedWeight(objectGrams(table, o), metric) };
  if (kind === 'money') return { ...base, money: o.money };
  if (kind !== 'weapon') {
    if (kind === 'ammo') return { ...base, amount: { shots: o.status[index] ?? 0, capacity: def.magazine?.capacity ?? 0 } };
    return { ...base, status: o.status[index] ?? 0 };
  }
  const stats = weaponStats(table, o, metric);
  const title = gunTitle(table, o.item);
  const ammo = ammoButton(table, o);
  return {
    ...base,
    status: o.status[0] ?? 0,
    ...(stats ? { weapon: stats } : {}),
    ...(title ? { title: { ...title, imprint: itemImprint(table, o) } } : {}),
    ...(ammo ? { ammo } : {}),
    ...(hasProsAndCons(table, o.item) ? { pros: itemPros(table, o), cons: itemCons(table, o) } : {}),
  };
}

function carriedInventory(world: KnowledgeWorld, id: unknown): Inventory | { readonly refusal: HintRefusal } {
  if (typeof id === 'number') {
    const inSector = world.tactical?.ownSoldier(id);
    if (inSector) return inSector.inv;
    const crew = world.strategic?.merc(id);
    if (crew) return crew.inv;
  }
  if (!world.tactical && !world.strategic) return { refusal: refuseHint('noSector', 'no sector is loaded') };
  return { refusal: refuseHint('noSuchSoldier', 'no such soldier of yours') };
}

function attachedObject(table: ItemTable, o: ItemObject, position: unknown): ItemObject | null {
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position >= MAX_ATTACHMENTS) return null;
  const attachment = o.attachments[position];
  return attachment && attachment.item !== NOTHING ? createItem(table, attachment.item, attachment.status) : null;
}

export function itemInfo(world: KnowledgeWorld, req: ItemInfoRequest): HintResult<ItemInfo> {
  const metric = req.metric === true;
  const items = world.rules.content?.items ?? world.rules.strategic?.items;
  if (!items) return refuseHint('noSector', 'no item content');
  if (req.item !== undefined) {
    const item = req.item;
    if (typeof item !== 'number' || !items.byIndex.has(item) || item === NOTHING)
      return refuseHint('badItem', 'item must be an item index');
    const info = describe(items, createItem(items, item, FULL_STATUS), 0, metric);
    return info ? hintData(info) : refuseHint('badItem', 'item must be an item index');
  }
  const inventory = carriedInventory(world, req.soldier);
  if ('refusal' in inventory) return inventory.refusal;
  const slot = parseSlot(req.slot);
  if (slot === null) return refuseHint('badSlot', 'slot must be 0..18 or a slot name such as "hand"');
  const o = inventory[slot] as ItemObject;
  const index = req.index ?? 0;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= Math.max(1, o.count))
    return refuseHint('badIndex', 'index must point to an object in the stack');
  if (req.attachment !== undefined) {
    const attached = attachedObject(items, o, req.attachment);
    if (!attached) return refuseHint('noAttachment', 'attachment must name an attached item 0..3');
    const info = describe(items, attached, 0, metric);
    return info ? hintData(info) : refuseHint('noAttachment', 'attachment must name an attached item 0..3');
  }
  const info = describe(items, o, index, metric);
  return info ? hintData(info) : refuseHint('emptySlot', 'that slot is empty');
}
