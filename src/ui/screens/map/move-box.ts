// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc CreateDestroyMovementBox, CreatePopUpBoxForMovementBox (at 450, 100,
// @src the header white, the Plot and Cancel lines yellow, kept inside the map view), BuildMouseRegionsForMoveBox (one
// @src region per line at MSYS_PRIORITY_HIGHEST, the heading and blank lines without callbacks), MoveMenuMvtCallback,
// @src MoveMenuBtnCallback (a second click on the same line within DBL_CLICK_DELAY_FOR_MOVE_MENU acts as Plot when
// @src something is picked), ReBuildMoveBox, CreateScreenMaskForMoveBox and MoveScreenMaskBtnCallbackPrimary (a mask at
// @src MSYS_PRIORITY_HIGHEST - 4 that closes the box), ReportMapScreenMovementError.

import { FontColor } from '../../../content/text/font-colors.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../../input/regions.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { PopupBoxStyle, PopupLine } from '../../widgets/popup-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { MapMenu } from './map-menu.ts';
import { MAP_VIEW_HEIGHT, MAP_VIEW_START_X, MAP_VIEW_START_Y, MAP_VIEW_WIDTH } from './map-view.ts';
import type { MoveFeedback, MoveLine, MovePlan, MoveSelection } from './move-selection.ts';

export const MOVE_BOX_X = 450;
export const MOVE_BOX_Y = 100;
export const DBL_CLICK_DELAY_FOR_MOVE_MENU = 200;
const LINE_PRIORITY = Priority.HIGHEST;
const MASK_PRIORITY = Priority.HIGHEST - 4;
const ACTIVE_LINES: ReadonlySet<MoveLine['kind']> = new Set(['squad', 'vehicle', 'soldier', 'others', 'done', 'cancel']);
const NEVER = Number.NEGATIVE_INFINITY;

type Point = { readonly x: number; readonly y: number };

export interface MoveBoxHost {
  readonly regions: RegionDispatcher;
  readonly text: UiTextService;
  readonly owner: unknown;
  readonly style: () => PopupBoxStyle;
  readonly origin: () => Point;
  readonly now: () => number;
  readonly vehicleType: (vehicle: number) => number;
  readonly report: (feedback: NonNullable<MoveFeedback>) => void;
  readonly done: (plan: MovePlan) => void;
  readonly closed: () => void;
}

function lineColour(kind: MoveLine['kind']): number | undefined {
  if (kind === 'header') return FontColor.WHITE;
  if (kind === 'done' || kind === 'cancel') return FontColor.YELLOW;
  return undefined;
}

export class MoveBox {
  readonly #host: MoveBoxHost;
  #menu: MapMenu | null = null;
  #mask: MouseRegion | null = null;
  #selection: MoveSelection | null = null;
  #sector = '';
  #lines: MoveLine[] = [];
  #clicks: number[] = [];

  constructor(host: MoveBoxHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#menu !== null;
  }

  get selection(): MoveSelection | null {
    return this.#selection;
  }

  get lines(): readonly MoveLine[] {
    return this.#lines;
  }

  show(sector: string, selection: MoveSelection): void {
    this.close(false);
    this.#sector = sector;
    this.#selection = selection;
    this.#clicks = [];
    this.#defineMask();
    this.#build();
  }

  #defineMask(): void {
    this.#mask = this.#host.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: MASK_PRIORITY,
      cursor: NO_CURSOR,
      owner: this.#host.owner,
      id: 'moveBoxMask',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_UP) this.close(true);
      },
    });
  }

  #build(): void {
    const selection = this.#selection;
    if (!selection) return;
    this.#menu?.hide();
    this.#lines = selection.lines(this.#host.text, this.#sector, this.#host.vehicleType);
    const lines: PopupLine[] = this.#lines.map((l) => {
      const foreground = lineColour(l.kind);
      return foreground === undefined ? { text: l.text } : { text: l.text, foreground };
    });
    const o = this.#host.origin();
    const menu = new MapMenu(this.#host.style(), o.x + MOVE_BOX_X, o.y + MOVE_BOX_Y, lines, {
      id: 'moveBox',
      owner: this.#host.owner,
      regions: this.#host.regions,
      priority: LINE_PRIORITY,
      selectable: (line) => ACTIVE_LINES.has(this.#lines[line]?.kind ?? 'blank'),
      select: (line) => this.#click(line),
    });
    this.#keepInMapView(menu, o);
    this.#menu = menu;
    menu.show();
  }

  #keepInMapView(menu: MapMenu, o: Point): void {
    const box = menu.box;
    const right = o.x + MAP_VIEW_START_X + MAP_VIEW_WIDTH;
    const bottom = o.y + MAP_VIEW_START_Y + MAP_VIEW_HEIGHT;
    if (box.x + box.width >= right) box.x = Math.max(o.x + MAP_VIEW_START_X, right - box.width);
    if (box.y + box.height >= bottom) box.y = Math.max(o.y + MAP_VIEW_START_Y, bottom - box.height);
  }

  #click(index: number): void {
    const selection = this.#selection;
    const line = this.#lines[index];
    if (!selection || !line) return;
    const now = this.#host.now();
    if (now - (this.#clicks[index] ?? NEVER) < DBL_CLICK_DELAY_FOR_MOVE_MENU) {
      if (selection.anythingSelected()) this.#plot();
      return;
    }
    this.#clicks[index] = now;
    switch (line.kind) {
      case 'squad':
        this.#feedback(selection.toggleSquad(line.unit));
        break;
      case 'vehicle':
        this.#feedback(selection.toggleVehicle(line.unit));
        break;
      case 'others':
        this.#feedback(selection.toggleOthers());
        break;
      case 'soldier': {
        const feedback = selection.toggleSoldier(line.unit);
        this.#feedback(feedback);
        if (feedback && 'mapError' in feedback) return;
        break;
      }
      case 'done':
        if (selection.anythingSelected()) this.#plot();
        return;
      case 'cancel':
        this.close(true);
        return;
      default:
        return;
    }
    this.#build();
  }

  #feedback(feedback: MoveFeedback): void {
    if (feedback) this.#host.report(feedback);
  }

  #plot(): void {
    const plan = this.#selection?.plan();
    this.close(false);
    if (plan) this.#host.done(plan);
  }

  close(notify: boolean): void {
    const wasOpen = this.open;
    this.#menu?.hide();
    this.#menu = null;
    this.#mask?.remove();
    this.#mask = null;
    if (wasOpen && notify) this.#host.closed();
  }

  render(list: DrawList): void {
    this.#menu?.render(list);
  }

  describe(): WidgetInfo[] {
    return this.#menu?.describe() ?? [];
  }
}
