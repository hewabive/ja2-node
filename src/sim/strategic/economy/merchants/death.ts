// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc AddDeadArmsDealerItemsToWorld.

import { createMoney, type ItemObject } from '../../../items/object.ts';
import { InvSlot, itemSlotLimit } from '../../../tactical/inventory.ts';
import { dealerIdFromProfile, type MerchantContext } from './context.ts';
import { freeSpecialItemArray, makeObjectOutOfDealerItems, removeItemFromArmsDealerInventory } from './inventory.ts';
import { dealerState, defaultItemInfo, header } from './state.ts';

export type DropAtDealerTile = (o: ItemObject) => void;

export function addDeadArmsDealerItemsToWorld(ctx: MerchantContext, profile: number, drop: DropAtDealerTile): boolean {
  const dealer = dealerIdFromProfile(ctx, profile);
  if (dealer < 0) return false;
  const status = dealerState(ctx.state, dealer).status;
  status.outOfBusiness = true;
  for (const def of ctx.items.ordered) {
    const item = def.index;
    const h = header(ctx.state, dealer, item);
    if (h.total === 0) continue;
    if (h.perfect > 0) {
      const perStack = Math.max(1, itemSlotLimit(ctx.items, item, InvSlot.BIGPOCK1));
      const info = defaultItemInfo();
      for (let left = h.perfect; left > 0; ) {
        const now = Math.min(left, perStack);
        drop(makeObjectOutOfDealerItems(ctx.items, item, info, now));
        left -= now;
      }
      removeItemFromArmsDealerInventory(ctx, dealer, item, info, h.perfect);
    }
    for (const s of h.specials) {
      if (!s.active) continue;
      drop(makeObjectOutOfDealerItems(ctx.items, item, s.info, 1));
      removeItemFromArmsDealerInventory(ctx, dealer, item, s.info, 1);
    }
    if (h.specials.length > 0) freeSpecialItemArray(h);
  }
  if (status.cash > 0) {
    drop(createMoney(ctx.items, status.cash));
    status.cash = 0;
  }
  return true;
}
