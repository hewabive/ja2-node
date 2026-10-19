// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc EXCEPTIONAL_* and BAD_* thresholds, ITEM_PROS_AND_CONS, GenerateProsString,
// @src GenerateConsString, RenderItemDescriptionBox (the weight in kilograms or pounds, status, range, damage, APs, burst APs,
// @src the ROF bullets, the gun title, the ammo button); Items.cc Weight; Points.h DEFAULT_APS, DEFAULT_AIMSKILL;
// @src externalized/WeaponModels.cc the weapon type index of WeaponType[]; Utils/Text.h Message ids STR_RELIABLE..STR_NONE.
// @src See docs/28 §5.4.

import { ItemClass, type ItemDef, type ItemTable, WEAPON_CLASSES } from '../../content/items/items.ts';
import type { ItemObject } from '../items/object.ts';
import { baseAPsToShootOrStabWith, calcAPsToBurstWith } from './combat/ap.ts';
import { gunRange } from './combat/chance.ts';
import { objectGrams } from './inventory.ts';

export const DEFAULT_APS = 20;
export const DEFAULT_AIMSKILL = 80;

const EXCEPTIONAL_DAMAGE = 30;
const EXCEPTIONAL_WEIGHT_GRAMS = 2000;
const EXCEPTIONAL_RANGE = 300;
const EXCEPTIONAL_MAGAZINE = 30;
const EXCEPTIONAL_AP_COST = 7;
const EXCEPTIONAL_BURST_SIZE = 5;
const EXCEPTIONAL_RELIABILITY = 2;
const EXCEPTIONAL_REPAIR_EASE = 2;
const BAD_DAMAGE = 23;
const BAD_WEIGHT = 45;
const BAD_RANGE = 150;
const BAD_MAGAZINE = 10;
const BAD_AP_COST = 11;
const BAD_RELIABILITY = -2;
const BAD_REPAIR_EASE = -2;
const GRAMS_PER_100G = 100;
const GRAMS_PER_KILOGRAM = 1000;
const GRAMS_PER_POUND = 453.59237;
const RANGE_UNITS_PER_TILE = 10;

export const ProConMessage = {
  RELIABLE: 13,
  UNRELIABLE: 14,
  EASY_TO_REPAIR: 15,
  HARD_TO_REPAIR: 16,
  HIGH_DAMAGE: 17,
  LOW_DAMAGE: 18,
  QUICK_FIRING: 19,
  SLOW_FIRING: 20,
  LONG_RANGE: 21,
  SHORT_RANGE: 22,
  LIGHT: 23,
  HEAVY: 24,
  SMALL: 25,
  FAST_BURST: 26,
  NO_BURST: 27,
  LARGE_AMMO_CAPACITY: 28,
  SMALL_AMMO_CAPACITY: 29,
  NONE: 38,
} as const;

const WEAPON_TYPE_INDEX: Readonly<Record<string, number>> = {
  PISTOL: 1,
  M_PISTOL: 2,
  SMG: 3,
  RIFLE: 4,
  SN_RIFLE: 5,
  ASRIFLE: 6,
  LMG: 7,
  SHOTGUN: 8,
};

const NOT_GUN = 0;

export function weaponTypeIndex(def: ItemDef | undefined): number {
  if (def?.itemClass !== ItemClass.GUN) return NOT_GUN;
  return WEAPON_TYPE_INDEX[def.weapon?.type ?? ''] ?? NOT_GUN;
}

export function convertedWeight(grams: number, metric: boolean): number {
  return grams / (metric ? GRAMS_PER_KILOGRAM : GRAMS_PER_POUND);
}

export function hasProsAndCons(items: ItemTable, item: number): boolean {
  return items.byIndex.get(item)?.itemClass === ItemClass.GUN;
}

const isG11 = (items: ItemTable, item: number) => item === items.byName.get('G11')?.index;

function baseAttackAPs(items: ItemTable, o: ItemObject): number {
  return baseAPsToShootOrStabWith(items, DEFAULT_APS, DEFAULT_AIMSKILL, o);
}

function collect(entries: readonly (readonly [boolean, number])[]): number[] {
  const found = entries.filter(([on]) => on).map(([, message]) => message);
  return found.length > 0 ? found : [ProConMessage.NONE];
}

