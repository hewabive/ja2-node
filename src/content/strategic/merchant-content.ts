// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/DealerModel.cc (dealers.json), DealerInventory.cc (dealer-inventory-*.json),
// @src DefaultContentManager.cc loadAllDealersAndInventory; src/externalized/mercs/MercProfileInfo.cc (weaponSaleModifier);
// @src src/game/Tactical/Arms_Dealer.h. Tables in data/tables from tools/transcribe/merchant-tables.ts. See docs/23 §1, §15.

import { FormatError } from '../binary/errors.ts';
import { ItemClass, type ItemTable, WeaponClass } from '../items/items.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { asArray, asInt, asObject, asString, type JsonObject } from './json-fields.ts';
import { parseJsoncBytes } from './jsonc.ts';

export const MERCHANT_CONTENT_PATHS = {
  dealers: 'externalized/dealers.json',
  profileInfo: 'externalized/mercs-profile-info.json',
  tables: 'tables/merchant-tables.json',
} as const;

export const DEALER_INVENTORY_DIR = 'externalized';
export const NUM_ARMS_DEALERS = 19;
export const DEFAULT_WEAPON_SALE_MODIFIER = 100;

export const DealerType = { BUYS_SELLS: 0, SELLS_ONLY: 1, BUYS_ONLY: 2, REPAIRS: 3 } as const;

export const DealerFlag = {
  ONLY_USED_ITEMS: 0x001,
  SOME_USED_ITEMS: 0x002,
  GIVES_CHANGE: 0x004,
  ACCEPTS_GIFTS: 0x008,
  HAS_NO_INVENTORY: 0x010,
  DELAYS_REPAIR: 0x020,
  REPAIRS_ELECTRONICS: 0x040,
  SELLS_ALCOHOL: 0x080,
  SELLS_FUEL: 0x100,
  BUYS_EVERYTHING: 0x200,
} as const;

const DEALER_ROLES = [
  'BOBBYR',
  'TONY',
  'FRANZ',
  'KEITH',
  'JAKE',
  'GABBY',
  'DEVIN',
  'HOWARD',
  'SAM',
  'FRANK',
  'BAR_BRO_1',
  'BAR_BRO_2',
  'BAR_BRO_3',
  'BAR_BRO_4',
  'MICKY',
  'ARNIE',
  'FREDO',
  'PERKO',
  'ELGIN',
  'MANNY',
] as const;
export type DealerRole = (typeof DEALER_ROLES)[number];

const CATEGORY_NAMES = [
  'HANDGUNCLASS',
  'SMGCLASS',
  'RIFLECLASS',
  'MGCLASS',
  'SHOTGUNCLASS',
  'KNIFECLASS',
  'BLADE',
  'LAUNCHER',
  'ARMOUR',
  'MEDKIT',
  'MISC',
  'AMMO',
  'GRENADE',
  'BOMB',
  'KIT',
  'FACE',
  'ALCOHOL',
  'ELECTRONICS',
  'HARDWARE',
  'MEDICAL',
  'ATTACHMENTS',
  'DETONATORS',
  'ROCKET_RIFLE',
  'BIG_GUNS',
] as const;
export type DealerCategory = (typeof CATEGORY_NAMES)[number];

const SPECIAL_ITEMS = [
  'JAR',
  'JAR_ELIXIR',
  'JAR_CREATURE_BLOOD',
  'GAS_CAN',
  'VIDEO_CAMERA',
  'BEER',
  'WINE',
  'ALCOHOL',
  'ROCKET_RIFLE',
  'AUTO_ROCKET_RIFLE',
  'ROCKET_LAUNCHER',
  'MONEY',
] as const;
export type MerchantItem = (typeof SPECIAL_ITEMS)[number];

