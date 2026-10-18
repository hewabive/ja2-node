// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc HandleDoorChangeFromGridNo;
// @src TileEngine/Structure.cc SwapStructureForPartner; Structure_Wrap.cc SetOpenableStructureToClosed. See docs/07 §1.5.

import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import type { DoorSoundKind } from '../events.ts';
import type { TacticalState } from './state.ts';

export function swapStructureForPartner(t: TacticalState, s: StructureInstance): StructureInstance | null {
  const structures = t.world.structures;
  const base = structures.findBase(s);
  if (!base?.file) return null;
  const partner = base.file.structures[base.def.number + base.def.partnerDelta];
  if (!partner) return null;
  const hitPoints = base.hitPoints;
  const level = Math.trunc(base.cubeOffset / PROFILE_Z_SIZE);
  const gridNo = base.gridNo;
  structures.remove(base);
  const added = structures.add(gridNo, level, partner, undefined, base.file);
  if (!added) {
    structures.add(gridNo, level, base.def, undefined, base.file);
    return null;
  }
  added.hitPoints = hitPoints;
  return added;
}

const MATERIAL_CLOTH = 17;
const METAL_MATERIALS: ReadonlySet<number> = new Set([21, 22, 23]);

export function doorSoundKind(door: StructureInstance): DoorSoundKind {
  if (has(door.flags, StructureFlags.SLIDINGDOOR) && door.def.armour === MATERIAL_CLOTH) return 'cloth';
  if (has(door.flags, StructureFlags.GARAGEDOOR)) return 'garage';
  return METAL_MATERIALS.has(door.def.armour) ? 'metal' : 'wood';
}

export function toggleDoorAt(t: TacticalState, gridNo: number, noisy = false): boolean {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  if (!door) return false;
  const swapped = swapStructureForPartner(t, door);
  if (!swapped) return false;
  recompileLocalMovementCosts(t.world.costs, t.world, gridNo);
  const open = has(swapped.flags, StructureFlags.OPEN);
  t.doorStatus.set(swapped.gridNo, { perceivedOpen: open });
  t.events.push({ type: 'doorChanged', gridNo: swapped.gridNo, open, kind: doorSoundKind(swapped), noisy });
  return true;
}

export function setOpenableStructureToClosed(t: TacticalState, gridNo: number): boolean {
  const openable = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  if (!openable) return false;
  if (has(openable.flags, StructureFlags.OPEN) && swapStructureForPartner(t, openable))
    recompileLocalMovementCosts(t.world.costs, t.world, gridNo);
  return true;
}

export function isDoorOpenAt(t: TacticalState, gridNo: number): boolean {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  return door !== null && has(door.flags, StructureFlags.OPEN);
}
