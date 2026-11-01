// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Isometric_Utils.h DirIncrementer, OneCDirection, OneCCDirection, QuickestDirection, OppositeDirection;
// @src Isometric_Utils.cc gPurpendicularDirection (2026-11-01)

import { DIRECTION_COUNT, Direction } from '../../content/world/grid.ts';

export { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction } from '../../content/world/grid.ts';

export function oneCDirection(direction: number): number {
  return (direction + 1) % DIRECTION_COUNT;
}

export function oneCCDirection(direction: number): number {
  return (direction + DIRECTION_COUNT - 1) % DIRECTION_COUNT;
}

export function oppositeDirection(direction: number): number {
  return (direction + DIRECTION_COUNT / 2) % DIRECTION_COUNT;
}

export function withinOneOctant(direction: number, of: number): boolean {
  return direction === of || direction === oneCDirection(of) || direction === oneCCDirection(of);
}

export function quickestTurnIncrement(origin: number, dest: number, maxDistance = DIRECTION_COUNT / 2): number {
  if (origin === dest) return 0;
  if (origin > dest) return origin - dest >= maxDistance ? 1 : -1;
  return dest - origin > maxDistance ? -1 : 1;
}

const { NORTH, NORTHEAST, EAST, SOUTHEAST, SOUTH, SOUTHWEST, WEST, NORTHWEST } = Direction;

const PERPENDICULAR_DIRECTION: readonly (readonly number[])[] = [
  [WEST, NORTHWEST, NORTH, NORTHEAST, EAST, NORTHWEST, NORTH, NORTHEAST],
  [NORTHWEST, NORTHWEST, SOUTH, NORTHEAST, EAST, SOUTHEAST, NORTH, NORTHEAST],
  [EAST, SOUTHEAST, NORTH, NORTHEAST, EAST, SOUTHEAST, NORTH, NORTHEAST],
  [EAST, SOUTHEAST, SOUTH, SOUTHWEST, SOUTHWEST, SOUTHEAST, SOUTH, SOUTHWEST],
  [WEST, SOUTHEAST, SOUTH, SOUTHWEST, EAST, SOUTHEAST, SOUTH, SOUTHWEST],
  [WEST, NORTHWEST, SOUTH, SOUTHWEST, WEST, SOUTHEAST, SOUTH, SOUTHWEST],
  [WEST, NORTHWEST, NORTH, SOUTHWEST, WEST, NORTHWEST, SOUTH, SOUTHWEST],
  [WEST, NORTHWEST, NORTH, SOUTHWEST, SOUTHWEST, NORTHWEST, NORTH, NORTHEAST],
];

export function perpendicularDirection(facing: number, goingTo: number): number {
  return PERPENDICULAR_DIRECTION[facing]?.[goingTo] ?? facing;
}
