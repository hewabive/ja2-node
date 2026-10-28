// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc the pickup into the item cursor, the hatch drawn on invalid slots except the
// @src second hand, the blocked second hand under a two-handed weapon, the compatible outline (InternalHandleCompatibleAmmoUI),
// @src HandleAnyMercInSquadHasCompatibleStuff; Interface_Panels.cc ReevaluateItemHatches.

import { isTwoHanded, NOTHING } from '../../content/items/items.ts';
import { validAttachment } from '../../content/items/rules.ts';
import { cloneObject, type ItemObject } from '../items/object.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { InvSlot, placeObject } from '../tactical/inventory.ts';
import { parseCount, parseSlot } from '../tactical/inventory-commands.ts';
import { dryInventoryContext, takeObjects } from '../tactical/inventory-panel.ts';
import {
  compatibleItemForApplyingOnMerc,
  compatibleSlots,
  invalidPlacementSlots,
  soldierContainsAnyCompatibleStuff,
} from '../tactical/item-compatibility.ts';
import { validMerge } from '../tactical/item-merge.ts';
import { Team } from '../tactical/soldier.ts';
import { actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface SlotPlacement {
  readonly slot: number;
  readonly invalid: boolean;
  readonly hatched: boolean;
  readonly attach: boolean;
  readonly merge: boolean;
  readonly highlight: boolean;
  readonly fits: boolean;
}

export interface Placements {
  readonly cursor: { readonly item: number; readonly count: number };
  readonly slots: readonly SlotPlacement[];
  readonly secondHandBlocked: boolean;
  readonly applyOnMerc: boolean;
  readonly compatibleMercs: readonly number[];
}

export interface PlacementsRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly slot?: unknown;
  readonly count?: unknown;
  readonly index?: unknown;
  readonly mapScreen?: unknown;
}

export function placements(world: KnowledgeWorld, req: PlacementsRequest): HintResult<Placements> {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const { state: t, soldier: s } = acting;
  const items = t.content.items;
  const slot = parseSlot(req.slot);
  if (slot === null) return refuseHint('badSlot', 'slot must be 0..18 or a slot name such as "hand"');
  const count = parseCount(req.count, 'all');
  if (count === null) return refuseHint('badCount', 'count must be 1 or "all"');
  const index = req.index ?? 0;
  const inv = s.inv.map(cloneObject);
  const source = inv[slot] as ItemObject;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= Math.max(1, source.count))
    return refuseHint('badIndex', 'index must point to an object in the stack');
  const cursor = source.item === NOTHING ? null : takeObjects(source, count, index);
  if (!cursor) return refuseHint('emptySlot', 'that slot is empty');
  const invalid = invalidPlacementSlots(items, inv, cursor);
  const highlight = compatibleSlots(items, inv, cursor.item);
  const ctx = dryInventoryContext(items, t.inCombat, s);
  const slots = inv.map((o, k): SlotPlacement => {
    const blocked = invalid[k] === true;
    return {
      slot: k,
      invalid: blocked,
      hatched: blocked && k !== InvSlot.SECOND_HAND,
      attach: validAttachment(items, cursor.item, o.item),
      merge: validMerge(items, cursor.item, o.item),
      highlight: highlight[k] === true,
      fits: placeObject(ctx, { inv: inv.map(cloneObject) }, k, cloneObject(cursor)),
    };
  });
  const own = world.view.soldiers.filter((v) => v.team === Team.OUR);
  const compatibleMercs = own
    .filter((v) => {
      const merc = v.id === s.id ? { inv } : world.tactical?.ownSoldier(v.id);
      return merc ? soldierContainsAnyCompatibleStuff(items, merc.inv, cursor.item) : false;
    })
    .map((v) => v.id);
  return hintData({
    cursor: { item: cursor.item, count: cursor.count },
    slots,
    secondHandBlocked: isTwoHanded(items, inv[InvSlot.HAND]?.item ?? NOTHING),
    applyOnMerc: compatibleItemForApplyingOnMerc(items, cursor.item, req.mapScreen === true),
    compatibleMercs,
  });
}
