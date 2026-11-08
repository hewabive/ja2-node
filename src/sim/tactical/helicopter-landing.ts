// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc code 467 (the end of HELIDROP: face east, walk to the closest free tile of the
// @src south-east quadrant within three tiles; the drop's gfIngagedInDrop cleared and HandleMercArrivesQuotes between
// @src the search and the path, the script left on the code, 2026-11-08).

import type { OpOutcome } from '../../content/anim/script.ts';
import { Direction } from '../../content/world/grid.ts';
import { setDesiredDirection, setSoldierDirection, states } from './animation.ts';
import { getNewSoldierPath } from './movement.ts';
import { NOWHERE } from './pathfinding.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant } from './sweet-spots.ts';

const LANDING_WALK_RADIUS = 3;
const OP_HELIDROP_LANDED = 467;

function faceEast(t: TacticalState, s: Soldier): void {
  setSoldierDirection(t, s, Direction.EAST);
  setDesiredDirection(t, s, s.direction);
}

function stepAwaySpot(t: TacticalState, s: Soldier): number {
  return findGridNoFromSweetSpotExcludingSweetSpotInSouthEastQuadrant(t, s, s.gridNo, LANDING_WALK_RADIUS);
}

function walkTo(t: TacticalState, s: Soldier, spot: number): void {
  if (spot !== NOWHERE) getNewSoldierPath(t, s, spot, states(t.content.animations).WALKING);
}

export function stepAwayFromHelicopter(t: TacticalState, s: Soldier): void {
  faceEast(t, s);
  walkTo(t, s, stepAwaySpot(t, s));
}

export function helicopterLandingOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== OP_HELIDROP_LANDED) return null;
  faceEast(t, s);
  t.helicopterDrop.engagedInDrop = false;
  const spot = stepAwaySpot(t, s);
  t.sectorHooks.mercArrivesQuotes(t, s);
  walkTo(t, s, spot);
  return 'stop';
}
