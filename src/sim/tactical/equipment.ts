// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Inventory_Choosing.cc InitArmyGunTypes, GetWeaponClass, MarkAllWeaponsOfSameGunClassAsDropped,
// @src GenerateRandomEquipment, ChooseWeaponForSoldierCreateStruct, ChooseGrenadesForSoldierCreateStruct,
// @src ChooseArmourForSoldierCreateStruct, ChooseSpecialWeaponsForSoldierCreateStruct, ChooseFaceGearForSoldierCreateStruct,
// @src ChooseKitsForSoldierCreateStruct, ChooseMiscGearForSoldierCreateStruct, ChooseBombsForSoldierCreateStruct,
// @src PlaceObjectInSoldierCreateStruct, MakeOneItemOfClassDroppable, RandomlyChooseWhichItemsAreDroppable,
// @src ReplaceExtendedGuns, SelectStandardArmyGun; Items.cc RandomMagazine. See docs/12 §8.

import { AmmoType, ArmourClass, ItemClass, type ItemDef, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { validAttachment } from '../../content/items/rules.ts';
import {
  attachObject,
  copyObjectInto,
  createItem,
  createItems,
  defaultMagazine,
  emptyObject,
  findReplacementMagazine,
  type ItemObject,
  NO_PROFILE,
  ObjectFlags,
} from '../items/object.ts';
import type { RandomStream } from './combat/context.ts';
import { type Inventory, InvSlot, NUM_INV_SLOTS } from './inventory.ts';
import { Body, SoldierClass } from './soldier.ts';

export const MORTAR_GRENADE_CLASS = 100;
const MIN_EQUIPMENT_CLASS = 1;
const MAX_EQUIPMENT_CLASS = 11;
const ARMY_GUN_LEVELS = 11;
const MAX_MORTARS_PER_TEAM = 1;

const Rating = {
  BAD_ADMINISTRATOR: 1,
  GOOD_ADMINISTRATOR: 4,
  GREAT_ADMINISTRATOR: 5,
  BAD_ARMY: 3,
  AVERAGE_ARMY: 5,
  GOOD_ARMY: 6,
  GREAT_ARMY: 7,
  BAD_ELITE: 5,
  AVERAGE_ELITE: 7,
  GOOD_ELITE: 8,
} as const;

const DropRate = {
  ENEMY_AMMO: 50,
  ENEMY_GRENADE: 25,
  ENEMY_EQUIP: 15,
  MILITIA_AMMO: 5,
  MILITIA_GRENADE: 3,
  MILITIA_EQUIP: 2,
} as const;

export interface EquipmentState {
  weaponsAlreadyDropped: Set<number>;
  mortarsRolledByTeam: number;
  progress: number;
  gunNut: boolean;
  sciFi: boolean;
  underground: boolean;
  inEnemyHeldTixa: boolean;
  enemyWeaponMinimalStatus: number;
  autoResolveActive: boolean;
}

export function initArmyGunTypes(items: ItemTable): Set<number> {
  const dropped = new Set<number>();
  markAllWeaponsOfSameGunClassAsDropped(items, dropped, id(items, 'SW38'));
  return dropped;
}

export function sharedWeaponsDropped(holder: { weaponsDropped: Set<number> | null }, items: ItemTable): Set<number> {
  holder.weaponsDropped ??= initArmyGunTypes(items);
  return holder.weaponsDropped;
}

export function createEquipmentState(items: ItemTable, weaponsAlreadyDropped: Set<number> = initArmyGunTypes(items)): EquipmentState {
  return {
    weaponsAlreadyDropped,
    mortarsRolledByTeam: 0,
    progress: 0,
    gunNut: false,
    sciFi: true,
    underground: false,
    inEnemyHeldTixa: false,
    enemyWeaponMinimalStatus: 0,
    autoResolveActive: false,
  };
}

export interface EquipmentTarget {
  readonly inv: Inventory;
  readonly soldierClass: number;
  readonly bodyType: number;
  readonly experience: number;
  readonly marksmanship: number;
}

const id = (items: ItemTable, name: string): number => items.byName.get(name)?.index ?? NOTHING;
const def = (items: ItemTable, item: number): ItemDef | undefined => items.byIndex.get(item);
const classOf = (items: ItemTable, item: number): number => def(items, item)?.itemClass ?? 0;
const chance = (rng: RandomStream, percent: number): boolean => rng.int(100) < percent;
const isEnemyClass = (c: number) => c === SoldierClass.ADMINISTRATOR || c === SoldierClass.ARMY || c === SoldierClass.ELITE;
const isMilitiaClass = (c: number) =>
  c === SoldierClass.GREEN_MILITIA || c === SoldierClass.REG_MILITIA || c === SoldierClass.ELITE_MILITIA;

function weaponClassLevel(items: ItemTable, gun: number): number {
  return items.gunChoice.extended.findIndex((level) => level.includes(gun));
}

function markAllWeaponsOfSameGunClassAsDropped(items: ItemTable, dropped: Set<number>, weapon: number): void {
  if (!(classOf(items, weapon) & (ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.TENTACLES)))
    return;
  dropped.add(weapon);
  const level = weaponClassLevel(items, weapon);
  if (level >= 0) for (const gun of items.gunChoice.extended[level] ?? []) dropped.add(gun);
}

function selectStandardArmyGun(items: ItemTable, rng: RandomStream, state: EquipmentState, level: number): number {
  const choice = (state.gunNut ? items.gunChoice.extended : items.gunChoice.normal)[level] ?? [];
  return choice[rng.int(choice.length)] ?? NOTHING;
}

export function randomMagazine(items: ItemTable, rng: RandomStream, gun: number, percentStandard: number): number {
  const weapon = def(items, gun);
  if (weapon?.itemClass !== ItemClass.GUN || !weapon.weapon) return NOTHING;
  const w = weapon.weapon;
  const possible = items.magazines.filter((m) => m.magazine?.calibre === w.calibre && m.magazine.capacity === w.magSize);
  if (possible.length === 0) return NOTHING;
  if (possible.length === 1) return possible[0]?.index ?? NOTHING;
  const chosen = rng.int(100) < percentStandard ? 0 : 1 + rng.int(possible.length - 1);
  return possible[chosen]?.index ?? NOTHING;
}

function placeObjectInCreateStruct(items: ItemTable, inv: Inventory, o: ItemObject): boolean {
  const free = (slot: number) => {
    const here = inv[slot] as ItemObject;
    return here.item === NOTHING && !(here.flags & ObjectFlags.NO_OVERWRITE);
  };
  const perPocket = def(items, o.item)?.perPocket ?? 0;
  if (!perPocket) {
    o.count = 1;
    for (let slot = InvSlot.BIGPOCK1; slot <= InvSlot.BIGPOCK4; slot++) {
      if (free(slot)) {
        copyObjectInto(inv[slot] as ItemObject, o);
        return true;
      }
    }
    return false;
  }
  o.count = Math.min(perPocket, o.count);
  for (const [from, to] of [
    [InvSlot.SMALLPOCK1, InvSlot.SMALLPOCK8],
    [InvSlot.BIGPOCK1, InvSlot.BIGPOCK4],
  ] as const) {
    for (let slot = from; slot <= to; slot++) {
      if (free(slot)) {
        copyObjectInto(inv[slot] as ItemObject, o);
        return true;
      }
    }
  }
  return false;
}

function undroppable(o: ItemObject): ItemObject {
  o.flags |= ObjectFlags.UNDROPPABLE;
  return o;
}

function chooseWeapon(
  items: ItemTable,
  rng: RandomStream,
  state: EquipmentState,
  target: EquipmentTarget,
  weaponClass: number,
  ammoClips: number,
  attachClassIn: number,
  attachment: boolean,
): void {
  const inv = target.inv;
  if (weaponClass < 0 && ammoClips) {
    let ammo = NOTHING;
    for (const o of inv) {
      if (classOf(items, o.item) !== ItemClass.GUN) continue;
      ammo = randomMagazine(items, rng, o.item, 100 - weaponClass * -9);
      if (o.item === id(items, 'ROCKET_RIFLE')) o.imprintId = NO_PROFILE + 1;
      break;
    }
    if (ammoClips && ammo) placeObjectInCreateStruct(items, inv, undroppable(createItems(items, ammo, 100, ammoClips)));
    return;
  }
  if (weaponClass < 1) return;
  const level = Math.min(weaponClass, ARMY_GUN_LEVELS);
  const gun = selectStandardArmyGun(items, rng, state, level - 1);
  let ammo = NOTHING;
  if (ammoClips) {
    const standard = def(items, defaultMagazine(items, gun))?.magazine?.ammoType;
    const percent = standard === AmmoType.AP || standard === AmmoType.SUPER_AP ? 80 : 100 - level * 9;
    ammo = randomMagazine(items, rng, gun, percent);
  }
  let attach = NOTHING;
  let attachClass = attachClassIn;
  if (attachClass && attachment) {
    const matches = () =>
      items.ordered.filter((it) => it.itemClass === ItemClass.MISC && it.coolness === attachClass && validAttachment(items, it.index, gun));
    let found: ItemDef[] = [];
    while (attachClass && found.length === 0) {
      found = matches();
      if (found.length === 0) attachClass--;
    }
    if (found.length) attach = found[rng.int(found.length)]?.index ?? NOTHING;
  }
  const hand = inv[InvSlot.HAND] as ItemObject;
  if (!(hand.flags & ObjectFlags.NO_OVERWRITE)) {
    let status: number;
    switch (target.soldierClass) {
      case SoldierClass.ADMINISTRATOR:
      case SoldierClass.ARMY:
      case SoldierClass.GREEN_MILITIA:
      case SoldierClass.REG_MILITIA:
        status = Math.min(100, 60 + rng.int(16) + Math.trunc(state.progress / 4));
        break;
      case SoldierClass.ELITE:
      case SoldierClass.ELITE_MILITIA:
        status = Math.min(100, 85 + rng.int(6) + Math.trunc(state.progress / 10));
        break;
      default:
        status = 50 + rng.int(51);
    }
    status = Math.max(target.marksmanship, status, state.enemyWeaponMinimalStatus);
    copyObjectInto(hand, undroppable(createItem(items, gun, status)));
    if (gun === id(items, 'ROCKET_RIFLE')) hand.imprintId = NO_PROFILE + 1;
  } else attach = NOTHING;
  if (ammoClips && ammo) placeObjectInCreateStruct(items, inv, undroppable(createItems(items, ammo, 100, ammoClips)));
  if (attach) attachObject(items, hand, undroppable(createItem(items, attach, 100)));
}

function chooseGrenades(
  items: ItemTable,
  rng: RandomStream,
  inv: Inventory,
  grenades: number,
  grenadeClass: number,
  launcher: boolean,
): void {
  let points = grenades * grenadeClass;
  if (!points) return;
  if (grenadeClass === MORTAR_GRENADE_CLASS) {
    placeObjectInCreateStruct(items, inv, undroppable(createItems(items, id(items, 'MORTAR_SHELL'), 80 + rng.int(21), grenades)));
    return;
  }
  const base = Math.min(45 + grenadeClass * 5, 90);
  const variation = 101 - base;
  const n = { stun: 0, tear: 0, mustard: 0, mini: 0, reg: 0, smoke: 0, flare: 0 };
  while (points > 0) {
    if (points >= 20) {
      if (rng.int(2) && !launcher) {
        n.mustard++;
        points -= 10;
      } else {
        n.reg++;
        points -= 9;
      }
    }
    if (points >= 10) {
      const roll = rng.int(7);
      if (roll === 0 && !launcher) {
        n.mustard++;
        points -= 10;
      } else if (roll <= 1) {
        n.reg++;
        points -= 9;
      } else if (roll === 2 && !launcher) {
        n.mini++;
        points -= 7;
      } else if (roll <= 3) {
        n.tear++;
        points -= 6;
      } else if (roll === 4) {
        n.stun++;
        points -= 5;
      } else if (roll === 5) {
        n.smoke++;
        points -= 4;
      } else if (!launcher) {
        n.flare++;
        points -= 3;
      }
    }
    if (points >= 1 && points < 10) {
      const roll = rng.int(10);
      if (roll <= 2) {
        n.smoke++;
        points -= 4;
      } else if (roll <= 4) {
        n.tear++;
        points -= 6;
      } else if (roll <= 6) {
        if (!launcher) {
          n.flare++;
          points -= 3;
        }
      } else if (roll <= 8) {
        n.stun++;
        points -= 5;
      } else if (!launcher) {
        n.mini++;
        points -= 7;
      }
    }
  }
  const make = (count: number, name: string) => {
    if (count) placeObjectInCreateStruct(items, inv, undroppable(createItems(items, id(items, name), base + rng.int(variation), count)));
  };
  make(n.smoke, launcher ? 'GL_SMOKE_GRENADE' : 'SMOKE_GRENADE');
  make(n.tear, launcher ? 'GL_TEARGAS_GRENADE' : 'TEARGAS_GRENADE');
  make(n.stun, launcher ? 'GL_STUN_GRENADE' : 'STUN_GRENADE');
  make(n.reg, launcher ? 'GL_HE_GRENADE' : 'HAND_GRENADE');
  make(n.mini, 'MINI_GRENADE');
  make(n.mustard, 'MUSTARD_GRENADE');
  make(n.flare, 'BREAK_LIGHT');
}

function chooseArmourPiece(
  items: ItemTable,
  rng: RandomStream,
  inv: Inventory,
  slot: number,
  armourClass: number,
  wantedClass: number,
  skip: ReadonlySet<number>,
): ItemDef | null {
  let cls = wantedClass;
  const armours = items.ordered.filter((it) => it.armour && !skip.has(it.index));
  const matches = () => armours.filter((it) => it.coolness === cls && it.armour?.armourClass === armourClass);
  let found: ItemDef[] = [];
  while (cls && found.length === 0) {
    found = matches();
    if (found.length === 0) cls--;
  }
  if (found.length === 0) return null;
  let pick = rng.int(found.length);
  const target = inv[slot] as ItemObject;
  for (const it of found) {
    if (pick) {
      pick--;
      continue;
    }
    if (target.flags & ObjectFlags.NO_OVERWRITE) return null;
    copyObjectInto(target, undroppable(createItem(items, it.index, 70 + rng.int(31))));
    return it;
  }
  return null;
}

function chooseArmour(
  items: ItemTable,
  rng: RandomStream,
  inv: Inventory,
  helmetClass: number,
  vestClass: number,
  leggingsClass: number,
): void {
  const none = new Set<number>();
  if (helmetClass) chooseArmourPiece(items, rng, inv, InvSlot.HELMET, ArmourClass.HELMET, helmetClass, none);
  if (vestClass) {
    const skip = new Set(['TSHIRT', 'LEATHER_JACKET', 'TSHIRT_DEIDRANNA'].map((n) => id(items, n)));
    const vest = chooseArmourPiece(items, rng, inv, InvSlot.VEST, ArmourClass.VEST, vestClass, skip);
    if (vest && (vest.name === 'KEVLAR_VEST' || vest.name === 'SPECTRA_VEST')) {
      if (rng.int(100) < 15 * (vestClass - vest.coolness)) {
        const plates = undroppable(createItem(items, id(items, 'CERAMIC_PLATES'), 70 + rng.int(31)));
        attachObject(items, inv[InvSlot.VEST] as ItemObject, plates);
      }
    }
  }
  if (leggingsClass) chooseArmourPiece(items, rng, inv, InvSlot.LEGS, ArmourClass.LEGGINGS, leggingsClass, none);
}

function chooseSpecialWeapons(
  items: ItemTable,
  rng: RandomStream,
  inv: Inventory,
  knifeClassIn: number,
  launcher: boolean,
  law: boolean,
  mortar: boolean,
): void {
  let knifeClass = knifeClassIn;
  const knives = () =>
    items.ordered.filter(
      (it) => it.weapon && (it.itemClass === ItemClass.BLADE || it.itemClass === ItemClass.THROWING_KNIFE) && it.coolness === knifeClass,
    );
  let found: ItemDef[] = [];
  while (knifeClass && found.length === 0) {
    found = knives();
    if (found.length === 0) knifeClass--;
  }
  const knife = found.length ? found[rng.int(found.length)] : undefined;
  if (knife) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, knife.index, 70 + rng.int(31))));
  if (launcher) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, id(items, 'GLAUNCHER'), 50 + rng.int(51))));
  if (law) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, id(items, 'ROCKET_LAUNCHER'), 50 + rng.int(51))));
  if (mortar) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, id(items, 'MORTAR'), 50 + rng.int(51))));
}

