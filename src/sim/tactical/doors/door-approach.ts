// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc adjacentTiles, FindAdjacentGridExAdvanced (default policy: no diagonal door
// @src interaction); TileEngine/TileDef.h GetBitPositionIndex. See docs/25 §8.2.

import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, WORLD_COLS } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { plotPathCost } from '../ai/utils.ts';
import { newOKDestination } from '../pathfinding.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { HandleDoor } from './door-table.ts';

const D = Direction;
const IRRELEVANT = -1;

interface Relative {
  readonly inc: number;
  readonly turnTo: number;
  readonly test: number;
}

interface AdjacentTile {
  readonly kind: number;
  readonly relativeTo: readonly [Relative | null, Relative | null, Relative | null, Relative | null];
}

const FRONT_OUTSIDE: AdjacentTile['relativeTo'] = [
  { inc: 0, turnTo: D.SOUTH, test: IRRELEVANT },
  { inc: 0, turnTo: D.EAST, test: IRRELEVANT },
  { inc: WORLD_COLS, turnTo: D.NORTH, test: IRRELEVANT },
  { inc: 1, turnTo: D.WEST, test: IRRELEVANT },
];
const FRONT_INSIDE: AdjacentTile['relativeTo'] = [
  { inc: WORLD_COLS, turnTo: D.NORTH, test: IRRELEVANT },
  { inc: 1, turnTo: D.WEST, test: IRRELEVANT },
  { inc: 0, turnTo: D.SOUTH, test: IRRELEVANT },
  { inc: 0, turnTo: D.EAST, test: IRRELEVANT },
];
const GARAGE: readonly AdjacentTile['relativeTo'][] = [
  [null, null, { inc: WORLD_COLS, turnTo: D.NORTH, test: IRRELEVANT }, { inc: 1, turnTo: D.WEST, test: IRRELEVANT }],
  [null, null, { inc: 0, turnTo: D.SOUTH, test: IRRELEVANT }, { inc: 0, turnTo: D.EAST, test: IRRELEVANT }],
  [null, null, { inc: WORLD_COLS - 1, turnTo: D.NORTH, test: IRRELEVANT }, { inc: -WORLD_COLS + 1, turnTo: D.WEST, test: IRRELEVANT }],
  [null, null, { inc: -1, turnTo: D.SOUTH, test: IRRELEVANT }, { inc: -WORLD_COLS, turnTo: D.EAST, test: IRRELEVANT }],
];
const SWITCH_FRONT: AdjacentTile['relativeTo'] = [
  { inc: WORLD_COLS, turnTo: D.NORTH, test: IRRELEVANT },
  { inc: 1, turnTo: D.WEST, test: IRRELEVANT },
  null,
  null,
];

const ADJACENT_TILES: readonly AdjacentTile[] = [
  { kind: StructureFlags.DOOR, relativeTo: FRONT_OUTSIDE },
  { kind: StructureFlags.DOOR, relativeTo: FRONT_INSIDE },
  ...GARAGE.map((relativeTo) => ({ kind: StructureFlags.GARAGEDOOR, relativeTo })),
  { kind: StructureFlags.DDOOR_LEFT, relativeTo: FRONT_OUTSIDE },
  { kind: StructureFlags.DDOOR_LEFT, relativeTo: FRONT_INSIDE },
  { kind: StructureFlags.DDOOR_RIGHT, relativeTo: FRONT_OUTSIDE },
  { kind: StructureFlags.DDOOR_RIGHT, relativeTo: FRONT_INSIDE },
  { kind: StructureFlags.SLIDINGDOOR, relativeTo: FRONT_OUTSIDE },
  { kind: StructureFlags.SLIDINGDOOR, relativeTo: FRONT_INSIDE },
  { kind: StructureFlags.SWITCH, relativeTo: SWITCH_FRONT },
];

const ORIENTATION_INDEX: Readonly<Record<number, number>> = {
  [Orientation.INSIDE_LEFT]: 0,
  [Orientation.INSIDE_RIGHT]: 1,
  [Orientation.OUTSIDE_LEFT]: 2,
  [Orientation.OUTSIDE_RIGHT]: 3,
};

export interface DoorApproach {
  readonly gridNo: number;
  readonly direction: number;
}

export function findAdjacentGridExAdvanced(t: TacticalState, s: Soldier, door: StructureInstance, baseGridNo: number): DoorApproach | null {
  let closest = Number.POSITIVE_INFINITY;
  let best: DoorApproach | null = null;
  const index = ORIENTATION_INDEX[door.wallOrientation] ?? 0;
  for (const tile of ADJACENT_TILES) {
    if (!has(door.flags, tile.kind)) continue;
    s.doorHandleCode = HandleDoor.OPEN;
    const rel = tile.relativeTo[index];
    if (!rel) continue;
    const adj = baseGridNo + rel.inc;
    if (rel.test !== IRRELEVANT && t.world.costs.get(adj, rel.test, s.level) >= TravelCost.BLOCKED) continue;
    if (adj === s.gridNo) return { gridNo: adj, direction: rel.turnTo };
    if (!newOKDestination(t.pathEnv, s, adj, true, s.level)) continue;
    const distance = plotPathCost(t, s, adj, s.uiMovementMode);
    if (distance > 0 && distance <= closest) {
      closest = distance;
      best = { gridNo: adj, direction: rel.turnTo };
    }
  }
  return best;
}
