// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Sound_Control.cc SoundDir, SoundVolume, PositionSoundDir, PositionSoundVolume,
// @src CalculateSoundEffectsVolume, CalculateSpeechVolume; TileEngine/Isometric_Utils.cc GetAbsoluteScreenXYFromMapPos,
// @src ConvertGridNoToCellXY; src/sgp/SoundMan.cc SoundServiceStreams (the mixer's balance).

export const MAX_VOLUME = 127;
export const NOWHERE = -1;
const ROUNDING = 63;
const CENTRE_TOLERANCE = 64;
const LOW_VOLUME = 25;
const FAR_VOLUME_MOD = 25;
const POSITION_RANGE_IN_VIEWS = 1.5;
const MIX_SHIFT = 128;
const WORLD_COLS = 160;
const CELL_SIZE = 10;

export const Pan = { FAR_LEFT_OFF_SCREEN: 1, LEFT: 48, MIDDLE: 64, RIGHT: 80, FAR_RIGHT_OFF_SCREEN: 126 } as const;

export interface ScreenView {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenOffset {
  readonly dx: number;
  readonly dy: number;
}

export function scaleVolume(volume: number, setting: number): number {
  return Math.trunc((volume * setting + ROUNDING) / MAX_VOLUME);
}

export function offsetFromCentre(gridNo: number, view: ScreenView): ScreenOffset {
  const cellX = (gridNo % WORLD_COLS) * CELL_SIZE;
  const cellY = Math.trunc(gridNo / WORLD_COLS) * CELL_SIZE;
  const distX = cellX - view.centerX;
  const distY = cellY - view.centerY;
  return { dx: -(2 * distX - 2 * distY), dy: -(distX + distY) };
}

function halfWidth(view: ScreenView): number {
  return Math.trunc(view.width / 2);
}

function halfHeight(view: ScreenView): number {
  return Math.trunc(view.height / 2);
}

export function soundDir(gridNo: number, view: ScreenView): number {
  if (gridNo === NOWHERE) return Pan.MIDDLE;
  const { dx } = offsetFromCentre(gridNo, view);
  const abs = Math.abs(dx);
  if (abs <= CENTRE_TOLERANCE) return Pan.MIDDLE;
  if (abs > halfWidth(view)) return dx > 0 ? Pan.FAR_LEFT_OFF_SCREEN : Pan.FAR_RIGHT_OFF_SCREEN;
  return dx > 0 ? Pan.LEFT : Pan.RIGHT;
}

export function onScreen(gridNo: number, view: ScreenView): boolean {
  if (gridNo === NOWHERE) return true;
  const { dx, dy } = offsetFromCentre(gridNo, view);
  return Math.abs(dx) <= halfWidth(view) && Math.abs(dy) <= halfHeight(view);
}

export function soundVolume(base: number, gridNo: number, view: ScreenView): number {
  if (gridNo === NOWHERE) return base;
  const { dx, dy } = offsetFromCentre(gridNo, view);
  const nearCentre = Math.abs(dx) <= CENTRE_TOLERANCE && Math.abs(dy) <= CENTRE_TOLERANCE;
  if (nearCentre || onScreen(gridNo, view)) return base;
  return Math.max(LOW_VOLUME, base - FAR_VOLUME_MOD);
}

export function positionSoundVolume(base: number, gridNo: number, view: ScreenView): number {
  if (gridNo === NOWHERE) return base;
  const { dx, dy } = offsetFromCentre(gridNo, view);
  const maxDist = Math.hypot(Math.trunc(view.width * POSITION_RANGE_IN_VIEWS), Math.trunc(view.height * POSITION_RANGE_IN_VIEWS));
  const dist = Math.min(Math.hypot(dx, dy), maxDist);
  if (dist === 0) return base;
  return Math.trunc(base * ((maxDist - dist) / maxDist));
}

export interface BalanceGains {
  readonly left: number;
  readonly right: number;
}

export function balanceGains(volume: number, pan: number): BalanceGains {
  const left = Math.trunc((volume * (MAX_VOLUME - pan)) / MAX_VOLUME);
  const right = Math.trunc((volume * pan) / MAX_VOLUME);
  return { left: left / MIX_SHIFT, right: right / MIX_SHIFT };
}
