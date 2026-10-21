// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc CleanUpStack (ammo, kits and medkits only; the cursor's points first, then the stack's own,
// @src each object's points moved down to the lower objects, an emptied object dropped from the top of the count);
// @src Interface_Panels.cc UIHandleItemPlacement and SMInvClickCallbackPrimary (CTRL+click, free). See docs/28 §5.3.

import { ItemClass, type ItemTable } from '../../content/items/items.ts';
import { deleteObject, type ItemObject } from '../items/object.ts';

const KIT_POINTS = 100;

function maxPointsOf(items: ItemTable, item: number): number | null {
  const def = items.byIndex.get(item);
  if (!def) return null;
  if (def.itemClass === ItemClass.AMMO) return def.magazine?.capacity ?? null;
  if (def.itemClass === ItemClass.KIT || def.itemClass === ItemClass.MEDKIT) return KIT_POINTS;
  return null;
}

function moveDown(target: ItemObject, from: number, below: number, source: ItemObject, max: number): void {
  let points = source.status[from] ?? 0;
  if (points <= 0) return;
  for (let k = below; k >= 0; k--) {
    const have = target.status[k] ?? 0;
    if (have >= max) continue;
    const moved = Math.min(max - have, points);
    target.status[k] = have + moved;
    points -= moved;
    source.status[from] = points;
    if (points !== 0) continue;
    source.count--;
    return;
  }
}

function clearBeyondCount(o: ItemObject): void {
  for (let k = o.count; k < o.status.length; k++) o.status[k] = 0;
}

export function cleanUpStack(items: ItemTable, o: ItemObject, cursor: ItemObject | null): boolean {
  const max = maxPointsOf(items, o.item);
  if (max === null) return false;
  if (cursor && cursor.item === o.item) {
    for (let i = cursor.count - 1; i >= 0; i--) moveDown(o, i, o.count - 1, cursor, max);
    clearBeyondCount(cursor);
    if (cursor.count === 0) deleteObject(cursor);
  }
  for (let i = o.count - 1; i >= 0; i--) moveDown(o, i, i - 1, o, max);
  clearBeyondCount(o);
  return true;
}
