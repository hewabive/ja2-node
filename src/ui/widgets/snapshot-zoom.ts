// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/VSurface.cc BltStretchVideoSurface (a copy of the screen stretched with nearest stepping);
// @src src/game/Laptop/Laptop.cc, src/game/Strategic/Auto_Resolve.cc (the zooms that stretch a saved screen into a
// @src growing or shrinking rectangle). See docs/28 §3.6.

import { idiv } from '../../core/int.ts';
import { type Area, type DrawList, rgb } from '../draw-list.ts';
import type { UiInputEvent } from '../input/events.ts';
import type { Modal } from '../screen.ts';
import type { UiServices } from '../services.ts';
import type { WidgetInfo } from './widget-info.ts';

export const ZOOM_STEP_MS = 16;
const BLACK = rgb(0, 0, 0);

export type ZoomRect = (step: number, steps: number) => Area;

export function interpolateRect(from: Area, to: Area): ZoomRect {
  return (step, steps) => {
    const t = Math.min(step, steps);
    const lerp = (a: number, b: number) => a + idiv((b - a) * t, steps);
    return { x: lerp(from.x, to.x), y: lerp(from.y, to.y), width: lerp(from.width, to.width), height: lerp(from.height, to.height) };
  };
}

export interface SnapshotZoomOptions {
  readonly steps: number;
  readonly destination: ZoomRect;
  readonly source?: Area;
  readonly onDone?: () => void;
  readonly id?: string;
}

export class SnapshotZoom implements Modal {
  readonly id: string;
  readonly freezesScreen = true;
  readonly #services: UiServices;
  readonly #options: SnapshotZoomOptions;
  readonly #texture: string;
  #captured = false;
  #start: number | null = null;
  #step = 0;
  #done = false;

  constructor(services: UiServices, options: SnapshotZoomOptions) {
    this.#services = services;
    this.#options = options;
    this.id = options.id ?? 'snapshotZoom';
    this.#texture = `${this.id}.snapshot`;
  }

  get step(): number {
    return this.#step;
  }

  get destination(): Area {
    return this.#options.destination(this.#step, this.#options.steps);
  }

  enter(): void {
    this.#captured = false;
    this.#start = null;
    this.#step = 0;
  }

  exit(): void {}

  update(): void {
    const now = this.#services.clock.now;
    if (this.#start === null) this.#start = now;
    this.#step = Math.floor((now - this.#start) / ZOOM_STEP_MS);
    if (this.#step > this.#options.steps && !this.#done) {
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
    list.capture(this.#texture);
    this.#captured = true;
    const source = this.#options.source ?? { x: 0, y: 0, width, height };
    list.fill(0, 0, width, height, BLACK);
    list.snapshot(this.#texture, source, this.destination);
  }

  get captured(): boolean {
    return this.#captured;
  }

  describe(): WidgetInfo[] {
    return [
      {
        id: this.id,
        kind: 'snapshotZoom',
        rect: this.destination,
        visible: true,
        enabled: true,
        state: this.#step,
        text: null,
        frame: null,
      },
    ];
  }
}
