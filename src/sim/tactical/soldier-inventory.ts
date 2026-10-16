import type { ItemObject } from '../items/object.ts';
import type { InventoryContext } from './inventory.ts';
import { deductPoints } from './points.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, Visibility } from './world-items.ts';

export function soldierInventoryContext(t: TacticalState, s: Soldier): InventoryContext {
  return {
    items: t.content.items,
    inCombat: t.inCombat,
    actionPoints: () => s.actionPoints,
    spendActionPoints: (ap) => deductPoints(t.inCombat, s, ap, 0),
    dropAtFeet: (o: ItemObject) => {
      addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level);
    },
  };
}
