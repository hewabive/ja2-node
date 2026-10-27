// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-27. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Interactive_Tiles.cc HandleStructChangeFromGridNo (the Drassen shipment quote, the NPC
// @src approach, the contents shown with the merc's HUMM, COOL1 or NOTHING or hidden again, the partner swap and the
// @src switch; the browser plays the open or close sound from the view's open containers).

import { Approach } from '../../../content/narrative/npc-constants.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { swapStructureForPartner } from '../doors.ts';
import { activateSwitchInGridNo } from '../narrative/quest-items.ts';
import { NO_PROFILE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { ANY_VISIBILITY_VALUE, itemsAt, setItemsVisibilityHidden, setItemsVisibilityOn } from '../world-items.ts';
import type { ContentsExclamation } from './events.ts';

const POOL_WORTH_COOL = 3;

function exclaim(t: TacticalState, s: Soldier, sound: ContentsExclamation): void {
  t.events.push({ type: 'contentsExclaimed', soldier: s.id, sound });
}

function tellOpener(t: TacticalState, s: Soldier, gridNo: number): boolean {
  if (s.team === Team.OUR) return t.narrative.stuffMissingFromShipment(gridNo);
  if (s.team === Team.CIV && s.profile !== NO_PROFILE) t.narrative.triggerNpcWithGivenApproach(s.profile, Approach.DONE_OPEN_STRUCTURE);
  return false;
}

function showOrHideContents(t: TacticalState, s: Soldier, gridNo: number, closing: boolean): void {
  const missingQuote = tellOpener(t, s, gridNo);
  const pool = itemsAt(t, gridNo, s.level);
  if (pool.length === 0) {
    if (!closing) exclaim(t, s, 'NOTHING');
    return;
  }
  if (closing) {
    setItemsVisibilityHidden(t, gridNo, s.level);
    return;
  }
  const ours = s.team === Team.OUR;
  let humm = ours;
  if (pool[0]?.object.item === t.content.items.byName.get('OWNERSHIP')?.index) {
    humm = false;
    exclaim(t, s, 'NOTHING');
  }
  setItemsVisibilityOn(t, gridNo, s.level, ANY_VISIBILITY_VALUE, ours);
  if (missingQuote) return;
  if (pool.length >= POOL_WORTH_COOL) exclaim(t, s, 'COOL1');
  else if (humm) exclaim(t, s, 'HUMM');
}

export function handleStructChangeFromGridNo(t: TacticalState, s: Soldier, gridNo: number): void {
  const structure = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  if (!structure) return;
  const closing = has(structure.flags, StructureFlags.OPEN);
  if (!has(structure.flags, StructureFlags.SWITCH)) showOrHideContents(t, s, gridNo, closing);
  const swapped = swapStructureForPartner(t, structure);
  if (!swapped) return;
  recompileLocalMovementCosts(t.world.costs, t.world, gridNo);
  if (has(swapped.flags, StructureFlags.SWITCH)) activateSwitchInGridNo(t, s, gridNo);
}
