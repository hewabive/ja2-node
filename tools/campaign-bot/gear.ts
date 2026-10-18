import { ItemClass, type ItemDef } from '../../src/content/items/items.ts';
import type { InventoryItemView, SoldierView } from '../../src/protocol/view.ts';
import type { Player } from './player.ts';

export type HandState = 'armed' | 'acted' | 'unarmed';

const HAND = 5;

export function handItem(merc: SoldierView): InventoryItemView | undefined {
  return merc.inventory?.find((o) => o.slot === HAND);
}

export function isGun(def: ItemDef | undefined): def is ItemDef {
  return def !== undefined && def.itemClass === ItemClass.GUN && def.weapon !== null && def.weapon.calibre > 0;
}

export function handGun(p: Player, merc: SoldierView): ItemDef | undefined {
  const def = p.item(handItem(merc)?.item);
  return isGun(def) ? def : undefined;
}

export function magazineFits(gun: ItemDef, magazine: ItemDef | undefined): boolean {
  return magazine?.magazine !== null && magazine?.magazine !== undefined && magazine.magazine.calibre === gun.weapon?.calibre;
}

export function hasAmmoFor(p: Player, merc: SoldierView, gun: ItemDef): boolean {
  return (merc.inventory ?? []).some((o) => o.slot !== HAND && magazineFits(gun, p.item(o.item)) && o.status.some((rounds) => rounds > 0));
}

function loadedShots(o: InventoryItemView): number {
  return o.ammo?.shots ?? 0;
}

export function gunValue(gun: ItemDef): number {
  return gun.weapon?.deadliness ?? 0;
}

function usableGunSlot(p: Player, merc: SoldierView): InventoryItemView | undefined {
  let best: InventoryItemView | undefined;
  let bestValue = -1;
  for (const o of merc.inventory ?? []) {
    if (o.slot === HAND) continue;
    const def = p.item(o.item);
    if (!isGun(def)) continue;
    if (loadedShots(o) === 0 && !hasAmmoFor(p, merc, def)) continue;
    if (gunValue(def) > bestValue) {
      best = o;
      bestValue = gunValue(def);
    }
  }
  return best;
}

export async function readyHand(p: Player, merc: SoldierView, inCombat: boolean): Promise<HandState> {
  const hand = handItem(merc);
  const gun = handGun(p, merc);
  if (gun && hand && loadedShots(hand) > 0) {
    const better = usableGunSlot(p, merc);
    const betterDef = p.item(better?.item);
    if (!inCombat && better && betterDef && gunValue(betterDef) > gunValue(gun)) {
      const swapped = await p.act({ type: 'moveItem', soldier: merc.id, from: better.slot, to: 'hand' });
      if (swapped.ok) return 'acted';
    }
    return 'armed';
  }
  if (gun && hasAmmoFor(p, merc, gun)) {
    const reloaded = await p.act({ type: 'reload', soldier: merc.id });
    if (reloaded.ok) return 'acted';
  }
  const other = usableGunSlot(p, merc);
  if (other) {
    const swapped = await p.act({ type: 'moveItem', soldier: merc.id, from: other.slot, to: 'hand' });
    if (swapped.ok) return 'acted';
  }
  return 'unarmed';
}
