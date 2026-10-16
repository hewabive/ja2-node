// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldMan.cc AddMercStructureInfoFromAnimSurface; Tactical/Animation_Control.cc
// @src SetSoldierAnimationSurface; Tactical/Soldier_Control.cc EVENT_SetSoldierDirection, InternalIsValidStance

import type { StructureDef } from '../../content/formats/jsd.ts';
import type { StructureInstance } from '../../content/world/structures.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { AnimHeight, states } from './animation.ts';
import { DIRECTION_COUNT } from './directions.ts';
import { animStructureFile } from './multi-tile.ts';
import { Body, OKBREATH, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export function removeMercStructure(t: TacticalState, s: Soldier): void {
  if (!s.structure) return;
  t.world.structures.remove(s.structure);
  s.structure = null;
}

export function animStructureDef(t: TacticalState, s: Soldier, state: number, direction: number): StructureDef | null {
  const file = animStructureFile(t.content, s, state);
  if (!file) return null;
  return file.structures[s.bodyType === Body.QUEENMONSTER ? 0 : (direction + 1) % DIRECTION_COUNT] ?? null;
}

const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;

export function internalIsValidStance(t: TacticalState, s: Soldier, direction: number, stance: number): boolean {
  if (isVehicle(s) && stance !== AnimHeight.STAND) return false;
  if (inWater(s) && (stance === AnimHeight.PRONE || stance === AnimHeight.CROUCH)) return false;
  if (s.bodyType === Body.ROBOTNOWEAPON && stance !== AnimHeight.STAND) return false;
  if (s.collapsed && (stance === AnimHeight.STAND || stance === AnimHeight.CROUCH) && s.breath < OKBREATH) return false;
  const st = states(t.content.animations);
  const state =
    stance === AnimHeight.STAND
      ? st.STANDING
      : stance === AnimHeight.CROUCH
        ? st.CROUCHING
        : stance === AnimHeight.PRONE
          ? st.PRONE
          : s.state;
  const def = animStructureDef(t, s, state, direction);
  if (!def) return true;
  return t.world.structures.okayToAdd(s.gridNo, s.level, def, s.id);
}

export function isValidStance(t: TacticalState, s: Soldier, stance: number): boolean {
  return internalIsValidStance(t, s, s.direction, stance);
}

export function addMercStructure(t: TacticalState, s: Soldier, state = s.state): StructureInstance | null {
  s.multiTile = false;
  removeMercStructure(t, s);
  if (!s.placed) return null;
  const def = animStructureDef(t, s, state, s.direction);
  if (!def) return null;
  s.structure = t.world.structures.add(s.gridNo, s.level, def, { kind: 'soldier', id: s.id });
  s.multiTile = def.tiles.length > 1;
  return s.structure;
}

export function okToAddMercToWorld(t: TacticalState, s: Soldier, direction: number): boolean {
  const def = animStructureDef(t, s, s.state, direction);
  return !def || t.world.structures.okayToAdd(s.gridNo, s.level, def, s.id);
}
