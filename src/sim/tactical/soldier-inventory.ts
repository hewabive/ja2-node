// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc PlaceObject (the robot controller, the face-item sight update and
// @src EnsureConsistentWeaponMode at the end of a placement, for a merc on or off the loaded map, 2026-11-15); ReloadGun
// @src (the reload sound only for a visible soldier); AutoReload (STR_RELOAD_ONLY_ONE_GUN, 2026-11-18).

import { ItemClass, type ItemTable } from '../../content/items/items.ts';
import type { ItemObject } from '../items/object.ts';
import { collectKey } from './doors/keys.ts';
import { ensureConsistentWeaponMode } from './hand-item.ts';
import type { InventoryContext } from './inventory.ts';
import { SightFlags } from './perception/opp.ts';
import { handleSight } from './perception/sight.ts';
import { deductPoints } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import { shownInSector, type TacticalState } from './state.ts';
import { namedSoldier } from './unseen-sources.ts';
import { addItemToPool, Visibility } from './world-items.ts';

const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';

export interface PlacementEffects {
  readonly robotRemotePlaced: (s: Soldier) => void;
  readonly look?: (s: Soldier) => void;
}

export function afterPlacement(items: ItemTable, s: Soldier, item: number, effects: PlacementEffects): void {
  if (s.team === Team.OUR && item === items.byName.get(ROBOT_REMOTE_CONTROL)?.index) effects.robotRemotePlaced(s);
  if (items.byIndex.get(item)?.itemClass === ItemClass.FACE) effects.look?.(s);
  ensureConsistentWeaponMode(items, s);
}

function tacticalPlacementEffects(t: TacticalState): PlacementEffects {
  return {
    robotRemotePlaced: (s) => t.narrative.robotRemotePlaced(s),
    look: (s) => {
      if (s.placed) handleSight(t, s, SightFlags.LOOK);
    },
  };
}

export function soldierInventoryContext(t: TacticalState, s: Soldier): InventoryContext {
  return {
    items: t.content.items,
    inCombat: t.inCombat,
    actionPoints: () => s.actionPoints,
    spendActionPoints: (ap) => deductPoints(t, s, ap, 0),
    dropAtFeet: (o: ItemObject) => {
      addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level);
    },
    collectKey: (o: ItemObject) => collectKey(t, s, o),
    placed: (item: number) => afterPlacement(t.content.items, s, item, tacticalPlacementEffects(t)),
    reloaded: (gun: number) => {
      if (shownInSector(t, s)) t.events.push({ type: 'reloaded', soldier: s.id, item: gun });
    },
    reloadedOneGunOnly: () => {
      t.events.push({ type: 'reloadedOneGunOnly', ...namedSoldier(t, s) });
    },
  };
}
