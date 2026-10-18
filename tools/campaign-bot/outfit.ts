import { ArmourClass, ItemClass, type ItemDef } from '../../src/content/items/items.ts';
import type { InventoryItemView } from '../../src/protocol/view.ts';
import { gunValue, isGun, magazineFits } from './gear.ts';
import type { Player } from './player.ts';

export interface StashItem {
  readonly index: number;
  readonly item: string;
  readonly count: number;
  readonly status: readonly number[];
  readonly reachable: boolean;
}

export interface MercInventory {
  readonly id: number;
  readonly name: string;
  readonly accessible: boolean;
  readonly betweenSectors: boolean;
  readonly inventory: readonly InventoryItemView[];
}

export interface SectorInventory {
  readonly sector: string;
  readonly usable: boolean;
  readonly stash: readonly StashItem[];
  readonly mercs: readonly MercInventory[];
}

const Slot = { HELMET: 0, VEST: 1, LEGS: 2, HAND: 5 } as const;
const SMALL_POCKETS = [11, 12, 13, 14, 15, 16, 17, 18] as const;
const BIG_POCKETS = [7, 8, 9, 10] as const;
const ARMOUR_SLOTS: readonly { readonly slot: number; readonly armourClass: number }[] = [
  { slot: Slot.VEST, armourClass: ArmourClass.VEST },
  { slot: Slot.HELMET, armourClass: ArmourClass.HELMET },
  { slot: Slot.LEGS, armourClass: ArmourClass.LEGGINGS },
];
const WANTED_MAGAZINES = 4;
const MAX_MOVES = 120;
const FIRST_AID_KIT = 'FIRSTAIDKIT';
const MEDICAL_KIT = 'MEDICKIT';
const MEDKIT_CLASS = ItemClass.MEDKIT;

export async function sectorInventory(p: Player, sector: string): Promise<SectorInventory | null> {
  const result = await p.act({ type: 'inventory', sector });
  if (!result.ok || !result.data) return null;
  return result.data as unknown as SectorInventory;
}

function slotItem(m: MercInventory, slot: number): InventoryItemView | undefined {
  return m.inventory.find((o) => o.slot === slot);
}

function handValue(p: Player, m: MercInventory): number {
  const def = p.item(slotItem(m, Slot.HAND)?.item);
  return isGun(def) ? gunValue(def) : -1;
}

function stashRounds(p: Player, stash: readonly StashItem[], gun: ItemDef): number {
  return stash
    .filter((s) => s.reachable && magazineFits(gun, p.item(s.item)))
    .reduce((sum, s) => sum + s.status.reduce((a, b) => a + b, 0), 0);
}

function armourProtection(def: ItemDef | undefined, armourClass: number): number {
  return def?.armour && def.armour.armourClass === armourClass ? def.armour.protection : -1;
}

function freePockets(m: MercInventory, pockets: readonly number[]): number[] {
  return pockets.filter((slot) => !slotItem(m, slot));
}

export class Quartermaster {
  readonly #p: Player;
  readonly #sector: string;
  readonly #medics: readonly number[];
  #moves = 0;
  #refused = new Set<string>();

  constructor(p: Player, sector: string, medics: readonly number[]) {
    this.#p = p;
    this.#sector = sector;
    this.#medics = medics;
  }

  async #inventory(): Promise<SectorInventory | null> {
    const inv = await sectorInventory(this.#p, this.#sector);
    return inv?.usable ? inv : null;
  }

  async #take(merc: MercInventory, stash: StashItem, to: number | 'hand'): Promise<boolean> {
    const key = `${merc.id}:${stash.item}:${to}`;
    if (this.#refused.has(key) || this.#moves >= MAX_MOVES) return false;
    this.#moves++;
    const moved = await this.#p.act({ type: 'moveItem', soldier: merc.id, from: 'ground', item: stash.index, to, sector: this.#sector });
    if (!moved.ok) this.#refused.add(key);
    return moved.ok;
  }

  async #takeIntoPocket(merc: MercInventory, stash: StashItem): Promise<boolean> {
    for (const slot of [...freePockets(merc, SMALL_POCKETS), ...freePockets(merc, BIG_POCKETS)])
      if (await this.#take(merc, stash, slot)) return true;
    return false;
  }

