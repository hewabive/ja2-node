// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc ValidQuickExchangePosition (the target, the distance, the line of sight and the path,
// @src without the cursor timer); Soldier_Tile.cc CanExchangePlaces. See docs/28 §6.1.

import { AnimFlags } from '../../content/anim/tables.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { u8 } from '../../core/int.ts';
import { endHeight, hasAnimFlag } from './animation.ts';
import { soldierTo3DLocationLos } from './combat/positions.ts';
import { pathMoveMode } from './movement-mode.ts';
import { findBestPath, PathCopy, PathFlags } from './pathfinding.ts';
import { distanceVisible } from './perception/sight.ts';
import { internalIsValidStance } from './person-structure.ts';
import { AP, enoughPoints } from './points.ts';
import { Body, CivilianGroup, NOWHERE, OKLIFE, Orders, Side, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

const DIRECTION_IRRELEVANT = -1;
const EXCHANGE_LOS_CUBE_LEVEL = 3;
const ADJACENT = 1;

export function isAnimalBody(s: { readonly bodyType: number }): boolean {
  return s.bodyType === Body.COW || s.bodyType === Body.CROW || s.bodyType === Body.BLOODCAT;
}

export function validQuickExchangePosition(t: TacticalState, sel: Soldier, over: Soldier): boolean {
  const candidate = (over.team !== Team.OUR && over.neutral) || (over.team === Team.MILITIA && over.side === Side.FRIENDLY);
  if (!candidate || isAnimalBody(over)) return false;
  if (pythSpacesAway(sel.gridNo, over.gridNo) !== ADJACENT) return false;
  const visible = distanceVisible(t, sel, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, over.gridNo, over.level);
  if (soldierTo3DLocationLos(t, sel, over.gridNo, over.level, EXCHANGE_LOS_CUBE_LEVEL, u8(visible), true) === 0) return false;
  const route = findBestPath(t.pathEnv, sel, over.gridNo, sel.level, {
    copy: PathCopy.NONE,
    mode: pathMoveMode(t.content, sel.uiMovementMode),
    flags: PathFlags.IGNORE_PERSON_AT_DEST,
  });
  return route.length === 1;
}

function isMoving(t: TacticalState, s: Soldier): boolean {
  return hasAnimFlag(t.content, s.state, AnimFlags.MOVING);
}

export function seenExchangeChecks(t: TacticalState, s1: Soldier, s2: Soldier): boolean {
  if (isMoving(t, s2)) return false;
  if (isMoving(t, s1) && !t.inCombat) return false;
  return (
    internalIsValidStance(t, s1, s2.direction, endHeight(t.content, s2.state)) &&
    internalIsValidStance(t, s2, s1.direction, endHeight(t.content, s1.state))
  );
}

function willingToExchange(s2: Soldier): boolean {
  if (isAnimalBody(s2)) return false;
  const moving = s2.absoluteFinalDestination !== NOWHERE && s2.absoluteFinalDestination !== s2.gridNo;
  return (
    s2.neutral &&
    s2.life >= OKLIFE &&
    s2.civilianGroup !== CivilianGroup.HICKS &&
    (s2.ai.orders !== Orders.STATIONARY || s2.team === Team.MILITIA || moving)
  );
}

export function canExchangePlaces(t: TacticalState, s1: Soldier, s2: Soldier): boolean {
  if (!enoughPoints(t.inCombat, s1, AP.EXCHANGE_PLACES) || !enoughPoints(t.inCombat, s2, AP.EXCHANGE_PLACES)) return false;
  if (!seenExchangeChecks(t, s1, s2)) return false;
  return s2.side === Side.FRIENDLY || willingToExchange(s2);
}
