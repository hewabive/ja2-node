// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc DisplayLoadPending (UNIT_TIME 40, FAST_UNIT_TIME 3, FASTEST_UNIT_TIME 2,
// @src ALMOST_FAST_UNIT_TIME 25, LONG_UNIT_TIME 120, 30 units, a unit accounted when more than its time passed, the
// @src segments drawn while time is left), DisplayTitleBarMaximizeGraphic (18 steps from the side button to the title bar,
// @src the last one snapped), LaptopScreenHandle and LeaveLapTopScreen (the zoom: 1000 ms, the gravity factor, the scale
// @src 10000 / (100 - p), the centre from (472, 424) to (320, 240)), FlickerHDLight (Random(2) every 50 ms, 3000 ms more
// @src after the load), ExitLaptopDone (100 ms with the power light off), HandleWebBookMarkNotifyTimer (2000 ms).

import { idiv, u16 } from '../../../core/int.ts';
import type { Area } from '../../draw-list.ts';

const trunc = Math.trunc;

export const UNIT_TIME = 40;
export const FAST_UNIT_TIME = 3;
export const FASTEST_UNIT_TIME = 2;
export const ALMOST_FAST_UNIT_TIME = 25;
export const LONG_UNIT_TIME = 120;
export const LOAD_UNITS = 30;
export const LOAD_SEGMENTS_MAX = 30;
export const HD_FLICKER_TIME = 3000;
export const FLICKER_TIME = 50;
export const EXIT_LAPTOP_DELAY_TIME = 100;
export const BOOKMARK_NOTIFY_TIME = 2000;
export const TITLE_BAR_ITERATIONS = 18;
export const DEFAULT_SLIDE_STEP_MS = 16;
export const ZOOM_TIME = 1000;

export interface LoadSpeed {
  readonly fast: boolean;
  readonly subPage: boolean;
  readonly slowSite: boolean;
}

export function loadUnitTime(speed: LoadSpeed, scale: number): number {
  let unit = UNIT_TIME;
  if (speed.fast) unit = speed.subPage ? FASTEST_UNIT_TIME : FAST_UNIT_TIME;
  else if (speed.subPage) unit = ALMOST_FAST_UNIT_TIME;
  else if (speed.slowSite) unit = LONG_UNIT_TIME;
  return trunc(unit * scale);
}

export class LoadPending {
  readonly speed: LoadSpeed;
  readonly unitTime: number;
  #base: number | null = null;
  #total = 0;
  #done = false;

  constructor(speed: LoadSpeed, scale: number) {
    this.speed = speed;
    this.unitTime = loadUnitTime(speed, scale);
  }

  get done(): boolean {
    return this.#done;
  }

  get total(): number {
    return this.#total;
  }

  update(now: number): boolean {
    if (this.#done) return true;
    if (this.#base === null) this.#base = now;
    if (this.#total >= this.unitTime * LOAD_UNITS) {
      this.#done = true;
      return true;
    }
    const difference = now - this.#base;
    if (difference > this.unitTime) {
      this.#base = now;
      this.#total += difference;
    }
    return false;
  }

  segments(): number {
    let count = 0;
    for (let i = 0, left = this.#total; i <= LOAD_SEGMENTS_MAX && left > 0; ++i, left -= this.unitTime) {
      count++;
      if (this.unitTime > left) break;
    }
    return count;
  }
}

export interface SlideEnds {
  readonly startX: number;
  readonly startRightX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endRightX: number;
  readonly endY: number;
  readonly height: number;
}

export function titleBarSlideRect(ends: SlideEnds, count: number): Area {
  if (count === TITLE_BAR_ITERATIONS) return { x: ends.endX, y: ends.endY, width: ends.endRightX - ends.endX, height: ends.height };
  const x = trunc(ends.startX + ((ends.endX - ends.startX) / TITLE_BAR_ITERATIONS) * count);
  const right = trunc(ends.startRightX + ((ends.endRightX - ends.startRightX) / TITLE_BAR_ITERATIONS) * count);
  const y = trunc(ends.startY + ((ends.endY - ends.startY) / TITLE_BAR_ITERATIONS) * count);
  return { x, y, width: right - x, height: ends.height };
}

export function slideStep(forward: boolean, elapsed: number, stepMs: number): number {
  const steps = stepMs <= 0 ? TITLE_BAR_ITERATIONS + 1 : Math.floor(elapsed / stepMs);
  return forward ? 1 + steps : TITLE_BAR_ITERATIONS - 1 - steps;
}

export function slideFinished(forward: boolean, step: number): boolean {
  return forward ? step > TITLE_BAR_ITERATIONS : step < 0;
}

const ZOOM_SCALE_MAX = 5333;
const ZOOM_FROM = { x: 472, y: 424 };
const ZOOM_TO = { x: 320, y: 240 };
const ZOOM_BASE = { width: 12, height: 9 };
const PERCENT = 100;
const HALF = 50;

export function zoomPercentage(elapsed: number, opening: boolean): number {
  const linear = Math.min(trunc((elapsed * PERCENT) / ZOOM_TIME), PERCENT);
  return opening ? linear : PERCENT - linear;
}

export function zoomRect(realPercentage: number): Area {
  let p = realPercentage;
  const factor = (p - HALF) * 2;
  if (p < HALF) p += trunc(p * factor * 0.01 + 0.5);
  else p += trunc((PERCENT - p) * factor * 0.01 + 0.5);
  const scale = p < 99 ? trunc(10000 / (PERCENT - p)) : ZOOM_SCALE_MAX;
  const width = u16(trunc((ZOOM_BASE.width * scale) / PERCENT));
  const height = u16(trunc((ZOOM_BASE.height * scale) / PERCENT));
  const x = u16(ZOOM_FROM.x - trunc(((ZOOM_FROM.x - ZOOM_TO.x) * scale) / ZOOM_SCALE_MAX));
  const y = u16(ZOOM_FROM.y - trunc(((ZOOM_FROM.y - ZOOM_TO.y) * scale) / ZOOM_SCALE_MAX));
  return { x: x - idiv(width, 2), y: y - idiv(height, 2), width, height };
}