const TYPE_NAMES: Readonly<Record<string, number>> = DealerType;
const FLAG_NAMES: Readonly<Record<string, number>> = DealerFlag;
const ITEM_CLASS_NAMES: Readonly<Record<string, number>> = ItemClass;
const WEAPON_CLASS_NAMES: Readonly<Record<string, number>> = {
  NOGUNCLASS: WeaponClass.NOGUN,
  HANDGUNCLASS: WeaponClass.HANDGUN,
  SMGCLASS: WeaponClass.SMG,
  RIFLECLASS: WeaponClass.RIFLE,
  MGCLASS: WeaponClass.MG,
  SHOTGUNCLASS: WeaponClass.SHOTGUN,
  KNIFECLASS: WeaponClass.KNIFE,
  MONSTERCLASS: WeaponClass.MONSTER,
};

export interface DealerDef {
  readonly id: number;
  readonly profile: number;
  readonly profileName: string;
  readonly type: number;
  readonly buyingPrice: number;
  readonly sellingPrice: number;
  readonly repairSpeed: number;
  readonly repairCost: number;
  readonly initialCash: number;
  readonly flags: number;
  readonly inventory: ReadonlyMap<number, number>;
}

export interface SortCategory {
  readonly itemClass: number;
  readonly weaponClass: number;
  readonly allowUsed: boolean;
}

export interface CategoryOverrides {
  readonly byItem: ReadonlyMap<number, number>;
  readonly fallback: number;
}

export interface MerchantTables {
  readonly dealerIds: Readonly<Record<DealerRole, number>>;
  readonly categories: Readonly<Record<DealerCategory, number>>;
  readonly misc: CategoryOverrides;
  readonly face: CategoryOverrides;
  readonly sortCategories: readonly SortCategory[];
  readonly staples: ReadonlySet<number>;
  readonly liquids: ReadonlySet<number>;
}

export interface MerchantContent {
  readonly dealers: readonly DealerDef[];
  readonly tables: MerchantTables;
  readonly itemIds: Readonly<Record<MerchantItem, number>>;
  readonly weaponSaleModifiers: ReadonlyMap<number, number>;
}

export interface MerchantContentSources {
  readonly dealers: unknown;
  readonly profileInfo: unknown;
  readonly tables: unknown;
  readonly inventories: ReadonlyMap<string, unknown>;
}

function itemId(items: ItemTable, name: string, what: string): number {
  const def = items.byName.get(name);
  if (!def) throw new FormatError(`${what}: unknown item ${name}`);
  return def.index;
}

function float(o: JsonObject, key: string, what: string): number {
  const v = o[key];
  if (v === undefined) return 0;
  if (typeof v !== 'number') throw new FormatError(`${what}.${key}: expected a number`);
  return Math.fround(v);
}

interface ProfileInfo {
  readonly ids: ReadonlyMap<string, number>;
  readonly names: ReadonlyMap<number, string>;
  readonly weaponSaleModifiers: ReadonlyMap<number, number>;
}

function parseProfileInfo(json: unknown): ProfileInfo {
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  const weaponSaleModifiers = new Map<number, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const what = `mercs profile info[${i}]`;
    const o = asObject(v, what);
    const id = asInt(o.profileID, `${what}.profileID`);
    const name = asString(o.internalName, `${what}.internalName`);
    ids.set(name, id);
    names.set(id, name);
    const modifier =
      o.weaponSaleModifier === undefined ? DEFAULT_WEAPON_SALE_MODIFIER : asInt(o.weaponSaleModifier, `${what}.weaponSaleModifier`);
    weaponSaleModifiers.set(id, modifier);
  });
  return { ids, names, weaponSaleModifiers };
}

export function dealerInventoryPath(profileName: string): string {
  return `${DEALER_INVENTORY_DIR}/dealer-inventory-${profileName.toLowerCase()}.json`;
}

function parseInventory(json: unknown, items: ItemTable, what: string): Map<number, number> {
  const o = asObject(json, what);
  const inventory = new Map<number, number>();
  for (const [name, amount] of Object.entries(o)) inventory.set(itemId(items, name, what), asInt(amount, `${what}.${name}`));
  return inventory;
}

