// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc code 467 (the end of HELIDROP: face east, walk to the closest free tile of the
// @src south-east quadrant within three tiles).

import { Direction } from '../../content/world/grid.ts';
import { setDesiredDirection, setSoldierDirection, states } from './animation.ts';
import { getNewSoldierPath } from './movement.ts';
import { NOWHERE } from './pathfinding.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant } from './sweet-spots.ts';

const LANDING_WALK_RADIUS = 3;

export function stepAwayFromHelicopter(t: TacticalState, s: Soldier): void {
  setSoldierDirection(t, s, Direction.EAST);
  setDesiredDirection(t, s, s.direction);
  const spot = findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant(t, s, s.gridNo, LANDING_WALK_RADIUS);
  if (spot !== NOWHERE) getNewSoldierPath(t, s, spot, states(t.content.animations).WALKING);
}
