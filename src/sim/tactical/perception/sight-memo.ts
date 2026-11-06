import type { WorldStructures } from '../../../content/world/structures.ts';
import { endHeight } from '../animation.ts';
import { soldierToSoldierLineOfSightIn } from '../combat/positions.ts';
import { type Soldier, TOTAL_SOLDIERS } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { keptApartInBloodcatArena } from './bloodcat-arena.ts';

interface LineOfSightEntry {
  viewerGridNo: number;
  viewerLevel: number;
  viewerHeight: number;
  viewerBody: number;
  viewerTerrain: number;
  targetGridNo: number;
  targetLevel: number;
  targetHeight: number;
  targetBody: number;
  targetTerrain: number;
  targetCamo: number;
  targetTilesMoved: number;
  tileLimit: number;
  aware: boolean;
  disallowSight: boolean;
  structuresVersion: number;
  smokeVersion: number;
  value: number;
}

export interface SightMemo {
  structures: WorldStructures | null;
  heights: Uint8Array | null;
  entries: (LineOfSightEntry | null)[] | null;
}

export function createSightMemo(): SightMemo {
  return { structures: null, heights: null, entries: null };
}

function entriesFor(t: TacticalState): (LineOfSightEntry | null)[] {
  const memo = t.sightMemo;
  const structures = t.world.structures;
  const heights = t.world.level.heights;
  if (memo.entries && memo.structures === structures && memo.heights === heights) return memo.entries;
  memo.structures = structures;
  memo.heights = heights;
  memo.entries = new Array<LineOfSightEntry | null>(TOTAL_SOLDIERS * TOTAL_SOLDIERS).fill(null);
  return memo.entries;
}

function targetCamo(target: Soldier, aware: boolean): number {
  return aware ? 0 : target.camo;
}

function sameInputs(e: LineOfSightEntry, t: TacticalState, viewer: Soldier, target: Soldier, tileLimit: number, aware: boolean): boolean {
  return (
    e.viewerGridNo === viewer.gridNo &&
    e.targetGridNo === target.gridNo &&
    e.tileLimit === tileLimit &&
    e.aware === aware &&
    e.structuresVersion === t.world.structures.version &&
    e.smokeVersion === t.changes.smoke &&
    e.disallowSight === t.perception.disallowSight &&
    e.viewerLevel === viewer.level &&
    e.viewerHeight === endHeight(t.content, viewer.state) &&
    e.viewerBody === viewer.bodyType &&
    e.viewerTerrain === viewer.overTerrain &&
    e.targetLevel === target.level &&
    e.targetHeight === endHeight(t.content, target.state) &&
    e.targetBody === target.bodyType &&
    e.targetTerrain === target.overTerrain &&
    e.targetCamo === targetCamo(target, aware) &&
    e.targetTilesMoved === target.tilesMoved
  );
}

function entryOf(t: TacticalState, viewer: Soldier, target: Soldier, tileLimit: number, aware: boolean, value: number): LineOfSightEntry {
  return {
    viewerGridNo: viewer.gridNo,
    viewerLevel: viewer.level,
    viewerHeight: endHeight(t.content, viewer.state),
    viewerBody: viewer.bodyType,
    viewerTerrain: viewer.overTerrain,
    targetGridNo: target.gridNo,
    targetLevel: target.level,
    targetHeight: endHeight(t.content, target.state),
    targetBody: target.bodyType,
    targetTerrain: target.overTerrain,
    targetCamo: targetCamo(target, aware),
    targetTilesMoved: target.tilesMoved,
    tileLimit,
    aware,
    disallowSight: t.perception.disallowSight,
    structuresVersion: t.world.structures.version,
    smokeVersion: t.changes.smoke,
    value,
  };
}

export function sightLineOfSight(t: TacticalState, viewer: Soldier, target: Soldier, tileLimit: number, aware: boolean): number {
  if (keptApartInBloodcatArena(t, viewer, target)) return 0;
  const entries = entriesFor(t);
  const index = viewer.id * TOTAL_SOLDIERS + target.id;
  const known = entries[index];
  if (known && sameInputs(known, t, viewer, target, tileLimit, aware)) return known.value;
  const value = soldierToSoldierLineOfSightIn(t, viewer, target, tileLimit, aware);
  entries[index] = entryOf(t, viewer, target, tileLimit, aware, value);
  return value;
}
