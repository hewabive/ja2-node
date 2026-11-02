// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Explosion_Control.cc ExplosiveDamageStructureAtGridNo (what wreckage.ts does not cover),
// @src ExplosiveDamageGridNo;
// @src TileEngine/Structure.cc DamageStructure (explosion branch); Tactical/Weapons.cc WindowHit;
// @src Tactical/Handle_Items.cc RemoveAllUnburiedItems, PutItemPoolOnGround; Tactical/End_Game.cc HandleStatueDamaged (the
// @src BeforeStructureDamaged listener); Tactical/Overhead.cc HandleBrothelWallDestroyed and Strategic/SAM_Sites.cc
// @src UpdateAndDamageSAMIfFound (the OnStructureDamaged listeners, in key order); Tactical/Rotting_Corpses.cc VaporizeCorpse.

import { NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { has, ORIENT_RIGHT, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { idiv, u8 } from '../../../core/int.ts';
import type { WindowShatterTile } from '../../events.ts';
import { corpseOfStructure, isVehicleCorpse } from '../combat/death.ts';
import { swapStructureForPartnerAndRecord } from '../doors.ts';
import { levelNodeTile, recordStructureDamaged, recordStructureRemoved } from '../map-changes.ts';
import { handleBrothelWallDestroyed } from '../narrative/civ-hostility.ts';
import { statueTakesExplosion } from '../narrative/statue.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { removeRottingCorpse } from '../rotting-corpses.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { itemsAt, removeWorldItem, Visibility } from '../world-items.ts';
import { internalIgniteExplosion, Spread, spreadEffect } from './explosion.ts';
import { addPartnerGraphic, markStructureTiles, type StructureChanges, wreckSurroundings } from './wreckage.ts';

export const StructureDamage = { NOT_DAMAGED: 0, DAMAGED: 1, DESTROYED: 2 } as const;

const MATERIAL_INDESTRUCTABLE_STONE = 24;
const MATERIAL_INDESTRUCTABLE_METAL = 25;
const MATERIAL_THICKER_METAL_WITH_SCREEN_WINDOWS = 26;
const WINDOW_CRACK_VOLUME = 3;
const WINDOW_SMASH_VOLUME = 7;
const EXPLOSIVE_ARMOUR_DIVISOR = 3;
const ARMOUR_DIVISOR = 2;
const NO_MULTI_FLAG = -1;
const CORPSE_SPRAYING_WOUND = 10;
const VAPORIZING_DISTANCE = 1;
const CORPSE_BLOOD_RADIUS = 2;

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const centreX = (g: number) => (g % WORLD_COLS) * 10 + 5;
const centreY = (g: number) => idiv(g, WORLD_COLS) * 10 + 5;

export function damageStructureByExplosion(t: TacticalState, s: StructureInstance, damageIn: number): number {
  if (has(s.flags, StructureFlags.PERSON | StructureFlags.CORPSE)) return StructureDamage.NOT_DAMAGED;
  const kind = s.def.armour;
  if (kind === MATERIAL_INDESTRUCTABLE_METAL || kind === MATERIAL_INDESTRUCTABLE_STONE) return StructureDamage.NOT_DAMAGED;
  let damage = u8(damageIn);
  const base = t.content.materialArmour[kind] ?? 0;
  const armour = idiv(base, has(s.flags, StructureFlags.EXPLOSIVE) ? EXPLOSIVE_ARMOUR_DIVISOR : ARMOUR_DIVISOR);
  if (damage < armour) return StructureDamage.NOT_DAMAGED;
  damage -= armour;
  const root = t.world.structures.findBase(s);
  if (!root) return StructureDamage.NOT_DAMAGED;
  if (root.hitPoints <= damage) return StructureDamage.DESTROYED;
  root.hitPoints -= damage;
  recordStructureDamaged(t, root);
  return StructureDamage.DAMAGED;
}

export function windowHit(t: TacticalState, g: number, structureId: number, blowSouth: boolean): void {
  let window = t.world.structures.findById(g, structureId);
  if (!window) return;
  window = swapStructureForPartnerAndRecord(t, window);
  if (!window) return;
  if (window.def.partnerDelta !== 0) window = swapStructureForPartnerAndRecord(t, window) ?? window;
  if (window.def.armour === MATERIAL_THICKER_METAL_WITH_SCREEN_WINDOWS) return;
  if (window.def.partnerDelta !== 0) {
    makeNoise(t, null, g, 0, WINDOW_CRACK_VOLUME, NoiseKind.BULLET_IMPACT);
    return;
  }
  makeNoise(t, null, g, 0, WINDOW_SMASH_VOLUME, NoiseKind.BULLET_IMPACT);
  shatterWindow(t, g, window, blowSouth);
}

function shatterWindow(t: TacticalState, g: number, window: StructureInstance, blowSouth: boolean): void {
  const right = (window.wallOrientation & ORIENT_RIGHT) !== 0;
  const gridNo = blowSouth ? g + (right ? 1 : WORLD_COLS) : g;
  t.events.push({ type: 'windowShattered', gridNo, tile: shatterTile(right, blowSouth) });
}

function shatterTile(right: boolean, blowSouth: boolean): WindowShatterTile {
  if (right) return blowSouth ? 'WINDOWSHATTER1' : 'WINDOWSHATTER11';
  return blowSouth ? 'WINDOWSHATTER6' : 'WINDOWSHATTER16';
}

function removeAllUnburiedItems(t: TacticalState, g: number, level: number): void {
  for (const wi of itemsAt(t, g, level)) if (wi.visible !== Visibility.BURIED) removeWorldItem(t, wi);
}

function putItemPoolOnGround(t: TacticalState, g: number, level: number): void {
  for (const wi of itemsAt(t, g, level)) wi.zHeight = 0;
}

function standing(t: TacticalState, base: StructureInstance): boolean {
  return t.world.structures.findById(base.gridNo, base.id) === base;
}

function vaporizeCorpse(t: TacticalState, current: StructureInstance): void {
  const base = t.world.structures.findBase(current) ?? current;
  const corpse = corpseOfStructure(t, base);
  if (!corpse || isVehicleCorpse(corpse)) return;
  const g = base.gridNo;
  t.events.push({ type: 'corpseVaporized', gridNo: g, x: centreX(g), y: centreY(g), z: 0 });
  removeRottingCorpse(t, corpse, base);
  if (corpse.level === 0) spreadEffect(t, g, CORPSE_BLOOD_RADIUS, NOTHING, null, Spread.BLOOD, 0, null);
}

function structureDamaged(t: TacticalState, g: number, current: StructureInstance, wound: number, destroyed: boolean): void {
  handleBrothelWallDestroyed(t, g, current, destroyed);
  t.sectorHooks.structureDamaged(t, g, u8(wound));
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
  distance: number,
): boolean {
  if (statueTakesExplosion(t, g, distance)) return true;
  if (onlyWalls && !has(current.flags, StructureFlags.WALLSTUFF)) return true;
  if (level > 0) return true;
  if (has(current.flags, StructureFlags.CORPSE) && t.options.bloodAndGore && wound > CORPSE_SPRAYING_WOUND) {
    if (distance <= VAPORIZING_DISTANCE) vaporizeCorpse(t, current);
    return true;
  }
  if (has(current.flags, StructureFlags.PERSON)) return true;
  let result = damageStructureByExplosion(t, current, wound);
  if (result === StructureDamage.NOT_DAMAGED) return true;
  structureDamaged(t, g, current, wound, result === StructureDamage.DESTROYED);
  const base = t.world.structures.findBase(current) ?? current;
  const baseG = base.gridNo;
  if (has(base.flags, StructureFlags.OPENABLE) && !has(base.flags, StructureFlags.DOOR)) removeAllUnburiedItems(t, baseG, level);
  const explosive = has(current.flags, StructureFlags.EXPLOSIVE);
  const partner = base.def.destructionPartner;
  if (result === StructureDamage.DESTROYED && partner < 0) result = StructureDamage.DAMAGED;
  const swap = result === StructureDamage.DAMAGED && partner < 0;
  if (result !== StructureDamage.DESTROYED && !swap) return true;
  wreckSurroundings(t, { current, base, destructionPartner: partner, baseTile: levelNodeTile(t, base) }, changes);
  if (has(current.flags, StructureFlags.HASITEMONTOP)) putItemPoolOnGround(t, g, level);
  if (standing(t, base)) {
    recordStructureRemoved(t, base);
    t.world.structures.remove(base);
  }
  if (swap) addPartnerGraphic(t, base, -partner);
  markStructureTiles(changes, base);
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
      damageReturn = explosiveDamageStructureAtGridNo(t, current, g, wound, onlyWalls, owner, level, changes, distance);
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
