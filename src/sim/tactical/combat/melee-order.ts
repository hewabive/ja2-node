// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIMouseOnValidAttackLocation (the punch path check), SelectedMercCanAffordAttack
// @src (for a blade or fists, whose HandleItem path checks no APs; a melee click is always checked, never auto-confirmed).

import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { InvSlot } from '../inventory.ts';
import { enoughPoints } from '../points.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { calcTotalAPsToAttack } from './ap.ts';

export type MeleeOrderRefusal = 'noPath' | 'notEnoughAP';

const NO_AIM = 0;

function punches(t: TacticalState, s: Soldier): boolean {
  const cls = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING)?.itemClass ?? ItemClass.NONE;
  return (cls & (ItemClass.NONE | ItemClass.PUNCH)) !== 0;
}

export function meleeOrderRefusal(t: TacticalState, s: Soldier, target: number): MeleeOrderRefusal | null {
  if (punches(t, s) && calcTotalAPsToAttack(t, s, target, true, NO_AIM) === 0) return 'noPath';
  if (!enoughPoints(t.inCombat, s, calcTotalAPsToAttack(t, s, target, true, s.aimTime))) return 'notEnoughAP';
  return null;
}
