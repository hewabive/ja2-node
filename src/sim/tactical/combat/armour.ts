// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc CalcBodyImpactReduction, ArmourProtection, TotalArmourProtection, EffectiveArmour,
// @src ArmourPercent; src/externalized/DefaultContentManager.cc loadMaxArmourPerClass.

import { AmmoType, ArmourClass, type ItemTable, NOTHING } from '../../../content/items/items.ts';
import { i8 } from '../../../core/int.ts';
import { deleteObject, type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { InvSlot } from '../inventory.ts';
import type { Soldier } from '../soldier.ts';
import type { RandomStream } from './context.ts';
import { AimShot } from './types.ts';

const BODY_IMPACT_REDUCTION = [0, 15, 30, 23];

function ammoArmourAdjust(value: number, ammo: number): number {
  switch (ammo) {
    case AmmoType.HP:
      return Math.trunc((value * 3) / 2);
    case AmmoType.AP:
    case AmmoType.HEAT:
      return Math.trunc((value * 3) / 4);
    case AmmoType.SUPER_AP:
      return Math.trunc(value / 2);
    default:
      return value;
  }
}

export function calcBodyImpactReduction(ammo: number, location: number): number {
  return ammoArmourAdjust(BODY_IMPACT_REDUCTION[location] ?? 0, ammo);
}

interface StatusRef {
  get(): number;
  set(v: number): void;
}

function armourProtection(items: ItemTable, pre: RandomStream, item: number, status: StatusRef, impact: number, ammo: number): number {
  const armour = items.byIndex.get(item)?.armour;
  if (!armour) return 0;
  let protection = armour.protection;
  const failure = pre.int(100) + 1 - status.get();
  if (failure > 0) {
    protection -= failure;
    if (protection < 0) return 0;
  }
  protection = ammoArmourAdjust(protection, ammo);
  const applied = protection > impact ? impact : armour.protection;
  if (ammo === AmmoType.KNIFE || ammo === AmmoType.SLEEP_DART) {
    if (armour.armourClass === ArmourClass.VEST || armour.armourClass === ArmourClass.LEGGINGS) protection = 0;
  } else if (ammo === AmmoType.MONSTER) {
    status.set(i8(status.get() - Math.trunc((3 * applied * armour.degradePercentage) / 100)));
    protection = Math.trunc(protection / 2);
  }
  status.set(i8(status.get() - Math.trunc((applied * armour.degradePercentage) / 100)));
  return protection;
}

export function findPlatesAttachment(items: ItemTable, o: ItemObject): number {
  return o.attachments.findIndex((a) => items.byIndex.get(a.item)?.armour?.armourClass === ArmourClass.PLATE);
}

export function totalArmourProtection(
  items: ItemTable,
  pre: RandomStream,
  target: Soldier,
  location: number,
  impact: number,
  ammo: number,
): number {
  if (location === AimShot.GLAND) return 0;
  const slot = location === AimShot.HEAD ? InvSlot.HELMET : location === AimShot.LEGS ? InvSlot.LEGS : InvSlot.VEST;
  const armour = target.inv[slot] as ItemObject;
  if (armour.item === NOTHING) return 0;
  let total = 0;
  if (slot === InvSlot.VEST) {
    const plate = findPlatesAttachment(items, armour);
    if (plate !== -1) {
      const attachment = armour.attachments[plate] as { item: number; status: number };
      total += armourProtection(
        items,
        pre,
        attachment.item,
        { get: () => attachment.status, set: (v) => (attachment.status = v) },
        impact,
        ammo,
      );
      if (attachment.status < USABLE_STATUS) {
        attachment.item = NOTHING;
        attachment.status = 0;
      }
    }
  }
  if (impact > total) {
    total += armourProtection(
      items,
      pre,
      armour.item,
      { get: () => armour.status[0] ?? 0, set: (v) => (armour.status[0] = v) },
      impact,
      ammo,
    );
    if ((armour.status[0] ?? 0) < USABLE_STATUS) deleteObject(armour);
  }
  return total;
}

export interface MaxArmour {
  readonly vest: number;
  readonly helmet: number;
  readonly leggings: number;
}

export function maxArmourPerClass(items: ItemTable): MaxArmour {
  const plates = Math.max(
    0,
    ...items.ordered
      .filter((i) => i.armour?.armourClass === ArmourClass.PLATE && !i.armour.ignoreForMaxProtection)
      .map((i) => i.armour?.protection ?? 0),
  );
  const best = (cls: number) =>
    Math.max(
      0,
      ...items.ordered
        .filter((i) => i.armour?.armourClass === cls && !i.armour.ignoreForMaxProtection)
        .map((i) => (i.armour?.protection ?? 0) + (items.rules.plateVests.has(i.index) ? plates : 0)),
    );
  return { vest: best(ArmourClass.VEST), helmet: best(ArmourClass.HELMET), leggings: best(ArmourClass.LEGGINGS) };
}

export function effectiveArmour(items: ItemTable, o: ItemObject): number {
  const armour = items.byIndex.get(o.item)?.armour;
  if (!armour) return 0;
  let value = Math.trunc((armour.protection * (o.status[0] ?? 0)) / 100);
  const plate = findPlatesAttachment(items, o);
  if (plate !== -1) {
    const a = o.attachments[plate] as { item: number; status: number };
    value += Math.trunc(((items.byIndex.get(a.item)?.armour?.protection ?? 0) * a.status) / 100);
  }
  return value;
}

export function armourPercent(items: ItemTable, max: MaxArmour, s: Soldier): number {
  const part = (slot: number, weight: number, maximum: number) =>
    maximum > 0 ? Math.trunc((weight * effectiveArmour(items, s.inv[slot] as ItemObject)) / maximum) : 0;
  return i8(part(InvSlot.HELMET, 15, max.helmet) + part(InvSlot.VEST, 65, max.vest) + part(InvSlot.LEGS, 25, max.leggings));
}
