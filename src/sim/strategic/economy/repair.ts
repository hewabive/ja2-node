// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc HandleRepairmenInSector, DoActualRepair, DoRepair, RepairObject, HandleRepairBySoldier,
// @src RepairItemsOnOthers, UnjamGunsOnSoldier, HandleRepairOfRobotBySoldier, RepairRobot. See docs/18 §5.7.

import { NOTHING } from '../../../content/items/items.ts';
import { sameSector } from '../../../content/strategic/sector-ids.ts';
import { i8, idiv, u8, u16 } from '../../../core/int.ts';
import type { ItemObject } from '../../items/object.ts';
import { CompressionStop, stopTimeCompression } from '../time/world-clock.ts';
import { assignmentAborted, assignmentDone } from './assignment-done.ts';
import { enoughTimeOnAssignment } from './conditions.ts';
import { Assignment, SkillTrait, StatAmt, StatCause } from './constants.ts';
import {
  FULL_STATUS,
  findObj,
  isElectronic,
  isGun,
  isItemRepairable,
  kitItems,
  makeSureToolKitIsInHand,
  NO_SLOT,
  Slot,
  useKitPoints,
} from './kits.ts';
import { calculateRepairPointsForRepairman, countTraits } from './points.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import {
  canCharacterRepair,
  canCharacterRepairAnotherSoldiersStuff,
  canCharacterRepairRobot,
  canCharacterRepairVehicle,
  doesCharacterHaveAnyItemsToRepair,
  FINAL_REPAIR_PASS,
  findRepairableItemOnOtherSoldier,
  hasCharacterFinishedRepairing,
  NO_PASS,
  RepairPass,
  robotSoldier,
} from './repair-rules.ts';

const REPAIR_COST_PER_JAM = 2;
const UNJAM_STAT_CHANCES = 5;
const MIN_REPAIR_COST_ADJUSTMENT = 10;
const REPAIR_EASE_PERCENT = 10;
const ELECTRONICS_PENALTY_FACTOR = 2;
const TOOLKIT_WEAR_PER_POINT = 5;
const ROBOT_REPAIR_DIVISOR = 2;
const STAT_CHANCE_DIVISOR = 2;

interface Budget {
  left: number;
}

function hasElectronics(s: CrewMember): boolean {
  return countTraits(s.skillTraits, SkillTrait.ELECTRONICS) > 0;
}

export function repairCostAdjustment(ctx: EconomyContext, repairer: CrewMember, item: number): number {
  let adjust = 100 - REPAIR_EASE_PERCENT * (ctx.items.byIndex.get(item)?.repairEase ?? 0);
  if (adjust < MIN_REPAIR_COST_ADJUSTMENT) adjust = MIN_REPAIR_COST_ADJUSTMENT;
  if (isElectronic(ctx.items, item) && !hasElectronics(repairer)) adjust *= ELECTRONICS_PENALTY_FACTOR;
  return adjust;
}

export function doActualRepair(ctx: EconomyContext, repairer: CrewMember, item: number, status: number, budget: Budget): number {
  const adjust = repairCostAdjustment(ctx, repairer, item);
  const damage = u16(idiv(u16(FULL_STATUS - status) * adjust, 100));
  if (budget.left >= damage) {
    budget.left = u8(budget.left - damage);
    return FULL_STATUS;
  }
  const fixed = u16(idiv(budget.left * 100, adjust));
  let result = status;
  if (fixed > 0) {
    result = i8(status + fixed);
    if (result > FULL_STATUS) result = FULL_STATUS;
  }
  budget.left = 0;
  return result;
}

function doRepair(
  ctx: EconomyContext,
  repairer: CrewMember,
  owner: CrewMember,
  item: number,
  status: number,
  budget: Budget,
): number | null {
  if (!isItemRepairable(ctx.items, item, status)) return null;
  const repaired = doActualRepair(ctx, repairer, item, status, budget);
  if (repaired === FULL_STATUS) ctx.events.push({ type: 'itemRepaired', repairer: repairer.id, owner: owner.id, item });
  return repaired;
}

