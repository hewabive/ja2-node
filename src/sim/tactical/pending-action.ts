// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/Soldier.cc Soldier::hasPendingAction, Soldier::removePendingAction (the one ubPendingAction slot is
// @src split into the melee, pickup, door, talk, give, first-aid, robot reload, drop bomb and tile tool records here; the
// @src give's MERC_GIVEITEM is held while walking up and after a give on the spot, 2026-11-08; a native save's action
// @src stays its code alone, 2026-11-08; a pickup's data outlives its MERC_PICKUPITEM, 2026-11-09).

import { clearPendingGive, dropHeldActions, holdsGiveItem } from './give.ts';
import { cancelPendingRobotReload } from './robot-reload.ts';
import { pickupInTheSlot, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export function hasPendingAction(s: Soldier): boolean {
  return (
    s.pendingMelee !== null ||
    pickupInTheSlot(s) !== null ||
    s.pendingDoorAction !== null ||
    s.pendingTalk !== null ||
    holdsGiveItem(s) ||
    s.pendingAid !== null ||
    s.pendingRobotReload !== null ||
    s.pendingDropBomb ||
    s.pendingTileTool !== null ||
    s.savedPendingAction !== null
  );
}

export function removePendingAction(t: TacticalState, s: Soldier): void {
  s.pendingMelee = null;
  s.pendingDoorAction = null;
  s.pendingTalk = null;
  s.pendingAid = null;
  s.pendingDropBomb = false;
  s.pendingTileTool = null;
  clearPendingGive(t, s);
  dropHeldActions(s);
  cancelPendingRobotReload(t, s);
}