function flagsOf(o: JsonObject, what: string): number {
  let flags = 0;
  for (const [k, v] of asArray(o.flags ?? [], `${what}.flags`).entries()) {
    const flag = FLAG_NAMES[asString(v, `${what}.flags[${k}]`)];
    if (flag === undefined) throw new FormatError(`${what}: unknown dealer flag ${String(v)}`);
    flags |= flag;
  }
  return flags;
}

function parseDealers(sources: MerchantContentSources, profiles: ProfileInfo, items: ItemTable): DealerDef[] {
  const dealers = asArray(sources.dealers, 'dealers').map((v, id): DealerDef => {
    const what = `dealers[${id}]`;
    const o = asObject(v, what);
    const profileName = asString(o.profile, `${what}.profile`);
    const profile = profiles.ids.get(profileName);
    if (profile === undefined) throw new FormatError(`${what}: unknown profile ${profileName}`);
    const type = TYPE_NAMES[asString(o.type, `${what}.type`)];
    if (type === undefined) throw new FormatError(`${what}: unknown dealer type ${String(o.type)}`);
    const path = dealerInventoryPath(profileName);
    const inventoryJson = sources.inventories.get(path);
    if (inventoryJson === undefined) throw new FormatError(`${what}: missing ${path}`);
    const dealer: DealerDef = {
      id,
      profile,
      profileName,
      type,
      buyingPrice: float(o, 'buyingPrice', what),
      sellingPrice: float(o, 'sellingPrice', what),
      repairSpeed: float(o, 'repairSpeed', what),
      repairCost: float(o, 'repairCost', what),
      initialCash: asInt(o.initialCash, `${what}.initialCash`),
      flags: flagsOf(o, what),
      inventory: parseInventory(inventoryJson, items, path),
    };
    if (type === DealerType.REPAIRS && (dealer.repairCost === 0 || dealer.repairSpeed === 0))
      throw new FormatError(`${what}: a repairman needs repairCost and repairSpeed`);
    return dealer;
  });
  if (dealers.length < NUM_ARMS_DEALERS) throw new FormatError(`dealers: expected ${NUM_ARMS_DEALERS} dealers, got ${dealers.length}`);
  return dealers;
}

function named<K extends string>(o: JsonObject, keys: readonly K[], what: string): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of keys) out[key] = asInt(o[key], `${what}.${key}`);
  return out;
}

function overrides(json: unknown, categories: Readonly<Record<string, number>>, items: ItemTable, what: string): CategoryOverrides {
  const o = asObject(json, what);
  const byItem = new Map<number, number>();
  let fallback: number | undefined;
  for (const [name, category] of Object.entries(o)) {
    const bits = categories[asString(category, `${what}.${name}`)];
    if (bits === undefined) throw new FormatError(`${what}: unknown category ${String(category)}`);
    if (name === 'default') fallback = bits;
    else byItem.set(itemId(items, name, what), bits);
  }
  if (fallback === undefined) throw new FormatError(`${what}: no default category`);
  return { byItem, fallback };
}

