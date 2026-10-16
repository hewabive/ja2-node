// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc CalculateSoldierZPos, GetTargetZPosFromStructureHeight, SoldierTo3DLocationLineOfSightTest,
// @src SoldierToBodyPartLineOfSightTest; TileEngine/Structure.cc GetTallestStructureHeight. See docs/11 §1.8, docs/08 §1.2.

import { has, STRUCTURE_ON_GROUND, STRUCTURE_ON_ROOF, StructureFlags, structureHeight } from '../../../content/world/structures.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { endHeight } from '../animation.ts';
import { type LosWorld, landHeightUnits, lineOfSightTest, soldierToSoldierLineOfSight, TREE_SIGHT_REDUCTION } from '../perception/los.ts';
import { Body, type Soldier } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { AimShot } from './types.ts';

export const ZPos = { LOS: 0, FIRING: 1, TARGET: 2, HEAD_TARGET: 3, TORSO_TARGET: 4, LEGS_TARGET: 5, HEIGHT: 6 } as const;

const HEIGHT_UNITS = 256;
const HEIGHT_UNITS_PER_INDEX = 64;
const PROFILE_Z_SIZE = 4;
const STAND = 6;
const CROUCH = 3;
const PRONE = 1;

const POSITIONS: Readonly<Record<number, readonly [number, number, number]>> = {
  [ZPos.LOS]: [175, 111, 31],
  [ZPos.FIRING]: [175, 111, 31],
  [ZPos.TARGET]: [175, 111, 31],
  [ZPos.HEAD_TARGET]: [175, 111, 31],
  [ZPos.TORSO_TARGET]: [127, 71, 31],
  [ZPos.LEGS_TARGET]: [47, 31, 31],
  [ZPos.HEIGHT]: [191, 130, 63],
};

const isCreatureOrBloodcat = (s: Soldier) =>
  (s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER) || s.bodyType === Body.BLOODCAT;
const isTank = (s: Soldier) => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;

export function losWorldOf(t: TacticalState): LosWorld {
  return { structures: t.world.structures, heights: t.world.level.heights };
}

export function calculateSoldierZPos(t: TacticalState, s: Soldier, posTypeIn: number): number {
  let posType = posTypeIn;
  let height: number;
  if (s.bodyType === Body.CROW || s.overTerrain === Terrain.DEEP_WATER) height = PRONE;
  else if (s.overTerrain === Terrain.LOW_WATER || s.overTerrain === Terrain.MED_WATER) height = CROUCH;
  else {
    if (isCreatureOrBloodcat(s) || s.bodyType === Body.COW) {
      if (posType === ZPos.HEAD_TARGET || posType === ZPos.LEGS_TARGET) posType = ZPos.TORSO_TARGET;
    } else if (isTank(s)) posType = ZPos.HEAD_TARGET;
    height = endHeight(t.content, s.state);
  }
  const row = POSITIONS[posType] ?? POSITIONS[ZPos.LOS] ?? [175, 111, 31];
  let z = Math.fround(height === STAND ? row[0] : height === CROUCH ? row[1] : row[2]);
  if (s.bodyType === Body.HATKIDCIV || s.bodyType === Body.KIDCIV) z = Math.fround((z * 2) / 3);
  else if (
    s.bodyType === Body.ROBOTNOWEAPON ||
    s.bodyType === Body.LARVAE_MONSTER ||
    s.bodyType === Body.INFANT_MONSTER ||
    s.bodyType === Body.BLOODCAT
  )
    z = Math.fround(z / 3);
  else if (isTank(s)) z = Math.fround((z * 4) / 3);
  if (s.level > 0) z += HEIGHT_UNITS;
  return Math.fround(z + landHeightUnits(losWorldOf(t), s.gridNo));
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

export function soldierToSoldierLos(t: TacticalState, viewer: Soldier, target: Soldier, tileLimit: number, aware: boolean): number {
  const subject = (s: Soldier) => ({ gridNo: s.gridNo, level: s.level, heightClass: endHeight(t.content, s.state) });
  return soldierToSoldierLineOfSight(losWorldOf(t), subject(viewer), subject(target), tileLimit, aware, t.perception.disallowSight);
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
