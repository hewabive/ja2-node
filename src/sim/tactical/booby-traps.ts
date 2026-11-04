// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc ContinuePastBoobyTrap, SetOffBoobyTrap, BoobyTrapDialogueCallBack,
// @src BoobyTrapMessageBoxCallBack; Dialogue_Control.cc SetStopTimeQuoteCallback; the buried bomb under a blue flag of
// @src HandleSoldierPickupItem and BoobyTrapMessageBoxCallBack (gfDisarmingBuriedBomb), RemoveBlueFlagDialogueCallBack
// @src (2026-11-04).

import { i8, i16 } from '../../core/int.ts';
import { cloneObject, createItem, type ItemObject, ObjectFlags } from '../items/object.ts';
import { actionValueOf, bombItemOf, bombOwnerIdOf, bombStatusOf, ItemAction } from './bombs/bomb-object.ts';
import { setOffBombsInGridNo } from './bombs/bomb-queue.ts';
import { removeBlueFlag } from './bombs/mine-flags.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { calcTrapDetectLevel, SkillCheckReason, skillCheck } from './combat/skill-check.ts';
import { igniteExplosion } from './explosions/explosion.ts';
import { autoPlaceObject } from './inventory.ts';
import { MercQuote } from './narrative/merc-quotes.ts';
import { StopTimeCallback } from './narrative/port.ts';
import { StatKind } from './profiles.ts';
import { openTacticalPrompt, TacticalPromptKind } from './prompts.ts';
import { type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, removeWorldItem, Visibility, type WorldItem } from './world-items.ts';

export type BoobyTrapCheck = 'continue' | 'stopped' | 'spotted';

const FOUND_GAIN_PER_DIFFICULTY = 3;
const DISARMED_GAIN_PER_DIFFICULTY = 6;
const FAILED_GAIN_PER_DIFFICULTY = 3;
const GROUND_LEVEL = 0;
const DUG_UP_TRIGGER_STATUS_SPREAD = 9;

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

function rememberBoobyTrap(t: TacticalState, s: Soldier, wi: WorldItem, gridNo: number, buried = false): void {
  Object.assign(t.boobyTrap, { soldier: s, item: wi, gridNo, level: s.level, buried, difficulty: wi.object.trap });
}

export function askToDisarmBuriedBomb(t: TacticalState, s: Soldier, bomb: WorldItem, gridNo: number): void {
  rememberBoobyTrap(t, s, bomb, gridNo, true);
  openTacticalPrompt(t, { kind: TacticalPromptKind.DISARM_TRAP });
}

export function boobyTrapDialogueCallBack(t: TacticalState): void {
  t.boobyTrap.justFound = true;
  openTacticalPrompt(t, { kind: TacticalPromptKind.DISARM_TRAP });
}

function warnAboutBoobyTrap(t: TacticalState, s: Soldier): void {
  if (!t.narrative.sayStopTimeQuote(s, MercQuote.BOOBYTRAP_ITEM, StopTimeCallback.BOOBY_TRAP)) boobyTrapDialogueCallBack(t);
}

export function setOffBoobyTrap(t: TacticalState): void {
  const wi = t.boobyTrap.item;
  t.boobyTrap.item = null;
  if (!wi) return;
  const z = i16((t.world.level.heights[wi.gridNo] ?? 0) + wi.zHeight);
  igniteExplosion(t, null, z, wi.gridNo, itemIndex(t, 'MINI_GRENADE'), GROUND_LEVEL);
  removeWorldItem(t, wi);
}

export function continuePastBoobyTrap(t: TacticalState, s: Soldier, wi: WorldItem, gridNo: number): BoobyTrapCheck {
  const o = wi.object;
  if (o.trap <= 0 || s.team !== Team.OUR) return 'continue';
  const known = (o.flags & ObjectFlags.KNOWN_TO_BE_TRAPPED) !== 0;
  if (!known && calcTrapDetectLevel(t, s, false) >= o.trap) {
    o.flags |= ObjectFlags.KNOWN_TO_BE_TRAPPED;
    rememberBoobyTrap(t, s, wi, gridNo);
    t.events.push({ type: 'trapSpotted', soldier: s.id, gridNo, kind: 'item' });
    warnAboutBoobyTrap(t, s);
    return 'spotted';
  }
  t.boobyTrap.item = wi;
  if (known) {
    rememberBoobyTrap(t, s, wi, gridNo);
    openTacticalPrompt(t, { kind: TacticalPromptKind.DISARM_TRAP });
  } else {
    t.events.push({ type: 'trapSetOff', soldier: s.id, gridNo });
    setOffBoobyTrap(t);
  }
  return 'stopped';
}