function chooseFaceGear(items: ItemTable, rng: RandomStream, state: EquipmentState, target: EquipmentTarget, difficulty: number): void {
  const inv = target.inv;
  if (state.inEnemyHeldTixa) return;
  for (let slot = InvSlot.BIGPOCK1; slot < InvSlot.BIGPOCK4; slot++)
    if (classOf(items, (inv[slot] as ItemObject).item) === ItemClass.FACE) return;
  const put = (slot: number, name: string) =>
    copyObjectInto(inv[slot] as ItemObject, undroppable(createItem(items, id(items, name), 70 + rng.int(31))));
  switch (target.soldierClass) {
    case SoldierClass.ELITE:
    case SoldierClass.ELITE_MILITIA:
      put(InvSlot.HEAD1, chance(rng, 75) ? 'GASMASK' : 'EXTENDEDEAR');
      put(InvSlot.HEAD2, chance(rng, 75) ? 'NIGHTGOGGLES' : 'UVGOGGLES');
      break;
    case SoldierClass.ARMY:
    case SoldierClass.REG_MILITIA:
      if (chance(rng, Math.trunc(difficulty / 2))) put(InvSlot.HEAD1, chance(rng, 50) ? 'GASMASK' : 'NIGHTGOGGLES');
      if (chance(rng, Math.trunc(difficulty / 3))) put(InvSlot.HEAD2, 'EXTENDEDEAR');
      break;
  }
}