export function itemPros(items: ItemTable, o: ItemObject): number[] {
  const def = items.byIndex.get(o.item);
  const w = def?.weapon;
  if (!def || !w) return [ProConMessage.NONE];
  return collect([
    [def.weight * GRAMS_PER_100G <= EXCEPTIONAL_WEIGHT_GRAMS, ProConMessage.LIGHT],
    [def.perPocket >= 1, ProConMessage.SMALL],
    [gunRange(items, o) >= EXCEPTIONAL_RANGE, ProConMessage.LONG_RANGE],
    [w.impact >= EXCEPTIONAL_DAMAGE, ProConMessage.HIGH_DAMAGE],
    [baseAttackAPs(items, o) <= EXCEPTIONAL_AP_COST, ProConMessage.QUICK_FIRING],
    [w.shotsPerBurst >= EXCEPTIONAL_BURST_SIZE || isG11(items, o.item), ProConMessage.FAST_BURST],
    [w.magSize > EXCEPTIONAL_MAGAZINE, ProConMessage.LARGE_AMMO_CAPACITY],
    [def.reliability >= EXCEPTIONAL_RELIABILITY, ProConMessage.RELIABLE],
    [def.repairEase >= EXCEPTIONAL_REPAIR_EASE, ProConMessage.EASY_TO_REPAIR],
  ]);
}

export function itemCons(items: ItemTable, o: ItemObject): number[] {
  const def = items.byIndex.get(o.item);
  const w = def?.weapon;
  if (!def || !w) return [ProConMessage.NONE];
  const weight = def.weight + (def.itemClass === ItemClass.GUN ? (items.byIndex.get(o.gunAmmoItem)?.weight ?? 0) : 0);
  return collect([
    [weight >= BAD_WEIGHT, ProConMessage.HEAVY],
    [gunRange(items, o) <= BAD_RANGE, ProConMessage.SHORT_RANGE],
    [w.impact <= BAD_DAMAGE, ProConMessage.LOW_DAMAGE],
    [baseAttackAPs(items, o) >= BAD_AP_COST, ProConMessage.SLOW_FIRING],
    [w.shotsPerBurst === 0, ProConMessage.NO_BURST],
    [w.magSize < BAD_MAGAZINE, ProConMessage.SMALL_AMMO_CAPACITY],
    [def.reliability <= BAD_RELIABILITY, ProConMessage.UNRELIABLE],
    [def.repairEase <= BAD_REPAIR_EASE, ProConMessage.HARD_TO_REPAIR],
  ]);
}

export interface StatValue {
  readonly value: number;
  readonly exceptional: boolean;
}

export interface WeaponStats {
  readonly status: number;
  readonly weight: StatValue;
  readonly range?: StatValue;
  readonly damage?: StatValue;
  readonly ap: StatValue;
  readonly burstAp?: StatValue;
  readonly bullets?: { readonly single: number; readonly burst: number };
}

export function weaponStats(items: ItemTable, o: ItemObject, metric: boolean): WeaponStats | null {
  const def = items.byIndex.get(o.item);
  const w = def?.weapon;
  if (!def || !w || !(def.itemClass & WEAPON_CLASSES)) return null;
  const grams = objectGrams(items, o);
  const ap = baseAttackAPs(items, o);
  const ranged = (def.itemClass & (ItemClass.GUN | ItemClass.LAUNCHER)) !== 0;
  const range = gunRange(items, o);
  const damaging = def.itemClass !== ItemClass.LAUNCHER && def.name !== 'ROCKET_LAUNCHER';
  const gun = def.itemClass === ItemClass.GUN;
  return {
    status: o.status[0] ?? 0,
    weight: { value: convertedWeight(grams, metric), exceptional: grams <= EXCEPTIONAL_WEIGHT_GRAMS },
    ...(ranged ? { range: { value: Math.trunc(range / RANGE_UNITS_PER_TILE), exceptional: range >= EXCEPTIONAL_RANGE } } : {}),
    ...(damaging ? { damage: { value: w.impact, exceptional: w.impact >= EXCEPTIONAL_DAMAGE } } : {}),
    ap: { value: ap, exceptional: ap <= EXCEPTIONAL_AP_COST },
    ...(w.shotsPerBurst > 0
      ? {
          burstAp: {
            value: ap + calcAPsToBurstWith(items, DEFAULT_APS, o),
            exceptional: w.shotsPerBurst >= EXCEPTIONAL_BURST_SIZE || isG11(items, o.item),
          },
        }
      : {}),
    ...(gun ? { bullets: { single: 1, burst: w.shotsPerBurst } } : {}),
  };
}

export interface GunTitle {
  readonly calibre: number | null;
  readonly weaponType: number;
}

export function gunTitle(items: ItemTable, item: number): GunTitle | null {
  const def = items.byIndex.get(item);
  if (!hasProsAndCons(items, item) || !def?.weapon) return null;
  return { calibre: def.weapon.calibre === 0 ? null : def.weapon.calibre, weaponType: weaponTypeIndex(def) };
}

export interface AmmoButton {
  readonly shots: number;
  readonly magSize: number;
  readonly ammoType: number;
}

export function ammoButton(items: ItemTable, o: ItemObject): AmmoButton | null {
  const def = items.byIndex.get(o.item);
  if (def?.itemClass !== ItemClass.GUN || def.name === 'ROCKET_LAUNCHER' || !def.weapon) return null;
  return { shots: o.gunShotsLeft, magSize: def.weapon.magSize, ammoType: o.gunAmmoType };
}
