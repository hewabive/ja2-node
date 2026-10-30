// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc CalculateSoldierZPos, GetTargetZPosFromStructureHeight, SoldierToSoldierLineOfSightTest,
// @src SoldierTo3DLocationLineOfSightTest, SoldierToBodyPartLineOfSightTest; TileEngine/Structure.cc GetTallestStructureHeight.

import { has, STRUCTURE_ON_GROUND, STRUCTURE_ON_ROOF, StructureFlags, structureHeight } from '../../../content/world/structures.ts';
import { endHeight } from '../animation.ts';
import { smokeTypeOnTile } from '../explosions/smoke.ts';
import { keptApartInBloodcatArena } from '../perception/bloodcat-arena.ts';
import {
  type LosSubject,
  type LosWorld,
  landHeightUnits,
  lineOfSightTest,
  type SightTarget,
  soldierToSoldierLineOfSight,
  soldierZPos,
  TREE_SIGHT_REDUCTION,
  ZPos,
} from '../perception/los.ts';
import { isMonster, type Soldier } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { AimShot } from './types.ts';

const HEIGHT_UNITS = 256;
const HEIGHT_UNITS_PER_INDEX = 64;
const PROFILE_Z_SIZE = 4;
const STAND = 6;

export function losWorldOf(t: TacticalState): LosWorld {
  return { structures: t.world.structures, heights: t.world.level.heights, smokeAt: (g, level) => smokeTypeOnTile(t, g, level) };
}

function losSubject(t: TacticalState, s: Soldier): LosSubject {
  return { gridNo: s.gridNo, level: s.level, heightClass: endHeight(t.content, s.state), bodyType: s.bodyType, overTerrain: s.overTerrain };
}

export function calculateSoldierZPos(t: TacticalState, s: Soldier, posType: number): number {
  return soldierZPos(losWorldOf(t), losSubject(t, s), posType);
}

export function tallestStructureHeight(t: TacticalState, g: number, onRoof: boolean, preferOpenables: boolean): number {
  const desired = onRoof ? STRUCTURE_ON_ROOF : STRUCTURE_ON_GROUND;
  if (preferOpenables) {
    const openable = t.world.structures.find(g, StructureFlags.DOOR | StructureFlags.OPENABLE);
    if (openable && openable.cubeOffset === desired) return structureHeight(openable);
  }
  let tallest = 0;
  for (const s of t.world.structures.at(g)) {
    if (s.cubeOffset !== desired || has(s.flags, StructureFlags.NORMAL_ROOF)) continue;
    tallest = Math.max(tallest, structureHeight(s));
  }
  return tallest;
}

export function targetZFromStructureHeight(t: TacticalState, g: number, level: number, cubeLevel: number): number {
  let z: number;
  if (cubeLevel) z = Math.fround((cubeLevel + level * PROFILE_Z_SIZE - 0.5) * HEIGHT_UNITS_PER_INDEX);
  else {
    let h = tallestStructureHeight(t, g, level === 1, true);
    if (h > 0) {
      if (h > 1) h--;
      z = Math.fround((h + level * PROFILE_Z_SIZE - 0.5) * HEIGHT_UNITS_PER_INDEX);
    } else z = level * PROFILE_Z_SIZE * HEIGHT_UNITS_PER_INDEX + 1;
  }
  return Math.fround(z + landHeightUnits(losWorldOf(t), g));
}

function sightTarget(t: TacticalState, s: Soldier, aware: boolean): SightTarget {
  return { ...losSubject(t, s), camo: aware ? 0 : s.camo, tilesMoved: s.tilesMoved };
}

export function soldierToSoldierLos(t: TacticalState, viewer: Soldier, target: Soldier, tileLimit: number, aware: boolean): number {
  if (keptApartInBloodcatArena(t, viewer, target)) return 0;
  return soldierToSoldierLineOfSight(
    losWorldOf(t),
    losSubject(t, viewer),
    sightTarget(t, target, aware),
    tileLimit,
    aware,
    t.perception.disallowSight,
    isMonster(viewer),
  );
}

export function soldierTo3DLocationLos(
  t: TacticalState,
  s: Soldier,
  g: number,
  level: number,
  cubeLevel: number,
  tileLimit: number,
  aware: boolean,
): number {
  const startZ = calculateSoldierZPos(t, s, ZPos.LOS);
  let endZ: number;
  if (cubeLevel > 0)
    endZ = Math.fround((cubeLevel + level * PROFILE_Z_SIZE - 0.5) * HEIGHT_UNITS_PER_INDEX) + landHeightUnits(losWorldOf(t), g);
  else {
    const target = whoIsThere(t, g, level);
    if (target) return soldierToSoldierLos(t, s, target, tileLimit, aware);
    endZ = 175 + level * HEIGHT_UNITS + landHeightUnits(losWorldOf(t), g);
  }
  return lineOfSightTest(losWorldOf(t), s.gridNo, startZ, g, endZ, {
    tileLimit,
    treeReduction: TREE_SIGHT_REDUCTION[STAND] ?? 6,
    aware,
    camo: 0,
    disallowSight: t.perception.disallowSight,
  });
}

export function aimPosType(aim: number): number {
  return aim === AimShot.HEAD
    ? ZPos.HEAD_TARGET
    : aim === AimShot.TORSO
      ? ZPos.TORSO_TARGET
      : aim === AimShot.LEGS
        ? ZPos.LEGS_TARGET
        : ZPos.TARGET;
}

export function soldierToBodyPartLos(
  t: TacticalState,
  s: Soldier,
  g: number,
  level: number,
  aim: number,
  tileLimit: number,
  aware: boolean,
): number {
  const target = whoIsThere(t, g, level);
  if (!target) return 0;
  const startZ = calculateSoldierZPos(t, s, ZPos.LOS);
  const endZ = calculateSoldierZPos(t, target, aimPosType(aim));
  return lineOfSightTest(losWorldOf(t), s.gridNo, startZ, g, endZ, {
    tileLimit,
    treeReduction: TREE_SIGHT_REDUCTION[STAND] ?? 6,
    aware,
    camo: 0,
    disallowSight: t.perception.disallowSight,
  });
}