function chooseKits(items: ItemTable, rng: RandomStream, inv: Inventory, kitClass: number): void {
  let kit = NOTHING;
  if (chance(rng, 50)) kit = id(items, 'FIRSTAIDKIT');
  else if (chance(rng, 25)) kit = id(items, 'MEDICKIT');
  else {
    const toolkit = id(items, 'TOOLKIT');
    const found = items.ordered.filter(
      (it) => it.itemClass === ItemClass.KIT && it.coolness > 0 && it.coolness <= kitClass && it.index !== toolkit,
    );
    if (found.length) kit = found[rng.int(found.length)]?.index ?? NOTHING;
  }
  if (kit) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, kit, 80 + rng.int(21))));
}

const MISC_ITEMS = [
  'CANTEEN',
  'CANTEEN',
  'CANTEEN',
  'CANTEEN',
  'ALCOHOL',
  'ALCOHOL',
  'ADRENALINE_BOOSTER',
  'ADRENALINE_BOOSTER',
  'REGEN_BOOSTER',
  'BRASS_KNUCKLES',
  'CHEWING_GUM',
  'CIGARS',
  'GOLDWATCH',
];

function chooseMisc(items: ItemTable, rng: RandomStream, state: EquipmentState, inv: Inventory, miscClass: number): void {
  const found = MISC_ITEMS.map((n) => def(items, id(items, n))).filter(
    (it): it is ItemDef => !!it && it.coolness > 0 && it.coolness <= miscClass && (it.name !== 'REGEN_BOOSTER' || state.sciFi),
  );
  if (found.length === 0) return;
  const chosen = found[rng.int(found.length)];
  if (chosen) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, chosen.index, 80 + rng.int(21))));
}

