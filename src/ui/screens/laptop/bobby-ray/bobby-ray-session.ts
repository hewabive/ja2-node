// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyRGuns.cc BobbyRayPurchases, PurchaseBobbyRayItem (a new line takes the first free entry, a line
// @src grows while the stock covers one more and it holds at most 200 + 1), CheckIfItemIsPurchased (new and used lines apart),
// @src GetNextPurchaseNumber (an entry is free when its slot and count are 0), UnPurchaseBobbyRayItem,
// @src CalculateTotalPurchasePrice, guiLastBobbyRayPage; src/game/Laptop/BobbyRMailOrder.cc EnterInitBobbyRayOrder (the cart,
// @src the speed and the city cleared on every laptop entry), BtnBobbyRClearOrderCallback, IsAnythingPurchasedFromBobbyRayPage,
// @src CalcPackageTotalWeight. See docs/28 §9.6.

import { DropDown } from '../../../widgets/drop-down.ts';
import { LaptopMode } from '../laptop-modes.ts';

export const MAX_PURCHASE_AMOUNT = 10;
export const BOBBY_RAY_MAX_AMOUNT_OF_ITEMS_TO_PURCHASE = 200;
export const BOBBYR_ORDER_NUM_SHIPPING_CITIES = 17;
export const BOBBYR_NUM_DISPLAYED_CITIES = 10;
export const NOT_PURCHASED = -1;
const FREE_SLOT = 0;

export interface BobbyRayMemory {
  lastPage: number;
}

export function bobbyRayMemory(): BobbyRayMemory {
  return { lastPage: LaptopMode.BOBBY_R };
}

export interface CartLine {
  readonly item: number;
  readonly slot: number;
  readonly used: boolean;
  readonly quality: number;
  count: number;
}

export interface CartStock {
  readonly item: number;
  readonly slot: number;
  readonly quantity: number;
  readonly quality: number;
}

export type PurchaseRefusal = 'tooManyLines' | 'noMoreInStock';

export interface OrderLine {
  readonly item: number;
  readonly used: boolean;
  readonly quantity: number;
}

function emptyLine(): CartLine {
  return { item: 0, slot: FREE_SLOT, used: false, quality: 0, count: 0 };
}

export class BobbyRayCart {
  readonly lines: CartLine[] = Array.from({ length: MAX_PURCHASE_AMOUNT }, emptyLine);
  speed = 0;
  readonly cities = new DropDown({
    entries: BOBBYR_ORDER_NUM_SHIPPING_CITIES,
    visible: BOBBYR_NUM_DISPLAYED_CITIES,
    selectOnHover: true,
  });

  find(slot: number, used: boolean): number {
    return this.lines.findIndex((l) => l.slot === slot && l.count !== 0 && l.used === used);
  }

  #nextFree(): number {
    return this.lines.findIndex((l) => l.slot === FREE_SLOT && l.count === 0);
  }

  purchase(stock: CartStock, used: boolean): PurchaseRefusal | null {
    const at = this.find(stock.slot, used);
    const line = this.lines[at];
    if (line && stock.quantity < line.count + 1) return 'noMoreInStock';
    if (line) {
      if (line.count <= BOBBY_RAY_MAX_AMOUNT_OF_ITEMS_TO_PURCHASE) line.count++;
      return null;
    }
    const free = this.#nextFree();
    if (free === NOT_PURCHASED) return 'tooManyLines';
    this.lines[free] = { item: stock.item, slot: stock.slot, used, quality: used ? stock.quality : 100, count: 1 };
    return null;
  }

  unpurchase(slot: number, used: boolean): void {
    const line = this.lines[this.find(slot, used)];
    if (!line) return;
    if (line.count > 1) line.count--;
    else Object.assign(line, emptyLine());
  }

  count(slot: number, used: boolean): number | null {
    return this.lines[this.find(slot, used)]?.count ?? null;
  }

  get purchased(): CartLine[] {
    return this.lines.filter((l) => l.count !== 0);
  }

  get empty(): boolean {
    return this.purchased.length === 0;
  }

  orderLines(): OrderLine[] {
    return this.purchased.map((l) => ({ item: l.item, used: l.used, quantity: l.count }));
  }

  clear(): void {
    for (let i = 0; i < this.lines.length; i++) this.lines[i] = emptyLine();
    this.speed = 0;
    this.cities.reset();
  }

  removeOrdered(): void {
    for (let i = 0; i < this.lines.length; i++) this.lines[i] = emptyLine();
    this.speed = 0;
  }
}
