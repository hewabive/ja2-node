// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/TeamTurns.cc NPCFirstDraw; Tactical/Handle_UI.cc UIHandleMercAttack (the out-of-combat check
// @src before the attack, gUIFullTarget as the soldier on the target tile).

import { WEAPON_CLASSES } from '../../../content/items/items.ts';
import { Approach } from '../../../content/narrative/npc-constants.ts';
import { idiv } from '../../../core/int.ts';
import { FIRST_APPROACH_FLAGS } from '../../narrative/select.ts';
import { findAIUsableObjClass } from '../ai/utils.ts';
import { findSoldierAtGridNo } from '../combat/melee-reach.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { effectiveExpLevel } from '../skills.ts';
import { NO_PROFILE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from './civ-hostility.ts';
import { Profile } from './constants.ts';

const NO_SLOT = -1;
const THREATENED_BONUS = 1;

interface DrawDice {
  readonly smaller: number;
  readonly larger: number;
}

function drawDice(level: number): DrawDice {
  const smaller = idiv(level, 2);
  return { smaller, larger: level - smaller };
}

function rollDraw(t: TacticalState, dice: DrawDice): number {
  return t.rng.int(dice.smaller + 1) + dice.larger;
}

function threatenedBefore(t: TacticalState, profile: number): boolean {
  const flag = FIRST_APPROACH_FLAGS[Approach.THREATEN - 1] ?? 0;
  return ((t.profiles.get(profile)?.approached ?? 0) & flag) !== 0;
}

function targetDiceOf(t: TacticalState, target: Soldier): DrawDice {
  const dice = drawDice(effectiveExpLevel(target));
  if (!threatenedBefore(t, target.profile)) return dice;
  return { smaller: dice.smaller + THREATENED_BONUS, larger: dice.larger + THREATENED_BONUS };
}

function readyToDraw(t: TacticalState, attacker: Soldier, target: Soldier): boolean {
  return (
    target.profile !== NO_PROFILE &&
    target.profile !== Profile.SLAY &&
    target.neutral &&
    target.oppList[attacker.id] === Opp.SEEN_CURRENTLY &&
    findAIUsableObjClass(t, target, WEAPON_CLASSES) !== NO_SLOT
  );
}

export function npcFirstDraw(t: TacticalState, attacker: Soldier, target: Soldier): boolean {
  if (!readyToDraw(t, attacker, target)) return false;
  const ours = drawDice(effectiveExpLevel(attacker));
  const theirs = targetDiceOf(t, target);
  return rollDraw(t, theirs) > rollDraw(t, ours);
}

function weaponInHand(t: TacticalState, s: Soldier): boolean {
  return ((t.content.items.byIndex.get(itemIn(s.inv, InvSlot.HAND))?.itemClass ?? 0) & WEAPON_CLASSES) !== 0;
}

export function npcDrawsFirstOnAttack(t: TacticalState, attacker: Soldier, gridNo: number, level: number): boolean {
  if (t.inCombat) return false;
  const target = findSoldierAtGridNo(t, gridNo, level);
  if (!target || !weaponInHand(t, attacker) || !npcFirstDraw(t, attacker, target)) return false;
  t.turnHooks.cancelAIAction(t, target);
  addToShouldBecomeHostileOrSayQuoteList(t, target);
  return true;
}
