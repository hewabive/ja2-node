// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.h PANIC_BOMBS_HERE, PANIC_TRIGGERS_HERE, NUM_PANIC_TRIGGERS and the panic fields of
// @src TacticalStatusType (fPanicFlags, the_chosen_one, ubArmyGuysKilled, sPanicTriggerGridNo, bPanicTriggerIsAlarm,
// @src ubPanicTolerance); Overhead.cc InitializeTacticalStatusAtBattleStart (their values at a sector entry);
// @src TacticalAI/PanicButtons.cc PercentEnemiesKilled, InitPanicSystem, ClosestPanicTrigger,
// @src NeedToRadioAboutPanicTrigger and the bHasKeys stack of MakeClosestEnemyChosenOne; Tactical/World_Items.cc
// @src FindPanicBombsAndTriggers; Tactical/Soldier_Control.cc SoldierCollapse (the chosen one replaced).

import { DIRECTION_INCREMENT, Direction, pythSpacesAway } from '../../../content/world/grid.ts';
import { ORIENT_LEFT, StructureFlags } from '../../../content/world/structures.ts';
import { i8, idiv } from '../../../core/int.ts';
import { ObjectFlags } from '../../items/object.ts';
import { frequencyOf, PANIC_FREQUENCIES, toleranceOf } from '../bombs/bomb-object.ts';
import { Profile, TIXA_SECTOR } from '../narrative/constants.ts';
import { NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { WorldItem } from '../world-items.ts';

export const PanicFlags = { BOMBS_HERE: 0x01, TRIGGERS_HERE: 0x02 } as const;
export const NUM_PANIC_TRIGGERS = 3;
export const NO_PANIC_TRIGGER = -1;
export const FIRST_PANIC_TRIGGER = 0;

const FAR_AWAY = 1000;
const PERCENT = 100;

export interface PanicTrigger {
  gridNo: number;
  isAlarm: boolean;
  tolerance: number;
}

export interface PanicState {
  flags: number;
  readonly triggers: PanicTrigger[];
  chosenOne: Soldier | null;
  armyGuysKilled: number;
}

function noPanicTrigger(): PanicTrigger {
  return { gridNo: NOWHERE, isAlarm: false, tolerance: 0 };
}

export function createPanicState(): PanicState {
  return {
    flags: 0,
    triggers: Array.from({ length: NUM_PANIC_TRIGGERS }, noPanicTrigger),
    chosenOne: null,
    armyGuysKilled: 0,
  };
}

export function panicTrigger(t: TacticalState, index: number): PanicTrigger {
  return t.panic.triggers[index] ?? noPanicTrigger();
}

export function hasPanicTriggers(t: TacticalState): boolean {
  return (t.panic.flags & PanicFlags.TRIGGERS_HERE) !== 0;
}

function inTixa(t: TacticalState): boolean {
  const sector = t.sector;
  return sector !== null && sector.x === TIXA_SECTOR.x && sector.y === TIXA_SECTOR.y && sector.z === 0;
}

export function mayUsePanicButtons(t: TacticalState, s: Soldier): boolean {
  return inTixa(t) ? s.profile === Profile.WARDEN : s.team === Team.ENEMY;
}

export function pushPanicKeys(s: Soldier): void {
  s.hasKeys = i8((s.hasKeys << 1) | 1);
}

export function popPanicKeys(s: Soldier): void {
  s.hasKeys = i8(s.hasKeys >> 1);
}

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

function switchTriggerGridNo(t: TacticalState, item: WorldItem): number {
  const switchStructure = t.world.structures.find(item.gridNo, StructureFlags.SWITCH);
  if (!switchStructure) return item.gridNo;
  const side = switchStructure.wallOrientation & ORIENT_LEFT ? Direction.SOUTH : Direction.EAST;
  return item.gridNo + (DIRECTION_INCREMENT[side] ?? 0);
}

export function findPanicBombsAndTriggers(t: TacticalState): void {
  const panic = t.panic;
  for (const slot of t.worldBombs) {
    if (!slot.exists) continue;
    const o = slot.item.object;
    const index = PANIC_FREQUENCIES.indexOf(frequencyOf(o));
    if (index === NO_PANIC_TRIGGER) continue;
    if (o.item !== itemIndex(t, 'SWITCH')) {
      panic.flags |= PanicFlags.BOMBS_HERE;
      continue;
    }
    const trigger = panicTrigger(t, index);
    panic.flags |= PanicFlags.TRIGGERS_HERE;
    trigger.gridNo = switchTriggerGridNo(t, slot.item);
    trigger.tolerance = toleranceOf(o);
    if (o.flags & ObjectFlags.ALARM_TRIGGER) trigger.isAlarm = true;
    if (index + 1 === NUM_PANIC_TRIGGERS) return;
  }
}

export function initPanicSystem(t: TacticalState): void {
  t.panic.chosenOne = null;
  findPanicBombsAndTriggers(t);
}

function armyInSector(t: TacticalState): number {
  let n = 0;
  for (const s of t.mercSlots) if ((s.placed || s.offMap) && s.team === Team.ENEMY && !s.dead) n++;
  return n;
}

export function percentEnemiesKilled(t: TacticalState): number {
  const killed = t.panic.armyGuysKilled;
  const total = armyInSector(t) + killed;
  return total === 0 ? 0 : idiv(PERCENT * killed, total);
}

export function closestPanicTrigger(t: TacticalState, s: Soldier): number {
  if (!mayUsePanicButtons(t, s)) return NO_PANIC_TRIGGER;
  const killed = percentEnemiesKilled(t);
  const tixa = inTixa(t);
  let closest = NO_PANIC_TRIGGER;
  let closestDistance = FAR_AWAY;
  for (let k = 0; k < NUM_PANIC_TRIGGERS; k++) {
    const trigger = panicTrigger(t, k);
    if (trigger.gridNo === NOWHERE || trigger.tolerance > killed) continue;
    if (tixa && k > 0 && panicTrigger(t, k - 1).gridNo !== NOWHERE) break;
    const distance = pythSpacesAway(s.gridNo, trigger.gridNo);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = k;
    }
  }
  return closest;
}

function soldierOfProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s): s is Soldier => s?.placed === true && s.profile === profile) ?? null;
}

export function needToRadioAboutPanicTrigger(t: TacticalState): boolean {
  const panic = t.panic;
  if (!hasPanicTriggers(t) || panic.chosenOne !== null) return false;
  if (inTixa(t)) {
    const warden = soldierOfProfile(t, Profile.WARDEN);
    if (!warden || warden === panic.chosenOne) return false;
  } else if (armyInSector(t) <= 0) return false;
  const killed = percentEnemiesKilled(t);
  return panic.triggers.some((trigger) => trigger.gridNo !== NOWHERE && killed >= trigger.tolerance);
}

export function replaceCollapsedChosenOne(t: TacticalState, s: Soldier): void {
  const index = closestPanicTrigger(t, s);
  if (index === NO_PANIC_TRIGGER || panicTrigger(t, index).isAlarm || t.panic.chosenOne !== s) return;
  t.panic.chosenOne = null;
  t.turnHooks.makeClosestEnemyChosenOne(t);
}
