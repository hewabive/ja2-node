// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Radar_Screen.cc LoadRadarScreenBitmap (the full and the 100 shade tables), RenderRadarScreen
// @src (the darker table at night on the surface); src/game/Strategic/Game_Clock.cc NightTime.

import type { AssetKey, DrawList, PaletteShade } from '../../draw-list.ts';

const NIGHT_TIME_LIGHT_START_HOUR = 21;
const NIGHT_TIME_LIGHT_END_HOUR = 7;
const FULL_SHADE: PaletteShade = { red: 255, green: 255, blue: 255, mono: false };
const NIGHT_SHADE: PaletteShade = { red: 100, green: 100, blue: 100, mono: false };

export function nightTime(hour: number): boolean {
  return hour < NIGHT_TIME_LIGHT_END_HOUR || hour >= NIGHT_TIME_LIGHT_START_HOUR;
}

export function drawRadarPicture(list: DrawList, image: AssetKey, x: number, y: number, darkened: boolean): void {
  list.image(image, 0, x, y, { shade: darkened ? NIGHT_SHADE : FULL_SHADE });
}
