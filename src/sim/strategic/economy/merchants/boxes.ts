// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc DetermineArmsDealersSellingInventory, AddItemsToTempDealerInventory,
// @src StoreObjectsInNextFreeDealerInvSlot, RepairIsDone, RepairmanItemQsortCompare; ArmsDealerInvInit.cc
// @src ArmsDealerItemQsortCompare.

import { NOTHING } from '../../../../content/items/items.ts';
import { DealerFlag, hasDealerFlag } from '../../../../content/strategic/merchant-content.ts';
import { type ItemObject, MAX_ATTACHMENTS, MAX_OBJECTS_PER_SLOT, NO_PROFILE } from '../../../items/object.ts';
import { dealerDef, type MerchantContext } from './context.ts';
import { dealerItemIsSafeToStack, makeObjectOutOfDealerItems, NO_ELEMENT, removeSpecialItemAtElement } from './inventory.ts';
import { canDealerRepairItem, doesDealerDoRepairs } from './repair.ts';
import { defaultItemInfo, header, MAXITEMS, PERFECT_CONDITION, type SpecialItemInfo } from './state.ts';
import { compareItemsForSorting } from './supply.ts';

export interface BoxKey {
  readonly item: number;
  readonly element: number;
}

export interface DealerBox {
  readonly key: BoxKey;
  readonly object: ItemObject;
  readonly owner: number;
  readonly repairDoneTime: number | null;
}

export interface RepairedItem {
  readonly item: number;
  readonly element: number;
  readonly owner: number;
  readonly object: ItemObject;
}

export type CollectRepair = (repaired: RepairedItem) => boolean;

function boxObject(ctx: MerchantContext, item: number, info: SpecialItemInfo, howMany: number): ItemObject {
  const o = makeObjectOutOfDealerItems(ctx.items, item, info, Math.min(howMany, MAX_OBJECTS_PER_SLOT));
  if (howMany > MAX_OBJECTS_PER_SLOT) o.count = howMany;
  return o;
}

function addBoxes(
  ctx: MerchantContext,
  out: DealerBox[],
  key: BoxKey,
  info: SpecialItemInfo,
  howMany: number,
  owner: number,
  done: number | null,
): void {
  if (howMany === 1 || dealerItemIsSafeToStack(ctx.items, key.item)) {
    out.push({ key, object: boxObject(ctx, key.item, info, howMany), owner, repairDoneTime: done });
    return;
  }
  for (let k = 0; k < howMany; k++) out.push({ key, object: boxObject(ctx, key.item, info, 1), owner, repairDoneTime: done });
}

export function repairedObject(ctx: MerchantContext, dealer: number, item: number, info: SpecialItemInfo): ItemObject {
  const d = dealerDef(ctx, dealer);
  const o = makeObjectOutOfDealerItems(ctx.items, item, info, 1);
  if (canDealerRepairItem(ctx, d, o.item)) o.status[0] = PERFECT_CONDITION;
  for (let k = 0; k < MAX_ATTACHMENTS; k++) {
    const a = o.attachments[k];
    if (a && a.item !== NOTHING && canDealerRepairItem(ctx, d, a.item)) a.status = PERFECT_CONDITION;
  }
  if (hasDealerFlag(d, DealerFlag.REPAIRS_ELECTRONICS)) o.imprintId = NO_PROFILE;
  return o;
}

export function determineArmsDealersSellingInventory(ctx: MerchantContext, dealer: number, collect: CollectRepair): DealerBox[] {
  const boxes: DealerBox[] = [];
  const repairs = doesDealerDoRepairs(ctx, dealer);
  const now = ctx.world.worldMinutes();
  for (let item = 1; item < MAXITEMS; item++) {
    const h = header(ctx.state, dealer, item);
    if (h.total === 0) continue;
    if (h.perfect > 0) addBoxes(ctx, boxes, { item, element: NO_ELEMENT }, defaultItemInfo(), h.perfect, NO_PROFILE, null);
    for (let element = 0; element < h.specials.length; element++) {
      const s = h.specials[element];
      if (!s?.active) continue;
      const inRepair = s.info.condition < 0;
      if (inRepair && s.repairDoneTime <= now) {
        const repaired = { item, element, owner: s.owner, object: repairedObject(ctx, dealer, item, s.info) };
        if (collect(repaired)) {
          removeSpecialItemAtElement(ctx, dealer, item, element);
          continue;
        }
      }
      const owner = repairs ? s.owner : NO_PROFILE;
      addBoxes(ctx, boxes, { item, element }, s.info, 1, owner, inRepair ? s.repairDoneTime : null);
    }
  }
  if (repairs) return boxes.sort((a, b) => (a.repairDoneTime ?? 0) - (b.repairDoneTime ?? 0));
  return boxes.sort((a, b) =>
    compareItemsForSorting(ctx.items, ctx.content.tables, a.key.item, b.key.item, a.object.status[0] ?? 0, b.object.status[0] ?? 0),
  );
}
