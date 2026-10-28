// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Animated_ProgressBar.cc CreateLoadingScreenProgressBar (162,427 318×16 in the std640 frame),
// @src CreateProgressBar (red fill), DefineProgressBarPanel (lighter and darker edges), SetProgressBarTitle,
// @src SetRelativeStartAndEndPercentage (the panel and its title), RenderProgressBar (the load bar fill, or the grey
// @src border, black interior and green fill), SetProgressBarColor.

import { idiv } from '../../core/int.ts';
import { type DrawList, type RgbColor, rgb } from '../draw-list.ts';
import type { BitmapFont } from '../text/bitmap-font.ts';
import { stringPixLength } from '../text/measure.ts';
import { mprint } from '../text/print.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const LOAD_BAR = { x: 162, y: 427, width: 318, height: 16 } as const;
const DEFAULT_FILL = rgb(150, 0, 0);
const PANEL_BORDER = rgb(160, 160, 160);
const PANEL_INTERIOR = rgb(0, 0, 0);
const PANEL_FILL = rgb(72, 155, 24);
const LIGHTER = 1.33;
const DARKER = 0.75;
const CHANNEL_MAX = 255;
const PERCENT = 100;
const BAR_INSET = 2;
const TITLE_Y = 3;

export type ProgressBarStyle = 'loadBar' | 'panel';

export interface ProgressPanel {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly title?: { readonly text: string; readonly font: BitmapFont; readonly foreground: number; readonly shadow: number };
}

export interface ProgressBarOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly style: ProgressBarStyle;
  readonly fill?: RgbColor;
  readonly panel?: ProgressPanel;
  readonly id?: string;
}

function channel(value: number, factor: number): number {
  return Math.min(CHANNEL_MAX, Math.trunc(value * factor));
}

export class ProgressBar {
  readonly id: string;
  readonly options: ProgressBarOptions;
  #start = 0;
  #end = 1;
  #percentage = 0;

  constructor(options: ProgressBarOptions) {
    this.options = options;
    this.id = options.id ?? 'progressBar';
  }

  setRelativeRange(startPercent: number, endPercent: number): void {
    this.#start = startPercent * 0.01;
    this.#end = endPercent * 0.01;
  }

  setPercentage(percentage: number): void {
    this.#percentage = percentage;
  }

  get actual(): number {
    return this.#start + (this.#end - this.#start) * this.#percentage * 0.01;
  }

  render(list: DrawList): void {
    const panel = this.options.panel;
    if (panel) this.#drawPanel(list, panel);
    const { x, y, width: w, height: h } = this.options;
    const end = Math.trunc(x + 2.0 + this.actual * (w - 4));
    if (end < x + BAR_INSET || x + w - BAR_INSET < end) return;
    if (this.options.style === 'loadBar') {
      list.fill(x, y, end, y + h, this.options.fill ?? DEFAULT_FILL);
      return;
    }
    list.fill(x, y, x + w, y + h, PANEL_BORDER);
    list.fill(x + BAR_INSET, y + BAR_INSET, x + w - BAR_INSET, y + h - BAR_INSET, PANEL_INTERIOR);
    list.fill(x + BAR_INSET, y + BAR_INSET, end, y + h - BAR_INSET, PANEL_FILL);
  }

  #drawPanel(list: DrawList, panel: ProgressPanel): void {
    const { left: l, top: t, right: r, bottom: b } = panel;
    list.fill(l, t, r, b, rgb(channel(panel.red, LIGHTER), channel(panel.green, LIGHTER), channel(panel.blue, LIGHTER)));
    list.fill(l + 1, t + 1, r, b, rgb(channel(panel.red, DARKER), channel(panel.green, DARKER), channel(panel.blue, DARKER)));
    list.fill(l + 1, t + 1, r - 1, b - 1, rgb(panel.red, panel.green, panel.blue));
    const title = panel.title;
    if (!title) return;
    const x = idiv(r + l - stringPixLength(title.text, title.font), 2);
    mprint(list, title.font, x, t + TITLE_Y, title.text, { foreground: title.foreground, shadow: title.shadow, background: 0 });
  }

  describe(): WidgetInfo {
    const { x, y, width, height } = this.options;
    return {
      id: this.id,
      kind: 'progressBar',
      rect: widgetRect(x, y, width, height),
      visible: true,
      enabled: true,
      state: Math.round(this.actual * PERCENT),
      text: null,
      frame: null,
    };
  }
}
