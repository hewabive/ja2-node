// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc gRepairPassSlotList, IsAnythingAroundForSoldierToRepair, HasCharacterFinishedRepairing,
// @src DoesCharacterHaveAnyItemsToRepair, BasicCanCharacterRepair, CanCharacterRepair, FindRepairableItemOnOtherSoldier,
// @src CanCharacterRepairAnotherSoldiersStuff, CanCharacterRepairRobot, IsRobotInThisSector, CanCharacterRepairVehicle.
// See docs/18 §5.7.

import { NOTHING } from '../../../content/items/items.ts';
import { sameSector } from '../../../content/strategic/sector-ids.ts';
import type { ItemObject } from '../../items/object.ts';
import { AC, areAssignmentConditionsMet, isMechanical } from './conditions.ts';
import { Assignment } from './constants.ts';
import { findObj, isGun, isItemRepairable, kitItems, NO_SLOT, Slot } from './kits.ts';
import type { CrewMember, EconomyContext } from './ports.ts';

export const RepairPass = { HANDS_AND_ARMOR: 0, HEADGEAR: 1, POCKETS: 2 } as const;
export const FINAL_REPAIR_PASS = RepairPass.POCKETS;
export const NO_PASS = -1;

export const REPAIR_PASS_SLOTS: readonly (readonly number[])[] = [
  [Slot.HAND, Slot.SECOND_HAND, Slot.VEST, Slot.HELMET, Slot.LEGS],
  [Slot.HEAD1, Slot.HEAD2],
  [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
];

function objectNeedsRepair(ctx: EconomyContext, o: ItemObject): boolean {
  for (let k = 0; k < o.count; k++) if (isItemRepairable(ctx.items, o.item, o.status[k] ?? 0)) return true;
  return o.attachments.some((a) => a.item !== NOTHING && isItemRepairable(ctx.items, a.item, a.status));
}

function isJammedGun(ctx: EconomyContext, o: ItemObject | undefined): boolean {
  return o !== undefined && isGun(ctx.items, o.item) && o.gunAmmoStatus < 0;
}

export function findRepairableItemOnOtherSoldier(ctx: EconomyContext, s: CrewMember, pass: number): number {
  for (const slot of REPAIR_PASS_SLOTS[pass] ?? []) {
    const o = s.inv[slot];
    if (o && objectNeedsRepair(ctx, o)) return slot;
  }
  return NO_SLOT;
}

export function canCharacterRepairAnotherSoldiersStuff(repairer: CrewMember, other: CrewMember): boolean {
  if (other.id === repairer.id || other.life === 0) return false;
  if (!sameSector(other.sector, repairer.sector) || other.betweenSectors) return false;
  if (
    other.assignment === Assignment.IN_TRANSIT ||
    other.assignment === Assignment.ASSIGNMENT_POW ||
    other.assignment === Assignment.ASSIGNMENT_DEAD ||
    isMechanical(repairer) ||
    repairer.isEpc
  )
    return false;
  return true;
}

export function doesCharacterHaveAnyItemsToRepair(ctx: EconomyContext, s: CrewMember, highestPass: number): boolean {
  for (const o of s.inv) for (let k = 0; k < o.count; k++) if (isJammedGun(ctx, o)) return true;
  for (const o of s.inv) if (objectNeedsRepair(ctx, o)) return true;
  if (highestPass === NO_PASS) return false;
  for (const other of ctx.crew.all()) {
    if (!canCharacterRepairAnotherSoldiersStuff(s, other)) continue;
    for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) if (isJammedGun(ctx, other.inv[slot])) return true;
    for (let pass = RepairPass.HANDS_AND_ARMOR; pass <= highestPass; pass++)
      if (findRepairableItemOnOtherSoldier(ctx, other, pass) !== NO_SLOT) return true;
  }
  return false;
}

export function robotSoldier(ctx: EconomyContext): CrewMember | null {
  return ctx.crew.all().find((m) => m.isRobot) ?? null;
}

export function canCharacterRepairRobot(ctx: EconomyContext, s: CrewMember): boolean {
  const robot = robotSoldier(ctx);
  if (!robot || robot.life === robot.lifeMax) return false;
  return sameSector(robot.sector, s.sector) && !robot.betweenSectors;
}

export function canCharacterRepairVehicle(ctx: EconomyContext, s: CrewMember, vehicle: number): boolean {
  return ctx.hooks.vehicleNeedsRepair(vehicle, s.id);
}

function anyRepairableVehicleHere(ctx: EconomyContext, s: CrewMember): boolean {
  if (s.sector.z !== 0) return false;
  return ctx.state.forces.vehicles.some(
    (v, id) => v.valid && ctx.state.forces.helicopterVehicleId !== id && canCharacterRepairVehicle(ctx, s, id),
  );
}

export function isAnythingAroundForSoldierToRepair(ctx: EconomyContext, s: CrewMember): boolean {
  return (
    doesCharacterHaveAnyItemsToRepair(ctx, s, FINAL_REPAIR_PASS) || canCharacterRepairRobot(ctx, s) || anyRepairableVehicleHere(ctx, s)
  );
}

export function basicCanCharacterRepair(ctx: EconomyContext, s: CrewMember): boolean {
  return s.stats.mechanical > 0 && areAssignmentConditionsMet(ctx, s, AC.UNDERGROUND);
}

export function canCharacterRepair(ctx: EconomyContext, s: CrewMember): boolean {
  if (!basicCanCharacterRepair(ctx, s)) return false;
  if (findObj(s.inv, kitItems(ctx.items).toolKit) === NO_SLOT) return false;
  return isAnythingAroundForSoldierToRepair(ctx, s);
}

export function hasCharacterFinishedRepairing(ctx: EconomyContext, s: CrewMember): boolean {
  if (s.vehicleUnderRepair !== -1) return !canCharacterRepairVehicle(ctx, s, s.vehicleUnderRepair);
  if (s.fixingRobot) return !canCharacterRepairRobot(ctx, s);
  return !doesCharacterHaveAnyItemsToRepair(ctx, s, FINAL_REPAIR_PASS);
}
