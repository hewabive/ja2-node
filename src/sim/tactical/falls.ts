// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleGotoNewGridNo (the blind and the drunk fall on the way)

import { i8 } from '../../core/int.ts';
import type { FellDownEvent } from '../events.ts';
import { states } from './animation.ts';
import { okFallDirection, soldierCollapse } from './combat/hit.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { DrunkLevel, drunkLevel } from './drugs.ts';
import { type Soldier, shownToPlayer } from './soldier.ts';
import type { TacticalState } from './state.ts';

type FallCause = FellDownEvent['cause'];

const FALL_ONE_IN = 5;

function fallRolled(t: TacticalState): boolean {
  return t.rng.int(FALL_ONE_IN) === 0;
}

function roomToFallForward(t: TacticalState, s: Soldier): boolean {
  return okFallDirection(t, s, s.gridNo + (DIRECTION_INCREMENT[s.direction] ?? 0), s.level, s.direction, s.state);
}

function blindRunner(t: TacticalState, s: Soldier): boolean {
  return s.blindedCounter > 0 && s.state === states(t.content.animations).RUNNING;
}

function fallCause(t: TacticalState, s: Soldier): FallCause | null {
  if (blindRunner(t, s) && fallRolled(t) && roomToFallForward(t, s)) return 'blind';
  if (drunkLevel(s) === DrunkLevel.DRUNK && fallRolled(t) && roomToFallForward(t, s)) return 'drunk';
  return null;
}

function loseSomeActionPoints(t: TacticalState, s: Soldier): void {
  if (s.actionPoints > 0) s.actionPoints = i8(s.actionPoints - (t.rng.int(s.actionPoints) + 1));
}

export function tripsAndFalls(t: TacticalState, s: Soldier): boolean {
  if (s.pathIndex <= 0) return false;
  const cause = fallCause(t, s);
  if (cause === null) return false;
  if (shownToPlayer(s)) t.events.push({ type: 'fellDown', soldier: s.id, cause });
  soldierCollapse(t, s);
  loseSomeActionPoints(t, s);
  return true;
}
