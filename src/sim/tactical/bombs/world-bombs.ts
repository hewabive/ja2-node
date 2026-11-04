// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/World_Items.cc gWorldBombs, AddBombToWorld, RemoveBombFromWorldByItemIndex; World_Items.h
// @src WORLDBOMB, FOR_EACH_WORLD_BOMB.

import type { TacticalState } from '../state.ts';
import type { WorldItem } from '../world-items.ts';

export interface WorldBomb {
  exists: boolean;
  item: WorldItem;
}

export function addBombToWorld(t: Pick<TacticalState, 'worldBombs'>, item: WorldItem): void {
  const free = t.worldBombs.find((b) => !b.exists);
  if (!free) {
    t.worldBombs.push({ exists: true, item });
    return;
  }
  free.exists = true;
  free.item = item;
}

export function removeBombFromWorld(t: Pick<TacticalState, 'worldBombs'>, item: WorldItem): void {
  const slot = t.worldBombs.find((b) => b.exists && b.item === item);
  if (slot) slot.exists = false;
}

export function worldBombItems(t: Pick<TacticalState, 'worldBombs'>): WorldItem[] {
  return t.worldBombs.flatMap((b) => (b.exists ? [b.item] : []));
}