function chooseBombs(items: ItemTable, rng: RandomStream, inv: Inventory, bombClass: number): void {
  const found = items.ordered.filter(
    (it) => it.explosive && it.itemClass === ItemClass.BOMB && it.coolness > 0 && it.coolness <= bombClass,
  );
  if (found.length === 0) return;
  const chosen = found[rng.int(found.length)];
  if (chosen) placeObjectInCreateStruct(items, inv, undroppable(createItem(items, chosen.index, 80 + rng.int(21))));
}

function makeOneItemOfClassDroppable(items: ItemTable, rng: RandomStream, inv: Inventory, mask: number): void {
  let matches = 0;
  for (const o of inv) {
    if (!(classOf(items, o.item) & mask)) continue;
    if (o.flags & ObjectFlags.NO_OVERWRITE) break;
    matches++;
  }
  if (matches === 0) return;
  for (const o of inv) {
    if (!(classOf(items, o.item) & mask)) continue;
    if (o.flags & ObjectFlags.NO_OVERWRITE) break;
    if (rng.int(matches--) !== 0) continue;
    o.flags &= ~ObjectFlags.UNDROPPABLE;
    break;
  }
}

function chooseDroppable(items: ItemTable, rng: RandomStream, state: EquipmentState, inv: Inventory, soldierClass: number): void {
  if (isEnemyClass(soldierClass) && !state.autoResolveActive) {
    for (const o of inv) {
      const d = def(items, o.item);
      if (
        o.item === NOTHING ||
        !(
          classOf(items, o.item) &
          (ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.TENTACLES)
        ) ||
        !d
      )
        continue;
      if (o.flags & ObjectFlags.NO_OVERWRITE || state.weaponsAlreadyDropped.has(o.item)) continue;
      o.flags &= ~ObjectFlags.UNDROPPABLE;
      markAllWeaponsOfSameGunClassAsDropped(items, state.weaponsAlreadyDropped, o.item);
    }
  }
  const militia = isMilitiaClass(soldierClass);
  const ammoRate = militia ? DropRate.MILITIA_AMMO : DropRate.ENEMY_AMMO;
  const grenadeRate = militia ? DropRate.MILITIA_GRENADE : DropRate.ENEMY_GRENADE;
  const otherRate = militia ? DropRate.MILITIA_EQUIP : DropRate.ENEMY_EQUIP;
  const ammo = rng.int(100) < ammoRate;
  const weapon = rng.int(100) < otherRate;
  const armour = rng.int(100) < otherRate;
  const knife = rng.int(100) < otherRate;
  const grenades = rng.int(100) < grenadeRate;
  const kit = rng.int(100) < otherRate;
  const face = rng.int(100) < Math.trunc(otherRate / 3);
  const misc = rng.int(100) < otherRate;
  if (ammo)
    for (const o of inv)
      if (classOf(items, o.item) === ItemClass.AMMO && !(o.flags & ObjectFlags.NO_OVERWRITE)) o.flags &= ~ObjectFlags.UNDROPPABLE;
  if (weapon) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.LAUNCHER | ItemClass.GUN);
  if (armour) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.ARMOUR);
  if (knife) {
    for (const o of inv) {
      const c = classOf(items, o.item);
      if (c !== ItemClass.BLADE && c !== ItemClass.THROWING_KNIFE) continue;
      if (!(o.flags & ObjectFlags.NO_OVERWRITE)) o.flags &= ~ObjectFlags.UNDROPPABLE;
      break;
    }
  }
  if (grenades) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.GRENADE);
  if (kit) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.KIT | ItemClass.MEDKIT);
  if (face) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.FACE);
  if (misc) makeOneItemOfClassDroppable(items, rng, inv, ItemClass.MISC);
}

