// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Item_Types.h OBJECTTYPE; Items.cc DefaultMagazine, FindReplacementMagazine, CreateGun,
// @src CreateMagazine, CreateItem, CreateItems, CreateMoney

import type { ObjectRecord } from '../../content/formats/object.ts';
import { AmmoType, ItemClass, ItemFlags, type ItemTable, NOTHING, WeaponClass } from '../../content/items/items.ts';
import { validAttachment, validLaunchable } from '../../content/items/rules.ts';

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
  keyId: number;
}

export function emptyObject(): ItemObject {
  return {
    item: NOTHING,
    count: 0,
    status: [],
    gunAmmoType: 0,
    gunShotsLeft: 0,
    gunAmmoItem: NOTHING,
    gunAmmoStatus: 0,
    money: 0,
    attachments: Array.from({ length: MAX_ATTACHMENTS }, () => ({ item: NOTHING, status: 0 })),
    flags: 0,
    trap: 0,
    imprintId: 0,
    keyId: 0,
  };
}

function blankObject(item: number): ItemObject {
  const o = emptyObject();
  o.item = item;
  o.count = 1;
  o.status = [0];
  return o;
}

export function deleteObject(o: ItemObject): void {
  Object.assign(o, emptyObject());
}

export function copyObjectInto(target: ItemObject, source: ItemObject): void {
  Object.assign(target, cloneObject(source));
}

export function swapObjects(a: ItemObject, b: ItemObject): void {
  const temp = cloneObject(a);
  copyObjectInto(a, b);
  copyObjectInto(b, temp);
}

export function removeObjectAt(o: ItemObject, index: number): void {
  if (o.count < index) return;
  if (o.count === 1) {
    deleteObject(o);
    return;
  }
  for (let k = index + 1; k < o.count; k++) o.status[k - 1] = o.status[k] ?? 0;
  o.status[o.count - 1] = 0;
  o.count--;
}

export function removeObjects(o: ItemObject, n: number): void {
  if (n === 0) return;
  if (n >= o.count) {
    deleteObject(o);
    return;
  }
  for (let k = 0; k < n; k++) removeObjectAt(o, 0);
}

export function stackObjects(source: ItemObject, target: ItemObject, n: number): void {
  for (let k = 0; k < n; k++) target.status[k + target.count] = source.status[k] ?? 0;
  for (let k = n; k < source.count; k++) source.status[k - n] = source.status[k] ?? 0;
  target.count += n;
  removeObjects(source, n);
}

export function damageObject(o: ItemObject, amount: number): void {
  o.status[0] = amount >= (o.status[0] ?? 0) ? 1 : (o.status[0] ?? 0) - amount;
}

export function findAttachment(o: ItemObject, item: number): number {
  return o.attachments.findIndex((a) => a.item === item);
}

export function findAttachmentByClass(table: ItemTable, o: ItemObject, itemClass: number): number {
  return o.attachments.findIndex((a) => (table.byIndex.get(a.item)?.itemClass ?? 0) === itemClass);
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

export function validItemAttachment(table: ItemTable, o: ItemObject, attachment: number, attempting: boolean): boolean {
  const ugl = table.byName.get('UNDER_GLAUNCHER')?.index ?? -1;
  if (!validAttachment(table, attachment, o.item)) return findAttachment(o, ugl) !== -1 && validLaunchable(table, attachment, ugl);
  if (!attempting) return true;
  const id = (name: string) => table.byName.get(name)?.index ?? -1;
  if (findAttachment(o, attachment) !== -1) return false;
  const exclusive: Readonly<Record<string, string>> = {
    BIPOD: 'UNDER_GLAUNCHER',
    UNDER_GLAUNCHER: 'BIPOD',
    DETONATOR: 'REMDETONATOR',
    REMDETONATOR: 'DETONATOR',
  };
  const other = exclusive[table.byIndex.get(attachment)?.name ?? ''];
  return !(other && findAttachment(o, id(other)) !== -1);
}

export function attachObject(table: ItemTable, target: ItemObject, attachment: ItemObject): boolean {
  const ugl = table.byName.get('UNDER_GLAUNCHER')?.index ?? -1;
  const launchable = validLaunchable(table, attachment.item, target.item);
  if (!launchable && !validItemAttachment(table, target, attachment.item, true)) return false;
  let pos: number;
  if (launchable || validLaunchable(table, attachment.item, ugl)) {
    pos = findAttachmentByClass(table, target, table.byIndex.get(attachment.item)?.itemClass ?? 0);
    if (pos !== -1 && attachment.count > 1) return false;
  } else pos = findAttachment(target, attachment.item);
  if (pos === -1) pos = findAttachment(target, NOTHING);
  if (pos === -1) return false;
  const slot = target.attachments[pos] as Attachment;
  const previous = { ...slot };
  slot.item = attachment.item;
  slot.status = attachment.status[0] ?? 0;
  if (attachment.item === ugl && (attachment.attachments[0]?.item ?? NOTHING) !== NOTHING) {
    const second = findAttachment(target, NOTHING);
    if (second === -1) {
      slot.item = NOTHING;
      slot.status = 0;
      return false;
    }
    Object.assign(target.attachments[second] as Attachment, attachment.attachments[0]);
    Object.assign(attachment.attachments[0] as Attachment, { item: NOTHING, status: 0 });
  }
  if (previous.item !== NOTHING) copyObjectInto(attachment, createItem(table, previous.item, previous.status));
  else removeObjects(attachment, 1);
  applyComboMerge(table, target);
  return true;
}

function applyComboMerge(table: ItemTable, target: ItemObject): void {
  const m = table.rules.comboMerges.find((c) => c.item === target.item);
  if (!m || !m.attachments.every((a) => a === NOTHING || findAttachment(target, a) !== -1)) return;
  let total = target.status[0] ?? 0;
  let contributors = 1;
  for (const a of m.attachments) {
    if (a === NOTHING) continue;
    const at = target.attachments[findAttachment(target, a)] as Attachment;
    total += at.status;
    contributors++;
    at.item = NOTHING;
    at.status = 0;
  }
  target.item = m.result;
  target.status[0] = Math.trunc(total / contributors);
}

export function objectToRecord(o: ItemObject): ObjectRecord {
  return {
    item: o.item,
    count: o.count,
    status: [...o.status],
    gunStatus: o.status[0] ?? 0,
    gunAmmoType: o.gunAmmoType,
    gunShotsLeft: o.gunShotsLeft,
    gunAmmoItem: o.gunAmmoItem,
    gunAmmoStatus: o.gunAmmoStatus,
    money: o.money,
    attachments: o.attachments.map((a) => ({ ...a })),
    flags: o.flags,
    trap: o.trap,
    imprintId: o.imprintId,
    keyId: o.keyId,
  };
}

export function objectFromRecord(rec: ObjectRecord): ItemObject {
  const o = emptyObject();
  if (rec.item === NOTHING) {
    o.flags = rec.flags;
    return o;
  }
  o.item = rec.item;
  o.count = rec.count;
  o.status = rec.status.slice(0, Math.max(rec.count, 1));
  o.gunAmmoType = rec.gunAmmoType;
  o.gunShotsLeft = rec.gunShotsLeft;
  o.gunAmmoItem = rec.gunAmmoItem;
  o.gunAmmoStatus = rec.gunAmmoStatus;
  o.money = rec.money;
  o.attachments = rec.attachments.map((a) => ({ ...a }));
  o.flags = rec.flags;
  o.trap = rec.trap;
  o.imprintId = rec.imprintId;
  o.keyId = rec.keyId;
  return o;
}
