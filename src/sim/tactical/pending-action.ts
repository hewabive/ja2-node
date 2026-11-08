// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/Soldier.cc Soldier::hasPendingAction, Soldier::removePendingAction (the one ubPendingAction slot is
// @src split into the melee, pickup, door, talk, give, first-aid, robot reload, drop bomb and tile tool records here; the
// @src give's MERC_GIVEITEM is held while walking up and after a give on the spot, 2026-11-08).

import { clearPendingGive, dropHeldGive, holdsGiveItem } from './give.ts';
import { cancelPendingRobotReload } from './robot-reload.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export function hasPendingAction(s: Soldier): boolean {
  return (
    s.pendingMelee !== null ||
    s.pendingPickup !== null ||
    s.pendingDoorAction !== null ||
    s.pendingTalk !== null ||
    holdsGiveItem(s) ||
    s.pendingAid !== null ||
    s.pendingRobotReload !== null ||
    s.pendingDropBomb ||
    s.pendingTileTool !== null
  );
}

export function removePendingAction(t: TacticalState, s: Soldier): void {
  s.pendingMelee = null;
  s.pendingPickup = null;
  s.pendingDoorAction = null;
  s.pendingTalk = null;
  s.pendingAid = null;
  s.pendingDropBomb = false;
  s.pendingTileTool = null;
  clearPendingGive(t, s);
  dropHeldGive(s);
  cancelPendingRobotReload(t, s);
}
