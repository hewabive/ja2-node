import type { ImageCatalog } from './assets.ts';
import { UiClock } from './clock.ts';
import { CursorId } from './cursors/cursor-ids.ts';
import { type ComposedCursor, CursorState } from './cursors/cursor-state.ts';
import type { CursorTable } from './cursors/cursor-table.ts';
import type { DrawList } from './draw-list.ts';
import { isPointerEvent, type UiInputEvent } from './input/events.ts';
import { RegionDispatcher } from './input/regions.ts';
import { FastHelp } from './input/tooltips.ts';
import { ScreenHost } from './screen.ts';
import type { ScreenGeometry, UiServices } from './services.ts';
import { FontName, type FontSet } from './text/fonts.ts';
import { ButtonSystem } from './widgets/button.ts';
import { SILENT, UiScreenKind, type UiSoundSink } from './widgets/button-sounds.ts';
import { SliderSystem } from './widgets/slider.ts';
import type { WidgetInfo } from './widgets/widget-info.ts';

export interface UiRuntimeOptions {
  readonly fonts: FontSet;
  readonly images: ImageCatalog;
  readonly cursors: CursorTable;
  readonly geometry: () => ScreenGeometry;
  readonly sounds?: UiSoundSink;
  readonly pauseGame?: (paused: boolean) => void;
}

export interface CursorReport {
  readonly id: number;
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

interface CursorEffects {
  readonly hidesCursor?: boolean;
}

export class UiRuntime implements UiServices {
  readonly regions = new RegionDispatcher(CursorId.NORMAL);
  readonly clock = new UiClock();
  readonly host = new ScreenHost();
  readonly fonts: FontSet;
  readonly images: ImageCatalog;
  readonly sounds: UiSoundSink;
  readonly buttons: ButtonSystem;
  readonly sliders: SliderSystem;
  readonly cursor: CursorState;
  readonly #fastHelp = new FastHelp();
  readonly #geometry: () => ScreenGeometry;
  readonly #pauseGame: ((paused: boolean) => void) | undefined;
  #pointerInside = false;
  #lastCursor: ComposedCursor | null = null;

  constructor(options: UiRuntimeOptions) {
    this.fonts = options.fonts;
    this.images = options.images;
    this.sounds = options.sounds ?? SILENT;
    this.#geometry = options.geometry;
    this.#pauseGame = options.pauseGame;
    this.buttons = new ButtonSystem({ regions: this.regions, images: this.images, sounds: this.sounds, screen: () => this.soundScreen });
    this.sliders = new SliderSystem(this.regions);
    this.cursor = new CursorState(options.cursors, this.images);
    this.regions.onCursor((id) => this.cursor.set(id, this.clock.ja2Now));
  }

  get soundScreen(): UiScreenKind {
    return this.host.screen?.soundScreen ?? UiScreenKind.OTHER;
  }

  geometry(): ScreenGeometry {
    return this.#geometry();
  }

  pauseGame(paused: boolean): void {
    this.#pauseGame?.(paused);
  }

  pointerLeft(): void {
    this.#pointerInside = false;
  }

  input(event: UiInputEvent): boolean {
    if (isPointerEvent(event)) {
      this.#pointerInside = true;
      this.regions.pointer(event, this.clock.now);
    }
    return this.host.input(event);
  }

  frame(now: number, list: DrawList): void {
    this.clock.advance(now);
    this.regions.frame(now);
    this.sliders.frame();
    this.host.update(now);
    const region = this.regions.current;
    this.cursor.tick(this.clock.ja2Now, region?.animatesCursor ?? false, region?.flashesCursor ?? false);
    this.host.render(list);
    this.#renderTooltips(list, now);
    this.#renderCursor(list);
  }

  #renderTooltips(list: DrawList, now: number): void {
    const top = this.host.top;
    if (!top?.rendersTooltips) return;
    const { width, height } = this.geometry();
    this.#fastHelp.render(list, this.regions, now, this.fonts, width, height);
  }

  #cursorHidden(): boolean {
    const top = this.host.top as (CursorEffects & object) | null;
    return !this.#pointerInside || !this.regions.pointerKnown || top?.hidesCursor === true;
  }

  #renderCursor(list: DrawList): void {
    this.#lastCursor = null;
    if (this.#cursorHidden()) return;
    const font = this.fonts.find(FontName.TINYFONT1);
    const composed = this.cursor.compose(this.clock.ja2Now, font, this.regions.current?.showsMouseText ?? false);
    if (!composed) return;
    this.#lastCursor = composed;
    this.cursor.draw(list, this.regions.mouseX, this.regions.mouseY, composed, font);
  }

  cursorReport(): CursorReport {
    const id = this.cursor.current;
    return {
      id,
      name: this.cursor.table.cursors[id]?.name ?? null,
      x: this.regions.mouseX,
      y: this.regions.mouseY,
      visible: this.#lastCursor !== null,
    };
  }

  describe(): WidgetInfo[] {
    return this.host.describe();
  }
}
