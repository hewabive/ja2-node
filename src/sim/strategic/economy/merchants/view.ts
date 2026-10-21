// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/ShopKeeper_Interface.cc DisplayInvSlot (unit price), BuildDoneWhenTimeString (ETA);
// @src Tactical/Interface_Dialogue.cc (dealer type label); Arms_Dealer_Init.cc MakeObjectOutOfDealerItems (guns sold
// @src empty, keeping their ammo type); ShopKeeper_Interface.cc RepairIsDone ("REPAIRED" in the player's offer area).
// @src See docs/23 §13.4.

import { NOTHING } from '../../../../content/items/items.ts';
import { DealerType } from '../../../../content/strategic/merchant-content.ts';
import { NO_PROFILE } from '../../../items/object.ts';
import type { DealerBox } from './boxes.ts';
import { dealerDef, type MerchantContext } from './context.ts';
import { calcShopKeeperItemPrice } from './pricing.ts';
import { MINUTES_IN_DAY, MINUTES_IN_HOUR, roundUpToRepairInterval } from './repair.ts';

export type ShopKind = 'buySell' | 'buy' | 'sell' | 'repair';

export interface ShopEta {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface ShopBoxView {
  readonly key: { readonly item: number; readonly element: number };
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly unitPrice?: number;
  readonly attachments: readonly { readonly item: string; readonly status: number }[];
  readonly imprinted: boolean;
  readonly owner?: number;
  readonly eta?: ShopEta | null;
  readonly ammo?: { readonly item: string; readonly shots: number };
}

export interface ShopRepairedView {
  readonly item: string;
  readonly status: number;
  readonly owner: number;
  readonly soldier: number | null;
}

export interface ShopView {
  readonly dealer: number;
  readonly name: string;
  readonly kind: ShopKind;
  readonly soldier: number;
  readonly pricing: { readonly soldier: number; readonly weaponSaleModifier: number };
  readonly balance: number;
  readonly canTrade: readonly number[];
  readonly boxes: readonly ShopBoxView[];
  readonly repaired: readonly ShopRepairedView[];
}

const KINDS: Readonly<Record<number, ShopKind>> = {
  [DealerType.BUYS_SELLS]: 'buySell',
  [DealerType.SELLS_ONLY]: 'buy',
  [DealerType.BUYS_ONLY]: 'sell',
  [DealerType.REPAIRS]: 'repair',
};

export function shopKind(type: number): ShopKind {
  return KINDS[type] ?? 'buySell';
}

export function repairEta(doneAt: number, now: number): ShopEta | null {
  if (doneAt <= now) return null;
  const rounded = roundUpToRepairInterval(doneAt);
  const day = Math.trunc(rounded / MINUTES_IN_DAY);
  const hour = Math.trunc((rounded - day * MINUTES_IN_DAY) / MINUTES_IN_HOUR);
  return { day, hour, minute: rounded - day * MINUTES_IN_DAY - hour * MINUTES_IN_HOUR };
}

export function shopBoxView(ctx: MerchantContext, dealer: number, box: DealerBox, weaponSaleModifier: number): ShopBoxView {
  const d = dealerDef(ctx, dealer);
  const name = (item: number) => ctx.items.byIndex.get(item)?.name ?? String(item);
  const o = box.object;
  const base = {
    key: { item: box.key.item, element: box.key.element },
    item: name(o.item),
    count: o.count,
    status: o.status[0] ?? 0,
    attachments: o.attachments.filter((a) => a.item !== NOTHING).map((a) => ({ item: name(a.item), status: a.status })),
    imprinted: o.imprintId !== NO_PROFILE,
    ...(ctx.items.byIndex.get(o.item)?.weapon && o.gunAmmoItem !== NOTHING
      ? { ammo: { item: name(o.gunAmmoItem), shots: o.gunShotsLeft } }
      : {}),
  };
  if (d.type === DealerType.REPAIRS)
    return { ...base, owner: box.owner, eta: repairEta(box.repairDoneTime ?? 0, ctx.world.worldMinutes()) };
  const unitPrice = calcShopKeeperItemPrice(
    ctx,
    { dealer, dealerSelling: true, unitOnly: true, modifier: d.sellingPrice, weaponSaleModifier },
    o,
  );
  return { ...base, unitPrice };
}
