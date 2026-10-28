// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/End_Game.cc sStatueGridNos, DoesO3SectorStatueExistHere, ChangeO3SectorStatue,
// @src HandleStatueDamaged; Tactical/Handle_Items.cc StartBombMessageBox (the REMOTETRIGGER branch).

import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { roomAt } from '../ai/destinations.ts';
import { addExitGridToWorld, recordExitGridAdded, recordStructureAdded, recordStructureRemoved } from '../map-changes.ts';
import { RevealedFlags } from '../perception/fov.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

const O3 = { x: 3, y: 15, z: 0 } as const;
const STATUE_GRIDNOS: readonly number[] = [13829, 13830, 13669, 13670];
const STATUE_GRIDNO = 13830;
const STATUE_EXIT_GRIDNO = 13669;
const BASEMENT_ARRIVAL_GRIDNO = 13037;
const BASEMENT = { x: 3, y: 15, z: 1 } as const;
const STATUE_ROOM = 4;
const EIGHTOSTRUCT = 19;
const STATUE_INTACT = 5;
const STATUE_DAMAGED = 7;
const STATUE_OPEN = 8;
const RECOMPILE_RADIUS = 5;
const MAX_STATUE_DAMAGE_DISTANCE = 1;

function inO3(t: TacticalState): boolean {
  const s = t.sector;
  return s !== null && s.x === O3.x && s.y === O3.y && s.z === O3.z;
}

export function o3StatueStandsAt(t: TacticalState, gridNo: number): boolean {
  return inO3(t) && !t.world.exitGrids.has(STATUE_EXIT_GRIDNO) && STATUE_GRIDNOS.includes(gridNo);
}

function statueTile(t: TacticalState, subIndex: number) {
  const tiles = t.world.tiles ?? [];
  const first = tiles.findIndex((te) => te.type === EIGHTOSTRUCT);
  return first < 0 ? null : (tiles[first + subIndex - 1] ?? null);
}

function removeStatue(t: TacticalState): void {
  const intact = statueTile(t, STATUE_INTACT)?.structure;
  if (!intact) return;
  const base = t.world.structures.at(STATUE_GRIDNO).find((s) => (s.flags & StructureFlags.BASE_TILE) !== 0 && s.def === intact) ?? null;
  if (!base) return;
  recordStructureRemoved(t, base);
  t.world.structures.remove(base);
}

function addStatue(t: TacticalState, subIndex: number): void {
  const tile = statueTile(t, subIndex);
  if (!tile?.structure) return;
  const added = t.world.structures.add(STATUE_GRIDNO, 0, tile.structure, undefined, tile.structureFile);
  if (added) recordStructureAdded(t, added);
}

export function changeO3SectorStatue(t: TacticalState, fromExplosion: boolean): void {
  removeStatue(t);
  addStatue(t, fromExplosion ? STATUE_DAMAGED : STATUE_OPEN);
  const exit = { mapIndex: STATUE_EXIT_GRIDNO, gridNo: BASEMENT_ARRIVAL_GRIDNO, sector: { ...BASEMENT } };
  addExitGridToWorld(t, exit);
  recordExitGridAdded(t, exit);
  t.fog.revealed[STATUE_EXIT_GRIDNO] = (t.fog.revealed[STATUE_EXIT_GRIDNO] ?? 0) | RevealedFlags.GROUND;
  recompileLocalMovementCosts(t.world.costs, t.world, STATUE_GRIDNO, RECOMPILE_RADIUS);
  t.events.push({ type: 'statueOpened', sector: 'O3', destroyed: fromExplosion });
}

export function statueTakesExplosion(t: TacticalState, gridNo: number, distance: number): boolean {
  if (!o3StatueStandsAt(t, gridNo) || distance > MAX_STATUE_DAMAGE_DISTANCE) return false;
  changeO3SectorStatue(t, true);
  return true;
}

export function useStatueRemote(t: TacticalState, s: Soldier): boolean {
  const opens = inO3(t) && roomAt(t, s.gridNo) === STATUE_ROOM;
  if (opens) changeO3SectorStatue(t, false);
  return opens;
}
