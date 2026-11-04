// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame code 491 (TIME_FOR_RANDOM_ANIM_CHECK; the drunk
// @src checks 2026-11-04)

import type { OpOutcome } from '../../content/anim/script.ts';
import { type RandomAnim, RandomAnimFlags, RandomAnimHand } from '../../content/anim/tables.ts';
import { ItemClass, isTwoHanded } from '../../content/items/items.ts';
import { u32 } from '../../core/int.ts';
import { changeSoldierState, endHeight } from './animation.ts';
import { DrunkLevel, drunkLevel } from './drugs.ts';
import { InvSlot } from './inventory.ts';
import { mercInWater } from './person-structure.ts';
import { hasThreatenStance, OKLIFE, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

const RANDOM_ANIM_CHECK = 491;
const TIME_FOR_RANDOM_ANIM_CHECK = 2;
const INJURED_CHANGE_THRESHOLD = 30;
const DICE = 100;
const NOTHING = 0;

type Hand = (typeof RandomAnimHand)[keyof typeof RandomAnimHand];

function randomHandIndex(t: TacticalState, s: Soldier): Hand | null {
  const item = s.inv[InvSlot.HAND]?.item ?? NOTHING;
  if (item === NOTHING || t.content.items.byIndex.get(item)?.itemClass !== ItemClass.GUN) return RandomAnimHand.NOTHING;
  return isTwoHanded(t.content.items, item) ? RandomAnimHand.RIFLE : null;
}

const injured = (s: Soldier) => s.life < INJURED_CHANGE_THRESHOLD;
const forInjured = (a: RandomAnim) => (a.flags & RandomAnimFlags.INJURED) !== 0;
const drunkForIdles = (s: Soldier) => drunkLevel(s) >= DrunkLevel.BORDERLINE;
const forDrunk = (a: RandomAnim) => (a.flags & RandomAnimFlags.DRUNK) !== 0;

function allowed(t: TacticalState, s: Soldier, a: RandomAnim, hand: Hand): boolean {
  if (forInjured(a) !== injured(s)) return false;
  if (forDrunk(a) !== drunkForIdles(s)) return false;
  if (a.hand !== RandomAnimHand.IRRELEVANT && a.hand !== hand) return false;
  if (a.flags & RandomAnimFlags.CASUAL && (s.team !== Team.OUR || t.inCombat)) return false;
  if (a.flags & RandomAnimFlags.FIRST_BIG_MERC && hasThreatenStance(s)) return false;
  if (a.flags & RandomAnimFlags.SECOND_BIG_MERC && !hasThreatenStance(s)) return false;
  return a.height === endHeight(t.content, s.state);
}

function dueForCheck(s: Soldier): boolean {
  s.timeOfLastRandomAction = u32(s.timeOfLastRandomAction + 1);
  if (s.timeOfLastRandomAction <= TIME_FOR_RANDOM_ANIM_CHECK && !injured(s) && !drunkForIdles(s)) return false;
  s.timeOfLastRandomAction = 0;
  return true;
}

function randomAnimCheck(t: TacticalState, s: Soldier): OpOutcome {
  if (s.life < OKLIFE || !dueForCheck(s) || mercInWater(s)) return 'continue';
  const roll = t.rng.int(DICE);
  const hand = randomHandIndex(t, s);
  if (hand === null) return 'continue';
  const chosen = t.content.animations.randomAnims[s.bodyType]?.find(
    (a) => allowed(t, s, a, hand) && roll >= a.firstRoll && roll <= a.lastRoll,
  );
  if (!chosen) return 'continue';
  if (chosen.state !== null) changeSoldierState(t, s, chosen.state);
  return 'stop';
}

export function randomAnimOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  return code === RANDOM_ANIM_CHECK ? randomAnimCheck(t, s) : null;
}
