// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc AddRottingCorpse (aging), IsValidDecapitationCorpse, GetCorpseAtGridNo,
// @src DecapitateCorpse.

import { NO_CORPSE } from '../../content/anim/corpses.ts';
import { StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { idiv, u32 } from '../../core/int.ts';
import { createItem } from '../items/object.ts';
import { addCorpseStructure, type Corpse, corpseOfStructure, removeCorpse } from './combat/death.ts';
import { worldSeconds } from './explosions/state.ts';
import { Profile } from './narrative/constants.ts';
import type { TacticalState } from './state.ts';
import { addItemToPool, notifySoldiersToLookForItems, Visibility } from './world-items.ts';

export const ROTTING_STAGE2 = 44;
const LAST_FRESH_MERC_CORPSE = 24;
const DELAY_UNTIL_ROTTING_MINUTES = 1440;
const DELAY_UNTIL_DONE_ROTTING_MINUTES = 3 * 1440;
const SECONDS_PER_MINUTE = 60;
const HEAD_STATUS = 100;
const HEAD_LEVEL = 0;
const HEAD_FLAGS = 0;
const HEAD_Z_HEIGHT = 0;
const DEFAULT_HEAD = 'HEAD_1';
const HEADS_OF_PROFILES: Readonly<Record<number, string>> = {
  [Profile.CHRIS]: 'HEAD_2',
  [Profile.T_REX]: 'HEAD_3',
  [Profile.SLAY]: 'HEAD_4',
  [Profile.DRUGGIST]: 'HEAD_5',
  [Profile.ANNIE]: 'HEAD_6',
  [Profile.TIFFANY]: 'HEAD_7',
};

export function agedCorpse(corpse: Corpse, nowMinute: number, loadingSave: boolean): Corpse | null {
  if (loadingSave) return corpse;
  const age = u32(nowMinute - corpse.timeOfDeath);
  if (age > DELAY_UNTIL_DONE_ROTTING_MINUTES) return null;
  if (age > DELAY_UNTIL_ROTTING_MINUTES && corpse.type < ROTTING_STAGE2 && corpse.type <= LAST_FRESH_MERC_CORPSE)
    return { ...corpse, type: ROTTING_STAGE2 };
  return corpse;
}

function corpseBaseAt(t: TacticalState, g: number): StructureInstance | null {
  const structure = t.world.structures.find(g, StructureFlags.CORPSE);
  return structure ? t.world.structures.findBase(structure) : null;
}

export function corpseAt(t: TacticalState, g: number): Corpse | null {
  const base = corpseBaseAt(t, g);
  return base ? corpseOfStructure(t, base) : null;
}

export function isValidDecapitationCorpse(t: TacticalState, c: Corpse): boolean {
  return !c.headTaken && t.content.corpses.table.validForDecapitation[c.type] === 1;
}

function replaceCorpse(t: TacticalState, corpse: Corpse, base: StructureInstance, replacement: Corpse): void {
  const slot = t.corpses.indexOf(corpse);
  removeCorpse(t, corpse, base);
  const added = agedCorpse(replacement, idiv(worldSeconds(t), SECONDS_PER_MINUTE), false);
  if (!added) return;
  t.corpses.splice(slot, 0, added);
  addCorpseStructure(t, added.gridNo, added.level, added.type, added.direction);
}

function markHeadTaken(t: TacticalState, corpse: Corpse): void {
  t.corpses[t.corpses.indexOf(corpse)] = { ...corpse, headTaken: true };
}

function headOf(t: TacticalState, profile: number): number {
  const name = HEADS_OF_PROFILES[profile] ?? DEFAULT_HEAD;
  return t.content.items.byName.get(name)?.index ?? 0;
}

export function decapitateCorpse(t: TacticalState, g: number): void {
  const base = corpseBaseAt(t, g);
  const corpse = base ? corpseOfStructure(t, base) : null;
  if (!base || !corpse || !isValidDecapitationCorpse(t, corpse)) return;
  const headless = t.content.corpses.table.decapitated[corpse.type] ?? NO_CORPSE;
  if (headless !== NO_CORPSE) replaceCorpse(t, corpse, base, { ...corpse, type: headless });
  else markHeadTaken(t, corpse);
  const head = createItem(t.content.items, headOf(t, corpse.profile), HEAD_STATUS);
  addItemToPool(t, g, head, Visibility.INVISIBLE, HEAD_LEVEL, HEAD_FLAGS, HEAD_Z_HEIGHT);
  notifySoldiersToLookForItems(t);
}
