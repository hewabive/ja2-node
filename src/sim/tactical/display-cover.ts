// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/DisplayCover.cc CalculateCoverInRadiusAroundGridno, CalcCoverForGridNoBasedOnTeamKnownEnemies,
// @src GetCurrentMercForDisplayCoverStance, CalculateVisibleToSoldierAroundGridno, CalcIfSoldierCanSeeGridNo,
// @src IsTheRoofVisible (the screen check, GridNoOnScreen, is the client's); PathAI.cc LocalReachableTest.

import { CELL_X_SIZE, gridSquare, rangeInCellCoords } from '../../content/world/grid.ts';
import { clamp, idiv, u8, u16 } from '../../core/int.ts';
import { weaponInHand } from './ai/attack-choice.ts';
import { AnimHeight, states } from './animation.ts';
import { soldierToLocationChanceToGetThrough } from './combat/bullets.ts';
import { gunRange } from './combat/chance.ts';
import { soldierToVirtualSoldierLos } from './combat/positions.ts';
import { InvSlot } from './inventory.ts';
import { findBestPath, NOWHERE, PathCopy, PathFlags } from './pathfinding.ts';
import { Opp } from './perception/opp.ts';
import { distanceVisible } from './perception/sight.ts';
import { consideredNeutral, OKLIFE, type Soldier, Team, Visible } from './soldier.ts';
import { mercs, type TacticalState, whoIsThere } from './state.ts';
import { dummySoldier } from './sweet-spots.ts';
import { flatRoofAboveGridNo } from './world-items.ts';

const DC_MAX_COVER_RANGE = 31;
export const MAX_DISPLAY_RADIUS = idiv(DC_MAX_COVER_RANGE, 2);
const DIRECTION_IRRELEVANT = -1;
const GROUND_LEVEL = 0;
const ROOF_LEVEL = 1;
const NO_ROOM = 0;
const FULL_COVER = 100;
const BULLET_RANGE_BONUS = 0.3;
const PERCENT = 100;
const MIN_BULLET_GET_THROUGH = 5;
const SIGHT_STANCES = [AnimHeight.PRONE, AnimHeight.CROUCH, AnimHeight.STAND] as const;

export interface TileCover {
  readonly gridNo: number;
  readonly cover: number;
}

export interface TileSight {
  readonly gridNo: number;
  readonly stances: number;
  readonly roof: boolean;
}

export interface RoofSight {
  readonly showAllRoofs: boolean;
  revealed(g: number): boolean;
}

export function displayCoverStance(t: TacticalState, s: Soldier): number {
  const st = states(t.content.animations);
  switch (s.uiMovementMode) {
    case st.PRONE:
    case st.CRAWLING:
      return AnimHeight.PRONE;
    case st.KNEEL_DOWN:
    case st.SWATTING:
    case st.CROUCHING:
      return AnimHeight.CROUCH;
    case st.WALKING:
    case st.RUNNING:
    case st.STANDING:
      return AnimHeight.STAND;
    default:
      return AnimHeight.CROUCH;
  }
}

function displayRadius(radius: number): number {
  return Math.min(radius, MAX_DISPLAY_RADIUS);
}

function localReachable(t: TacticalState, centre: number, radius: number, level: number): Uint8Array | null {
  const flood = findBestPath(t.pathEnv, dummySoldier(centre, Team.OUR, level), NOWHERE, level, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    distLimit: radius,
  });
  return flood.reachable ?? null;
}

function visibleOtherAt(t: TacticalState, s: Soldier, g: number): boolean {
  const there = whoIsThere(t, g, GROUND_LEVEL) ?? whoIsThere(t, g, ROOF_LEVEL);
  return there !== null && there.visible === Visible.SEEN && there.team !== s.team;
}

export function coverAroundGridNo(t: TacticalState, s: Soldier, centre: number, interfaceLevel: number, radius: number): TileCover[] {
  const range = displayRadius(radius);
  const level = interfaceLevel === ROOF_LEVEL ? ROOF_LEVEL : GROUND_LEVEL;
  const reachable = localReachable(t, centre, range, level);
  const stance = displayCoverStance(t, s);
  const tiles: TileCover[] = [];
  for (const g of gridSquare(centre, range)) {
    if (level === ROOF_LEVEL && !flatRoofAboveGridNo(t, g)) continue;
    if (!reachable?.[g]) continue;
    if (visibleOtherAt(t, s, g)) continue;
    tiles.push({ gridNo: g, cover: coverAgainstKnownEnemies(t, s, g, stance) });
  }
  return tiles;
}

