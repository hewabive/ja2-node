// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc ContinuePastBoobyTrap, SetOffBoobyTrap, BoobyTrapDialogueCallBack,
// @src BoobyTrapMessageBoxCallBack (the booby trap of an item; a buried bomb under a blue flag comes with the mines);
// @src Dialogue_Control.cc SetStopTimeQuoteCallback.

import { i16 } from '../../core/int.ts';
import { cloneObject, ObjectFlags } from '../items/object.ts';
import { bombOwnerIdOf } from './bombs/bomb-object.ts';
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
import { removeWorldItem, type WorldItem } from './world-items.ts';

export type BoobyTrapCheck = 'continue' | 'stopped' | 'spotted';

const FOUND_GAIN_PER_DIFFICULTY = 3;
const DISARMED_GAIN_PER_DIFFICULTY = 6;
const FAILED_GAIN_PER_DIFFICULTY = 3;
const GROUND_LEVEL = 0;

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -1;
}

function rememberBoobyTrap(t: TacticalState, s: Soldier, wi: WorldItem, gridNo: number): void {
  Object.assign(t.boobyTrap, { soldier: s, item: wi, gridNo, level: s.level, buried: false, difficulty: wi.object.trap });
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

function disarmBoobyTrap(t: TacticalState, s: Soldier): void {
  const trap = t.boobyTrap;
  const wi = trap.item;
  if (!wi) return;
  const o = cloneObject(wi.object);
  const ours = placedByOurTeam(bombOwnerIdOf(o));
  if (!ours) statChange(t, s, StatKind.EXPLOSIVES, DISARMED_GAIN_PER_DIFFICULTY * trap.difficulty, StatCause.SUCCESS);
  t.events.push({ type: 'trapDisarmed', soldier: s.id, gridNo: trap.gridNo, ...(ours ? {} : { battleSound: 'COOL1' as const }) });
  o.trap = 0;
  o.flags &= ~ObjectFlags.KNOWN_TO_BE_TRAPPED;
  if (autoPlaceObject(soldierInventoryContext(t, s), s, o)) removeWorldItem(t, wi);
  else Object.assign(wi.object, o);
}

function boobyTrapGoesOff(t: TacticalState, s: Soldier): void {
  const trap = t.boobyTrap;
  statChange(t, s, StatKind.EXPLOSIVES, FAILED_GAIN_PER_DIFFICULTY * trap.difficulty, StatCause.FAILURE);
  t.events.push({ type: 'trapSetOff', soldier: s.id, gridNo: trap.gridNo, battleSound: 'CURSE1' });
  setOffBoobyTrap(t);
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
  if (!yes) return;
  if (skillCheck(t, s, SkillCheckReason.DISARM_TRAP, 0) >= 0) disarmBoobyTrap(t, s);
  else boobyTrapGoesOff(t, s);
}
