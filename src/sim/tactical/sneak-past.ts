// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc SetSoldierGridNo (the agility a sneaking merc earns past an unaware enemy)

import { pythSpacesAway } from '../../content/world/grid.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { Opp } from './perception/opp.ts';
import { distanceVisible } from './perception/sight.ts';
import { StatKind } from './profiles.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

const DIRECTION_IRRELEVANT = -1;
const SNEAK_PAST_AGILITY_CHANCES = 5;

function sneaking(s: Soldier): boolean {
  return s.team === Team.OUR && s.stealthMode && s.ai.oppCount > 0;
}

function alertOpponent(s: Soldier, enemy: Soldier): boolean {
  if (!enemy.placed || enemy.life < OKLIFE || enemy.neutral || enemy.side === s.side) return false;
  return enemy.bodyType !== Body.COW && enemy.bodyType !== Body.CROW;
}

function couldSeeButDoesNot(t: TacticalState, s: Soldier, enemy: Soldier, g: number): boolean {
  if (s.oppList[enemy.id] !== Opp.SEEN_CURRENTLY || enemy.oppList[s.id] === Opp.SEEN_CURRENTLY) return false;
  return pythSpacesAway(g, enemy.gridNo) < distanceVisible(t, enemy, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, s.level);
}

export function sneakPastUnawareEnemies(t: TacticalState, s: Soldier, g: number): void {
  if (!sneaking(s)) return;
  for (const enemy of t.soldiers) {
    if (!enemy || !alertOpponent(s, enemy) || !couldSeeButDoesNot(t, s, enemy, g)) continue;
    statChange(t, s, StatKind.AGILITY, SNEAK_PAST_AGILITY_CHANCES, StatCause.SUCCESS);
  }
}
