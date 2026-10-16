// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame (muzzle flash frame count, opcodes 441 and 448),
// @src HandleSoldierDeath (muzzle flash light). See docs/20.

import { DIRECTION_INCREMENT, newGridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { lightSpriteCreate, lightSpriteDestroy, lightSpritePosition, lightSpritePower, MIN_AMB_LEVEL_FOR_MERC_LIGHTS } from './lighting.ts';

const MUZZLE_FLASH_TEMPLATE = 'L-R03.LHT';
const MAX_ANIFRAMES_PER_FLASH = 2;
const NOT_VISIBLE = -1;

export function putOutMuzzleFlash(t: TacticalState, s: Soldier): void {
  if (!s.muzzleFlashLight) return;
  lightSpriteDestroy(t, s.muzzleFlashLight);
  s.muzzleFlashLight = null;
}

export function showMuzzleFlash(t: TacticalState, s: Soldier): boolean {
  if (s.visible === NOT_VISIBLE || t.lighting.ambient < MIN_AMB_LEVEL_FOR_MERC_LIGHTS) return true;
  putOutMuzzleFlash(t, s);
  const light = lightSpriteCreate(t, MUZZLE_FLASH_TEMPLATE);
  s.muzzleFlashLight = light;
  if (!light) return false;
  lightSpritePower(light, true);
  const front = newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0);
  lightSpritePosition(t, light, front % WORLD_COLS, Math.trunc(front / WORLD_COLS));
  s.muzzleFlashCount = 1;
  return true;
}

export function countMuzzleFlashFrame(t: TacticalState, s: Soldier): void {
  if (s.muzzleFlashCount <= 0) return;
  if (s.muzzleFlashCount > MAX_ANIFRAMES_PER_FLASH) {
    s.muzzleFlashCount = 0;
    putOutMuzzleFlash(t, s);
  } else s.muzzleFlashCount++;
}
