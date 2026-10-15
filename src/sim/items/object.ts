// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Item_Types.h OBJECTTYPE; Items.cc DefaultMagazine, FindReplacementMagazine, CreateGun,
// @src CreateMagazine, CreateItem, CreateItems, CreateMoney

import { AmmoType, ItemClass, ItemFlags, type ItemTable, NOTHING, WeaponClass } from '../../content/items/items.ts';

export const MAX_OBJECTS_PER_SLOT = 8;
export const MAX_ATTACHMENTS = 4;
export const MAX_MONEY_PER_SLOT = 20000;
export const USABLE_STATUS = 10;
export const NO_PROFILE = 200;

export const ObjectFlags = {
  UNDROPPABLE: 0x01,
  AI_UNUSABLE: 0x04,
  ARMED_BOMB: 0x08,
  KNOWN_TO_BE_TRAPPED: 0x10,
  DISABLED_BOMB: 0x20,
  ALARM_TRIGGER: 0x40,
  NO_OVERWRITE: 0x80,
} as const;

export interface Attachment {
  item: number;
  status: number;
}

export interface ItemObject {
  item: number;
  count: number;
  status: number[];
  gunAmmoType: number;
  gunShotsLeft: number;
  gunAmmoItem: number;
  gunAmmoStatus: number;
  money: number;
  attachments: Attachment[];
  flags: number;
  trap: number;
  imprintId: number;
}

function blankObject(item: number): ItemObject {
  return {
    item,
    count: 1,
    status: [0],
    gunAmmoType: 0,
    gunShotsLeft: 0,
    gunAmmoItem: NOTHING,
    gunAmmoStatus: 0,
    money: 0,
    attachments: [],
    flags: 0,
    trap: 0,
    imprintId: 0,
  };
}

export function defaultMagazine(table: ItemTable, gun: number): number {
  const weapon = table.byIndex.get(gun)?.weapon;
  if (!weapon || weapon.calibre === 0) throw new Error(`no default magazine for item ${gun}`);
  for (const mag of table.magazines) {
    if (!mag.magazine?.defaultMagazine) continue;
    if (mag.magazine.calibre === weapon.calibre && mag.magazine.capacity === weapon.magSize) return mag.index;
  }
  throw new Error(`no default magazine for item ${gun}`);
}

export function findReplacementMagazine(table: ItemTable, calibre: number, magSize: number, ammoType: number): number {
  let fallback = NOTHING;
  for (const mag of table.magazines) {
    if (mag.magazine?.calibre !== calibre || mag.magazine.capacity !== magSize) continue;
    if (mag.magazine.ammoType === ammoType) return mag.index;
    if (fallback === NOTHING) fallback = mag.index;
  }
  return fallback;
}

function checkedStatus(status: number): number {
  return status < 1 || status > 100 ? 70 : status;
}

function createGun(table: ItemTable, item: number, status: number): ItemObject {
  const o = blankObject(item);
  const def = table.byIndex.get(item);
  const weapon = def?.weapon;
  o.status[0] = status;
  o.imprintId = NO_PROFILE;
  if (weapon?.weaponClass === WeaponClass.MONSTER) {
    o.gunShotsLeft = weapon.magSize;
    o.gunAmmoType = AmmoType.MONSTER;
  } else if (def?.name === 'ROCKET_LAUNCHER' || def?.name === 'TANK_CANNON') {
    o.gunShotsLeft = def.name === 'ROCKET_LAUNCHER' ? 1 : 0;
    o.gunAmmoStatus = 100;
    o.gunAmmoType = 0;
  } else {
    const ammo = defaultMagazine(table, item);
    const mag = table.byIndex.get(ammo)?.magazine;
    o.gunAmmoItem = ammo;
    o.gunAmmoType = mag?.ammoType ?? 0;
    o.gunAmmoStatus = 100;
    o.gunShotsLeft = mag?.capacity ?? 0;
  }
  return o;
}

export function createItem(table: ItemTable, item: number, status: number): ItemObject {
  const def = table.byIndex.get(item);
  if (!def) throw new Error(`unknown item ${item}`);
  let o: ItemObject;
  if (def.itemClass === ItemClass.GUN) o = createGun(table, item, checkedStatus(status));
  else if (def.itemClass === ItemClass.AMMO) {
    o = blankObject(item);
    o.status[0] = def.magazine?.capacity ?? 0;
  } else {
    o = blankObject(item);
    if (def.itemClass === ItemClass.MONEY) {
      o.status[0] = 100;
      o.money = status * 50;
    } else o.status[0] = checkedStatus(status);
  }
  if (def.flags & ItemFlags.DEFAULT_UNDROPPABLE) o.flags |= ObjectFlags.UNDROPPABLE;
  return o;
}

export function createItems(table: ItemTable, item: number, status: number, count: number): ItemObject {
  const n = Math.min(count, MAX_OBJECTS_PER_SLOT);
  const o = createItem(table, item, status);
  const first = o.status[0] ?? 0;
  for (let k = 1; k < n; k++) o.status[k] = first;
  o.count = n;
  return o;
}

export function createMoney(table: ItemTable, amount: number): ItemObject {
  const money = table.byName.get('MONEY');
  if (!money) throw new Error('no MONEY item');
  const o = createItem(table, money.index, 100);
  o.money = amount;
  return o;
}

export function cloneObject(o: ItemObject): ItemObject {
  return { ...o, status: [...o.status], attachments: o.attachments.map((a) => ({ ...a })) };
}
