// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/FindLocations.cc SearchForItems, IsGunUsable; AIUtils.cc FindBetterSpotForItem;
// @src Tactical/Items.cc ValidAmmoType, TotalPoints.

import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { pythSpacesAway, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../../content/world/grid.ts';
import { deleteObject, type ItemObject, ObjectFlags } from '../../items/object.ts';
import { soldierDifficultyLevel } from '../combat/chance.ts';
import { inGasOrSmoke } from '../explosions/smoke.ts';
import { findEmptySlotWithin, InvSlot, NO_SLOT } from '../inventory.ts';
import { isMercBody, PathCopy } from '../pathfinding.ts';
import { AP, deductPoints } from '../points.ts';
import { Attitude, NO_PROFILE, NOWHERE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { itemsAt, type WorldItem } from '../world-items.ts';
import { AiAction } from './actions.ts';
import { rearrangePocket } from './attack-choice.ts';
import { reachabilityFlood } from './cover.ts';
import { determineMovementMode } from './decide.ts';

export const ItemSearch = { AMMO: 0, WEAPONS: 1, GENERAL: 2 } as const;

const DIFF_MAX_COVER_RANGE = [4, 6, 8, 10, 13];
const MINIMUM_REQUIRED_STATUS = 70;
const WISDOM_PER_TILE = 10;
const DISTANCE_DISCOUNT = 3;

const ATTITUDE_RANGE: Readonly<Record<number, number>> = {
  [Attitude.DEFENSIVE]: -1,
  [Attitude.BRAVESOLO]: 2,
  [Attitude.BRAVEAID]: 2,
  [Attitude.CUNNINGSOLO]: -2,
  [Attitude.CUNNINGAID]: -2,
  [Attitude.AGGRESSIVE]: 1,
};

export interface ItemChoice {
  readonly action: number;
  readonly gridNo: number;
  readonly item: WorldItem | null;
}

const NO_CHOICE: ItemChoice = { action: AiAction.NONE, gridNo: NOWHERE, item: null };

function isGunUsable(t: TacticalState, o: ItemObject, s: Soldier): boolean {
  const imprinted = hasObjectImprint(t, o);
  return o.gunAmmoStatus > 0 && o.gunShotsLeft !== 0 && (!imprinted || o.imprintId === s.id);
}

function hasObjectImprint(t: TacticalState, o: ItemObject): boolean {
  const name = t.content.items.byIndex.get(o.item)?.name;
  return (name === 'ROCKET_RIFLE' || name === 'AUTO_ROCKET_RIFLE') && o.imprintId !== NO_PROFILE;
}

function validAmmoType(t: TacticalState, gun: number, ammo: number): boolean {
  const g = t.content.items.byIndex.get(gun);
  const a = t.content.items.byIndex.get(ammo);
  return g?.itemClass === ItemClass.GUN && a?.itemClass === ItemClass.AMMO && g.weapon?.calibre === a.magazine?.calibre;
}

function totalPoints(o: ItemObject): number {
  let points = 0;
  for (let k = 0; k < o.count; k++) points += o.status[k] ?? 0;
  return points;
}

function searchRange(t: TacticalState, s: Soldier): number {
  let range = (DIFF_MAX_COVER_RANGE[soldierDifficultyLevel(t, s)] ?? 0) + (ATTITUDE_RANGE[s.ai.attitude] ?? 0);
  range = Math.min(range, Math.trunc(s.stats.wisdom / WISDOM_PER_TILE));
  if (!t.inCombat) range = Math.trunc(range / 2);
  return Math.trunc(range / 2);
}

function ammoValue(t: TacticalState, o: ItemObject, wantedGun: number, s: Soldier): number | null {
  const def = t.content.items.byIndex.get(o.item);
  if (def?.itemClass === ItemClass.GUN && (o.status[0] ?? 0) >= MINIMUM_REQUIRED_STATUS) {
    if (!isGunUsable(t, o, s)) return null;
    const mine = t.content.items.byIndex.get(wantedGun)?.weapon?.deadliness || 1;
    return Math.trunc((o.gunShotsLeft * (def.weapon?.deadliness ?? 0)) / mine);
  }
  return validAmmoType(t, wantedGun, o.item) ? totalPoints(o) : null;
}

function weaponValue(t: TacticalState, o: ItemObject, s: Soldier): number | null {
  const items = t.content.items;
  const def = items.byIndex.get(o.item);
  if (!def?.weapon || (o.status[0] ?? 0) < MINIMUM_REQUIRED_STATUS) return null;
  if (def.itemClass === ItemClass.GUN && !isGunUsable(t, o, s)) return null;
  const inHand = items.byIndex.get((s.inv[InvSlot.HAND] as ItemObject).item);
  if (inHand?.weapon) {
    if (def.weapon.deadliness <= inHand.weapon.deadliness) return null;
    return Math.trunc((100 * def.weapon.deadliness) / (inHand.weapon.deadliness || 1));
  }
  return 200 + def.weapon.deadliness;
}

function itemValue(t: TacticalState, s: Soldier, o: ItemObject, reason: number, wantedGun: number): number | null {
  return reason === ItemSearch.AMMO ? ammoValue(t, o, wantedGun, s) : weaponValue(t, o, s);
}

export function findBetterSpotForItem(t: TacticalState, s: Soldier, slot: number): boolean {
  if (slot >= InvSlot.BIGPOCK1) return false;
  const o = s.inv[slot] as ItemObject;
  if (o.item === NOTHING) return true;
  const items = t.content.items;
  let free = NO_SLOT;
  if ((items.byIndex.get(o.item)?.perPocket ?? 0) !== 0) free = findEmptySlotWithin(items, s.inv, InvSlot.SMALLPOCK1, InvSlot.SMALLPOCK8);
  if (free === NO_SLOT) free = findEmptySlotWithin(items, s.inv, InvSlot.BIGPOCK1, InvSlot.BIGPOCK4);
  if (free === NO_SLOT) return false;
  rearrangePocket(s, InvSlot.HAND, free);
  return true;
}

export function searchForItems(t: TacticalState, s: Soldier, reason: number, wantedGun: number): ItemChoice {
  if (s.actionPoints < AP.PICKUP_ITEM || !isMercBody(s)) return NO_CHOICE;
  const range = searchRange(t, s);
  const x = s.gridNo % WORLD_COLS;
  const row = Math.trunc(s.gridNo / WORLD_ROWS);
  const maxLeft = Math.min(range, x);
  const maxRight = Math.min(range, WORLD_COLS - (x + 1));
  const maxUp = Math.min(range, row);
  const maxDown = Math.min(range, WORLD_ROWS - (row + 1));
  const mode = determineMovementMode(t, s, AiAction.PICKUP_ITEM);
  const { reachable } = reachabilityFlood(t, s, mode, PathCopy.REACHABLE, range, s.actionPoints - AP.PICKUP_ITEM, true);
  let bestSpot = NOWHERE;
  let bestValue = 0;
  let bestItem: WorldItem | null = null;
  for (let dy = -maxUp; dy <= maxDown; dy++) {
    for (let dx = -maxLeft; dx <= maxRight; dx++) {
      const g = s.gridNo + dx + WORLD_COLS * dy;
      if (g < 0 || g >= WORLD_MAX || inGasOrSmoke(t, s, g)) continue;
      const pool = itemsAt(t, g, s.level);
      if (pool.length === 0 || !reachable[g] || g === s.ai.blackList) continue;
      let value = 0;
      let item: WorldItem | null = null;
      for (const wi of pool) {
        const v = itemValue(t, s, wi.object, reason, wantedGun);
        if (v !== null && value < v) {
          value = v;
          item = wi;
        }
      }
      value = Math.trunc((DISTANCE_DISCOUNT * value) / (DISTANCE_DISCOUNT + pythSpacesAway(g, s.gridNo)));
      if (bestValue < value) {
        bestValue = value;
        bestSpot = g;
        bestItem = item;
      }
    }
  }
  if (bestSpot === NOWHERE || !bestItem) return NO_CHOICE;
  const isGun = t.content.items.byIndex.get(bestItem.object.item)?.itemClass === ItemClass.GUN;
  if (isGun && !findBetterSpotForItem(t, s, InvSlot.HAND)) {
    if (s.actionPoints < 2 * AP.PICKUP_ITEM) return NO_CHOICE;
    const hand = s.inv[InvSlot.HAND] as ItemObject;
    if (hand.flags & ObjectFlags.UNDROPPABLE) {
      deleteObject(hand);
      deductPoints(t.inCombat, s, AP.PICKUP_ITEM, 0);
    } else {
      s.ai.nextAction = AiAction.PICKUP_ITEM;
      s.ai.nextActionData = bestSpot;
      s.ai.nextPickupItem = bestItem;
      return { action: AiAction.DROP_ITEM, gridNo: bestSpot, item: bestItem };
    }
  }
  s.ai.pickupItem = bestItem;
  return { action: AiAction.PICKUP_ITEM, gridNo: bestSpot, item: bestItem };
}
