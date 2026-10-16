// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc DetermineSoldierAnimationSurface; Tactical/Animation_Data.cc
// @src InternalGetAnimationStructureRef; Tactical/Soldier_Control.cc GetStructureID; Tactical/PathAI.cc FindBestPath
// @src (multi-tile set-up). See docs/07 §3.

import { AnimStruct, animStructType } from '../../content/anim/structures.ts';
import { chooseSurface } from '../../content/anim/surface-choice.ts';
import { INVALID_SURFACE } from '../../content/anim/tables.ts';
import type { StructureFile } from '../../content/formats/jsd.ts';
import { handClass } from '../../content/items/items.ts';
import { INVALID_STRUCTURE_ID } from '../../content/world/structures.ts';
import { substituteBodyTypeAnimation } from './anim-substitution.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import type { MultiTileShape } from './pathfinding.ts';
import { Body, type Soldier } from './soldier.ts';

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

export function soldierAnimSurface(content: TacticalContent, s: Soldier, state: number): number {
  const items = content.items;
  return chooseSurface(content.animations, {
    bodyType: s.bodyType,
    state: substituteBodyTypeAnimation(content, s, state),
    hand: handClass(items, s.inv[InvSlot.HAND]?.item ?? 0),
    secondHandPistol: handClass(items, s.inv[InvSlot.SECOND_HAND]?.item ?? 0) === 'pistol',
    life: s.life,
    subFlags: 0,
  });
}

export function animStructureFile(content: TacticalContent, s: Soldier, state: number): StructureFile | null {
  const surface = soldierAnimSurface(content, s, state);
  if (surface === INVALID_SURFACE) return null;
  const surfaceStruct = content.animations.surfaces[surface]?.struct ?? AnimStruct.NONE;
  const type = animStructType(surfaceStruct, content.animations.controls[state]?.id ?? '');
  if (type === AnimStruct.NONE) return null;
  return content.animStructures[s.bodyType]?.[type] ?? null;
}

export function soldierStructureId(s: Soldier): number {
  return s.structure ? s.id : INVALID_STRUCTURE_ID;
}

export function multiTileShape(content: TacticalContent, s: Soldier, state: number): MultiTileShape | null {
  if (!s.multiTile) return null;
  return {
    structures: animStructureFile(content, s, state)?.structures ?? null,
    structureId: soldierStructureId(s),
    continuousTurn: s.monsterOrAnimal || isVehicle(s),
    direction: s.direction,
  };
}
