// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc ExplosiveDamageStructureAtGridNo, ExplosiveDamageGridNo, RemoveOnWall;
// @src TileEngine/Structure.cc DamageStructure (explosion branch); Tactical/Weapons.cc WindowHit;
// @src Tactical/Handle_Items.cc RemoveAllUnburiedItems, PutItemPoolOnGround. See docs/12 §10.6.

import { DIRECTION_INCREMENT, Direction, newGridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { has, ORIENT_LEFT, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { u8 } from '../../../core/int.ts';
import { swapStructureForPartner } from '../doors.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { itemsAt, removeWorldItem, Visibility } from '../world-items.ts';
import { internalIgniteExplosion } from './explosion.ts';

export const StructureDamage = { NOT_DAMAGED: 0, DAMAGED: 1, DESTROYED: 2 } as const;

const MATERIAL_INDESTRUCTABLE_STONE = 24;
const MATERIAL_INDESTRUCTABLE_METAL = 25;
const MATERIAL_THICKER_METAL_WITH_SCREEN_WINDOWS = 26;
const WINDOW_CRACK_VOLUME = 3;
const WINDOW_SMASH_VOLUME = 7;
const EXPLOSIVE_ARMOUR_DIVISOR = 3;
const ARMOUR_DIVISOR = 2;
const NO_MULTI_FLAG = -1;

export interface StructureChanges {
  readonly gridNos: Set<number>;
}

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const centreX = (g: number) => (g % WORLD_COLS) * 10 + 5;
const centreY = (g: number) => Math.trunc(g / WORLD_COLS) * 10 + 5;

export function damageStructureByExplosion(t: TacticalState, s: StructureInstance, damageIn: number): number {
  if (has(s.flags, StructureFlags.PERSON | StructureFlags.CORPSE)) return StructureDamage.NOT_DAMAGED;
  const kind = s.def.armour;
  if (kind === MATERIAL_INDESTRUCTABLE_METAL || kind === MATERIAL_INDESTRUCTABLE_STONE) return StructureDamage.NOT_DAMAGED;
  let damage = u8(damageIn);
  const base = t.content.materialArmour[kind] ?? 0;
  const armour = Math.trunc(base / (has(s.flags, StructureFlags.EXPLOSIVE) ? EXPLOSIVE_ARMOUR_DIVISOR : ARMOUR_DIVISOR));
  if (damage < armour) return StructureDamage.NOT_DAMAGED;
  damage -= armour;
  const root = t.world.structures.findBase(s);
  if (!root) return StructureDamage.NOT_DAMAGED;
  if (root.hitPoints <= damage) return StructureDamage.DESTROYED;
  root.hitPoints -= damage;
  return StructureDamage.DAMAGED;
}

export function windowHit(t: TacticalState, g: number, structureId: number): void {
  let window = t.world.structures.findById(g, structureId);
  if (!window) return;
  window = swapStructureForPartner(t, window);
  if (!window) return;
  if (window.def.partnerDelta !== 0) window = swapStructureForPartner(t, window) ?? window;
  if (window.def.armour === MATERIAL_THICKER_METAL_WITH_SCREEN_WINDOWS) return;
  makeNoise(t, null, g, 0, window.def.partnerDelta !== 0 ? WINDOW_CRACK_VOLUME : WINDOW_SMASH_VOLUME, NoiseKind.BULLET_IMPACT);
}

function removeAllUnburiedItems(t: TacticalState, g: number, level: number): void {
  for (const wi of itemsAt(t, g, level)) if (wi.visible !== Visibility.BURIED) removeWorldItem(t, wi);
}

function putItemPoolOnGround(t: TacticalState, g: number, level: number): void {
  for (const wi of itemsAt(t, g, level)) wi.zHeight = 0;
}

function removeOnWall(t: TacticalState, g: number, flag: number): void {
  for (let attached = t.world.structures.find(g, flag); attached; attached = t.world.structures.find(g, flag)) {
    const base = t.world.structures.findBase(attached);
    if (!base) return;
    t.world.structures.remove(base);
  }
}

function removeWallAttachments(t: TacticalState, s: StructureInstance, baseG: number): void {
  if (s.wallOrientation & ORIENT_LEFT) {
    removeOnWall(t, baseG, StructureFlags.ON_LEFT_WALL);
    removeOnWall(t, newGridNo(baseG, DIRECTION_INCREMENT[Direction.SOUTH] ?? 0), StructureFlags.ON_LEFT_WALL);
  } else {
    removeOnWall(t, baseG, StructureFlags.ON_RIGHT_WALL);
    removeOnWall(t, newGridNo(baseG, DIRECTION_INCREMENT[Direction.EAST] ?? 0), StructureFlags.ON_RIGHT_WALL);
  }
}

function addDamagedGraphic(t: TacticalState, base: StructureInstance, partner: number): void {
  const def = base.file?.structures[partner - 1];
  if (def) t.world.structures.add(base.gridNo, 0, def, undefined, base.file);
}

function explosiveDamageStructureAtGridNo(
  t: TacticalState,
  current: StructureInstance,
  g: number,
  wound: number,
  onlyWalls: boolean,
  owner: Soldier | null,
  level: number,
  changes: StructureChanges,
): boolean {
  if (onlyWalls && !has(current.flags, StructureFlags.WALLSTUFF)) return true;
  if (level > 0) return true;
  if (has(current.flags, StructureFlags.CORPSE) && t.options.bloodAndGore && wound > 10) return true;
  if (has(current.flags, StructureFlags.PERSON)) return true;
  let result = damageStructureByExplosion(t, current, wound);
  if (result === StructureDamage.NOT_DAMAGED) return true;
  const base = t.world.structures.findBase(current) ?? current;
  const baseG = base.gridNo;
  if (has(base.flags, StructureFlags.OPENABLE) && !has(base.flags, StructureFlags.DOOR)) removeAllUnburiedItems(t, baseG, level);
  const explosive = has(current.flags, StructureFlags.EXPLOSIVE);
  const partner = base.def.destructionPartner;
  if (result === StructureDamage.DESTROYED && partner < 0) result = StructureDamage.DAMAGED;
  const swap = result === StructureDamage.DAMAGED && partner < 0;
  if (result !== StructureDamage.DESTROYED && !swap) return true;
  if (has(current.flags, StructureFlags.WALLSTUFF)) removeWallAttachments(t, current, baseG);
  if (has(current.flags, StructureFlags.HASITEMONTOP)) putItemPoolOnGround(t, g, level);
  t.world.structures.remove(base);
  if (swap) addDamagedGraphic(t, base, -partner);
  for (const tile of base.def.tiles) changes.gridNos.add(baseG + tile.posRelToBase);
  t.events.push({ type: 'structureDamaged', gridNo: baseG, destroyed: !swap });
  if (explosive) internalIgniteExplosion(t, owner, centreX(baseG), centreY(baseG), 0, baseG, itemIndex(t, 'STRUCTURE_EXPLOSION'), level);
  return !swap;
}

export function explosiveDamageGridNo(
  t: TacticalState,
  g: number,
  wound: number,
  distance: number,
  onlyWalls: boolean,
  multiFlagIn: number,
  owner: Soldier | null,
  level: number,
  changes: StructureChanges,
): void {
  const structures = t.world.structures;
  let multiFlag = multiFlagIn;
  let damageReturn = false;
  let toBreak = false;
  const visited = new Set<StructureInstance>();
  const nextUnvisited = () => structures.at(g).find((s) => !visited.has(s)) ?? null;
  for (let current = nextUnvisited(); current; current = nextUnvisited()) {
    visited.add(current);
    const base = structures.findBase(current);
    let multi = false;
    if (base) {
      multi = has(base.flags, StructureFlags.MULTI);
      if (multiFlag === NO_MULTI_FLAG) multiFlag = has(base.flags, StructureFlags.SPECIAL) ? 1 : 0;
      if (has(base.flags, StructureFlags.EXPLOSIVE)) base.hitPoints = 0;
    }
    if (current.cubeOffset === 0) {
      damageReturn = explosiveDamageStructureAtGridNo(t, current, g, wound, onlyWalls, owner, level, changes);
      if (!damageReturn) toBreak = true;
    }
    if (!base || !multi || onlyWalls || damageReturn) continue;
    if (distance > 1) return;
    for (const tile of base.def.tiles) {
      const tileG = base.gridNo + tile.posRelToBase;
      for (const inc of DIRECTION_INCREMENT) {
        const next = newGridNo(tileG, inc);
        if (next === tileG || next === g) continue;
        const neighbour = structures.find(next, StructureFlags.MULTI);
        if (!neighbour || (has(neighbour.flags, StructureFlags.SPECIAL) ? 1 : 0) !== multiFlag) continue;
        explosiveDamageGridNo(t, next, wound, distance, onlyWalls, multiFlag, owner, level, changes);
        internalIgniteExplosion(t, owner, centreX(next), centreY(next), 0, next, itemIndex(t, 'RDX'), level);
        toBreak = true;
      }
    }
    if (toBreak) break;
  }
}

export function recompileChangedTiles(t: TacticalState, changes: StructureChanges): void {
  for (const g of changes.gridNos) recompileLocalMovementCosts(t.world.costs, t.world, g, 1);
}
