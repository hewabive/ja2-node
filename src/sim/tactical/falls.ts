// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleGotoNewGridNo (the blind and the drunk fall on the way, the slip on marbles
// @src before them); Tactical/Handle_Items.cc ItemTypeExistsAtLocation

import { Terrain } from '../../content/world/terrain.ts';
import { i8 } from '../../core/int.ts';
import type { FellDownEvent } from '../events.ts';
import { states } from './animation.ts';
import { okFallDirection, soldierCollapse } from './combat/hit.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { DrunkLevel, drunkLevel } from './drugs.ts';
import { type Soldier, shownToPlayer } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { itemsAt, removeWorldItem, type WorldItem } from './world-items.ts';

type FallCause = FellDownEvent['cause'];

const FALL_ONE_IN = 5;
const GROUND_LEVEL = 0;
const SLIPPERY_TERRAINS: readonly number[] = [Terrain.FLAT_FLOOR, Terrain.PAVED_ROAD];

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

export function loseSomeActionPoints(t: TacticalState, s: Soldier): void {
  if (s.actionPoints > 0) s.actionPoints = i8(s.actionPoints - (t.rng.int(s.actionPoints) + 1));
}

function marblesUnderfoot(t: TacticalState, s: Soldier): WorldItem | undefined {
  if (s.level !== GROUND_LEVEL || !SLIPPERY_TERRAINS.includes(s.overTerrain)) return undefined;
  const marbles = t.content.items.byName.get('MARBLES')?.index;
  return itemsAt(t, s.gridNo, GROUND_LEVEL).find((wi) => wi.object.item === marbles);
}

function slipsOnMarbles(t: TacticalState, s: Soldier): boolean {
  const marbles = marblesUnderfoot(t, s);
  if (!marbles) return false;
  if (shownToPlayer(s)) t.events.push({ type: 'slippedOnMarbles', soldier: s.id });
  removeWorldItem(t, marbles);
  soldierCollapse(t, s);
  loseSomeActionPoints(t, s);
  return true;
}

export function tripsAndFalls(t: TacticalState, s: Soldier): boolean {
  if (s.pathIndex <= 0) return false;
  if (slipsOnMarbles(t, s)) return true;
  const cause = fallCause(t, s);
  if (cause === null) return false;
  if (shownToPlayer(s)) t.events.push({ type: 'fellDown', soldier: s.id, cause });
  soldierCollapse(t, s);
  loseSomeActionPoints(t, s);
  return true;
}
