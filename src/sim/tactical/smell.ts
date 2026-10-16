// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Smell.cc DecaySmells, DecayBlood, DecayBloodAndSmells, DropSmell, InternalDropBlood, DropBlood,
// @src RemoveBlood, SetRandomBloodDecayTime, GetBloodType, SetBloodType. See docs/13 §14.

import { WORLD_MAX } from '../../content/world/grid.ts';
import { u8 } from '../../core/int.ts';
import { isWater } from './pathfinding.ts';
import { Body, NOWHERE, type Soldier } from './soldier.ts';

export const BloodKind = { HUMAN: 0, CREATURE_ON_FLOOR: 1, CREATURE_ON_ROOF: 2 } as const;
export const SmellKind = { HUMAN: 0, CREATURE: 1 } as const;
export const MAX_BLOOD_QUANTITY = 7;
export const BLOOD_DIVISOR = 10;

const SMELL_TYPE_NUM_BITS = 2;
const SMELL_STRENGTH_MAX = 63;
const BLOOD_DELAY_MAX = 3;
const FLOOR_TYPE_BIT = 0x01;
const ROOF_TYPE_BIT = 0x02;
const TYPE_BITS = FLOOR_TYPE_BIT | ROOF_TYPE_BIT;
const BLOOD_DELAY_MASK = 0x03;
const BLOOD_FLOOR_SHIFT = 2;
const BLOOD_FLOOR_MASK = 0x1c;
const BLOOD_ROOF_SHIFT = 5;
const BLOOD_ROOF_MASK = 0xe0;
const BLOOD_STRENGTH_MASK = 0xfc;
const SMELL_MUDDY_DIVISOR = 3;
const SMELL_COMBINE_DIVISOR = 5;
const REALTIME_DECAY_SECONDS = 100;

export interface SmellMap {
  readonly smell: Uint8Array;
  readonly blood: Uint8Array;
  lastDecaySeconds: number;
}

export interface SmellWorld {
  readonly smell: SmellMap;
  readonly rng: { int(n: number): number };
  readonly pathWorld: Parameters<typeof isWater>[0];
}

export function createSmellMap(): SmellMap {
  return { smell: new Uint8Array(WORLD_MAX), blood: new Uint8Array(WORLD_MAX), lastDecaySeconds: 0 };
}

export function smellType(info: number): number {
  return info & FLOOR_TYPE_BIT;
}

export function smellStrength(info: number): number {
  return (info & BLOOD_STRENGTH_MASK) >> SMELL_TYPE_NUM_BITS;
}

export function bloodFloorStrength(info: number): number {
  return (info & BLOOD_FLOOR_MASK) >> BLOOD_FLOOR_SHIFT;
}

export function bloodRoofStrength(info: number): number {
  return (info & BLOOD_ROOF_MASK) >> BLOOD_ROOF_SHIFT;
}

function bloodDelay(info: number): number {
  return info & BLOOD_DELAY_MASK;
}

function noBloodStrength(info: number): boolean {
  return (info & BLOOD_STRENGTH_MASK) === 0;
}

function withFloorStrength(info: number, strength: number): number {
  return u8((strength << BLOOD_FLOOR_SHIFT) | (info & ~BLOOD_FLOOR_MASK));
}

function withRoofStrength(info: number, strength: number): number {
  return u8((info & ~BLOOD_ROOF_MASK) | (strength << BLOOD_ROOF_SHIFT));
}

function withSmell(info: number, strength: number, kind: number): number {
  return u8((info & ROOF_TYPE_BIT) | smellType(kind) | (strength << SMELL_TYPE_NUM_BITS));
}

function setRandomBloodDecayTime(w: SmellWorld, g: number): void {
  const blood = w.smell.blood;
  blood[g] = u8(((blood[g] ?? 0) & ~BLOOD_DELAY_MASK) | (w.rng.int(BLOOD_DELAY_MAX) + 1));
}

function bloodType(m: SmellMap, g: number, level: number): number {
  const info = m.smell[g] ?? 0;
  if (level === 0) return info & FLOOR_TYPE_BIT ? BloodKind.CREATURE_ON_FLOOR : BloodKind.HUMAN;
  return info & ROOF_TYPE_BIT ? BloodKind.CREATURE_ON_ROOF : BloodKind.HUMAN;
}

function setBloodType(m: SmellMap, g: number, level: number, kind: number): void {
  const bit = level === 0 ? FLOOR_TYPE_BIT : ROOF_TYPE_BIT;
  let info = (m.smell[g] ?? 0) & ~bit;
  if (kind !== BloodKind.HUMAN) info |= bit;
  m.smell[g] = u8(info);
}

export function removeBlood(m: SmellMap, g: number): void {
  m.blood[g] = 0;
}

export function decaySmells(m: SmellMap): void {
  const smell = m.smell;
  for (let g = 0; g < WORLD_MAX; g++) {
    const info = smell[g] ?? 0;
    if (info === 0) continue;
    const strength = Math.max(smellStrength(info) - 1, 0);
    smell[g] = strength === 0 ? 0 : u8((info & TYPE_BITS) | (strength << SMELL_TYPE_NUM_BITS));
  }
}

