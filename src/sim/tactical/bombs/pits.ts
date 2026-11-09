// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Pits.cc Add3X3Pit, Add5X5Pit, SearchForOtherMembersWithinPitRadiusAndMakeThemFall,
// @src HandleFallIntoPitFromAnimation; Tactical/Soldier_Ani.cc code 754.

import type { OpOutcome } from '../../../content/anim/script.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { tileIndexFromTypeSubIndex, typeIndex } from '../../../content/world/tile-tables.ts';
import { u8, u16 } from '../../../core/int.ts';
import { anim } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import { type AddedExitGrid, addExitGridToWorld, addObjectToTail, recordExitGridAdded } from '../map-changes.ts';
import { setUnplacedSoldierHeight } from '../roofs.ts';
import { exitGridAt } from '../sector-exit.ts';
import { leaveTacticalSector } from '../sector-presence.ts';
import { type Soldier, shownToPlayer } from '../soldier.ts';
import { type SectorRef, type TacticalState, whoIsThere } from '../state.ts';

export interface PitShape {
  readonly radius: number;
  readonly firstTexture: number;
  readonly costRadius: number;
}

export const SMALL_PIT: PitShape = { radius: 1, firstTexture: 1, costRadius: 2 };
export const LARGE_PIT: PitShape = { radius: 2, firstTexture: 10, costRadius: 3 };

const PIT_TEXTURE_TYPE = 'REGWATERTEXTURE';
const FALL_INTO_PIT_CODE = 754;
const GROUND_LEVEL = 0;
const GROUND_HEIGHT = 0;
const NO_SECTOR: SectorRef = { x: 0, y: 0, z: 0 };
const NO_EXIT_GRID = { gridNo: 0, sector: NO_SECTOR };

function pitTiles(centre: number, radius: number): number[] {
  const tiles: number[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = radius; dy >= -radius; dy--) tiles.push(centre + dy * WORLD_COLS + dx);
  }
  return tiles;
}

function addPitTextures(t: TacticalState, centre: number, shape: PitShape): void {
  const tables = t.world.tables;
  if (!tables) return;
  const type = typeIndex(tables, PIT_TEXTURE_TYPE);
  pitTiles(centre, shape.radius).forEach((g, k) => {
    addObjectToTail(t, g, tileIndexFromTypeSubIndex(tables, type, shape.firstTexture + k));
  });
}

function sectorBelow(t: TacticalState): SectorRef {
  const here = t.sector ?? NO_SECTOR;
  return { x: here.x, y: here.y, z: u8(here.z + 1) };
}

function addPitExitGrids(t: TacticalState, centre: number, shape: PitShape): void {
  const below = sectorBelow(t);
  for (const g of pitTiles(centre, shape.radius)) {
    const exit: AddedExitGrid = { mapIndex: g, gridNo: u16(centre), sector: { ...below } };
    addExitGridToWorld(t, exit);
    recordExitGridAdded(t, exit);
  }
  recompileLocalMovementCosts(t.world.costs, t.world, centre, shape.costRadius);
}

function makeSoldiersAroundFall(t: TacticalState, centre: number, radius: number): void {
  t.events.push({ type: 'pitOpened', gridNo: centre });
  const fall = anim(t.content, 'FALL_INTO_PIT');
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const g = centre + y * WORLD_COLS + x;
      const s = whoIsThere(t, g, GROUND_LEVEL);
      if (!s) continue;
      s.pendingActionData4 = g;
      initNewSoldierAnim(t, s, fall, 0, false);
    }
  }
}

export function openPit(t: TacticalState, centre: number, shape: PitShape): void {
  addPitTextures(t, centre, shape);
  addPitExitGrids(t, centre, shape);
  makeSoldiersAroundFall(t, centre, shape.radius);
}

function handleFallIntoPitFromAnimation(t: TacticalState, s: Soldier): void {
  const pit = s.pendingActionData4;
  const exit = exitGridAt(t, pit) ?? NO_EXIT_GRID;
  if (shownToPlayer(s)) t.events.push({ type: 'fellIntoPit', soldier: s.id, gridNo: pit });
  s.insertionData = exit.gridNo;
  leaveTacticalSector(t, s);
  t.sectorHooks.soldierFellIntoPit(t, s, exit.sector);
  setUnplacedSoldierHeight(s, GROUND_HEIGHT);
}

export function pitOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== FALL_INTO_PIT_CODE) return null;
  handleFallIntoPitFromAnimation(t, s);
  return 'stop';
}
