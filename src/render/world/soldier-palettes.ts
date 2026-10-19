// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CreateSoldierPalettes, CreateEnemyGlow16BPPPalette,
// @src CreateEnemyGreyGlow16BPPPalette, gRedGlowR, gOrangeGlowR, gOrangeGlowG; src/sgp/HImage.cc Create16BPPPaletteShaded;
// @src src/game/TileEngine/Lighting.cc CreateBiasedShadedPalettes.

import { shadedPalette } from '../../content/picture/shaded-palette.ts';
import { displayRgbFrom565, rgbTo565, SHADE_LEVEL_COUNT, shadedDisplayPalette } from '../../content/world/shading.ts';

export const GLOW_ROW_COUNT = 20;
export const GREY_GLOW_OFFSET = 10;
export const SOLDIER_SHADE_ROWS = 0;
export const SOLDIER_GLOW_ROWS = SHADE_LEVEL_COUNT;
export const SOLDIER_ROOF_GLOW_ROWS = SHADE_LEVEL_COUNT + GLOW_ROW_COUNT;
export const SOLDIER_EFFECT_ROW = SOLDIER_GLOW_ROWS + GREY_GLOW_OFFSET;
export const SOLDIER_PALETTE_ROWS = SHADE_LEVEL_COUNT + 2 * GLOW_ROW_COUNT;

const COLOURS = 256;
const FULL_SCALE = 255;
const GREY_SCALE = 100;
const GLOW_STEPS = 10;
const RED_GLOW = [0, 25, 50, 75, 100, 125, 150, 175, 200, 225] as const;
const ORANGE_GLOW_GREEN = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180] as const;
const LAST_GREY_STEP = 8;

function to565Display(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(COLOURS * 3);
  for (let i = 0; i < COLOURS; i++) {
    out.set(displayRgbFrom565(rgbTo565(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0)), i * 3);
  }
  return out;
}

function scaled(palette: Uint8Array, scale: number, mono: boolean): Uint8Array {
  return to565Display(shadedPalette(palette, { red: scale, green: scale, blue: scale, mono }));
}

function enemyGlow(palette: Uint8Array, red: number, green: number): Uint8Array {
  const out = new Uint8Array(COLOURS * 3);
  for (let i = 0; i < COLOURS; i++) {
    out[i * 3] = Math.max(red, palette[i * 3] ?? 0);
    out[i * 3 + 1] = Math.max(green, palette[i * 3 + 1] ?? 0);
    out[i * 3 + 2] = palette[i * 3 + 2] ?? 0;
  }
  return to565Display(out);
}

function greyGlow(palette: Uint8Array, red: number, green: number): Uint8Array {
  const out = new Uint8Array(COLOURS * 3);
  for (let i = 0; i < COLOURS; i++) {
    const lumin = Math.floor(((palette[i * 3] ?? 0) * 299 + (palette[i * 3 + 1] ?? 0) * 587 + (palette[i * 3 + 2] ?? 0) * 114) / 1000);
    const mod = Math.floor((GREY_SCALE * lumin) / 256);
    out[i * 3] = Math.min(Math.max(red, mod), 255);
    out[i * 3 + 1] = Math.min(Math.max(green, mod), 255);
    out[i * 3 + 2] = Math.min(mod, 255);
  }
  return to565Display(out);
}

function glowSet(palette: Uint8Array, green: readonly number[]): Uint8Array[] {
  const rows = [scaled(palette, FULL_SCALE, false)];
  for (let i = 1; i < GLOW_STEPS; i++) rows.push(enemyGlow(palette, RED_GLOW[i] ?? 0, green[i] ?? 0));
  rows.push(scaled(palette, GREY_SCALE, true));
  for (let i = 1; i < LAST_GREY_STEP + 1; i++) rows.push(greyGlow(palette, RED_GLOW[i] ?? 0, green[i] ?? 0));
  rows.push(greyGlow(palette, RED_GLOW[LAST_GREY_STEP] ?? 0, green[LAST_GREY_STEP] ?? 0));
  return rows;
}

export type LightColour = readonly [number, number, number];

export const NO_LIGHT_COLOUR: LightColour = [0, 0, 0];

export function soldierPaletteRows(palette: Uint8Array, light: LightColour = NO_LIGHT_COLOUR): Uint8Array[] {
  const shades = Array.from({ length: SHADE_LEVEL_COUNT }, (_, s) => shadedDisplayPalette(palette, s, light));
  const noGreen = RED_GLOW.map(() => 0);
  return [...shades, ...glowSet(palette, noGreen), ...glowSet(palette, ORANGE_GLOW_GREEN)];
}
