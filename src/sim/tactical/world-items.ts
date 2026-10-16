// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/World_Items.cc AddItemToWorld; Handle_Items.cc AddItemToPool. See docs/12 §9.

import { cloneObject, type ItemObject } from '../items/object.ts';
import type { TacticalState } from './state.ts';

export const Visibility = { INVISIBLE: 0, VISIBLE: 1, HIDDEN_ITEM: 4, BURIED: 2 } as const;

export interface WorldItem {
  readonly gridNo: number;
  readonly level: number;
  readonly object: ItemObject;
  visible: number;
}

export function addItemToPool(t: TacticalState, g: number, o: ItemObject, visible: number, level: number): WorldItem {
  const item: WorldItem = { gridNo: g, level, object: cloneObject(o), visible };
  t.worldItems.push(item);
  return item;
}

export function itemsAt(t: TacticalState, g: number, level: number): WorldItem[] {
  return t.worldItems.filter((i) => i.gridNo === g && i.level === level);
}
