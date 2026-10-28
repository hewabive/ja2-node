// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Utils.cc DrawBar, DrawLifeUIBar, DrawBreathUIBar, DrawMoraleUIBar, DrawSoldierUIBars
// @src (the colours, 3 × 42 bars at x, x + 6, x + 12, the bars.sti background), DrawItemUIBarEx (the 2-pixel status bar);
// @src src/game/Tactical/Interface.cc DrawBarsInUIBox (the overhead box lines).

import { idiv } from '../../../core/int.ts';
import { type DrawList, type RgbColor, rgb } from '../../draw-list.ts';

const LIFE_BAR_SHADOW = rgb(108, 12, 12);
const LIFE_BAR = rgb(200, 0, 0);
const BANDAGE_BAR_SHADOW = rgb(156, 60, 60);
const BANDAGE_BAR = rgb(222, 132, 132);
const BLEEDING_BAR_SHADOW = rgb(128, 128, 60);
const BLEEDING_BAR = rgb(240, 240, 20);
const CURR_BREATH_BAR_SHADOW = rgb(8, 12, 118);
const CURR_BREATH_BAR = rgb(8, 12, 160);
const CURR_MAX_BREATH = rgb(0, 0, 0);
const MORALE_BAR_SHADOW = rgb(8, 112, 12);
const MORALE_BAR = rgb(8, 180, 12);
const BREATH_BAR_SHAD_BACK = rgb(1, 1, 1);
export const STATUS_BAR = rgb(201, 172, 133);
export const STATUS_BAR_SHADOW = rgb(140, 136, 119);
const BOX_BLEEDING = rgb(240, 240, 20);
const BOX_BANDAGE = rgb(222, 132, 132);
const BOX_LIFE = rgb(200, 0, 0);
const BOX_BREATH_MAX = rgb(20, 20, 150);
const BOX_BREATH = rgb(100, 100, 220);

const BAR_HEIGHT = 42;
const BREATH_OFFSET = 6;
const MORALE_OFFSET = 12;
const BREATH_MAX_GAP = 3;
const BREATH_MAX_GAP_LIMIT = 97;
const FULL = 100;
const BOX_LINE_X = 3;
const BOX_LIFE_Y = 1;
const BOX_BREATH_Y = 4;

export interface BarValues {
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly breath: number;
  readonly breathMax: number;
  readonly morale: number;
  readonly robot: boolean;
  readonly vehicle: boolean;
}

function drawBar(list: DrawList, x: number, y: number, height: number, color: RgbColor, shadow: RgbColor): void {
  list.line(x, y, x, y - height, shadow);
  list.line(x + 1, y, x + 1, y - height, color);
  list.line(x + 2, y, x + 2, y - height, shadow);
}

function unsigned(value: number): number {
  return value >>> 0;
}

function drawLifeBar(list: DrawList, v: BarValues, x: number, bottom: number): void {
  let y = bottom;
  let height = idiv(BAR_HEIGHT * v.life, FULL);
  drawBar(list, x, y, height, LIFE_BAR, LIFE_BAR_SHADOW);
  const bandage = unsigned(v.lifeMax - v.life - v.bleeding);
  if (bandage !== 0) {
    y -= height;
    height = Math.floor((Math.imul(BAR_HEIGHT, bandage) >>> 0) / FULL);
    drawBar(list, x, y, height, BANDAGE_BAR, BANDAGE_BAR_SHADOW);
  }
  if (v.bleeding !== 0) {
    y -= height;
    height = idiv(BAR_HEIGHT * v.bleeding, FULL);
    drawBar(list, x, y, height, BLEEDING_BAR, BLEEDING_BAR_SHADOW);
  }
}

function drawBreathBar(list: DrawList, v: BarValues, x: number, y: number): void {
  if (v.breathMax <= BREATH_MAX_GAP_LIMIT)
    drawBar(list, x, y, idiv(BAR_HEIGHT * (v.breathMax + BREATH_MAX_GAP), FULL), BREATH_BAR_SHAD_BACK, BREATH_BAR_SHAD_BACK);
  drawBar(list, x, y, idiv(BAR_HEIGHT * v.breathMax, FULL), CURR_MAX_BREATH, CURR_MAX_BREATH);
  drawBar(list, x, y, idiv(BAR_HEIGHT * v.breath, FULL), CURR_BREATH_BAR, CURR_BREATH_BAR_SHADOW);
}

export function drawSoldierBars(list: DrawList, v: BarValues, x: number, y: number, background: { asset: string; gold: boolean }): void {
  if (v.life === 0) return;
  if (!v.robot) list.image(background.asset, background.gold ? 1 : 0, x + BREATH_OFFSET, y - BAR_HEIGHT);
  drawLifeBar(list, v, x, y);
  if (v.robot) return;
  drawBreathBar(list, v, x + BREATH_OFFSET, y);
  if (!v.vehicle) drawBar(list, x + MORALE_OFFSET, y, idiv(BAR_HEIGHT * v.morale, FULL), MORALE_BAR, MORALE_BAR_SHADOW);
}

function boxLine(list: DrawList, x: number, y: number, value: number, width: number, color: RgbColor): void {
  const length = (value / FULL) * width;
  list.rectangle(x + BOX_LINE_X, y, Math.trunc(x + length + BOX_LINE_X), y, color);
}

export function drawBarsInUiBox(list: DrawList, v: BarValues, x: number, y: number, width: number): void {
  const bandage = v.lifeMax - v.life - v.bleeding;
  if (v.bleeding !== 0) boxLine(list, x, y + BOX_LIFE_Y, v.bleeding + v.life + bandage, width, BOX_BLEEDING);
  if (bandage !== 0) boxLine(list, x, y + BOX_LIFE_Y, v.life + bandage, width, BOX_BANDAGE);
  boxLine(list, x, y + BOX_LIFE_Y, v.life, width, BOX_LIFE);
  boxLine(list, x, y + BOX_BREATH_Y, v.breathMax, width, BOX_BREATH_MAX);
  boxLine(list, x, y + BOX_BREATH_Y, v.breath, width, BOX_BREATH);
}

export function drawItemStatusBar(list: DrawList, value: number, x: number, y: number, maxHeight: number): void {
  const height = idiv((maxHeight - 1) * value, FULL);
  list.line(x, y, x, y - height, STATUS_BAR);
  list.line(x + 1, y, x + 1, y - height, STATUS_BAR_SHADOW);
}
