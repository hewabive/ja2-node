// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (punch and blade tile choice);
// @src Overhead.cc FindAdjacentGridEx (fForceToPerson, no doors, no walk). See docs/11 §6.1.

import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, newGridNo } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { InvSlot } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { doorTravelCost } from '../points.ts';
import type { Soldier } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';

export interface MeleeSpot {
  readonly targetGridNo: number;
  readonly direction: number;
}

const SIDE_DIRECTIONS: readonly number[] = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST];

function doorAdjustedCost(t: TacticalState, s: Soldier, spot: number, cost: number): number {
  return doorTravelCost({ env: t.pathEnv, content: t.content, inCombat: t.inCombat }, s, spot, cost, false, false);
}

export function bladeSpot(t: TacticalState, s: Soldier, g: number): MeleeSpot | null {
  for (const dir of SIDE_DIRECTIONS) {
    const spot = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    if (doorAdjustedCost(t, s, spot, t.world.costs.get(spot, dir, s.level)) >= TravelCost.BLOCKED) continue;
    if (spot === s.gridNo) return { targetGridNo: g, direction: directionToward(s.gridNo, g) };
  }
  return null;
}

export function punchSpot(t: TacticalState, s: Soldier, g: number, level: number): MeleeSpot | null {
  const tgt = whoIsThere(t, g, level);
  if (tgt) {
    for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
      const spot = newGridNo(s.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
      const cost = t.world.costs.get(spot, dir, level);
      if (cost >= TravelCost.BLOCKED || doorAdjustedCost(t, s, spot, cost) >= TravelCost.BLOCKED) continue;
      if (whoIsThere(t, spot, s.level) === tgt) return { targetGridNo: tgt.gridNo, direction: dir };
    }
  }
  return bladeSpot(t, s, g);
}

export function meleeSpot(t: TacticalState, s: Soldier, g: number, level: number): MeleeSpot | null {
  const hand = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING);
  return hand?.itemClass === ItemClass.BLADE ? bladeSpot(t, s, g) : punchSpot(t, s, g, level);
}