function placedByOurTeam(owner: number | null): boolean {
  const first = TEAM_FIRST_ID[Team.OUR];
  return owner !== null && owner >= first && owner < first + TEAM_SIZES[Team.OUR];
}

function untrapped(o: ItemObject): ItemObject {
  o.trap = 0;
  o.flags &= ~ObjectFlags.KNOWN_TO_BE_TRAPPED;
  return o;
}

function dugUpTriggerStatus(t: TacticalState): number {
  return i8(1 + t.rng.int(DUG_UP_TRIGGER_STATUS_SPREAD));
}

function dugUp(t: TacticalState, o: ItemObject): ItemObject {
  const items = t.content.items;
  if (o.item === itemIndex(t, 'SWITCH')) return createItem(items, itemIndex(t, 'REMOTEBOMBTRIGGER'), dugUpTriggerStatus(t));
  if (o.item === itemIndex(t, 'ACTION_ITEM') && actionValueOf(o) !== ItemAction.BLOW_UP)
    return createItem(items, itemIndex(t, 'DETONATOR'), dugUpTriggerStatus(t));
  return createItem(items, bombItemOf(o), bombStatusOf(o));
}

function leaveOnTheGround(t: TacticalState, wi: WorldItem, o: ItemObject, buried: boolean): void {
  if (!buried) {
    Object.assign(wi.object, o);
    return;
  }
  removeWorldItem(t, wi);
  addItemToPool(t, wi.gridNo, o, Visibility.VISIBLE, wi.level);
}

function disarmBoobyTrap(t: TacticalState, s: Soldier): void {
  const trap = t.boobyTrap;
  const wi = trap.item;
  if (!wi) return;
  const o = cloneObject(wi.object);
  const ours = placedByOurTeam(bombOwnerIdOf(o));
  if (!ours) statChange(t, s, StatKind.EXPLOSIVES, DISARMED_GAIN_PER_DIFFICULTY * trap.difficulty, StatCause.SUCCESS);
  t.events.push({ type: 'trapDisarmed', soldier: s.id, gridNo: trap.gridNo, ...(ours ? {} : { battleSound: 'COOL1' as const }) });
  const taken = trap.buried ? dugUp(t, o) : untrapped(o);
  if (trap.buried) removeBlueFlag(t, trap.gridNo, trap.level);
  if (autoPlaceObject(soldierInventoryContext(t, s), s, taken)) removeWorldItem(t, wi);
  else leaveOnTheGround(t, wi, taken, trap.buried);
}

function boobyTrapGoesOff(t: TacticalState, s: Soldier): void {
  const trap = t.boobyTrap;
  statChange(t, s, StatKind.EXPLOSIVES, FAILED_GAIN_PER_DIFFICULTY * trap.difficulty, StatCause.FAILURE);
  t.events.push({ type: 'trapSetOff', soldier: s.id, gridNo: trap.gridNo, battleSound: 'CURSE1' });
  if (trap.buried) setOffBombsInGridNo(t, s, trap.gridNo, true, trap.level);
  else setOffBoobyTrap(t);
}

function awardFindingTheTrap(t: TacticalState, s: Soldier): void {
  const chances = FOUND_GAIN_PER_DIFFICULTY * t.boobyTrap.difficulty;
  statChange(t, s, StatKind.WISDOM, chances, StatCause.SUCCESS);
  statChange(t, s, StatKind.EXPLOSIVES, chances, StatCause.SUCCESS);
  t.boobyTrap.justFound = false;
}

export function answerDisarmTrap(t: TacticalState, yes: boolean): void {
  const s = t.boobyTrap.soldier;
  if (!s) return;
  if (t.boobyTrap.justFound) awardFindingTheTrap(t, s);
  if (!yes) {
    if (t.boobyTrap.buried) openTacticalPrompt(t, { kind: TacticalPromptKind.REMOVE_BLUE_FLAG });
    return;
  }
  if (skillCheck(t, s, SkillCheckReason.DISARM_TRAP, 0) >= 0) disarmBoobyTrap(t, s);
  else boobyTrapGoesOff(t, s);
}

export function answerRemoveBlueFlag(t: TacticalState, yes: boolean): void {
  if (yes) removeBlueFlag(t, t.boobyTrap.gridNo, t.boobyTrap.level);
}