function parseTables(json: unknown, items: ItemTable): MerchantTables {
  const o = asObject(json, 'merchant tables');
  const categoryJson = asObject(o.categories, 'merchant tables.categories');
  const allCategories = Object.fromEntries(Object.entries(categoryJson).map(([k, v]) => [k, asInt(v, `categories.${k}`)]));
  const exceptions = asObject(o.categoryExceptions, 'merchant tables.categoryExceptions');
  const names = (v: unknown, what: string) => new Set(asArray(v, what).map((n, i) => itemId(items, asString(n, `${what}[${i}]`), what)));
  return {
    dealerIds: named(asObject(o.dealerIds, 'merchant tables.dealerIds'), DEALER_ROLES, 'dealerIds'),
    categories: named(categoryJson, CATEGORY_NAMES, 'categories'),
    misc: overrides(exceptions.MISC, allCategories, items, 'categoryExceptions.MISC'),
    face: overrides(exceptions.FACE, allCategories, items, 'categoryExceptions.FACE'),
    sortCategories: asArray(o.sortCategories, 'merchant tables.sortCategories').map((v, i) => {
      const s = asObject(v, `sortCategories[${i}]`);
      const itemClass = ITEM_CLASS_NAMES[asString(s.itemClass, `sortCategories[${i}].itemClass`)];
      const weaponClass = WEAPON_CLASS_NAMES[asString(s.weaponClass, `sortCategories[${i}].weaponClass`)];
      if (itemClass === undefined || weaponClass === undefined) throw new FormatError(`sortCategories[${i}]: unknown class`);
      return { itemClass, weaponClass, allowUsed: s.allowUsed === true };
    }),
    staples: names(o.staples, 'merchant tables.staples'),
    liquids: names(o.liquids, 'merchant tables.liquids'),
  };
}

export function parseMerchantContent(sources: MerchantContentSources, items: ItemTable): MerchantContent {
  const profiles = parseProfileInfo(sources.profileInfo);
  const itemIds = {} as Record<MerchantItem, number>;
  for (const name of SPECIAL_ITEMS) itemIds[name] = itemId(items, name, 'merchant items');
  return {
    dealers: parseDealers(sources, profiles, items),
    tables: parseTables(sources.tables, items),
    itemIds,
    weaponSaleModifiers: profiles.weaponSaleModifiers,
  };
}

export function dealerInventoryPaths(dealersJson: unknown, profileInfoJson: unknown): string[] {
  const profiles = parseProfileInfo(profileInfoJson);
  return asArray(dealersJson, 'dealers').map((v, id) => {
    const name = asString(asObject(v, `dealers[${id}]`).profile, `dealers[${id}].profile`);
    if (!profiles.ids.has(name)) throw new FormatError(`dealers[${id}]: unknown profile ${name}`);
    return dealerInventoryPath(name);
  });
}

async function readJsonc(read: ReadFile, path: string): Promise<unknown> {
  const bytes = await read(path);
  if (!bytes) throw new FormatError(`missing ${path}`);
  return parseJsoncBytes(bytes);
}

export async function loadMerchantContent(read: ReadFile, items: ItemTable): Promise<MerchantContent> {
  const [dealers, profileInfo, tables] = await Promise.all([
    readJsonc(read, MERCHANT_CONTENT_PATHS.dealers),
    readJsonc(read, MERCHANT_CONTENT_PATHS.profileInfo),
    readJsonc(read, MERCHANT_CONTENT_PATHS.tables),
  ]);
  const paths = dealerInventoryPaths(dealers, profileInfo);
  const inventories = new Map(await Promise.all(paths.map(async (p) => [p, await readJsonc(read, p)] as const)));
  return parseMerchantContent({ dealers, profileInfo, tables, inventories }, items);
}

export function weaponSaleModifier(content: MerchantContent, profile: number): number {
  return content.weaponSaleModifiers.get(profile) ?? DEFAULT_WEAPON_SALE_MODIFIER;
}

export function dealerByProfile(content: MerchantContent, profile: number): DealerDef | undefined {
  return content.dealers.find((d) => d.profile === profile);
}

export function hasDealerFlag(dealer: DealerDef, flag: number): boolean {
  return (dealer.flags & flag) !== 0;
}

export function maxItemAmount(dealer: DealerDef, item: number): number {
  return dealer.inventory.get(item) ?? 0;
}

export function doesItemAppearInDealerInventoryList(dealer: DealerDef, item: number, purchaseFromPlayer: boolean): boolean {
  const max = dealer.inventory.get(item);
  return max !== undefined && (max > 0 || purchaseFromPlayer);
}