export function repairObject(ctx: EconomyContext, repairer: CrewMember, owner: CrewMember, o: ItemObject, budget: Budget): boolean {
  let repaired = false;
  const count = o.count;
  for (let k = 0; k < count; k++) {
    const status = doRepair(ctx, repairer, owner, o.item, o.status[k] ?? 0, budget);
    if (status === null) continue;
    o.status[k] = status;
    repaired = true;
    if (budget.left === 0) break;
  }
  for (const a of o.attachments) {
    if (a.item === NOTHING) continue;
    const status = doRepair(ctx, repairer, owner, a.item, a.status, budget);
    if (status === null) continue;
    a.status = status;
    repaired = true;
    if (budget.left === 0) break;
  }
  return repaired;
}

export function unjamGunsOnSoldier(ctx: EconomyContext, owner: CrewMember, repairer: CrewMember, budget: Budget): boolean {
  let unjammed = false;
  for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) {
    const o = owner.inv[slot];
    if (!o || !isGun(ctx.items, o.item) || o.gunAmmoStatus >= 0) continue;
    if (budget.left < REPAIR_COST_PER_JAM) break;
    budget.left = u8(budget.left - REPAIR_COST_PER_JAM);
    o.gunAmmoStatus = i8(-o.gunAmmoStatus);
    ctx.crew.statChange(repairer.id, StatAmt.MECHANICAL, UNJAM_STAT_CHANCES, StatCause.SUCCESS);
    ctx.crew.statChange(repairer.id, StatAmt.DEXTERITY, UNJAM_STAT_CHANCES, StatCause.SUCCESS);
    ctx.events.push({ type: 'gunUnjammed', repairer: repairer.id, owner: owner.id, item: o.item });
    unjammed = true;
  }
  return unjammed;
}

function bestOtherSoldierToRepair(ctx: EconomyContext, repairer: CrewMember, pass: number): CrewMember | null {
  let best: CrewMember | null = null;
  let bestPriority = -1;
  for (const other of ctx.crew.all()) {
    if (!canCharacterRepairAnotherSoldiersStuff(repairer, other)) continue;
    if (findRepairableItemOnOtherSoldier(ctx, other, pass) === NO_SLOT) continue;
    if (other.stats.expLevel > bestPriority) {
      bestPriority = other.stats.expLevel;
      best = other;
    }
  }
  return best;
}

export function repairItemsOnOthers(ctx: EconomyContext, repairer: CrewMember, budget: Budget): void {
  for (let pass = RepairPass.HANDS_AND_ARMOR; pass <= FINAL_REPAIR_PASS; pass++) {
    let repairedThisPass = false;
    for (const other of ctx.crew.all())
      if (canCharacterRepairAnotherSoldiersStuff(repairer, other) && unjamGunsOnSoldier(ctx, other, repairer, budget))
        repairedThisPass = true;
    while (budget.left > 0) {
      const best = bestOtherSoldierToRepair(ctx, repairer, pass);
      if (!best) break;
      let slot: number;
      do {
        slot = findRepairableItemOnOtherSoldier(ctx, best, pass);
        if (slot !== NO_SLOT && repairObject(ctx, repairer, best, best.inv[slot] as ItemObject, budget)) repairedThisPass = true;
      } while (slot !== NO_SLOT && budget.left > 0);
    }
    if (repairedThisPass && !doesCharacterHaveAnyItemsToRepair(ctx, repairer, pass))
      stopTimeCompression(ctx.clock, CompressionStop.ASSIGNMENT_DONE);
  }
}

function repairRobot(robot: CrewMember, points: number): number {
  if (robot.life === 0 || robot.life === robot.lifeMax) return 0;
  if (robot.life + points >= robot.lifeMax) {
    const used = robot.lifeMax - robot.life;
    robot.life = robot.lifeMax;
    return u8(used);
  }
  robot.life = i8(robot.life + points);
  return points;
}

