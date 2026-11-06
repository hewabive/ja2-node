// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc RenderSoldierSmallFaceForUpdatePanel; src/game/Tactical/Auto_Bandage.cc
// @src RenderSoldierSmallFaceForAutoBandagePanel (the same cell: the black bar background, panels.sti 0, the 65face
// @src portrait, no bars at life 0, the life max, bleeding, life, breath max and morale bars); Map_Screen_Interface.h
// @src TACT_UPDATE_MERC_FACE_X_WIDTH, TACT_UPDATE_MERC_FACE_X_HEIGHT, TACT_UPDATE_MERC_FACE_X_OFFSET,
// @src TACT_UPDATE_MERC_FACE_Y_OFFSET.

import { idiv } from '../../core/int.ts';
import { type DrawList, type RgbColor, rgb } from '../draw-list.ts';

export const TACT_UPDATE_MERC_FACE_X_WIDTH = 70;
export const TACT_UPDATE_MERC_FACE_X_HEIGHT = 49;
export const TACT_UPDATE_MERC_FACE_X_OFFSET = 8;
export const TACT_UPDATE_MERC_FACE_Y_OFFSET = 6;

const BARS_LEFT = 36;
const BARS_RIGHT = 44;
const BARS_TOP = 2;
const BARS_BOTTOM = 30;
const BAR_BASE = 29;
const BAR_RANGE = 27;
const BAR_STEP = 3;
const FULL = 100;
const PORTRAIT_INSET = 2;
const PANEL_FRAME = 0;
const PORTRAIT_FRAME = 0;
const BLACK = rgb(0, 0, 0);
const BLEEDING_SHADOW = rgb(107, 107, 57);
const BLEEDING = rgb(222, 181, 115);
const BANDAGED_SHADOW = rgb(156, 57, 57);
const BANDAGED = rgb(222, 132, 132);
const LIFE_SHADOW = rgb(107, 8, 8);
const LIFE = rgb(206, 0, 0);
const BREATH_SHADOW = rgb(8, 8, 132);
const BREATH = rgb(8, 8, 107);
const MORALE_SHADOW = rgb(8, 156, 8);
const MORALE = rgb(8, 107, 8);

export interface UpdatePanelFaceValues {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly breathMax: number;
  readonly morale: number;
}

export function drawUpdatePanelFace(
  list: DrawList,
  panel: string,
  portrait: string | null,
  values: UpdatePanelFaceValues,
  x: number,
  y: number,
): void {
  list.fill(x + BARS_LEFT, y + BARS_TOP, x + BARS_RIGHT, y + BARS_BOTTOM, BLACK);
  list.image(panel, PANEL_FRAME, x, y);
  if (portrait) list.image(portrait, PORTRAIT_FRAME, x + PORTRAIT_INSET, y + PORTRAIT_INSET);
  if (values.life === 0) return;
  const bottom = y + BAR_BASE;
  const top = (value: number) => bottom - idiv(BAR_RANGE * value, FULL);
  const bar = (dx: number, from: number, shadow: RgbColor, colour: RgbColor) => {
    list.fill(x + dx, from, x + dx + 1, bottom, shadow);
    list.fill(x + dx + 1, from, x + dx + 2, bottom, colour);
  };
  let start = top(values.lifeMax);
  bar(BARS_LEFT, start, BLEEDING_SHADOW, BLEEDING);
  start += idiv(BAR_RANGE * values.bleeding, FULL);
  bar(BARS_LEFT, start, BANDAGED_SHADOW, BANDAGED);
  bar(BARS_LEFT, top(values.life), LIFE_SHADOW, LIFE);
  bar(BARS_LEFT + BAR_STEP, top(values.breathMax), BREATH_SHADOW, BREATH);
  bar(BARS_LEFT + 2 * BAR_STEP, top(values.morale), MORALE_SHADOW, MORALE);
}
