// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc PlaceObject (the robot controller, the face-item sight update and
// @src EnsureConsistentWeaponMode at the end of a placement).

import { ItemClass } from '../../content/items/items.ts';
import type { ItemObject } from '../items/object.ts';
import { collectKey } from './doors/keys.ts';
import { ensureConsistentWeaponMode } from './hand-item.ts';
import type { InventoryContext } from './inventory.ts';
import { SightFlags } from './perception/opp.ts';
import { handleSight } from './perception/sight.ts';
import { deductPoints } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, Visibility } from './world-items.ts';

const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';

function afterPlacement(t: TacticalState, s: Soldier, item: number): void {
  const items = t.content.items;
  if (s.team === Team.OUR && item === items.byName.get(ROBOT_REMOTE_CONTROL)?.index) t.narrative.robotRemotePlaced(s);
  if (s.placed && items.byIndex.get(item)?.itemClass === ItemClass.FACE) handleSight(t, s, SightFlags.LOOK);
  ensureConsistentWeaponMode(items, s);
}

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
    placed: (item: number) => afterPlacement(t, s, item),
    reloaded: (gun: number) => {
      t.events.push({ type: 'reloaded', soldier: s.id, item: gun });
    },
  };
}
