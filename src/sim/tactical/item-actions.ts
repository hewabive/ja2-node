// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc SoldierPickupItem, HandleSoldierPickupItem, SoldierGetItemFromWorld,
// @src HandleAutoPlaceFail, ItemPoolOKForPickup, SoldierDropItem, SoldierHandleDropItem, AdjustGridNoForItemPlacement;
// @src Points.cc GetAPsToPickupItem; Handle_UI.cc UIOkForItemPickup;
// @src Soldier_Control.cc PickPickupAnimation, PickDropItemAnimation; Soldier_Ani.cc codes 487, 493;
// @src externalized/Soldier.cc handlePendingAction (MERC_PICKUPITEM); Soldier_Ani.cc code 486 (give); Items.cc ItemIsCool
// @src and SoldierGetItemFromWorld's QUOTE_FOUND_SOMETHING_SPECIAL or BATTLE_SOUND_GOTIT (2026-10-30), its ownership check
// @src timer (2026-10-31), the QUOTE_SPOTTED_SOMETHING_ONE + Random(2) line after LookForHiddenItems found something in
// @src both (the pick on the talk's cosmetic stream, 2026-11-02); GetLargestZLevelOfItemPool (the z-level a pickup
// @src without one takes, 2026-11-02); Turn_Based_Input.cc HandleHandCursorClick (the search of a tile that shows no
// @src item: the morale refusal with QUOTE_REFUSING_ORDER, the AP shown by Handle_UI.cc HandleUIMovementCursor for
// @src MOVEUI_TARGET_ITEMS and no AP check) and HandleSoldierPickupItem's BATTLE_SOUND_NOTHING (2026-11-03);
// @src Interface_Items.cc HandleItemPointerClick (a click next to the merc drops beside him on a tile that is no good
// @src destination or one step away, else at his feet: DROP_ADJACENT_OBJECT turned towards it when standing, else at
// @src once with NotifySoldiersToLookforItems), Soldier_Ani.cc code 763 (2026-11-03); PickPickupAnimation's turn to a
// @src raised or openable structure on his own tile (2026-11-04); SoldierGetItemFromWorld's ContinuePastBoobyTrap stop,
// @src the ACTIVATE_SWITCH_PROMPT box for a SWITCH left on the ground and no GOTIT after the booby-trap quote,
// @src SwitchMessageBoxCallBack (2026-11-04).

import type { OpOutcome } from '../../content/anim/script.ts';
import { type ItemTable, WEAPON_CLASSES } from '../../content/items/items.ts';
import { gunQuoteOf } from '../../content/narrative/quote-speakers.ts';
import { Direction } from '../../content/world/grid.ts';
import {
  has,
  ORIENT_LEFT,
  ORIENT_RIGHT,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
} from '../../content/world/structures.ts';
import { cloneObject, deleteObject, type ItemObject } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import {
  AnimHeight,
  height,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
  soldierGotoStationaryStance,
} from './animation.ts';
import { frequencyOf } from './bombs/bomb-object.ts';
import { setOffBombsByFrequency } from './bombs/bomb-queue.ts';
import { continuePastBoobyTrap } from './booby-traps.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { findAdjacentGridEx } from './combat/melee-reach.ts';
import { apsToMovePlusAction, giveItemOpcode } from './give.ts';
import { autoPlaceObject } from './inventory.ts';
import { directionToward, getNewSoldierPath } from './movement.ts';
import { MercQuote, markQuoteSaid, QuoteSaidFlag, quoteSaid } from './narrative/merc-quotes.ts';
import { schedulePickedOwnershipCheck } from './narrative/minor-offenses.ts';
import { findBestPath, isWater, newOKDestination, PathCopy } from './pathfinding.ts';
import { AP, deductPoints } from './points.ts';
import { StatKind } from './profiles.ts';
import { openTacticalPrompt, type TacticalPrompt, TacticalPromptKind } from './prompts.ts';
import { type PendingPickup, type Soldier, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import { type TacticalState, whoIsThere } from './state.ts';
import {
  addItemToPool,
  FORCE_ON_GROUND,
  itemsAt,
  lookForHiddenItems,
  notifySoldiersToLookForItems,
  removeWorldItem,
  Visibility,
  type WorldItem,
} from './world-items.ts';

const Code = { GIVE_ITEM: 486, DROP_ITEM: 487, PICKUP_ITEM: 493, DROP_BESIDE: 763 } as const;
const ONE_STEP = 1;
const HIDDEN_ITEM_WISDOM_GAIN = 5;
const SPOTTED_SOMETHING_QUOTES = 2;
const COOL_ITEM_MIN_STATUS = 60;
const COOL_WEAPON_MIN_DEADLINESS = 30;
const COOL_ARMOUR_MIN_PROTECTION = 20;

function itemIsCool(items: ItemTable, o: ItemObject): boolean {
  if ((o.status[0] ?? 0) < COOL_ITEM_MIN_STATUS) return false;
  const def = items.byIndex.get(o.item);
  if (!def) return false;
  if (def.itemClass & WEAPON_CLASSES) return (def.weapon?.deadliness ?? 0) >= COOL_WEAPON_MIN_DEADLINESS;
  return (def.armour?.protection ?? 0) >= COOL_ARMOUR_MIN_PROTECTION;
}

function saidFoundSomethingSpecial(t: TacticalState, s: Soldier): boolean {
  if (gunQuoteOf(t.content.quoteSpeakers, s.profile) !== MercQuote.FOUND_SOMETHING_SPECIAL) return false;
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.FOUND_SOMETHING_NICE) return false;
  markQuoteSaid(t, s, QuoteSaidFlag.FOUND_SOMETHING_NICE);
  t.narrative.sayQuote(s, MercQuote.FOUND_SOMETHING_SPECIAL);
  return true;
}

