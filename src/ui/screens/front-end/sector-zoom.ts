// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc BeginLoadScreen (on the map screen, unless a saved game loads or a meanwhile
// @src runs: no cursor, "final psionic blast 01 (16-44).wav" at HIGHVOLUME, the screen stretched for 2000 ms from a
// @src rectangle shrinking toward 536, 367 to the whole screen, the percentage bent by the gravity factor and truncated
// @src after it, the saved screen shaded with the low percent table once more on every pass past half way, until the
// @src percentage reaches 100), EnterSector and SetCurrentWorldSector (a sector entry, and gfGotoSectorTransition: the
// @src pre-battle panel's Enter into the loaded sector, src/game/Strategic/PreBattle_Interface.cc).

import { idiv, u16 } from '../../../core/int.ts';
import { type Area, type DrawList, LOW_PERCENT_SHADOW_FACTOR } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import type { Modal } from '../../screen.ts';
import type { UiServices } from '../../services.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';

export const SECTOR_ZOOM = 'sectorZoom';
export const SECTOR_ZOOM_TIME = 2000;
export const SECTOR_ZOOM_SHADE_STEP_MS = 16;
const SECTOR_ZOOM_SOUND = 'sounds/final psionic blast 01 (16-44).wav';
const HIGH_VOLUME = 127;
const PERCENT = 100;
const HALF = 50;
const ZOOM_LEFT = 536;
const ZOOM_TOP = 367;
const ZOOM_RIGHT = 541;
const ZOOM_BOTTOM = 406;
const SNAPSHOT = `${SECTOR_ZOOM}.screen`;
const trunc = Math.trunc;

export function sectorZoomPercentage(elapsed: number): number {
  const p = Math.min(idiv(elapsed * PERCENT, SECTOR_ZOOM_TIME), PERCENT);
  const factor = (p - HALF) * 2;
  if (p < HALF) return trunc(p + p * factor * 0.01 + 0.5);
  return trunc(p + (PERCENT - p) * factor * 0.01 + 0.05);
}

export function sectorZoomSource(percentage: number, width: number, height: number): Area {
  return {
    x: u16(idiv(ZOOM_LEFT * percentage, PERCENT)),
    y: u16(idiv(ZOOM_TOP * percentage, PERCENT)),
    width: u16(width - idiv(ZOOM_RIGHT * percentage, PERCENT)),
    height: u16(height - idiv(ZOOM_BOTTOM * percentage, PERCENT)),
  };
}

export function sectorZoomShadePasses(elapsed: number): number {
  let passes = 0;
  for (let at = 0; at <= elapsed; at += SECTOR_ZOOM_SHADE_STEP_MS) if (sectorZoomPercentage(at) > HALF) passes++;
  return passes;
}

export class SectorZoom implements Modal {
  readonly id = SECTOR_ZOOM;
  readonly freezesScreen = true;
  readonly hidesCursor = true;
  readonly #services: UiServices;
  readonly #onDone: () => void;
  #start: number | null = null;
  #elapsed = 0;
  #reachedEnd = false;
  #done = false;

  constructor(services: UiServices, onDone: () => void) {
    this.#services = services;
    this.#onDone = onDone;
  }

  enter(): void {
    this.#services.pauseGame?.(true);
    this.#services.sounds.play({ file: SECTOR_ZOOM_SOUND, volume: HIGH_VOLUME });
  }

  exit(): void {
    this.#services.pauseGame?.(false);
  }

  update(): void {
    if (this.#done) return;
    if (this.#reachedEnd) {
      this.#done = true;
      this.#onDone();
      this.#services.host.closeModal(this);
      return;
    }
    const now = this.#services.clock.now;
    this.#start ??= now;
    this.#elapsed = now - this.#start;
  }

  input(_event: UiInputEvent): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { width, height } = this.#services.geometry();
    const percentage = sectorZoomPercentage(this.#elapsed);
    list.capture(SNAPSHOT);
    list.snapshot(SNAPSHOT, sectorZoomSource(percentage, width, height), { x: 0, y: 0, width, height });
    const passes = sectorZoomShadePasses(this.#elapsed);
    if (passes > 0) list.shadow(0, 0, width - 1, height - 1, LOW_PERCENT_SHADOW_FACTOR ** passes);
    if (percentage >= PERCENT) this.#reachedEnd = true;
  }

  describe(): WidgetInfo[] {
    const { width, height } = this.#services.geometry();
    return [
      {
        id: SECTOR_ZOOM,
        kind: 'snapshotZoom',
        rect: sectorZoomSource(sectorZoomPercentage(this.#elapsed), width, height),
        visible: true,
        enabled: true,
        state: this.#elapsed,
        text: null,
        frame: null,
      },
    ];
  }
}
