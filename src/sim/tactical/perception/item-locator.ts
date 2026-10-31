// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/FOV.cc RevealRoofsAndItems (the halt, the item locator lock and the items-seen quote);
// @src Overhead.cc InternalReduceAttackBusyCount (fItemsSeenOnAttack), MakeCharacterDialogueEventSignalItemLocatorStart.

import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

export function signalItemLocatorStart(t: TacticalState, s: Soldier): void {
  if (t.narrative.isEpc(s)) {
    t.turn.lockItemLocators = false;
    return;
  }
  t.narrative.signalItemLocatorStart(s);
}

export function noticeRevealedItems(t: TacticalState, s: Soldier, quoteSaid: boolean): boolean {
  if (t.inCombat) t.perceptionHooks.haltFromItemSighting(s);
  else t.turn.lockItemLocators = false;
  if (quoteSaid || t.turn.lockItemLocators) return quoteSaid;
  t.turn.lockItemLocators = true;
  if (t.turn.attackBusyCount > 0 && t.inCombat) t.turn.itemsSeenOnAttack = s;
  else signalItemLocatorStart(t, s);
  return true;
}

export function handleItemsSeenOnAttack(t: TacticalState): void {
  const seer = t.turn.itemsSeenOnAttack;
  if (!seer || t.turn.currentTeam !== Team.OUR) return;
  t.turn.itemsSeenOnAttack = null;
  signalItemLocatorStart(t, seer);
}