export function itemPlacementBlocked(t: TacticalState, s: Soldier, g: number): boolean {
  const desired = s.level !== 0 ? STRUCTURE_ON_ROOF : STRUCTURE_ON_GROUND;
  const blocked = t.world.structures
    .at(g)
    .some((x) => has(x.flags, StructureFlags.BLOCKSMOVES) && !has(x.flags, StructureFlags.PASSABLE) && x.cubeOffset === desired);
  if (blocked) return true;
  const occupant = whoIsThere(t, g, s.level);
  return occupant !== null && occupant !== s;
}

export function pickupCandidates(t: TacticalState, s: Soldier, g: number, zLevel: number): WorldItem[] {
  return itemsAt(t, g, s.level).filter((wi) => itemPoolOKForPickup(s, wi, zLevel));
}

export const ITEM_IGNORE_Z_LEVEL = -1;
const ON_STRUCTURE_Z_LEVEL = 1;
const FLOOR_Z_LEVEL = 0;
const SEARCH_MIN_MORALE = 30;

export function largestZLevelOfItemPool(t: TacticalState, g: number, level: number): number {
  return itemsAt(t, g, level).some((wi) => wi.zHeight > 0) ? ON_STRUCTURE_Z_LEVEL : FLOOR_Z_LEVEL;
}

export function requestedZLevel(t: TacticalState, s: Soldier, g: number, zLevel: unknown): number {
  if (zLevel === undefined) return largestZLevelOfItemPool(t, g, s.level);
  return zLevel === ON_STRUCTURE_Z_LEVEL ? ON_STRUCTURE_Z_LEVEL : FLOOR_Z_LEVEL;
}

function itemPoolOKForPickup(s: Soldier, wi: WorldItem, zLevel: number): boolean {
  if (s.team === Team.OUR && wi.visible !== Visibility.VISIBLE) return false;
  if (zLevel === ITEM_IGNORE_Z_LEVEL) return true;
  return zLevel === 0 ? wi.zHeight === 0 : wi.zHeight > 0;
}

export function adjustGridNoForItemPlacement(t: TacticalState, s: Soldier, g: number): number {
  if (!itemPlacementBlocked(t, s, g)) return g;
  return findAdjacentGridEx(t, s, g, false)?.actionGridNo ?? g;
}

export function apsToPickupItem(t: TacticalState, s: Soldier, g: number): number {
  if (itemsAt(t, g, s.level).length === 0) return 0;
  return apsToReachItems(t, s, g);
}

export function apsToReachItems(t: TacticalState, s: Soldier, g: number): number {
  return apsToMovePlusAction(t, s, adjustGridNoForItemPlacement(t, s, g), AP.PICKUP_ITEM);
}

export function showsItems(t: TacticalState, s: Soldier, g: number): boolean {
  return pickupCandidates(t, s, g, ITEM_IGNORE_Z_LEVEL).length > 0;
}

export type SearchRefusal = 'refusesOrder' | 'noPath';

export function searchTile(t: TacticalState, s: Soldier, g: number): SearchRefusal | null {
  if (s.morale < SEARCH_MIN_MORALE) {
    t.narrative.sayQuote(s, MercQuote.REFUSING_ORDER);
    return 'refusesOrder';
  }
  if (apsToReachItems(t, s, g) === 0) return 'noPath';
  return soldierPickupItem(t, s, g, FLOOR_Z_LEVEL, null) ? null : 'noPath';
}

