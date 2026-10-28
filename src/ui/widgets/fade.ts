// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Fade_Screen.cc BeginFade (fade out: eleven steps of the 0.8 low-percent shade then black; fade in: the new
// @src screen shaded 0.8^(8 − n) for n = 0…8), FadeScreenHandle (no cursor while fading), FadeFrameBufferRealFade,
// @src FadeInFrameBufferRealFade. The original advances one step per loop pass; ja2-node uses fixed steps.

import { type DrawList, LOW_PERCENT_SHADOW_FACTOR, rgb } from '../draw-list.ts';
import type { UiInputEvent } from '../input/events.ts';
import type { Modal } from '../screen.ts';
import type { UiServices } from '../services.ts';
import type { WidgetInfo } from './widget-info.ts';

export const FADE_STEP_MS = 16;
export const FADE_OUT_LIMIT = 10;
export const FADE_IN_LIMIT = 8;
const BLACK = rgb(0, 0, 0);

export type FadeDirection = 'out' | 'in';

export function fadeFactor(direction: FadeDirection, step: number): number | null {
  if (direction === 'out') return step > FADE_OUT_LIMIT ? 0 : LOW_PERCENT_SHADOW_FACTOR ** (step + 1);
  return step > FADE_IN_LIMIT ? null : LOW_PERCENT_SHADOW_FACTOR ** (FADE_IN_LIMIT - step);
}

export interface FadeOptions {
  readonly direction: FadeDirection;
  readonly onDone?: () => void;
  readonly id?: string;
}

export class Fade implements Modal {
  readonly id: string;
  readonly freezesScreen = true;
  readonly hidesCursor = true;
  readonly #services: UiServices;
  readonly #options: FadeOptions;
  #start: number | null = null;
  #step = 0;
  #done = false;

  constructor(services: UiServices, options: FadeOptions) {
    this.#services = services;
    this.#options = options;
    this.id = options.id ?? `fade-${options.direction}`;
  }

  get step(): number {
    return this.#step;
  }

  enter(): void {
    this.#start = null;
    this.#step = 0;
  }

  exit(): void {}

  update(): void {
    const now = this.#services.clock.ja2Now;
    if (this.#start === null) this.#start = now;
    this.#step = Math.floor((now - this.#start) / FADE_STEP_MS);
    const limit = this.#options.direction === 'out' ? FADE_OUT_LIMIT : FADE_IN_LIMIT;
    if (this.#step > limit && !this.#done) {
      this.#done = true;
      this.#services.host.closeModal(this);
      this.#options.onDone?.();
    }
  }

  input(_event: UiInputEvent): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { width, height } = this.#services.geometry();
    const factor = fadeFactor(this.#options.direction, this.#step);
    if (factor === null) return;
    if (factor === 0) list.fill(0, 0, width, height, BLACK);
    else list.shadow(0, 0, width - 1, height - 1, factor);
  }

  describe(): WidgetInfo[] {
    const { width, height } = this.#services.geometry();
    return [
      {
        id: this.id,
        kind: 'fade',
        rect: { x: 0, y: 0, width, height },
        visible: true,
        enabled: true,
        state: this.#step,
        text: null,
        frame: null,
      },
    ];
  }
}