function equipTank(items: ItemTable, rng: RandomStream, inv: Inventory): void {
  copyObjectInto(inv[InvSlot.HAND] as ItemObject, undroppable(createItem(items, id(items, 'TANK_CANNON'), 80 + rng.int(21))));
  placeObjectInCreateStruct(items, inv, undroppable(createItems(items, id(items, 'MINIMI'), 80 + rng.int(21), 1)));
  placeObjectInCreateStruct(items, inv, undroppable(createItems(items, id(items, 'TANK_SHELL'), 100, 1)));
  copyObjectInto(inv[InvSlot.VEST] as ItemObject, undroppable(createItem(items, id(items, 'SPECTRA_VEST'), 100)));
  copyObjectInto(inv[InvSlot.HELMET] as ItemObject, undroppable(createItem(items, id(items, 'SPECTRA_HELMET'), 100)));
  copyObjectInto(inv[InvSlot.LEGS] as ItemObject, undroppable(createItem(items, id(items, 'SPECTRA_LEGGINGS'), 100)));
}

export function generateRandomEquipment(
  items: ItemTable,
  rng: RandomStream,
  state: EquipmentState,
  target: EquipmentTarget,
  equipmentRating: number,
  difficulty: number,
): void {
  const inv = target.inv;
  if (target.bodyType === Body.HATKIDCIV || target.bodyType === Body.KIDCIV) return;
  if (target.bodyType === Body.TANK_NE || target.bodyType === Body.TANK_NW) {
    equipTank(items, rng, inv);
    return;
  }
  const modifier = equipmentRating + (Math.trunc(difficulty / 10) - 5);
  let ammoClips = 0;
  let grenades = 0;
  let attachment = false;
  let weaponClass = 0;
  let helmetClass = 0;
  let vestClass = 0;
  let leggingClass = 0;
  let attachClass = 0;
  let grenadeClass = 0;
  let knifeClass = 0;
  let kitClass = 0;
  let miscClass = 0;
  let bombClass = 0;
  let mortar = false;
  let launcher = false;
  let law = false;
  const clampRating = (r: number) => Math.min(MAX_EQUIPMENT_CLASS, Math.max(MIN_EQUIPMENT_CLASS, r));
  const specialRoll = () => rng.int(state.underground ? 6 : 7);
  switch (target.soldierClass) {
    case SoldierClass.NONE:
      ammoClips = 1 + rng.int(2);
      break;
    case SoldierClass.ADMINISTRATOR:
    case SoldierClass.GREEN_MILITIA: {
      const r = clampRating(Rating.BAD_ADMINISTRATOR + modifier);
      weaponClass = vestClass = helmetClass = r;
      if (rng.int(2)) knifeClass = r;
      ammoClips = 1 + rng.int(2);
      if (r >= Rating.GOOD_ADMINISTRATOR) {
        ammoClips++;
        kitClass = r;
        miscClass = r;
      }
      if (r >= Rating.GREAT_ADMINISTRATOR) {
        grenades = 1;
        grenadeClass = r;
      }
      if (r > MIN_EQUIPMENT_CLASS && r < MAX_EQUIPMENT_CLASS) {
        const roll = rng.int(5);
        if (roll === 0) {
          weaponClass++;
          vestClass--;
        } else if (roll === 1) {
          weaponClass--;
          vestClass++;
        }
      }
      break;
    }
    case SoldierClass.ARMY:
    case SoldierClass.REG_MILITIA: {
      const r = clampRating(Rating.BAD_ARMY + modifier);
      weaponClass = vestClass = helmetClass = grenadeClass = r;
      if (r >= Rating.GOOD_ARMY && rng.int(100) < 33) {
        attachment = true;
        attachClass = r;
      }
      ammoClips = 2 + rng.int(2);
      if (r >= Rating.AVERAGE_ARMY) {
        grenades = rng.int(2);
        kitClass = r;
        miscClass = r;
      }
      if (r >= Rating.GOOD_ARMY) grenades++;
      if (r >= Rating.GREAT_ARMY) {
        grenades++;
        leggingClass = r;
        if (chance(rng, 25)) bombClass = r;
      }
      if (rng.int(2)) knifeClass = r;
      if (r > MIN_EQUIPMENT_CLASS && r < MAX_EQUIPMENT_CLASS) {
        switch (rng.int(7)) {
          case 3:
            weaponClass++;
            vestClass--;
            break;
          case 4:
            weaponClass--;
            vestClass++;
            break;
          case 5:
            vestClass++;
            helmetClass--;
            break;
          case 6:
            vestClass--;
            helmetClass++;
            break;
        }
      }
      if (r >= Rating.GREAT_ARMY && rng.int(100) < 20) {
        const roll = specialRoll();
        if (roll <= 2) {
          if (target.experience >= 3) {
            launcher = true;
            grenades = 3 + rng.int(3);
          }
        } else if (roll <= 5) {
          if (target.experience >= 4) law = true;
        } else if (target.experience >= 5 && state.mortarsRolledByTeam < MAX_MORTARS_PER_TEAM) {
          mortar = true;
          state.mortarsRolledByTeam++;
          grenades = 2 + rng.int(3);
          grenadeClass = MORTAR_GRENADE_CLASS;
        }
      }
      break;
    }
    case SoldierClass.ELITE:
    case SoldierClass.ELITE_MILITIA: {
      const r = clampRating(Rating.BAD_ELITE + modifier);
      weaponClass = helmetClass = vestClass = leggingClass = attachClass = grenadeClass = kitClass = miscClass = r;
      if (chance(rng, 25)) bombClass = r;
      ammoClips = 3 + rng.int(2);
      grenades = 1 + rng.int(3);
      if (r >= Rating.AVERAGE_ELITE && rng.int(100) < 75) {
        attachment = true;
        attachClass = r;
      }
      if (rng.int(2)) knifeClass = r;
      if (r > MIN_EQUIPMENT_CLASS && r < MAX_EQUIPMENT_CLASS) {
        switch (rng.int(11)) {
          case 4:
            weaponClass++;
            vestClass--;
            break;
          case 5:
            weaponClass--;
            vestClass--;
            break;
          case 6:
            vestClass++;
            helmetClass--;
            break;
          case 7:
            grenades += 2;
            break;
          case 8:
            helmetClass++;
            break;
          case 9:
            vestClass++;
            break;
          case 10:
            weaponClass++;
            break;
        }
      }
      if (r >= Rating.GOOD_ELITE && rng.int(100) < 33) {
        const roll = specialRoll();
        if (roll <= 2) {
          launcher = true;
          grenades = 4 + rng.int(4);
        } else if (roll <= 5) law = true;
        else if (state.mortarsRolledByTeam < MAX_MORTARS_PER_TEAM) {
          mortar = true;
          state.mortarsRolledByTeam++;
          grenades = 3 + rng.int(5);
          grenadeClass = MORTAR_GRENADE_CLASS;
        }
      }
      break;
    }
  }
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    const o = inv[slot] as ItemObject;
    if (!(o.flags & ObjectFlags.NO_OVERWRITE)) {
      copyObjectInto(o, emptyObject());
      o.flags |= ObjectFlags.UNDROPPABLE;
      continue;
    }
    switch (classOf(items, o.item)) {
      case ItemClass.GUN:
        if (o.item !== id(items, 'ROCKET_LAUNCHER')) weaponClass *= -1;
        else law = false;
        break;
      case ItemClass.AMMO:
        ammoClips = 0;
        break;
      case ItemClass.BLADE:
      case ItemClass.THROWING_KNIFE:
        knifeClass = 0;
        break;
      case ItemClass.LAUNCHER:
        launcher = false;
        mortar = false;
        break;
      case ItemClass.ARMOUR:
        if (slot === InvSlot.HELMET) helmetClass = 0;
        else if (slot === InvSlot.VEST) vestClass = 0;
        else if (slot === InvSlot.LEGS) leggingClass = 0;
        break;
      case ItemClass.GRENADE:
        grenades = 0;
        grenadeClass = 0;
        break;
      case ItemClass.MEDKIT:
      case ItemClass.KIT:
        kitClass = 0;
        break;
      case ItemClass.MISC:
        miscClass = 0;
        break;
      case ItemClass.BOMB:
        bombClass = 0;
        break;
    }
  }
  if (!isEnemyClass(target.soldierClass)) bombClass = 0;
  chooseWeapon(items, rng, state, target, weaponClass, ammoClips, attachClass, attachment);
  chooseGrenades(items, rng, inv, grenades, grenadeClass, launcher);
  chooseArmour(items, rng, inv, helmetClass, vestClass, leggingClass);
  chooseSpecialWeapons(items, rng, inv, knifeClass, launcher, law, mortar);
  chooseFaceGear(items, rng, state, target, difficulty);
  chooseKits(items, rng, inv, kitClass);
  chooseMisc(items, rng, state, inv, miscClass);
  chooseBombs(items, rng, inv, bombClass);
  if (state.inEnemyHeldTixa) placeObjectInCreateStruct(items, inv, createItem(items, id(items, 'GASMASK'), 95 + rng.int(6)));
  chooseDroppable(items, rng, state, inv, target.soldierClass);
}