export function soldierPickupItem(
  t: TacticalState,
  s: Soldier,
  g: number,
  zLevel: number,
  selection: readonly WorldItem[] | null,
): boolean {
  const actionGridNo = adjustGridNoForItemPlacement(t, s, g);
  s.pendingPickup = { gridNo: g, actionGridNo, zLevel, selection };
  if (s.gridNo === actionGridNo) {
    pickPickupAnimation(t, s, g, zLevel);
    return true;
  }
  if (getNewSoldierPath(t, s, actionGridNo, s.uiMovementMode, s.team === Team.OUR ? 1 : 0, true)) return true;
  s.pendingPickup = null;
  return false;
}

export function handlePendingPickupOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingPickup;
  if (!pending) return false;
  if (pending.actionGridNo !== s.gridNo) {
    s.pendingPickup = null;
    soldierGotoStationaryStance(t, s);
    return true;
  }
  if (!t.inCombat && pending.actionGridNo !== pending.gridNo && newOKDestination(t.pathEnv, s, pending.gridNo, true, s.level))
    return soldierPickupItem(t, s, pending.gridNo, pending.zLevel, pending.selection);
  pickPickupAnimation(t, s, pending.gridNo, pending.zLevel);
  return true;
}

function pickPickupAnimation(t: TacticalState, s: Soldier, g: number, zLevel: number): void {
  if (g !== s.gridNo) {
    s.pendingDirection = directionToward(s.gridNo, g);
    initNewSoldierAnim(t, s, anim(t.content, 'ADJACENT_GET_ITEM'), 0, false);
    if (s.team !== Team.OUR) s.ai.action = AiAction.PENDING_ACTION;
    return;
  }
  if (isWater(t.pathWorld, s.gridNo) || height(t.content, s.state) !== AnimHeight.STAND) {
    handleSoldierPickupItem(t, s);
    soldierGotoStationaryStance(t, s);
    if (s.team !== Team.OUR) t.turnHooks.actionDone(t, s);
    return;
  }
  const raised = zLevel > 0 ? t.world.structures.find(g, StructureFlags.HASITEMONTOP | StructureFlags.OPENABLE) : null;
  if (raised) turnToRaisedItems(t, s, raised);
  initNewSoldierAnim(t, s, anim(t.content, raised ? 'ADJACENT_GET_ITEM' : 'PICKUP_ITEM'), 0, false);
  if (s.team !== Team.OUR) s.ai.action = AiAction.PENDING_ACTION;
}

function turnToRaisedItems(t: TacticalState, s: Soldier, structure: StructureInstance): void {
  let direction = s.direction;
  if (structure.wallOrientation & ORIENT_LEFT) direction = Direction.NORTH;
  else if (structure.wallOrientation & ORIENT_RIGHT) direction = Direction.WEST;
  setDesiredDirection(t, s, direction);
  setSoldierDirection(t, s, direction);
}

function handleSoldierPickupItem(t: TacticalState, s: Soldier): void {
  const pending = s.pendingPickup;
  s.pendingPickup = null;
  if (!pending) return;
  const pool = itemsAt(t, pending.gridNo, s.level);
  if (pool.length === 0) {
    sayNothingFound(t, s, pending.gridNo);
    return;
  }
  if (s.team !== Team.OUR) {
    soldierGetItemFromWorld(t, s, pending);
    return;
  }
  const allHidden = pool.every((wi) => wi.visible === Visibility.HIDDEN_ITEM);
  if (pickupCandidates(t, s, pending.gridNo, pending.zLevel).length > 0) soldierGetItemFromWorld(t, s, pending);
  else if (allHidden && lookForHiddenItems(t, pending.gridNo, s.level)) foundHiddenItems(t, s);
  else sayNothingFound(t, s, pending.gridNo);
}

function sayNothingFound(t: TacticalState, s: Soldier, gridNo: number): void {
  t.events.push({ type: 'nothingFound', soldier: s.id, gridNo });
}

function foundHiddenItems(t: TacticalState, s: Soldier): void {
  statChange(t, s, StatKind.WISDOM, HIDDEN_ITEM_WISDOM_GAIN, StatCause.SUCCESS);
  t.narrative.sayQuote(s, MercQuote.SPOTTED_SOMETHING_ONE + t.narrative.cosmeticPick(SPOTTED_SOMETHING_QUOTES));
}

function askToActivateSwitch(t: TacticalState, s: Soldier, wi: WorldItem): void {
  openTacticalPrompt(t, { kind: TacticalPromptKind.ACTIVATE_SWITCH, soldier: s, frequency: frequencyOf(wi.object) });
}

export function answerActivateSwitch(
  t: TacticalState,
  prompt: Extract<TacticalPrompt, { readonly kind: 'activateSwitch' }>,
  yes: boolean,
): void {
  if (!yes) return;
  t.events.push({ type: 'switchActivated', soldier: prompt.soldier.id });
  setOffBombsByFrequency(t, prompt.soldier, prompt.frequency);
}

