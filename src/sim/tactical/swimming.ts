// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc SetSoldierGridNo (the walk in water, the way out of water, the swim into and
// @src out of deep water and its fPrevInWater, which follows the terrain left), EVENT_InternalGetNewSoldierPath (the swim
// @src in deep water); Tactical/Items.cc WaterDamage (STR_CAMO_WASHED_OFF of a soldier out of sight too, 2026-11-14)

import { ItemFlags, NOTHING } from '../../content/items/items.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { i8 } from '../../core/int.ts';
import { anim } from './anim-states.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import { numSkillTraits, SkillTrait, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { namedSoldier } from './unseen-sources.ts';

const WATER_DAMAGE_DIE = 100;
const WATER_DAMAGE_CHANCE = 10;
const WATER_DAMAGE_MAX_LOSS = 10;
const LOWEST_SOAKED_STATUS = 1;
const CAMO_WASHED_IN_DEEP_WATER = 2;
const CAMO_WASHED_IN_MEDIUM_WATER = 1;
const SMELL_FADES_IN_DEEP_WATER_ONE_IN = 10;
const SMELL_FADES_IN_MEDIUM_WATER_ONE_IN = 20;

function waterTerrain(terrain: number): boolean {
  return terrain >= Terrain.LOW_WATER && terrain <= Terrain.DEEP_WATER;
}

function inDeepWater(s: Soldier): boolean {
  return s.overTerrain === Terrain.DEEP_WATER;
}

export function moveStateInWater(t: TacticalState, s: Soldier, state: number): number {
  return inDeepWater(s) ? anim(t.content, 'DEEP_WATER_SWIM') : state;
}

function soakInventory(t: TacticalState, s: Soldier): void {
  for (const o of s.inv) {
    if (o.item === NOTHING || !((t.content.items.byIndex.get(o.item)?.flags ?? 0) & ItemFlags.WATER_DAMAGES)) continue;
    const roll = t.pre.int(WATER_DAMAGE_DIE);
    if (roll < WATER_DAMAGE_CHANCE) o.status[0] = Math.max(LOWEST_SOAKED_STATUS, i8((o.status[0] ?? 0) - WATER_DAMAGE_MAX_LOSS + roll));
  }
}

function washOffCamouflage(t: TacticalState, s: Soldier): void {
  if (s.camo <= 0 || numSkillTraits(s, SkillTrait.CAMOUFLAGED) > 0) return;
  s.camo = Math.max(0, s.camo - (inDeepWater(s) ? CAMO_WASHED_IN_DEEP_WATER : CAMO_WASHED_IN_MEDIUM_WATER));
  if (s.camo === 0) t.events.push({ type: 'camoWashedOff', ...namedSoldier(t, s) });
}

function rinseCreatureSmell(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || s.monsterSmell <= 0) return;
  const oneIn = inDeepWater(s) ? SMELL_FADES_IN_DEEP_WATER_ONE_IN : SMELL_FADES_IN_MEDIUM_WATER_ONE_IN;
  if (t.rng.int(oneIn) === 0) s.monsterSmell--;
}

function waterDamage(t: TacticalState, s: Soldier): void {
  if (inDeepWater(s)) soakInventory(t, s);
  washOffCamouflage(t, s);
  rinseCreatureSmell(t, s);
}

function goUnder(t: TacticalState, s: Soldier): void {
  const st = states(t.content.animations);
  if (s.state !== st.WALKING && s.state !== st.RUNNING) return;
  initNewSoldierAnim(t, s, anim(t.content, 'LOW_TO_DEEP_WATER'), 0, false);
  s.pendingAnimation = anim(t.content, 'DEEP_WATER_SWIM');
}

function comeUp(t: TacticalState, s: Soldier): void {
  initNewSoldierAnim(t, s, anim(t.content, 'DEEP_TO_LOW_WATER'), 0, false);
  s.pendingAnimation = s.uiMovementMode;
}

export function handleWaterOnNewGridNo(t: TacticalState, s: Soldier, terrainLeft: number): void {
  const inWater = waterTerrain(s.overTerrain);
  if (inWater) s.uiMovementMode = states(t.content.animations).WALKING;
  if (!inWater && waterTerrain(terrainLeft)) initNewSoldierAnim(t, s, s.uiMovementMode, 0, false);
  if (inDeepWater(s) && terrainLeft !== Terrain.DEEP_WATER) goUnder(t, s);
  if (s.overTerrain === Terrain.MED_WATER || inDeepWater(s)) waterDamage(t, s);
  if (!inDeepWater(s) && terrainLeft === Terrain.DEEP_WATER) comeUp(t, s);
}
