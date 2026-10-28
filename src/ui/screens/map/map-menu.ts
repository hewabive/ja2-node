// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CreateDestroyMouseRegionsForAssignmentMenu and its siblings (one region per line,
// @src MSYS_PRIORITY_HIGHEST - 4, the callbacks run for shaded lines too and decide themselves), AssignmentMenuMvtCallBack
// @src (a shaded line is not highlighted), CreateDestroyScreenMaskForAssignmentAndContractMenus and
// @src AssignmentScreenMaskBtnCallback (a full-screen mask that closes every menu on a button release, the first release
// @src after opening ignored); src/game/Utils/PopUpBox.cc (the box itself).

import type { DrawList } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../../input/regions.ts';
import { PopupBox, type PopupBoxStyle, type PopupLine } from '../../widgets/popup-box.ts';
import { type WidgetInfo, widgetRect } from '../../widgets/widget-info.ts';

export const MENU_PRIORITY = Priority.HIGHEST - 4;
const ANY_BUTTON_UP =
  MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP | MouseReason.MBUTTON_UP | MouseReason.X1BUTTON_UP | MouseReason.X2BUTTON_UP;

export interface MapMenuOptions {
  readonly id: string;
  readonly owner: unknown;
  readonly regions: RegionDispatcher;
  readonly select: (line: number) => void;
  readonly secondary?: (line: number) => void;
  readonly hover?: (line: number, on: boolean) => void;
  readonly priority?: number;
  readonly selectable?: (line: number) => boolean;
}

export class MapMenu {
  readonly box: PopupBox;
  readonly id: string;
  readonly #options: MapMenuOptions;
  #regions: MouseRegion[] = [];
  #pinned = -1;

  constructor(style: PopupBoxStyle, x: number, y: number, lines: readonly PopupLine[], options: MapMenuOptions) {
    this.box = new PopupBox(style, x, y);
    this.box.setLines(lines);
    this.#options = options;
    this.id = options.id;
  }

  get open(): boolean {
    return this.#regions.length > 0;
  }

  get lines(): readonly PopupLine[] {
    return this.box.lines;
  }

  pin(line: number): void {
    this.#pinned = line;
    this.box.highlighted = line;
  }

  unpin(): void {
    this.#pinned = -1;
    this.box.highlighted = -1;
  }

  moveTo(x: number, y: number): void {
    const wasOpen = this.open;
    if (wasOpen) this.hide();
    this.box.x = x;
    this.box.y = y;
    if (wasOpen) this.show();
  }

  setLines(lines: readonly PopupLine[]): void {
    const wasOpen = this.open;
    if (wasOpen) this.hide();
    this.box.setLines(lines);
    if (wasOpen) this.show();
  }

  show(): void {
    if (this.open) return;
    const { regions, owner } = this.#options;
    const step = this.box.lineStep;
    let y = this.box.y + this.box.style.marginTop;
    this.#regions = this.box.lines.map((_, i) => {
      const region = regions.define({
        x1: this.box.x,
        y1: y,
        x2: this.box.x + this.box.width,
        y2: y + step,
        priority: this.#options.priority ?? MENU_PRIORITY,
        cursor: NO_CURSOR,
        owner,
        id: `${this.id}.line${i}`,
        onMove: (_r, reason) => this.#move(i, reason),
        onButton: (_r, reason) => this.#button(i, reason),
      });
      y += step;
      return region;
    });
  }

  hide(): void {
    for (const r of this.#regions) r.remove();
    this.#regions = [];
    this.box.highlighted = this.#pinned;
  }

  #shaded(line: number): boolean {
    return (this.box.lines[line]?.shade ?? 'none') !== 'none';
  }

  #selectable(line: number): boolean {
    return this.#options.selectable?.(line) ?? true;
  }

  #move(line: number, reason: number): void {
    if (this.#pinned >= 0 || !this.#selectable(line)) return;
    if (reason & MouseReason.GAIN_MOUSE) {
      if (!this.#shaded(line)) this.box.highlighted = line;
      this.#options.hover?.(line, true);
    } else if (reason & MouseReason.LOST_MOUSE) {
      this.box.highlighted = -1;
      this.#options.hover?.(line, false);
    }
  }

  #button(line: number, reason: number): void {
    if (!this.#selectable(line)) return;
    if (reason & MouseReason.LBUTTON_UP) this.#options.select(line);
    else if (reason & MouseReason.RBUTTON_UP) this.#options.secondary?.(line);
  }

  render(list: DrawList): void {
    if (this.open) this.box.draw(list);
  }

  describe(): WidgetInfo[] {
    const box = this.box;
    return [
      {
        id: this.id,
        kind: 'popupMenu',
        rect: widgetRect(box.x, box.y, box.width, box.height),
        visible: this.open,
        enabled: true,
        state: box.highlighted,
        text: null,
        frame: null,
      },
      ...this.#regions.map((r, i) => ({
        id: `${this.id}.line${i}`,
        kind: 'popupLine',
        rect: widgetRect(r.x1, r.y1, r.width, r.height),
        visible: this.open,
        enabled: !this.#shaded(i),
        state: box.highlighted === i ? 'highlighted' : (box.lines[i]?.shade ?? 'none'),
        text: box.lines[i]?.text ?? null,
        frame: null,
      })),
    ];
  }
}

export class MenuMask {
  #region: MouseRegion | null = null;
  #ignoreFirst = false;
  readonly #regions: RegionDispatcher;
  readonly #owner: unknown;
  readonly #close: () => void;

  constructor(regions: RegionDispatcher, owner: unknown, close: () => void) {
    this.#regions = regions;
    this.#owner = owner;
    this.#close = close;
  }

  get active(): boolean {
    return this.#region !== null;
  }

  sync(wanted: boolean, opening: boolean): void {
    if (wanted && !this.#region) {
      this.#ignoreFirst = opening;
      this.#region = this.#regions.define({
        x1: 0,
        y1: 0,
        x2: 0xffff,
        y2: 0xffff,
        priority: MENU_PRIORITY,
        cursor: NO_CURSOR,
        owner: this.#owner,
        id: 'mapMenuMask',
        onButton: (_r, reason) => {
          if (!(reason & ANY_BUTTON_UP)) return;
          if (this.#ignoreFirst) {
            this.#ignoreFirst = false;
            return;
          }
          this.#close();
        },
      });
    } else if (!wanted && this.#region) {
      this.#region.remove();
      this.#region = null;
    }
  }
}
