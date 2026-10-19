// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/RenderWorld.cc gsGlowFrames, RenderTiles (merc shade and glow), InitRenderParams (item
// @src cycle colours); src/game/Utils/Timer_Control.cc GLOW_ENEMYS; src/game/Tactical/Soldier_Control.cc
// @src SetSoldierPersonalLightLevel. See docs/28 §6.5 and the deviation "Enemy glow".

import { soldierShade } from '../../content/anim/soldier-sprite.ts';
import { displayRgbFrom565, rgbTo565 } from '../../content/world/shading.ts';
import { packRgb } from './instances.ts';
import { GREY_GLOW_OFFSET, SOLDIER_EFFECT_ROW, SOLDIER_GLOW_ROWS, SOLDIER_ROOF_GLOW_ROWS, SOLDIER_SHADE_ROWS } from './soldier-palettes.ts';

export const GLOW_STEP_MS = 100;
export const PERSONAL_LIGHT_SHADE = 3;
const GLOW_FRAMES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 6, 8, 9, 8, 6, 4, 2, 0] as const;
const TOPMOST_GLOW_FRAME = 7;
const ITEM_CYCLE_COLOURS = 20;
const ITEM_CYCLE_STEP = 25;

export function glowFrame(clockMs: number): number {
  const step = Math.floor(clockMs / GLOW_STEP_MS);
  return GLOW_FRAMES[((step % GLOW_FRAMES.length) + GLOW_FRAMES.length) % GLOW_FRAMES.length] ?? 0;
}

function displayColour(r: number, g: number, b: number): number {
  const [dr, dg, db] = displayRgbFrom565(rgbTo565(r, g, b));
  return packRgb(dr, dg, db);
}

function itemCycleLevel(i: number): number {
  return (i < ITEM_CYCLE_COLOURS / 2 ? i + 1 : ITEM_CYCLE_COLOURS - i) * ITEM_CYCLE_STEP;
}

export interface ItemGlowOptions {
  readonly glow: boolean;
  readonly red: boolean;
}

export function itemOutlineColour(clockMs: number, onRoof: boolean, o: ItemGlowOptions): number {
  if (!o.glow) return onRoof ? displayColour(255, 255, 0) : displayColour(255, 255, 255);
  const step = Math.floor(clockMs / GLOW_STEP_MS);
  const l = itemCycleLevel(((step % ITEM_CYCLE_COLOURS) + ITEM_CYCLE_COLOURS) % ITEM_CYCLE_COLOURS);
  if (onRoof) return displayColour(l, l, 0);
  return o.red ? displayColour(l, 0, 0) : displayColour(l, l, l);
}

export interface GlowContext {
  readonly ourTurn: boolean;
  readonly frame: number;
  readonly hovered: number | null;
  readonly hoveredHostile: boolean;
  readonly selectedSees: (id: number) => boolean | null;
  readonly underAiControl: (id: number) => boolean;
}

export interface SoldierLookInput {
  readonly id: number;
  readonly level: number;
  readonly hostile: boolean;
  readonly nodeShade: number;
  readonly fadeShade: number | null;
}

export interface SoldierLook {
  readonly row: number;
  readonly topmost: boolean;
}

export function soldierLook(s: SoldierLookInput, ctx: GlowContext): SoldierLook {
  if (s.fadeShade !== null) return { row: SOLDIER_SHADE_ROWS + s.fadeShade, topmost: false };
  const normal = { row: SOLDIER_SHADE_ROWS + soldierShade(s.nodeShade), topmost: false };
  if (!s.hostile) return normal;
  const offset = ctx.ourTurn && ctx.selectedSees(s.id) === false ? GREY_GLOW_OFFSET : 0;
  const start = s.level === 0 ? SOLDIER_GLOW_ROWS : SOLDIER_ROOF_GLOW_ROWS;
  if (ctx.hovered !== null && ctx.hoveredHostile) {
    if (ctx.hovered === s.id) return { row: start + ctx.frame + offset, topmost: true };
    return offset === GREY_GLOW_OFFSET ? { row: SOLDIER_EFFECT_ROW, topmost: false } : normal;
  }
  if (ctx.ourTurn || ctx.underAiControl(s.id)) return { row: start + ctx.frame + offset, topmost: ctx.frame >= TOPMOST_GLOW_FRAME };
  return normal;
}
