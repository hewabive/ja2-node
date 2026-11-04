// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc DetermineSoldierAnimationSurface (MercInWater, the second hand's gun and
// @src the queen's spit toward sTargetGridNo, 2026-11-04); Tactical/Soldier_Create.cc TacticalCopySoldierFromProfile and
// @src TacticalCreateSoldier (uiAnimSubFlags: the profile's, and the threaten stance of every BIGMALE, 2026-11-04);
// @src Tactical/Animation_Data.cc InternalGetAnimationStructureRef;
// @src Tactical/Soldier_Control.cc GetStructureID; Tactical/PathAI.cc FindBestPath (multi-tile set-up).

import { AnimStruct, animStructType } from '../../content/anim/structures.ts';
import { chooseSurface, SubAnimFlags } from '../../content/anim/surface-choice.ts';
import { INVALID_SURFACE } from '../../content/anim/tables.ts';
import type { StructureFile } from '../../content/formats/jsd.ts';
import { handClass, ItemClass, type ItemTable, isTwoHanded } from '../../content/items/items.ts';
import { INVALID_STRUCTURE_ID } from '../../content/world/structures.ts';
import { substituteBodyTypeAnimation } from './anim-substitution.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { directionToward } from './movement.ts';
import type { MultiTileShape } from './pathfinding.ts';
import { mercInWater } from './person-structure.ts';
import { Body, hasThreatenStance, NO_PROFILE, type Soldier } from './soldier.ts';

const QUEEN_HEAD_OFFSET = 2;

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

function isOneHandedGun(items: ItemTable, item: number): boolean {
  return items.byIndex.get(item)?.itemClass === ItemClass.GUN && !isTwoHanded(items, item);
}

function bodySubFlags(s: Soldier): number {
  return hasThreatenStance(s) ? SubAnimFlags.BIGGUY_THREATEN_STANCE : 0;
}

function profileSubFlags(content: TacticalContent, s: Soldier): number {
  return s.profile === NO_PROFILE ? 0 : (content.profiles[s.profile]?.bodyTypeSubFlags ?? 0);
}

function surfaceWithSubFlags(content: TacticalContent, s: Soldier, state: number, subFlags: number): number {
  const items = content.items;
  return chooseSurface(content.animations, {
    bodyType: s.bodyType,
    state: substituteBodyTypeAnimation(content, s, state),
    hand: handClass(items, itemIn(s.inv, InvSlot.HAND)),
    secondHandOneHandedGun: isOneHandedGun(items, itemIn(s.inv, InvSlot.SECOND_HAND)),
    life: s.life,
    subFlags,
    inWater: mercInWater(s),
    queenSpitDirection: () => directionToward(s.gridNo + QUEEN_HEAD_OFFSET, s.targetGridNo),
  });
}

export function soldierAnimSurface(content: TacticalContent, s: Soldier, state: number): number {
  return surfaceWithSubFlags(content, s, state, bodySubFlags(s));
}

export function shownAnimSurface(content: TacticalContent, s: Soldier): number {
  return surfaceWithSubFlags(content, s, s.state, bodySubFlags(s) | profileSubFlags(content, s));
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
