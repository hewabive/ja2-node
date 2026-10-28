// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc HandleAllReachAbleItemsInTheSector; PathAI.cc GlobalItemsReachableTest;
// @src Handle_Items.cc ItemTypeExistsAtLocation.

import { DIRECTION_INCREMENT, newGridNo, WORLD_MAX } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { ABSMAX_TRAIL_TREE, findBestPath, NOWHERE, PathCopy, PathFlags, type PathSoldier } from './pathfinding.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { type WorldItem, WorldItemFlags } from './world-items.ts';

const CARDINAL_DIRECTIONS = [0, 2, 4, 6] as const;
const DIRECTION_COUNT = 8;
const PROBE_SOLDIER_ID = 0;

function probe(gridNo: number): PathSoldier {
  return {
    id: PROBE_SOLDIER_ID,
    team: Team.ENEMY,
    bodyType: Body.REGMALE,
    gridNo,
    level: 0,
    visible: 0,
    hasKeys: false,
    underAiControl: false,
    monsterOrAnimal: false,
  };
}

function flood(t: TacticalState, start: number, into: Uint8Array): void {
  const result = findBestPath(t.pathEnv, probe(start), NOWHERE, 0, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    maxTrailTree: ABSMAX_TRAIL_TREE,
  });
  const reached = result.reachable;
  if (!reached) return;
  for (let g = 0; g < into.length; g++) if (reached[g]) into[g] = 1;
}

function startGridNo(t: TacticalState): number {
  const info = t.world.map?.info;
  if (!info) return NOWHERE;
  for (const g of [info.centerGridNo, info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo]) if (g !== -1) return g;
  return NOWHERE;
}

function isolatedStart(t: TacticalState, mercs: readonly Soldier[]): number {
  const isolated = t.world.map?.info.isolatedGridNo ?? -1;
  if (isolated === -1) return NOWHERE;
  const reaches = (s: Soldier) => s.life > 0 && findBestPath(t.pathEnv, s, isolated, s.level, { copy: PathCopy.NONE }).length > 0;
  return mercs.some(reaches) ? isolated : NOWHERE;
}

function hasOwnershipAt(t: TacticalState, wi: WorldItem): boolean {
  const ownership = t.content.items.byName.get('OWNERSHIP')?.index ?? -2;
  return t.worldItems.some((other) => other.gridNo === wi.gridNo && other.level === wi.level && other.object.item === ownership);
}

function neighbourReaches(t: TacticalState, wi: WorldItem, reachable: Uint8Array): boolean {
  for (const dir of CARDINAL_DIRECTIONS) {
    const next = newGridNo(wi.gridNo, DIRECTION_INCREMENT[dir] ?? 0);
    if (next === wi.gridNo || !reachable[next]) continue;
    const cost = t.world.costs.get(wi.gridNo, (dir + DIRECTION_COUNT / 2) % DIRECTION_COUNT, 0);
    if (cost === TravelCost.DOOR || cost === TravelCost.WALL) continue;
    return true;
  }
  return false;
}

function itemReachable(t: TacticalState, wi: WorldItem, reachable: Uint8Array): boolean {
  if (wi.object.trap > 0) return false;
  if (hasOwnershipAt(t, wi)) return false;
  if (wi.object.item === (t.content.items.byName.get('CHALICE')?.index ?? -2)) return false;
  if (reachable[wi.gridNo]) return true;
  if (wi.level > 0) return true;
  return neighbourReaches(t, wi, reachable);
}

export function handleAllReachableItemsInTheSector(t: TacticalState, mercsInSector: readonly Soldier[]): void {
  if (t.worldItems.length === 0) return;
  const start = startGridNo(t);
  if (start === NOWHERE) return;
  const second = isolatedStart(t, mercsInSector);
  const reachable = new Uint8Array(WORLD_MAX);
  flood(t, start, reachable);
  if (second !== NOWHERE) flood(t, second, reachable);
  for (const wi of t.worldItems) {
    if (itemReachable(t, wi, reachable)) wi.flags |= WorldItemFlags.REACHABLE;
    else wi.flags &= ~WorldItemFlags.REACHABLE;
  }
}