function repairOwnItems(ctx: EconomyContext, s: CrewMember, budget: Budget): void {
  let ownFixed = unjamGunsOnSoldier(ctx, s, s, budget);
  const ranges: readonly (readonly [number, number])[] = [
    [Slot.SECOND_HAND, Slot.SMALLPOCK8],
    [Slot.HELMET, Slot.HEAD2],
  ];
  for (const [start, end] of ranges) {
    for (let slot = start; slot <= end; slot++) {
      const o = s.inv[slot];
      if (!o || !repairObject(ctx, s, s, o, budget)) continue;
      ownFixed = true;
      if (budget.left === 0) break;
    }
  }
  if (ownFixed && !doesCharacterHaveAnyItemsToRepair(ctx, s, NO_PASS)) stopTimeCompression(ctx.clock, CompressionStop.ASSIGNMENT_DONE);
  repairItemsOnOthers(ctx, s, budget);
}

export function handleRepairBySoldier(ctx: EconomyContext, s: CrewMember): void {
  const kits = kitItems(ctx.items);
  let initial = calculateRepairPointsForRepairman(s, kits, true).points;
  if (initial === 0) {
    assignmentDone(ctx, s, true, true);
    return;
  }
  const budget: Budget = { left: initial };
  if (s.vehicleUnderRepair !== -1) {
    if (canCharacterRepairVehicle(ctx, s, s.vehicleUnderRepair))
      budget.left = u8(budget.left - ctx.hooks.repairVehicle(s.vehicleUnderRepair, budget.left));
  } else if (s.fixingRobot) {
    const robot = robotSoldier(ctx);
    if (robot && canCharacterRepairRobot(ctx, s)) {
      budget.left = idiv(budget.left, ROBOT_REPAIR_DIVISOR);
      initial = idiv(initial, ROBOT_REPAIR_DIVISOR);
      if (!hasElectronics(s)) {
        budget.left = idiv(budget.left, ROBOT_REPAIR_DIVISOR);
        initial = idiv(initial, ROBOT_REPAIR_DIVISOR);
      }
      budget.left = u8(budget.left - repairRobot(robot, budget.left));
    }
  } else repairOwnItems(ctx, s, budget);
  const used = u8(initial - budget.left);
  if (used > 0) {
    ctx.crew.statChange(s.id, StatAmt.MECHANICAL, idiv(used, STAT_CHANCE_DIVISOR), StatCause.SUCCESS);
    ctx.crew.statChange(s.id, StatAmt.DEXTERITY, idiv(used, STAT_CHANCE_DIVISOR), StatCause.SUCCESS);
    if (ctx.random.int(100) < used * TOOLKIT_WEAR_PER_POINT) {
      const hand = s.inv[Slot.HAND];
      if (hand) useKitPoints(hand, 1);
    }
  }
  if (hasCharacterFinishedRepairing(ctx, s)) assignmentDone(ctx, s, true, true);
  else if (used === 0) {
    if (findObj(s.inv, kits.toolKit) === NO_SLOT) assignmentAborted(ctx, s, 'noToolkits');
    else assignmentAborted(ctx, s, 'insufficientRepairSkill');
  }
}

export function handleRepairmenInSector(
  ctx: EconomyContext,
  sector: { x: number; y: number; z: number },
  sleptPastHour: ReadonlySet<number>,
): void {
  const kits = kitItems(ctx.items);
  for (const s of ctx.crew.all()) {
    if (!sameSector(s.sector, sector) || s.assignment !== Assignment.REPAIR || sleptPastHour.has(s.id)) continue;
    makeSureToolKitIsInHand(s.inv, kits);
    if (!canCharacterRepair(ctx, s) || !enoughTimeOnAssignment(ctx, s)) continue;
    handleRepairBySoldier(ctx, s);
  }
}
