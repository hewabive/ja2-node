// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc HandleDoorChangeFromGridNo;
// @src TileEngine/Structure.cc SwapStructureForPartner, SwapStructureForPartnerAndStoreChangeInMap; Structure_Wrap.cc
// @src SetOpenableStructureToClosed; SaveLoadMap.cc SaveBloodSmellAndRevealedStatesFromMapToTempFile (the openable
// @src statuses), SetOpenableStructStatusFromMapTempFile.

import { WORLD_MAX } from '../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../content/world/movement-costs.ts';
import { has, PROFILE_Z_SIZE, StructureFlags, type StructureInstance, type WorldStructures } from '../../content/world/structures.ts';
import type { DoorSoundKind } from '../events.ts';
import { recordStructureAdded, recordStructureRemoved } from './map-changes.ts';
import type { TacticalState } from './state.ts';
import { ANY_VISIBILITY_VALUE, setItemsVisibilityHidden, setItemsVisibilityOn } from './world-items.ts';

const NO_PARTNER_STRUCTURE = 0;

export function swapStructureForPartner(t: TacticalState, s: StructureInstance): StructureInstance | null {
  const structures = t.world.structures;
  const base = structures.findBase(s);
  if (!base?.file || base.def.partnerDelta === NO_PARTNER_STRUCTURE) return null;
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

export function swapStructureForPartnerAndRecord(t: TacticalState, s: StructureInstance): StructureInstance | null {
  const base = t.world.structures.findBase(s);
  const swapped = swapStructureForPartner(t, s);
  if (!swapped || !base) return swapped;
  recordStructureRemoved(t, base);
  recordStructureAdded(t, swapped);
  return swapped;
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

export function setOpenableStructStatus(t: TacticalState, gridNo: number, open: boolean): void {
  const structure = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  if (!structure || has(structure.flags, StructureFlags.OPEN) === open) return;
  const baseGridNo = t.world.structures.findBase(structure)?.gridNo ?? gridNo;
  swapStructureForPartner(t, structure);
  if (open) setItemsVisibilityOn(t, baseGridNo, 0, ANY_VISIBILITY_VALUE, false);
  else setItemsVisibilityHidden(t, baseGridNo, 0);
}

export interface OpenableStatus {
  readonly gridNo: number;
  open: boolean;
}

export function openableStatuses(t: TacticalState): OpenableStatus[] {
  const statuses: OpenableStatus[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const openable = t.world.structures.find(g, StructureFlags.OPENABLE);
    if (openable && !has(openable.flags, StructureFlags.ANYDOOR))
      statuses.push({ gridNo: g, open: has(openable.flags, StructureFlags.OPEN) });
  }
  return statuses;
}

const doorsOfWorld = new WeakMap<WorldStructures, readonly number[]>();

export function doorGridNos(world: { readonly structures: WorldStructures }): readonly number[] {
  const known = doorsOfWorld.get(world.structures);
  if (known) return known;
  const doors: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const door = world.structures.find(g, StructureFlags.ANYDOOR);
    if (door && door.gridNo === g) doors.push(g);
  }
  doorsOfWorld.set(world.structures, doors);
  return doors;
}

const containersOfWorld = new WeakMap<WorldStructures, readonly number[]>();

export function containerGridNos(world: { readonly structures: WorldStructures }): readonly number[] {
  const known = containersOfWorld.get(world.structures);
  if (known) return known;
  const containers: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const openable = world.structures.find(g, StructureFlags.OPENABLE);
    if (openable && openable.gridNo === g && !has(openable.flags, StructureFlags.ANYDOOR)) containers.push(g);
  }
  containersOfWorld.set(world.structures, containers);
  return containers;
}

export function isOpenableOpenAt(t: Pick<TacticalState, 'world'>, gridNo: number): boolean {
  const openable = t.world.structures.find(gridNo, StructureFlags.OPENABLE);
  return openable !== null && has(openable.flags, StructureFlags.OPEN);
}

export function openDoorGridNos(t: TacticalState): number[] {
  const candidates = new Set([...doorGridNos(t.world), ...t.doorStatus.keys()]);
  return [...candidates].filter((g) => isDoorOpenAt(t, g)).sort((a, b) => a - b);
}

export function openContainerGridNos(t: TacticalState): number[] {
  return containerGridNos(t.world).filter((g) => isOpenableOpenAt(t, g));
}

export function isDoorOpenAt(t: TacticalState, gridNo: number): boolean {
  const door = t.world.structures.find(gridNo, StructureFlags.ANYDOOR);
  return door !== null && has(door.flags, StructureFlags.OPEN);
}