export function replaceExtendedGuns(
  items: ItemTable,
  rng: RandomStream,
  state: EquipmentState,
  inv: Inventory,
  soldierClass: number,
): void {
  for (const o of inv) {
    const old = def(items, o.item);
    if (!old?.weapon || !(old.flags & ItemFlags.BIGGUNLIST)) continue;
    let newGun = NOTHING;
    if (soldierClass === SoldierClass.NONE) newGun = old.weapon.standardReplacement ? id(items, old.weapon.standardReplacement) : NOTHING;
    else newGun = selectStandardArmyGun(items, rng, state, weaponClassLevel(items, o.item));
    if (newGun === NOTHING) continue;
    const previous = { ...o, attachments: o.attachments.map((a) => ({ ...a })) };
    copyObjectInto(o, createItem(items, newGun, previous.status[0] ?? 0));
    o.flags = previous.flags;
    let dest = 0;
    for (const a of previous.attachments) {
      if (a.item === NOTHING || !validAttachment(items, a.item, newGun)) continue;
      Object.assign(o.attachments[dest++] as { item: number; status: number }, a);
    }
    for (const ammo of inv) {
      const mag = def(items, ammo.item)?.magazine;
      const newWeapon = def(items, newGun)?.weapon;
      if (!mag || !newWeapon || old.weapon.calibre === 0) continue;
      if (mag.calibre !== old.weapon.calibre || mag.capacity !== old.weapon.magSize) continue;
      const replacement = findReplacementMagazine(items, newWeapon.calibre, newWeapon.magSize, mag.ammoType);
      if (replacement !== NOTHING) copyObjectInto(ammo, createItems(items, replacement, 100, ammo.count));
    }
  }
}
