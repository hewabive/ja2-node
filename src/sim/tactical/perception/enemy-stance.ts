// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc ReevaluateEnemyStance; Soldier_Macros.h OK_ENEMY_MERC.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { anim } from '../anim-states.ts';
import { AnimHeight, endHeight, hasAnimFlag, initNewSoldierAnim } from '../animation.ts';
import { soldierReadyWeapon } from '../combat/attack.ts';
import { isMercBody } from '../pathfinding.ts';
import { Body, NOWHERE, OKLIFE, Side, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';
import { Opp } from './opp.ts';

const NOT_TURNING_FROM_PRONE = 0;
const FAR_AWAY = 10000;

function okEnemyMerc(s: Soldier): boolean {
  return !s.neutral && s.side !== Side.FRIENDLY && s.life >= OKLIFE;
}

function closestSeenMerc(t: TacticalState, s: Soldier): number {
  let closest = NOWHERE;
  let closestDistance = FAR_AWAY;
  for (const merc of teamMembers(t, Team.OUR)) {
    if (s.oppList[merc.id] !== Opp.SEEN_CURRENTLY) continue;
    const distance = pythSpacesAway(s.gridNo, merc.gridNo);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = merc.gridNo;
    }
  }
  return closest;
}

export function reevaluateEnemyStance(t: TacticalState, s: Soldier, animState: number): boolean {
  if (!okEnemyMerc(s) || endHeight(t.content, animState) !== AnimHeight.STAND || s.aiTurnControl) return false;
  if (s.turningFromPronePosition !== NOT_TURNING_FROM_PRONE) return false;
  if (s.bodyType === Body.QUEENMONSTER) {
    if (hasAnimFlag(t.content, animState, AnimFlags.BREATH) && s.ai.oppCount > 0) {
      initNewSoldierAnim(t, s, anim(t.content, 'QUEEN_INTO_READY'), 0, true);
      return true;
    }
  }
  if (!isMercBody(s) || !hasAnimFlag(t.content, animState, AnimFlags.MERCIDLE | AnimFlags.BREATH) || s.ai.oppCount <= 0) return false;
  const closest = closestSeenMerc(t, s);
  if (closest === NOWHERE) return false;
  s.dontChargeReadyAPs = true;
  return soldierReadyWeapon(t, s, closest, false);
}
