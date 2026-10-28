// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc IsValidJumpLocation (the four side directions, the movement costs both ways with
// @src door costs, a prone soldier in between); Points.cc GetAPsToJumpOver.

import { Direction, newGridNo } from '../../content/world/grid.ts';
import { isDoorTravelCost, TravelCost } from '../../content/world/movement-costs.ts';
import { AnimHeight, height } from './animation.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { newOKDestination } from './pathfinding.ts';
import { AP, apsToChangeStance, doorTravelCost } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import { type TacticalState, whoIsThere } from './state.ts';

const SIDE_DIRECTIONS = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST] as const;
const OPPOSITE = 4;
const DIRECTIONS = 8;

function sideCost(t: TacticalState, s: Soldier, g: number, dir: number): number {
  const cost = t.world.costs.get(g, dir, s.level);
  if (!isDoorTravelCost(cost)) return cost;
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  return doorTravelCost(ctx, s, g, cost, s.team === Team.OUR, false);
}

export interface JumpOver {
  readonly over: number;
  readonly direction: number;
}

export function jumpOverAt(t: TacticalState, s: Soldier, g: number, interfaceLevel: number): JumpOver | null {
  if (g === s.gridNo) return null;
  for (const dir of SIDE_DIRECTIONS) {
    const middle = newGridNo(g, DIRECTION_INCREMENT[dir] ?? 0);
    const back = (dir + OPPOSITE) % DIRECTIONS;
    if (sideCost(t, s, middle, dir) >= TravelCost.BLOCKED || sideCost(t, s, middle, back) >= TravelCost.BLOCKED) continue;
    const spot = newGridNo(middle, DIRECTION_INCREMENT[dir] ?? 0);
    if (whoIsThere(t, spot, s.level) !== s) continue;
    if (!newOKDestination(t.pathEnv, s, g, true, interfaceLevel)) continue;
    if (s.turningUntilDone) continue;
    const guy = whoIsThere(t, middle, s.level);
    if (guy && guy !== s && height(t.content, guy.state) === AnimHeight.PRONE) return { over: middle, direction: back };
  }
  return null;
}

export function isValidJumpLocation(t: TacticalState, s: Soldier, g: number, interfaceLevel: number): boolean {
  return jumpOverAt(t, s, g, interfaceLevel) !== null;
}

export function apsToJumpOver(t: TacticalState, s: Soldier): number {
  return apsToChangeStance(t.content, s, AnimHeight.STAND) + AP.JUMP_OVER;
}