function soldierGetItemFromWorld(t: TacticalState, s: Soldier, pending: PendingPickup): void {
  const ctx = soldierInventoryContext(t, s);
  const selected = pending.selection ?? pickupCandidates(t, s, pending.gridNo, pending.zLevel);
  const switchItem = t.content.items.byName.get('SWITCH')?.index;
  let dontCharge = false;
  let cool = false;
  let saidBoobyTrapQuote = false;
  for (const wi of selected) {
    if (!t.worldItems.includes(wi) || !itemPoolOKForPickup(s, wi, pending.zLevel)) continue;
    const trap = continuePastBoobyTrap(t, s, wi, pending.gridNo);
    saidBoobyTrapQuote = trap === 'spotted';
    if (trap !== 'continue') break;
    if (itemIsCool(t.content.items, wi.object)) cool = true;
    if (wi.object.item === switchItem) {
      askToActivateSwitch(t, s, wi);
      continue;
    }
    const copy = cloneObject(wi.object);
    if (autoPlaceObject(ctx, s, copy)) {
      removeWorldItem(t, wi);
      continue;
    }
    Object.assign(wi.object, copy);
    if (s.team === Team.OUR) dontCharge = true;
  }
  const gotIt = s.team === Team.OUR && !(cool && saidFoundSomethingSpecial(t, s)) && !saidBoobyTrapQuote;
  if (s.team === Team.OUR && lookForHiddenItems(t, pending.gridNo, s.level)) foundHiddenItems(t, s);
  if (!dontCharge) deductPoints(t.inCombat, s, AP.PICKUP_ITEM, 0);
  t.events.push({ type: 'itemsPickedUp', soldier: s.id, gridNo: pending.gridNo, ...(gotIt ? { battleSound: 'GOTIT' as const } : {}) });
  schedulePickedOwnershipCheck(t, s, pending.gridNo);
}

export function soldierDropItem(t: TacticalState, s: Soldier, slot: number): void {
  const o = s.inv[slot];
  if (!o) return;
  const dropped = cloneObject(o);
  deleteObject(o);
  soldierDropObject(t, s, dropped);
}

export function soldierDropObject(t: TacticalState, s: Soldier, o: ItemObject): void {
  s.tempObject = o;
  if (height(t.content, s.state) === AnimHeight.STAND) initNewSoldierAnim(t, s, anim(t.content, 'DROP_ITEM'), 0, false);
  else {
    soldierHandleDropItem(t, s);
    soldierGotoStationaryStance(t, s);
  }
}

function soldierHandleDropItem(t: TacticalState, s: Soldier): void {
  const o = s.tempObject;
  if (!o) return;
  s.tempObject = null;
  addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level, 0, FORCE_ON_GROUND);
  notifySoldiersToLookForItems(t);
  t.events.push({ type: 'itemDropped', soldier: s.id, gridNo: s.gridNo });
}

export function dropsBeside(t: TacticalState, s: Soldier, g: number): boolean {
  if (g === s.gridNo) return false;
  return (
    !newOKDestination(t.pathEnv, s, g, false, s.level) ||
    findBestPath(t.pathEnv, s, g, s.level, { copy: PathCopy.NONE }).length === ONE_STEP
  );
}

function putBeside(t: TacticalState, s: Soldier, o: ItemObject, g: number): void {
  addItemToPool(t, g, o, Visibility.VISIBLE, s.level, 0, FORCE_ON_GROUND);
  notifySoldiersToLookForItems(t);
  t.events.push({ type: 'itemDropped', soldier: s.id, gridNo: g, beside: true });
}

export function soldierDropObjectBeside(t: TacticalState, s: Soldier, o: ItemObject, g: number): void {
  if (height(t.content, s.state) !== AnimHeight.STAND) {
    putBeside(t, s, o, g);
    return;
  }
  s.tempObject = o;
  s.pendingActionData2 = g;
  s.reverse = false;
  setDesiredDirection(t, s, directionToward(s.gridNo, g));
  initNewSoldierAnim(t, s, anim(t.content, 'DROP_ADJACENT_OBJECT'), 0, false);
}

function soldierHandleDropItemBeside(t: TacticalState, s: Soldier): void {
  const o = s.tempObject;
  if (!o) return;
  s.tempObject = null;
  putBeside(t, s, o, s.pendingActionData2);
}

export function itemOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code === Code.GIVE_ITEM) {
    giveItemOpcode(t, s);
    return 'continue';
  }
  if (code === Code.DROP_ITEM) {
    soldierHandleDropItem(t, s);
    return 'continue';
  }
  if (code === Code.DROP_BESIDE) {
    soldierHandleDropItemBeside(t, s);
    return 'continue';
  }
  if (code === Code.PICKUP_ITEM) {
    handleSoldierPickupItem(t, s);
    return 'continue';
  }
  return null;
}
