// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/Soldier.cc Soldier::hasPendingAction, Soldier::removePendingAction (the one ubPendingAction slot is
// @src split into the melee, pickup, door, talk, give, first-aid, robot reload and drop bomb records here).

import { clearPendingGive } from './give.ts';
import { cancelPendingRobotReload } from './robot-reload.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export function hasPendingAction(s: Soldier): boolean {
  return (
    s.pendingMelee !== null ||
    s.pendingPickup !== null ||
    s.pendingDoorAction !== null ||
    s.pendingTalk !== null ||
    s.pendingGive !== null ||
    s.pendingAid !== null ||
    s.pendingRobotReload !== null ||
    s.pendingDropBomb
  );
}

export function removePendingAction(t: TacticalState, s: Soldier): void {
  s.pendingMelee = null;
  s.pendingPickup = null;
  s.pendingDoorAction = null;
  s.pendingTalk = null;
  s.pendingAid = null;
  s.pendingDropBomb = false;
  clearPendingGive(t, s);
  cancelPendingRobotReload(t, s);
}
