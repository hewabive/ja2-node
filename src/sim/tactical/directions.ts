// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Isometric_Utils.h DirIncrementer, OneCDirection, QuickestDirection

import { DIRECTION_COUNT } from '../../content/world/grid.ts';

export { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction } from '../../content/world/grid.ts';

export function oneCDirection(direction: number): number {
  return (direction + 1) % DIRECTION_COUNT;
}

export function quickestTurnIncrement(origin: number, dest: number, maxDistance = DIRECTION_COUNT / 2): number {
  if (origin === dest) return 0;
  if (origin > dest) return origin - dest >= maxDistance ? 1 : -1;
  return dest - origin > maxDistance ? -1 : 1;
}
