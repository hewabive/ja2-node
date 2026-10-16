import type { ItemObject } from '../items/object.ts';
import { collectKey } from './doors/keys.ts';
import type { InventoryContext } from './inventory.ts';
import { deductPoints } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, Visibility } from './world-items.ts';

const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';

export function soldierInventoryContext(t: TacticalState, s: Soldier): InventoryContext {
  return {
    items: t.content.items,
    inCombat: t.inCombat,
    actionPoints: () => s.actionPoints,
    spendActionPoints: (ap) => deductPoints(t.inCombat, s, ap, 0),
    dropAtFeet: (o: ItemObject) => {
      addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level);
    },
    collectKey: (o: ItemObject) => collectKey(t, s, o),
    placed: (item: number) => {
      if (s.team === Team.OUR && item === t.content.items.byName.get(ROBOT_REMOTE_CONTROL)?.index) t.narrative.robotRemotePlaced(s);
    },
  };
}
