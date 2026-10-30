// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleTOnTerrain (the range in tiles, the line of sight at cube level 3),
// @src HandleTalkInit (the walk up: FindAdjacentGridEx, UIPlotPath, FindGridNoFromSweetSpotWithStructData with
// @src gfNPCCircularDistLimit); TacticalAI/NPC.cc Converse (NPC_ACTION_TELEPORT_NPC: BumpAnyExistingMerc,
// @src TeleportSoldier).

import { NPC_TALK_RADIUS } from '../../../content/narrative/npc-constants.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import { u8 } from '../../../core/int.ts';
import { findAdjacentGridEx } from '../combat/melee-reach.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { pathMoveMode } from '../movement-mode.ts';
import { findBestPath } from '../pathfinding.ts';
import { distanceVisible } from '../perception/sight.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { findGridNoFromSweetSpotWithStructData } from '../sweet-spots.ts';
import { teleportSoldier } from './quest-items.ts';
import { bumpAnyExistingMerc } from './schedules.ts';

const DIRECTION_IRRELEVANT = -1;
const TALK_LOS_CUBE_LEVEL = 3;
export const TALK_SWEET_SPOT_RADIUS = NPC_TALK_RADIUS - 1;

export function talkRange(a: number, b: number): number {
  const dx = (a % WORLD_COLS) - (b % WORLD_COLS);
  const dy = Math.trunc(a / WORLD_COLS) - Math.trunc(b / WORLD_COLS);
  return Math.trunc(Math.sqrt(dx * dx + dy * dy));
}

export function talkLineOfSight(t: TacticalState, merc: Soldier, target: Soldier): boolean {
  const visible = distanceVisible(t, merc, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, target.gridNo, target.level);
  return soldierTo3DLocationLos(t, merc, target.gridNo, target.level, TALK_LOS_CUBE_LEVEL, u8(visible), true) !== 0;
}

export function talkWalkUp(t: TacticalState, merc: Soldier, target: Soldier): number | null {
  const adjacent = findAdjacentGridEx(t, merc, target.gridNo, false);
  if (!adjacent) return null;
  if (findBestPath(t.pathEnv, merc, adjacent.actionGridNo, merc.level, { mode: pathMoveMode(t.content, merc.uiMovementMode) }).length === 0)
    return null;
  return findGridNoFromSweetSpotWithStructData(t, merc, target.gridNo, TALK_SWEET_SPOT_RADIUS, {
    animState: merc.uiMovementMode,
    closestToMerc: true,
    circular: true,
  });
}

export function teleportNpc(t: TacticalState, npc: Soldier, gridNo: number): void {
  bumpAnyExistingMerc(t, gridNo);
  teleportSoldier(t, npc, gridNo, false);
}