  async guns(): Promise<void> {
    for (let pass = 0; pass < MAX_MOVES; pass++) {
      const inv = await this.#inventory();
      if (!inv) return;
      const p = this.#p;
      const mercs = inv.mercs.filter((m) => m.accessible && !m.betweenSectors);
      const weakest = [...mercs].sort((a, b) => handValue(p, a) - handValue(p, b) || a.id - b.id)[0];
      if (!weakest) return;
      const offers = inv.stash
        .filter((s) => s.reachable && !this.#refused.has(`${weakest.id}:${s.item}:hand`))
        .map((s) => ({ s, def: p.item(s.item) }))
        .filter((o): o is { s: StashItem; def: ItemDef } => isGun(o.def) && stashRounds(p, inv.stash, o.def) > 0)
        .sort((a, b) => gunValue(b.def) - gunValue(a.def) || a.s.index - b.s.index);
      const offer = offers[0];
      if (!offer || gunValue(offer.def) <= handValue(p, weakest)) return;
      if (await this.#take(weakest, offer.s, 'hand')) p.log(`  ${weakest.name} takes a ${offer.s.item}`);
    }
  }

  async magazines(): Promise<void> {
    for (let pass = 0; pass < MAX_MOVES; pass++) {
      const inv = await this.#inventory();
      if (!inv) return;
      const p = this.#p;
      let moved = false;
      for (const merc of inv.mercs.filter((m) => m.accessible && !m.betweenSectors)) {
        const gun = p.item(slotItem(merc, Slot.HAND)?.item);
        if (!isGun(gun)) continue;
        const carried = merc.inventory
          .filter((o) => o.slot !== Slot.HAND && magazineFits(gun, p.item(o.item)))
          .reduce((n, o) => n + o.count, 0);
        if (carried >= WANTED_MAGAZINES) continue;
        const offer = inv.stash.find((s) => s.reachable && magazineFits(gun, p.item(s.item)) && s.status.some((r) => r > 0));
        if (offer && (await this.#takeIntoPocket(merc, offer))) {
          moved = true;
          break;
        }
      }
      if (!moved) return;
    }
  }

  async armour(): Promise<void> {
    for (const { slot, armourClass } of ARMOUR_SLOTS) {
      for (let pass = 0; pass < MAX_MOVES; pass++) {
        const inv = await this.#inventory();
        if (!inv) return;
        const p = this.#p;
        const mercs = inv.mercs.filter((m) => m.accessible && !m.betweenSectors);
        const worn = (m: MercInventory) => armourProtection(p.item(slotItem(m, slot)?.item), armourClass);
        const weakest = [...mercs].sort((a, b) => worn(a) - worn(b) || a.id - b.id)[0];
        if (!weakest) break;
        const offer = inv.stash
          .filter((s) => s.reachable && !this.#refused.has(`${weakest.id}:${s.item}:${slot}`))
          .sort(
            (a, b) => armourProtection(p.item(b.item), armourClass) - armourProtection(p.item(a.item), armourClass) || a.index - b.index,
          )[0];
        if (!offer || armourProtection(p.item(offer.item), armourClass) <= worn(weakest)) break;
        if (await this.#take(weakest, offer, slot)) p.log(`  ${weakest.name} wears a ${offer.item}`);
      }
    }
  }

  async medicine(): Promise<void> {
    for (let pass = 0; pass < MAX_MOVES; pass++) {
      const inv = await this.#inventory();
      if (!inv) return;
      const p = this.#p;
      const mercs = inv.mercs.filter((m) => m.accessible && !m.betweenSectors);
      const kits = (m: MercInventory, name: string) => m.inventory.filter((o) => o.item === name).length;
      const medicalKit = inv.stash.find((s) => s.reachable && s.item === MEDICAL_KIT);
      const medic = mercs.find((m) => this.#medics.includes(m.id) && kits(m, MEDICAL_KIT) === 0);
      if (medicalKit && medic && (await this.#takeIntoPocket(medic, medicalKit))) continue;
      const firstAid = inv.stash.find((s) => s.reachable && s.item === FIRST_AID_KIT);
      const without = mercs.find((m) => !m.inventory.some((o) => p.item(o.item)?.itemClass === MEDKIT_CLASS));
      if (firstAid && without && (await this.#takeIntoPocket(without, firstAid))) continue;
      return;
    }
  }

  async reloadAll(): Promise<void> {
    const inv = await this.#inventory();
    if (!inv) return;
    for (const merc of inv.mercs.filter((m) => m.accessible && !m.betweenSectors)) {
      const hand = slotItem(merc, Slot.HAND);
      const gun = this.#p.item(hand?.item);
      if (!isGun(gun) || (hand?.ammo?.shots ?? 0) > 0) continue;
      await this.#p.act({ type: 'reload', soldier: merc.id });
    }
  }

  async run(): Promise<void> {
    await this.guns();
    await this.reloadAll();
    await this.magazines();
    await this.armour();
    await this.medicine();
  }
}
