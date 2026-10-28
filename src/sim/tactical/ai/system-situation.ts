// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc HandleSystemNewAISituation.

import { TurningFromProne } from '../animation.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import { removePendingAction } from '../pending-action.ts';
import { returnThrownObject } from '../perception/wiring.ts';
import { NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { Situation } from './actions.ts';

function aiTurnUnderWay(t: TacticalState, s: Soldier): boolean {
  return t.turn.currentTeam !== Team.OUR && s.team !== Team.OUR;
}

function cancelPendingWork(t: TacticalState, s: Soldier): void {
  s.pendingAnimation = NO_PENDING_ANIMATION;
  s.turningFromPronePosition = TurningFromProne.OFF;
  s.pendingDirection = NO_PENDING_DIRECTION;
  removePendingAction(t, s);
  s.endDoorOpenCode = 0;
}

function abandonAttack(t: TacticalState, s: Soldier): void {
  if (s.turningToShoot) {
    s.turningToShoot = false;
    s.dontUnsetLastTargetFromTurn = true;
    reduceAttackBusyCount(t, s, false);
  }
  if (s.tempObject !== null) {
    returnThrownObject(t, s);
    reduceAttackBusyCount(t, s, false);
  }
}

export function handleSystemNewAISituation(t: TacticalState, s: Soldier): void {
  if (!aiTurnUnderWay(t, s) || s.ai.newSituation !== Situation.IS_NEW) return;
  cancelPendingWork(t, s);
  if (s.aiTurnControl) abandonAttack(t, s);
}