function seenThisTurn(value: number): boolean {
  return value === Opp.SEEN_CURRENTLY || value === Opp.SEEN_THIS_TURN;
}

function knownToOurTeam(t: TacticalState, s: Soldier, opp: Soldier): boolean {
  return seenThisTurn(s.oppList[opp.id] ?? 0) || seenThisTurn(t.perception.publicOpp[Team.OUR]?.[opp.id] ?? 0);
}

function isOpponent(s: Soldier, opp: Soldier): boolean {
  return opp.life >= OKLIFE && !consideredNeutral(s, opp) && s.side !== opp.side;
}

function maxRangeOf(t: TacticalState, opp: Soldier): number {
  const hand = opp.inv[InvSlot.HAND];
  if (hand && weaponInHand(t, opp)) return gunRange(t.content.items, hand);
  return t.content.items.byName.get('GLOCK_18')?.weapon?.range ?? 0;
}

function bulletGetThrough(maxRange: number, range: number): number {
  const share = Math.fround((maxRange - range) / maxRange);
  const percent = Math.trunc((share + BULLET_RANGE_BONUS) * PERCENT);
  return Number.isFinite(percent) ? clamp(percent, 0, PERCENT) : 0;
}

function coverFrom(t: TacticalState, s: Soldier, opp: Soldier, g: number, stance: number): number | null {
  const range = u16(rangeInCellCoords(opp.gridNo, g));
  const sightLimit = u16(distanceVisible(t, opp, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, s.level));
  if (range > sightLimit * CELL_X_SIZE) return null;
  if (soldierToVirtualSoldierLos(t, opp, g, s.level, stance, u8(sightLimit), true) === 0) return null;
  const getThrough = soldierToLocationChanceToGetThrough(t, opp, g, s.level, stance, null);
  const throughRange = bulletGetThrough(maxRangeOf(t, opp), range);
  if (throughRange <= MIN_BULLET_GET_THROUGH || getThrough <= 0) return null;
  return idiv(getThrough * throughRange, PERCENT);
}

function coverAgainstKnownEnemies(t: TacticalState, s: Soldier, g: number, stance: number): number {
  let total = 0;
  let enemies = 0;
  let highest = 0;
  for (const opp of mercs(t)) {
    if (!isOpponent(s, opp) || !knownToOurTeam(t, s, opp)) continue;
    const cover = coverFrom(t, s, opp, g, stance);
    if (cover === null) continue;
    highest = Math.max(highest, cover);
    total += cover;
    enemies++;
  }
  if (enemies === 0) return FULL_COVER;
  const exposure = idiv(total, enemies) - idiv(highest, enemies) + highest;
  return clamp(FULL_COVER - exposure, 0, FULL_COVER);
}

function isTheRoofVisible(t: TacticalState, g: number, roofs: RoofSight): boolean {
  if ((t.world.level.rooms[g] ?? NO_ROOM) === NO_ROOM) return false;
  return roofs.revealed(g) ? roofs.showAllRoofs : true;
}

function sightLevelAt(t: TacticalState, g: number, roofs: RoofSight): number | null {
  if (!flatRoofAboveGridNo(t, g)) return GROUND_LEVEL;
  const aboveGround = (t.sector?.z ?? 0) === 0;
  if (isTheRoofVisible(t, g, roofs) && aboveGround) return ROOF_LEVEL;
  if (!roofs.revealed(g) && !aboveGround) return null;
  return GROUND_LEVEL;
}

function awareOf(t: TacticalState, s: Soldier, there: Soldier | null): boolean {
  if (!there) return false;
  return (s.oppList[there.id] ?? 0) !== 0 || (t.perception.publicOpp[s.team]?.[there.id] ?? 0) !== 0;
}

function stancesSeen(t: TacticalState, s: Soldier, g: number, level: number): number {
  const aware = awareOf(t, s, whoIsThere(t, g, level));
  const sightLimit = u8(distanceVisible(t, s, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, level));
  return SIGHT_STANCES.filter((stance) => soldierToVirtualSoldierLos(t, s, g, level, stance, sightLimit, aware) !== 0).length;
}

export function sightAroundGridNo(t: TacticalState, s: Soldier, centre: number, radius: number, roofs: RoofSight): TileSight[] {
  const tiles: TileSight[] = [];
  for (const g of gridSquare(centre, displayRadius(radius))) {
    const level = sightLevelAt(t, g, roofs);
    if (level === null) continue;
    tiles.push({ gridNo: g, stances: stancesSeen(t, s, g, level), roof: level === ROOF_LEVEL });
  }
  return tiles;
}
