// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Slider.cc AddSlider (the vertical steel style 42×25 and the default horizontal style), RenderAllSliderBars
// @src (dragging continues outside the region from the pointer's y, also for horizontal sliders), RenderSelectedSliderBar,
// @src RenderSliderBox, SelectedSliderMovementCallBack, SelectedSliderButtonCallBack (wheel steps of ceil(steps / 32)),
// @src SetSliderPos (the vertical value is inverted), CalculateNewSliderIncrement, CalculateNewSliderBoxPosition,
// @src SetSliderValue (a value at or above the step count is ignored). See docs/28 §3.6.

import { idiv, u16 } from '../../core/int.ts';
import { type AssetKey, type DrawList, rgb } from '../draw-list.ts';
import { MouseButtonMask, MouseReason, NO_CURSOR, Priority } from '../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../input/regions.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const WHEEL_MOVE_FRACTION = 32;
export const DEFAULT_SLIDER_SIZE = 7;
export const STEEL_SLIDER_WIDTH = 42;
export const STEEL_SLIDER_HEIGHT = 25;
const HORIZONTAL_BOX_WIDTH = 8;
const TRACK_COLOR = rgb(255, 255, 255);

export type SliderStyle = 'default' | 'verticalSteel';

export interface SliderOptions {
  readonly style: SliderStyle;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly steps: number;
  readonly thumb: AssetKey;
  readonly priority?: number;
  readonly cursor?: number;
  readonly onChange: (value: number) => void;
  readonly owner?: unknown;
  readonly id?: string;
}

export class Slider {
  readonly id: string;
  readonly owner: unknown;
  readonly vertical: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly thumb: AssetKey;
  readonly region: MouseRegion;
  readonly #onChange: (value: number) => void;
  increment = 0;
  boxPosition = 0;

  constructor(options: SliderOptions, regions: RegionDispatcher, system: SliderSystem) {
    this.id = options.id ?? 'slider';
    this.owner = options.owner;
    this.vertical = options.style === 'verticalSteel';
    this.x = options.x;
    this.y = options.y;
    this.steps = options.steps;
    this.thumb = options.thumb;
    this.#onChange = options.onChange;
    let rx = options.x;
    let ry = options.y;
    let rw: number;
    let rh: number;
    if (this.vertical) {
      this.width = STEEL_SLIDER_WIDTH;
      this.height = options.length;
      rx = u16(rx - idiv(this.width, 2));
      rw = this.width;
      rh = this.height;
    } else {
      this.width = options.length;
      this.height = DEFAULT_SLIDER_SIZE;
      ry = u16(ry - DEFAULT_SLIDER_SIZE);
      rw = this.width;
      rh = DEFAULT_SLIDER_SIZE * 2;
    }
    this.region = regions.define({
      x1: rx,
      y1: ry,
      x2: rx + rw,
      y2: ry + rh,
      priority: options.priority ?? Priority.NORMAL,
      cursor: options.cursor ?? NO_CURSOR,
      owner: options.owner,
      id: this.id,
      onMove: (r, reason) => system.movement(this, r, reason),
      onButton: (r, reason) => system.button(this, r, reason),
    });
    this.#updateBox();
  }

  get value(): number {
    return this.vertical ? this.steps - this.increment : this.increment;
  }

  setValue(value: number): void {
    if (value >= this.steps) return;
    this.increment = this.vertical ? this.steps - value : value;
    this.#updateBox();
  }

  setPosition(position: number): void {
    if (position === this.increment) return;
    this.increment = position;
    this.#updateBox();
    this.#onChange(this.vertical ? this.steps - position : position);
  }

  newIncrement(position: number): void {
    let next: number;
    if (this.vertical) next = position <= this.height ? idiv(this.steps * position, this.height) : this.steps;
    else next = idiv(this.steps * position, this.width);
    this.setPosition(next);
  }

