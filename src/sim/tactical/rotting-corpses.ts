// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc AddRottingCorpse (aging), IsValidDecapitationCorpse, GetCorpseAtGridNo,
// @src DecapitateCorpse; GetFreeRottingCorpse, RemoveCorpse, RemoveCorpses and the gRottingCorpse slots (2026-11-01);
// @src AddCrowToCorpse (the crow's link and bNumServicingCrows), HandleCrowLeave (2026-11-01).

import { NO_CORPSE } from '../../content/anim/corpses.ts';
import { StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { i8, idiv, u32 } from '../../core/int.ts';
import { createItem } from '../items/object.ts';
import { addCorpseStructure, type Corpse, corpseOfStructure } from './combat/death.ts';
import { worldSeconds } from './explosions/state.ts';
import { Profile } from './narrative/constants.ts';
import { Body, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, notifySoldiersToLookForItems, Visibility } from './world-items.ts';

export const ROTTING_STAGE2 = 44;
const LAST_FRESH_MERC_CORPSE = 24;
const DELAY_UNTIL_ROTTING_MINUTES = 1440;
const DELAY_UNTIL_DONE_ROTTING_MINUTES = 3 * 1440;
const SECONDS_PER_MINUTE = 60;
const MAX_ROTTING_CORPSES = 100;
const HEAD_STATUS = 100;
const HEAD_LEVEL = 0;
const HEAD_FLAGS = 0;
const HEAD_Z_HEIGHT = 0;
const DEFAULT_HEAD = 'HEAD_1';
const HEADS_OF_PROFILES: Readonly<Record<number, string>> = {
  [Profile.CHRIS]: 'HEAD_2',
  [Profile.T_REX]: 'HEAD_3',
  [Profile.SLAY]: 'HEAD_4',
  [Profile.DRUGGIST]: 'HEAD_5',
  [Profile.ANNIE]: 'HEAD_6',
  [Profile.TIFFANY]: 'HEAD_7',
};

export function agedCorpse(corpse: Corpse, nowMinute: number, loadingSave: boolean): Corpse | null {
  if (loadingSave) return corpse;
  const age = u32(nowMinute - corpse.timeOfDeath);
  if (age > DELAY_UNTIL_DONE_ROTTING_MINUTES) return null;
  if (age > DELAY_UNTIL_ROTTING_MINUTES && corpse.type < ROTTING_STAGE2 && corpse.type <= LAST_FRESH_MERC_CORPSE)
    return { ...corpse, type: ROTTING_STAGE2 };
  return corpse;
}

export interface CorpseAging {
  readonly nowMinute: number;
  readonly loadingSave: boolean;
}

export function rottingCorpseSlots(t: TacticalState): number {
  return t.corpses.length + t.corpseHoles.length;
}

function holesBelow(t: TacticalState, slot: number): number {
  return t.corpseHoles.filter((hole) => hole < slot).length;
}

export function corpseInSlot(t: TacticalState, slot: number): Corpse | null {
  if (t.corpseHoles.includes(slot)) return null;
  return t.corpses[slot - holesBelow(t, slot)] ?? null;
}

function slotOfCorpseAt(t: TacticalState, index: number): number {
  let slot = index;
  for (const hole of t.corpseHoles) if (hole <= slot) slot++;
  return slot;
}

function freeSlot(t: TacticalState): number | null {
  const hole = t.corpseHoles[0];
  if (hole !== undefined) return hole;
  const appended = rottingCorpseSlots(t);
  if (appended >= MAX_ROTTING_CORPSES) return null;
  t.corpseHoles.push(appended);
  return appended;
}

function activateSlot(t: TacticalState, slot: number, corpse: Corpse): void {
  t.corpseHoles.splice(t.corpseHoles.indexOf(slot), 1);
  t.corpses.splice(slot - holesBelow(t, slot), 0, corpse);
}

export function addRottingCorpse(t: TacticalState, corpse: Corpse, aging: CorpseAging): Corpse | null {
  const slot = freeSlot(t);
  if (slot === null) return null;
  const added = agedCorpse(corpse, aging.nowMinute, aging.loadingSave);
  if (!added) return null;
  activateSlot(t, slot, added);
  addCorpseStructure(t, added.gridNo, added.level, added.type, added.direction);
  return added;
}

export function removeRottingCorpse(t: TacticalState, corpse: Corpse, base: StructureInstance): void {
  const index = t.corpses.indexOf(corpse);
  const slot = slotOfCorpseAt(t, index);
  t.corpses.splice(index, 1);
  t.corpseHoles.push(slot);
  t.corpseHoles.sort((a, b) => a - b);
  t.world.structures.remove(base);
}

export function removeAllCorpses(t: TacticalState): void {
  t.corpses.length = 0;
  t.corpseHoles.length = 0;
}

export function nowMinuteOf(t: TacticalState): number {
  return idiv(worldSeconds(t), SECONDS_PER_MINUTE);
}

function corpseBaseAt(t: TacticalState, g: number): StructureInstance | null {
  const structure = t.world.structures.find(g, StructureFlags.CORPSE);
  return structure ? t.world.structures.findBase(structure) : null;
}

export function corpseAt(t: TacticalState, g: number): Corpse | null {
  const base = corpseBaseAt(t, g);
  return base ? corpseOfStructure(t, base) : null;
}

export function isValidDecapitationCorpse(t: TacticalState, c: Corpse): boolean {
  return !c.headTaken && t.content.corpses.table.validForDecapitation[c.type] === 1;
}

function replaceCorpse(t: TacticalState, corpse: Corpse, base: StructureInstance, replacement: Corpse): void {
  removeRottingCorpse(t, corpse, base);
  addRottingCorpse(t, replacement, { nowMinute: nowMinuteOf(t), loadingSave: false });
}

function markHeadTaken(t: TacticalState, corpse: Corpse): void {
  t.corpses[t.corpses.indexOf(corpse)] = { ...corpse, headTaken: true };
}

function withServicingCrows(t: TacticalState, corpse: Corpse, servicingCrows: number): void {
  t.corpses[t.corpses.indexOf(corpse)] = { ...corpse, servicingCrows };
}

export function linkCrowToCorpse(t: TacticalState, crow: Soldier, slot: number): void {
  const corpse = corpseInSlot(t, slot);
  if (!corpse) return;
  crow.pendingActionData1 = slot;
  crow.pendingActionData2 = corpse.gridNo;
  withServicingCrows(t, corpse, i8(corpse.servicingCrows + 1));
}

export function handleCrowLeave(t: TacticalState, s: Soldier): void {
  if (s.bodyType !== Body.CROW) return;
  const corpse = corpseInSlot(t, s.pendingActionData1);
  if (!corpse || s.pendingActionData2 !== corpse.gridNo) return;
  withServicingCrows(t, corpse, Math.max(0, i8(corpse.servicingCrows - 1)));
}

function headOf(t: TacticalState, profile: number): number {
  const name = HEADS_OF_PROFILES[profile] ?? DEFAULT_HEAD;
  return t.content.items.byName.get(name)?.index ?? 0;
}

export function decapitateCorpse(t: TacticalState, g: number): void {
  const base = corpseBaseAt(t, g);
  const corpse = base ? corpseOfStructure(t, base) : null;
  if (!base || !corpse || !isValidDecapitationCorpse(t, corpse)) return;
  const headless = t.content.corpses.table.decapitated[corpse.type] ?? NO_CORPSE;
  if (headless !== NO_CORPSE) replaceCorpse(t, corpse, base, { ...corpse, type: headless });
  else markHeadTaken(t, corpse);
  const head = createItem(t.content.items, headOf(t, corpse.profile), HEAD_STATUS);
  addItemToPool(t, g, head, Visibility.INVISIBLE, HEAD_LEVEL, HEAD_FLAGS, HEAD_Z_HEIGHT);
  notifySoldiersToLookForItems(t);
}
