// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/World_Items.cc gWorldBombs, AddBombToWorld, RemoveBombFromWorldByItemIndex; World_Items.h
// @src WORLDBOMB, FOR_EACH_WORLD_BOMB; TileEngine/Explosion_Control.cc FindActiveTimedBomb, ActiveTimedBombExists;
// @src World_Items.cc FindWorldItemForBombInGridNo (2026-11-04).

import type { TacticalState } from '../state.ts';
import type { WorldItem } from '../world-items.ts';
import { Detonator, detonatorOf, isDisabledBomb } from './bomb-object.ts';

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

export function findWorldItemForBombInGridNo(t: Pick<TacticalState, 'worldBombs'>, g: number, level: number): WorldItem | null {
  return worldBombItems(t).find((wi) => wi.gridNo === g && wi.level === level) ?? null;
}

export function isActiveTimedBomb(item: WorldItem): boolean {
  return detonatorOf(item.object) === Detonator.TIMED && !isDisabledBomb(item.object);
}

export function findActiveTimedBomb(t: Pick<TacticalState, 'worldBombs'>): WorldItem | null {
  return worldBombItems(t).find(isActiveTimedBomb) ?? null;
}

export function activeTimedBombExists(t: Pick<TacticalState, 'worldBombs'>): boolean {
  return findActiveTimedBomb(t) !== null;
}
