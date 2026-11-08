// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc LOCKUI_MODE (UIHandleLUIBeginLock, UIHandleLUIEndLock), from the LU_BEGINUILOCK and
// @src LU_ENDUILOCK pairs of TeamTurns.cc (FreezeInterfaceForEnemyTurn, DisplayHiddenInterrupt, StartInterrupt,
// @src EndInterrupt, StartPlayerTeamTurn), Strategic/StrategicMap.cc JumpIntoAdjacentSector and
// @src DoneFadeOutAdjacentSector, Overhead.cc ExecuteOverhead (the end of the wait for mercs) and CheckForEndOfBattle,
// @src Boxing.cc, Dialogue_Control.cc HandleDialogue, Interface_Dialogue.cc HandleNPCTriggerNPC and
// @src HandleWaitTimerForNPCTrigger, TileEngine/Explosion_Control.cc AddBombToQueue and HandleExplosionQueue;
// @src Tactical/Merc_Entering.cc StartHelicopterRun and HandleHeliDrop (LU_BEGINUILOCK forced on every frame of the drop
// @src until its end's LU_ENDUILOCK, 2026-11-08).

import { helicopterDropRunning } from './helicopter-drop-state.ts';
import { Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { latestInterruptGuy } from './turns/turns.ts';

function hiddenInterruptOfOurTurn(t: TacticalState): boolean {
  return t.turn.hiddenInterrupt && latestInterruptGuy(t)?.team === Team.OUR;
}

function computerTurnLocks(t: TacticalState): boolean {
  return t.inCombat && t.turn.currentTeam !== Team.OUR && !hiddenInterruptOfOurTurn(t);
}

export function playerInterfaceLocked(t: TacticalState): boolean {
  return (
    computerTurnLocks(t) ||
    t.mercsWaiting !== null ||
    t.boxing.uiLocked ||
    t.explosionQueue.active ||
    t.narrative.scriptedSequence() ||
    helicopterDropRunning(t)
  );
}
