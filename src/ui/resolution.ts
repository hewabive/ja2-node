// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/UILayout.cc UILayout::recalculatePositions (m_stdScreenOffsetX/Y); src/game/UILayout.h STD_SCREEN_X,
// @src STD_SCREEN_Y, MIN_INTERFACE_WIDTH, MIN_INTERFACE_HEIGHT.

import { idiv } from '../core/int.ts';

export const STD_SCREEN_WIDTH = 640;
export const STD_SCREEN_HEIGHT = 480;
export const AUTO_UI_SCALE = 0;
export const MAX_UI_SCALE = 8;
const ALIGNMENT_TOLERANCE = 1e-6;
const ALIGNMENT_SEARCH = 16;

export interface ScaleSetting {
  readonly scale: number;
  readonly fixed640: boolean;
}

export const DEFAULT_SCALE_SETTING: ScaleSetting = { scale: AUTO_UI_SCALE, fixed640: false };

export interface Resolution {
  readonly scale: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly viewX: number;
  readonly viewY: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly stdScreenX: number;
  readonly stdScreenY: number;
}

export interface LogicalPoint {
  readonly x: number;
  readonly y: number;
}

export function autoUiScale(deviceWidth: number, deviceHeight: number): number {
  return Math.max(1, Math.min(Math.floor(deviceWidth / STD_SCREEN_WIDTH), Math.floor(deviceHeight / STD_SCREEN_HEIGHT)));
}

function requestedScale(deviceWidth: number, deviceHeight: number, setting: ScaleSetting): number {
  const forced = Math.min(MAX_UI_SCALE, Math.floor(setting.scale));
  return forced >= 1 ? forced : autoUiScale(deviceWidth, deviceHeight);
}

function logicalSize(deviceWidth: number, deviceHeight: number, scale: number, setting: ScaleSetting): [number, number] {
  if (setting.fixed640) return [STD_SCREEN_WIDTH, STD_SCREEN_HEIGHT];
  return [Math.max(STD_SCREEN_WIDTH, Math.floor(deviceWidth / scale)), Math.max(STD_SCREEN_HEIGHT, Math.floor(deviceHeight / scale))];
}

function displaySize(deviceWidth: number, deviceHeight: number, width: number, height: number, scale: number): [number, number] {
  if (width * scale <= deviceWidth && height * scale <= deviceHeight) return [width * scale, height * scale];
  const fit = Math.min(deviceWidth / width, deviceHeight / height);
  return [Math.max(1, Math.floor(width * fit)), Math.max(1, Math.floor(height * fit))];
}

export function alignedOffset(device: number, pixelRatio: number): number {
  const widest = Math.floor(device / pixelRatio);
  for (let css = widest; css > 0 && css > widest - ALIGNMENT_SEARCH; css--) {
    const aligned = css * pixelRatio;
    if (Math.abs(aligned - Math.round(aligned)) < ALIGNMENT_TOLERANCE) return Math.round(aligned);
  }
  return 0;
}

export function resolveResolution(
  deviceWidth: number,
  deviceHeight: number,
  setting: ScaleSetting = DEFAULT_SCALE_SETTING,
  pixelRatio = 1,
): Resolution {
  const width = Math.max(1, Math.floor(deviceWidth));
  const height = Math.max(1, Math.floor(deviceHeight));
  const scale = requestedScale(width, height, setting);
  const [logicalWidth, logicalHeight] = logicalSize(width, height, scale, setting);
  const [viewWidth, viewHeight] = displaySize(width, height, logicalWidth, logicalHeight, scale);
  return {
    scale,
    logicalWidth,
    logicalHeight,
    viewX: alignedOffset(Math.floor((width - viewWidth) / 2), pixelRatio),
    viewY: alignedOffset(Math.floor((height - viewHeight) / 2), pixelRatio),
    viewWidth,
    viewHeight,
    stdScreenX: idiv(logicalWidth - STD_SCREEN_WIDTH, 2),
    stdScreenY: idiv(logicalHeight - STD_SCREEN_HEIGHT, 2),
  };
}

export function toLogical(resolution: Resolution, deviceX: number, deviceY: number): LogicalPoint {
  const x = Math.floor(((deviceX - resolution.viewX) * resolution.logicalWidth) / resolution.viewWidth);
  const y = Math.floor(((deviceY - resolution.viewY) * resolution.logicalHeight) / resolution.viewHeight);
  return { x, y };
}
