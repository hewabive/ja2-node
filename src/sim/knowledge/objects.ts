import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { emptyObject, type ItemObject, NO_PROFILE, ObjectFlags } from '../items/object.ts';
import { emptyInventory, type Inventory } from '../tactical/inventory.ts';
import type { InventoryItemView } from '../tactical/inventory-view.ts';
import { Visibility, type WorldItem } from '../tactical/world-items.ts';
import { type GuardOptions, guardFields } from './guard.ts';
import type { KnowledgeItem, KnowledgeItemAttachment } from './view.ts';

const JAMMED_AMMO_STATUS = -100;
const LOADED_AMMO_STATUS = 100;
const OWN_OBJECT_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'item',
  'count',
  'status',
  'gunAmmoType',
  'gunShotsLeft',
  'gunAmmoItem',
  'money',
  'attachments',
  'imprintId',
  'keyId',
  'gunAmmoStatus',
  'flags',
  'trap',
]);
const GROUND_OBJECT_FIELDS: ReadonlySet<PropertyKey> = new Set(['item', 'count', 'status', 'money', 'attachments']);
const WORLD_ITEM_FIELDS: ReadonlySet<PropertyKey> = new Set(['gridNo', 'level', 'object', 'visible', 'zHeight']);

function itemIndexOf(items: ItemTable, name: string): number {
  return items.byName.get(name)?.index ?? NOTHING;
}

function fillAttachments(items: ItemTable, o: ItemObject, attachments: readonly KnowledgeItemAttachment[] | undefined): void {
  (attachments ?? []).forEach((a, k) => {
    const slot = o.attachments[k];
    if (!slot) return;
    slot.item = itemIndexOf(items, a.item);
    slot.status = a.status;
  });
}

function imprintOf(items: ItemTable, v: InventoryItemView): number {
  if (v.imprint !== undefined) return v.imprint;
  return items.byIndex.get(v.index)?.itemClass === ItemClass.GUN ? NO_PROFILE : 0;
}

export function objectFromInventoryView(items: ItemTable, v: InventoryItemView, label: string, guard: GuardOptions): ItemObject {
  const o = emptyObject();
  o.item = v.index;
  o.count = v.count;
  o.status = [...v.status];
  o.money = v.money ?? 0;
  o.keyId = v.keyId ?? 0;
  o.imprintId = imprintOf(items, v);
  if (v.ammo) {
    o.gunAmmoItem = itemIndexOf(items, v.ammo.item);
    o.gunShotsLeft = v.ammo.shots;
    o.gunAmmoType = items.byIndex.get(o.gunAmmoItem)?.magazine?.ammoType ?? 0;
  }
  o.gunAmmoStatus = v.jammed ? JAMMED_AMMO_STATUS : LOADED_AMMO_STATUS;
  o.flags = (items.byIndex.get(v.index)?.flags ?? 0) & ItemFlags.DEFAULT_UNDROPPABLE ? ObjectFlags.UNDROPPABLE : 0;
  fillAttachments(items, o, v.attachments);
  return guardFields(o, OWN_OBJECT_FIELDS, label, guard);
}

export function inventoryFromView(items: ItemTable, views: readonly InventoryItemView[], label: string, guard: GuardOptions): Inventory {
  const inv = emptyInventory();
  for (const v of views) inv[v.slot] = objectFromInventoryView(items, v, `${label}.inv[${v.slot}]`, guard);
  return inv;
}

export function worldItemFromView(items: ItemTable, v: KnowledgeItem, label: string, guard: GuardOptions): WorldItem {
  const o = emptyObject();
  o.item = itemIndexOf(items, v.item);
  o.count = v.count;
  o.status = [v.status];
  o.money = v.money ?? 0;
  fillAttachments(items, o, v.attachments);
  const item: WorldItem = {
    gridNo: v.gridNo,
    level: v.level,
    object: guardFields(o, GROUND_OBJECT_FIELDS, `${label}.object`, guard),
    flags: 0,
    zHeight: v.zHeight ?? 0,
    visible: Visibility.VISIBLE,
  };
  return guardFields(item, WORLD_ITEM_FIELDS, label, guard);
}
