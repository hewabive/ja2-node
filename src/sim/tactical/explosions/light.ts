// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/LightEffects.cc NewLightEffect, DecayLightEffects (light sprites are not simulated).
// @src See docs/12 §11.5.

import { u16, u32 } from '../../../core/int.ts';
import { allTeamsLookForAll } from '../perception/sight.ts';
import type { TacticalState } from '../state.ts';
import { type LightEffect, worldSeconds } from './state.ts';

const NUM_LIGHT_EFFECT_SLOTS = 25;
const LIGHT_DECAY_SECONDS = 350;

export function newLightEffect(t: TacticalState, g: number, radius: number, duration: number): LightEffect | null {
  const lights = t.explosives.lights;
  let slot = lights.indexOf(null);
  if (slot === -1) {
    if (lights.length >= NUM_LIGHT_EFFECT_SLOTS) return null;
    slot = lights.length;
    lights.push(null);
  }
  const light: LightEffect = { gridNo: g, radius, duration, age: 0, lastUpdate: worldSeconds(t.explosives) };
  lights[slot] = light;
  allTeamsLookForAll(t, false);
  return light;
}

function ageLight(light: LightEffect, updates: number): boolean {
  for (let i = 0; i < updates; i++) {
    light.age++;
    if (light.age >= light.duration) return false;
    if (light.age % 2) light.radius--;
    if (light.radius === 0) return false;
  }
  return true;
}

export function decayLightEffects(t: TacticalState): void {
  const now = worldSeconds(t.explosives);
  const lights = t.explosives.lights;
  for (let k = 0; k < lights.length; k++) {
    const light = lights[k];
    if (!light) continue;
    const elapsed = u32(now - light.lastUpdate);
    if (elapsed <= LIGHT_DECAY_SECONDS) continue;
    light.lastUpdate = now;
    if (!ageLight(light, u16(Math.trunc(elapsed / LIGHT_DECAY_SECONDS)))) lights[k] = null;
    allTeamsLookForAll(t, false);
  }
}
