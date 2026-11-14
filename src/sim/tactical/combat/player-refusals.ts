// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (the refusals of a click: nice mercs, buddies, recruited rebels; the
// @src poor shot of a click in combat), HandleCheckForBadChangeToGetThrough; LOS.h OK_CHANCE_TO_GET_THROUGH.

import { ItemClass } from '../../../content/items/items.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { BuddySlot, whichBuddy } from '../profiles.ts';
import { Body, CivilianGroup, NO_PROFILE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { CantGetThrough } from '../turns/turn-state.ts';
import { soldierToLocationChanceToGetThrough, soldierToSoldierBodyPartChanceToGetThrough } from './bullets.ts';

export const OK_CHANCE_TO_GET_THROUGH = 10;
const ProfileMiscFlag3 = { GOODGUY: 0x80 } as const;
const GROUND_CUBE = 0;

function goodGuy(t: TacticalState, profile: number): boolean {
  return ((t.profiles.get(profile)?.miscFlags3 ?? 0) & ProfileMiscFlag3.GOODGUY) !== 0;
}

function namelessNeutral(s: Soldier): boolean {
  return s.profile === NO_PROFILE && s.neutral;
}

function niceMercSpares(t: TacticalState, s: Soldier, tgt: Soldier): boolean {
  return goodGuy(t, s.profile) && (namelessNeutral(tgt) || goodGuy(t, tgt.profile));
}

function buddySpares(t: TacticalState, s: Soldier, tgt: Soldier): boolean {
  if (tgt.profile === NO_PROFILE) return false;
  const p = t.profiles.get(s.profile);
  return p !== undefined && whichBuddy(p, tgt.profile) !== BuddySlot.NOT_FOUND;
}

function rebelSpares(s: Soldier, tgt: Soldier): boolean {
  if (s.civilianGroup !== CivilianGroup.REBEL) return false;
  if (tgt.civilianGroup === CivilianGroup.REBEL) return true;
  return namelessNeutral(tgt) && tgt.civilianGroup === CivilianGroup.NONE && tgt.bodyType !== Body.CROW;
}

function refusalsApply(t: TacticalState, s: Soldier, tgt: Soldier, handItem: number): boolean {
  if (s.team !== Team.OUR || s.profile === NO_PROFILE) return false;
  if ((tgt.team !== Team.OUR && !tgt.neutral) || tgt.bodyType === Body.CROW) return false;
  return t.content.items.byIndex.get(handItem)?.itemClass !== ItemClass.MEDKIT;
}

export function refusesToUseItemOn(t: TacticalState, s: Soldier, tgt: Soldier | null, handItem: number): boolean {
  if (!tgt || !refusalsApply(t, s, tgt, handItem)) return false;
  if (!niceMercSpares(t, s, tgt) && !buddySpares(t, s, tgt) && !rebelSpares(s, tgt)) return false;
  t.narrative.sayQuote(s, MercQuote.REFUSING_ORDER);
  return true;
}

function chanceToGetThrough(t: TacticalState, s: Soldier, tgt: Soldier | null, g: number, level: number): number {
  if (tgt) return soldierToSoldierBodyPartChanceToGetThrough(t, s, tgt, s.aimShotLocation);
  return soldierToLocationChanceToGetThrough(t, s, g, level, GROUND_CUBE, null);
}

function sameCase(held: CantGetThrough | null, s: Soldier, g: number): boolean {
  return held !== null && held.soldier === s && held.gridNo === g && held.soldierGridNo === s.gridNo;
}

export function holdsShotWithoutLineOfFire(t: TacticalState, s: Soldier, tgt: Soldier | null, g: number, level: number): boolean {
  if (chanceToGetThrough(t, s, tgt, g, level) >= OK_CHANCE_TO_GET_THROUGH) {
    t.turn.cantGetThrough = null;
    return false;
  }
  if (sameCase(t.turn.cantGetThrough, s, g)) return false;
  t.turn.cantGetThrough = { soldier: s, gridNo: g, soldierGridNo: s.gridNo };
  t.narrative.sayQuote(s, MercQuote.NO_LINE_OF_FIRE);
  return true;
}

export function heldShotWithoutLineOfFire(t: TacticalState, before: CantGetThrough | null): boolean {
  return t.turn.cantGetThrough !== null && t.turn.cantGetThrough !== before;
}