  #updateBox(): void {
    let position: number;
    let max: number;
    if (this.vertical) {
      position = this.increment >= this.steps ? this.y + this.height : this.y + idiv(this.height * this.increment, this.steps);
      max = this.y + this.height;
    } else {
      position =
        this.increment === this.steps
          ? this.x + this.width - HORIZONTAL_BOX_WIDTH + 1
          : this.x + idiv(this.width * this.increment, this.steps);
      max = this.x + this.width - HORIZONTAL_BOX_WIDTH + 1;
    }
    this.boxPosition = Math.min(u16(position), u16(max));
  }

  render(list: DrawList): void {
    if (!this.vertical) {
      const { x, y, width: w } = this;
      list.line(x + 1, y - 1, x + w - 1, y - 1, TRACK_COLOR);
      list.line(x, y, x + w, y, TRACK_COLOR);
      list.line(x + 1, y + 1, x + w - 1, y + 1, TRACK_COLOR);
      list.image(this.thumb, 0, this.boxPosition, y - DEFAULT_SLIDER_SIZE);
      return;
    }
    list.image(this.thumb, 0, this.x - idiv(STEEL_SLIDER_WIDTH, 2), this.boxPosition - idiv(STEEL_SLIDER_HEIGHT, 2));
  }

  describe(): WidgetInfo {
    const r = this.region;
    return {
      id: this.id,
      kind: 'slider',
      rect: widgetRect(r.x1, r.y1, r.width, r.height),
      visible: true,
      enabled: r.enabled,
      state: this.value,
      text: null,
      frame: null,
    };
  }
}

export class SliderSystem {
  readonly #regions: RegionDispatcher;
  readonly #sliders: Slider[] = [];
  #current: Slider | null = null;

  constructor(regions: RegionDispatcher) {
    this.#regions = regions;
  }

  get sliders(): readonly Slider[] {
    return this.#sliders;
  }

  add(options: SliderOptions): Slider {
    const slider = new Slider(options, this.#regions, this);
    this.#sliders.push(slider);
    return slider;
  }

  remove(slider: Slider): void {
    const at = this.#sliders.indexOf(slider);
    if (at >= 0) this.#sliders.splice(at, 1);
    if (this.#current === slider) this.#current = null;
    slider.region.remove();
  }

  removeOwner(owner: unknown): void {
    for (const slider of [...this.#sliders]) if (slider.owner === owner) this.remove(slider);
  }

  #leftDown(): boolean {
    return this.#regions.isButtonDown(MouseButtonMask.LEFT);
  }

  frame(): void {
    const current = this.#current;
    if (this.#leftDown() && current) {
      const mouseY = this.#regions.mouseY;
      current.newIncrement(mouseY < current.y ? 0 : u16(mouseY - current.y));
    } else this.#current = null;
  }

  render(list: DrawList, owner?: unknown): void {
    for (const slider of this.#sliders) if (owner === undefined || slider.owner === owner) slider.render(list);
  }

  movement(slider: Slider, region: MouseRegion, reason: number): void {
    if (this.#current !== null) return;
    if (!this.#leftDown()) return;
    if (reason & MouseReason.LOST_MOUSE) this.#current = slider;
    else if (!(reason & (MouseReason.GAIN_MOUSE | MouseReason.MOVE))) return;
    slider.newIncrement(u16(slider.vertical ? region.relativeY : region.relativeX));
  }

  button(slider: Slider, region: MouseRegion, reason: number): void {
    if (this.#current !== null) return;
    const step = idiv(slider.steps + WHEEL_MOVE_FRACTION - 1, WHEEL_MOVE_FRACTION);
    if (reason & (MouseReason.LBUTTON_DWN | MouseReason.LBUTTON_REPEAT))
      slider.newIncrement(u16(slider.vertical ? region.relativeY : region.relativeX));
    else if (reason & MouseReason.WHEEL_UP) slider.setPosition(Math.max(0, slider.increment - step));
    else if (reason & MouseReason.WHEEL_DOWN) slider.setPosition(Math.min(slider.increment + step, slider.steps));
  }
}