function decayBloodAt(w: SmellWorld, g: number): void {
  const blood = w.smell.blood;
  let info = blood[g] ?? 0;
  if (bloodDelay(info) > 0) info--;
  if (bloodDelay(info) !== 0) {
    blood[g] = info;
    return;
  }
  info = withFloorStrength(info, Math.max(bloodFloorStrength(info) - 1, 0));
  if (bloodFloorStrength(info) === 0 && noBloodStrength(info)) info = 0;
  info = withRoofStrength(info, Math.max(bloodRoofStrength(info) - 1, 0));
  if (bloodRoofStrength(info) === 0 && noBloodStrength(info)) info = 0;
  blood[g] = info;
  if (info) setRandomBloodDecayTime(w, g);
}

function decayBlood(w: SmellWorld): void {
  const blood = w.smell.blood;
  for (let g = 0; g < WORLD_MAX; g++) if (blood[g]) decayBloodAt(w, g);
}

export function decayBloodAndSmells(w: SmellWorld, worldSeconds: number): void {
  const m = w.smell;
  if ((worldSeconds - m.lastDecaySeconds) >>> 0 <= REALTIME_DECAY_SECONDS) return;
  m.lastDecaySeconds = worldSeconds;
  decayBlood(w);
  decaySmells(m);
}

function combinedSmell(strength: number, old: number): number {
  return Math.min(Math.max(strength, old) + Math.trunc(Math.min(strength, old) / SMELL_COMBINE_DIVISOR), SMELL_STRENGTH_MAX);
}

export function dropSmell(m: SmellMap, s: Pick<Soldier, 'level' | 'gridNo' | 'normalSmell' | 'monsterSmell'>): void {
  if (s.level !== 0) return;
  const g = s.gridNo;
  if (m.blood[g]) return;
  let strength: number;
  let kind: number;
  if (s.normalSmell > s.monsterSmell) {
    strength = u8(s.normalSmell - s.monsterSmell);
    kind = SmellKind.HUMAN;
  } else {
    strength = u8(s.monsterSmell - s.normalSmell);
    if (strength === 0) return;
    kind = SmellKind.CREATURE;
  }
  const info = m.smell[g] ?? 0;
  if (!info) {
    m.smell[g] = withSmell(info, strength, kind);
    return;
  }
  const oldKind = smellType(info);
  let oldStrength = smellStrength(info);
  if (oldKind === kind) {
    m.smell[g] = withSmell(info, combinedSmell(strength, oldStrength), kind);
    return;
  }
  if (oldStrength > strength) {
    oldStrength = u8(oldStrength - Math.trunc(strength / SMELL_MUDDY_DIVISOR));
    m.smell[g] = withSmell(info, oldStrength, oldKind);
    return;
  }
  strength = u8(strength - Math.trunc(oldStrength / SMELL_MUDDY_DIVISOR));
  m.smell[g] = strength > 0 ? withSmell(info, strength, kind) : 0;
}

export function internalDropBlood(w: SmellWorld, g: number, level: number, kind: number, amount: number): void {
  if (g === NOWHERE || isWater(w.pathWorld, g)) return;
  const m = w.smell;
  const strength = Math.min(amount, MAX_BLOOD_QUANTITY);
  const info = m.blood[g] ?? 0;
  if (level === 0) {
    const old = bloodFloorStrength(info);
    if (old > 0) {
      if (bloodType(m, g, 0) === kind) m.blood[g] = withFloorStrength(info, Math.min(old + strength, MAX_BLOOD_QUANTITY));
      else if (strength > old) m.blood[g] = withFloorStrength(info, strength);
      return;
    }
    setRandomBloodDecayTime(w, g);
    m.blood[g] = withFloorStrength(m.blood[g] ?? 0, strength);
    setBloodType(m, g, 0, kind);
    return;
  }
  const old = bloodRoofStrength(info);
  if (old > 0) {
    if (bloodType(m, g, 1) === kind) m.blood[g] = withRoofStrength(info, Math.min(Math.max(old, strength) + 1, MAX_BLOOD_QUANTITY));
    else if (strength > old) m.blood[g] = withRoofStrength(info, strength);
    return;
  }
  setRandomBloodDecayTime(w, g);
  m.blood[g] = withRoofStrength(m.blood[g] ?? 0, strength);
  setBloodType(m, g, 1, kind);
}

const isMonster = (s: Pick<Soldier, 'bodyType'>) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;

export function dropBlood(w: SmellWorld, s: Pick<Soldier, 'bodyType' | 'level' | 'gridNo'>, amount: number): void {
  const kind = !isMonster(s) ? BloodKind.HUMAN : s.level === 0 ? BloodKind.CREATURE_ON_FLOOR : BloodKind.CREATURE_ON_ROOF;
  internalDropBlood(w, s.gridNo, s.level, kind, amount);
}
