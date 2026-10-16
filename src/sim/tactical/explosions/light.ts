// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/LightEffects.cc UpdateLightingSprite, NewLightEffect, DecayLightEffects.
// @src See docs/12 §11.5, docs/20.

import { WORLD_COLS } from '../../../content/world/grid.ts';
import { u16, u32 } from '../../../core/int.ts';
import { lightSpriteCreate, lightSpriteDestroy, lightSpritePosition, lightSpritePower } from '../lighting/lighting.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import type { TacticalState } from '../state.ts';
import { type LightEffect, worldSeconds } from './state.ts';

const NUM_LIGHT_EFFECT_SLOTS = 25;
const LIGHT_DECAY_SECONDS = 350;

function updateLightingSprite(t: TacticalState, light: LightEffect): void {
  if (light.sprite) {
    lightSpriteDestroy(t, light.sprite);
    light.sprite = null;
  }
  const sprite = lightSpriteCreate(t, `Light${light.radius}`);
  light.sprite = sprite;
  if (!sprite) return;
  lightSpritePower(sprite, true);
  lightSpritePosition(t, sprite, light.gridNo % WORLD_COLS, Math.trunc(light.gridNo / WORLD_COLS));
}

export function newLightEffect(t: TacticalState, g: number, radius: number, duration: number): LightEffect | null {
  const lights = t.explosives.lights;
  let slot = lights.indexOf(null);
  if (slot === -1) {
    if (lights.length >= NUM_LIGHT_EFFECT_SLOTS) return null;
    slot = lights.length;
    lights.push(null);
  }
  const light: LightEffect = { gridNo: g, radius, duration, age: 0, lastUpdate: worldSeconds(t), sprite: null };
  lights[slot] = light;
  updateLightingSprite(t, light);
  allTeamsLookForAll(t, false);
  return light;
}

function ageLight(t: TacticalState, light: LightEffect, updates: number): boolean {
  for (let i = 0; i < updates; i++) {
    light.age++;
    if (light.age >= light.duration) return false;
    if (light.age % 2) light.radius--;
    if (light.radius === 0) return false;
    updateLightingSprite(t, light);
  }
  return true;
}

export function decayLightEffects(t: TacticalState): void {
  const now = worldSeconds(t);
  const lights = t.explosives.lights;
  for (let k = 0; k < lights.length; k++) {
    const light = lights[k];
    if (!light) continue;
    const elapsed = u32(now - light.lastUpdate);
    if (elapsed <= LIGHT_DECAY_SECONDS) continue;
    light.lastUpdate = now;
    if (!ageLight(t, light, u16(Math.trunc(elapsed / LIGHT_DECAY_SECONDS)))) {
      lights[k] = null;
      if (light.sprite) lightSpriteDestroy(t, light.sprite);
    }
    allTeamsLookForAll(t, false);
  }
}
