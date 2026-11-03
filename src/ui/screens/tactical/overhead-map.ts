// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Overhead_Map.cc GoIntoOverheadMap (the 640 × 360 background region and the 640 × 320 map
// @src region at MSYS_PRIORITY_HIGH, the persons.sti shades 256, 310 and black), HandleOverheadUI (every key goes to it:
// @src ESC and INSERT close it on key-down, ALT+x asks to leave the game), KillOverheadMap, RenderOverheadMap (black
// @src area, map_bord.sti border), RenderOverheadOverlays (the persons by team at +2, -5 lifted by the height
// @src adjustment / 5, the selected merc black while the radar blink is on, roof soldiers brighter; one pixel per
// @src visible item at +6, black while blinking),
// @src DisplayMercNameInOverhead (TINYFONT1 white, 13 above), GetClosestMercInOverheadMap (radius 1),
// @src ClickOverheadRegionCallbackPrimary (centre the view there and close), ClickOverheadRegionCallbackSecondary.

import { FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { ItemView, SoldierView } from '../../../protocol/view.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { KeyModifier, type UiKeyEvent, type UiTextEvent } from '../../input/events.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { OverheadMapView, ScreenPoint } from './environment.ts';

export const OVERHEAD_AREA_WIDTH = 640;
export const OVERHEAD_AREA_HEIGHT = 360;
export const OVERHEAD_MAP_HEIGHT = 320;
const OWNER = 'tacticalOverhead';
const CLOSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'Insert']);
const EXIT_GAME_KEY = 'x';
const PERSON_X = 2;
const PERSON_Y = -5;
const ITEM_Y = 6;
const NAME_LIFT = 13;
const SCALE = 5;
const CLOSEST_RADIUS = 1;
const WORLD_COLS = 160;
const BLACK = rgb(0, 0, 0);
const drawnHeight = (s: SoldierView) => Math.trunc(s.heightAdjustment ?? 0);
const drawnRaised = (s: SoldierView) => drawnHeight(s) !== 0;
const heightLift = (s: SoldierView) => idiv(drawnHeight(s), SCALE);
const WHITE = rgb(255, 255, 255);
const NORMAL_SHADE = { red: 256, green: 256, blue: 256, mono: false };
const ROOF_SHADE = { red: 310, green: 310, blue: 310, mono: false };
const SELECTED_SHADE = { red: 0, green: 0, blue: 0, mono: false };

export interface OverheadArt {
  readonly border: string;
  readonly persons: string;
}

export interface OverheadHooks {
  readonly services: UiServices;
  readonly art: OverheadArt;
  map(): OverheadMapView | null;
  soldiers(): readonly SoldierView[];
  items(): readonly ItemView[];
  selected(): number | null;
  blink(): boolean;
  centerOn(gridNo: number): void;
  opened(): void;
  closed(): void;
  exitGame(): void;
}

function tileRange(a: number, b: number): number {
  const dx = (a % WORLD_COLS) - (b % WORLD_COLS);
  const dy = idiv(a, WORLD_COLS) - idiv(b, WORLD_COLS);
  return dx * dx + dy * dy;
}

export class OverheadMap {
  readonly #hooks: OverheadHooks;
  #regions: MouseRegion[] = [];
  #mapRegion: MouseRegion | null = null;

  constructor(hooks: OverheadHooks) {
    this.#hooks = hooks;
  }

  get open(): boolean {
    return this.#mapRegion !== null;
  }

  #origin(): ScreenPoint {
    const g = this.#hooks.services.geometry();
    return { x: g.stdX, y: g.stdY };
  }

  show(): void {
    if (this.open) return;
    const regions = this.#hooks.services.regions;
    const o = this.#origin();
    this.#regions.push(
      regions.define({
        x1: o.x,
        y1: o.y,
        x2: o.x + OVERHEAD_AREA_WIDTH,
        y2: o.y + OVERHEAD_AREA_HEIGHT,
        priority: Priority.HIGH,
        cursor: 0,
        owner: OWNER,
        id: 'overheadBack',
      }),
    );
    this.#mapRegion = regions.define({
      x1: o.x,
      y1: o.y,
      x2: o.x + OVERHEAD_AREA_WIDTH,
      y2: o.y + OVERHEAD_MAP_HEIGHT,
      priority: Priority.HIGH,
      cursor: 0,
      owner: OWNER,
      id: 'overheadMap',
      onButton: (_r, reason) => this.#button(reason),
    });
    this.#regions.push(this.#mapRegion);
    this.#hooks.services.pauseGame?.(true);
    this.#hooks.opened();
  }

  close(): void {
    if (!this.open) return;
    for (const region of this.#regions) region.remove();
    this.#regions = [];
    this.#mapRegion = null;
    this.#hooks.services.pauseGame?.(false);
    this.#hooks.closed();
  }

  keyInput(event: UiKeyEvent | UiTextEvent): void {
    if (event.kind !== 'keyDown') return;
    if (CLOSE_KEYS.has(event.key)) this.close();
    else if (event.key === EXIT_GAME_KEY && event.modifiers & KeyModifier.ALT) this.#hooks.exitGame();
  }

  #button(reason: number): void {
    if (reason & MouseReason.RBUTTON_UP) {
      this.close();
      return;
    }
    if (!(reason & MouseReason.LBUTTON_UP)) return;
    const gridNo = this.mouseGridNo();
    if (gridNo !== null) this.#hooks.centerOn(gridNo);
    this.close();
  }

  mouseGridNo(): number | null {
    const map = this.#hooks.map();
    const regions = this.#hooks.services.regions;
    if (!map || !this.#mapRegion?.inArea) return null;
    const o = this.#origin();
    return map.gridNoAt(regions.mouseX - o.x, regions.mouseY - o.y);
  }

  #closestSoldier(gridNo: number): SoldierView | null {
    let best: SoldierView | null = null;
    let lowest = Number.POSITIVE_INFINITY;
    for (const s of this.#hooks.soldiers()) {
      const dx = Math.abs((s.gridNo % WORLD_COLS) - (gridNo % WORLD_COLS));
      const dy = Math.abs(idiv(s.gridNo, WORLD_COLS) - idiv(gridNo, WORLD_COLS));
      if (dx > CLOSEST_RADIUS || dy > CLOSEST_RADIUS) continue;
      const range = tileRange(s.gridNo, gridNo);
      if (range >= lowest) continue;
      lowest = range;
      best = s;
    }
    return best;
  }

  render(list: DrawList, tiny: BitmapFont): void {
    if (!this.open) return;
    const o = this.#origin();
    list.fill(o.x, o.y, o.x + OVERHEAD_AREA_WIDTH - 1, o.y + OVERHEAD_MAP_HEIGHT - 1, BLACK);
    const map = this.#hooks.map();
    if (map) map.render(list, o.x, o.y);
    list.image(this.#hooks.art.border, 0, o.x, o.y);
    if (!map) return;
    const blink = this.#hooks.blink();
    const selected = this.#hooks.selected();
    for (const s of this.#hooks.soldiers()) {
      const p = map.pointOf(s.gridNo);
      const lift = heightLift(s);
      const shade = blink && s.id === selected ? SELECTED_SHADE : drawnRaised(s) ? ROOF_SHADE : NORMAL_SHADE;
      list.image(this.#hooks.art.persons, s.team, o.x + p.x + PERSON_X, o.y + p.y + PERSON_Y - lift, { shade });
    }
    for (const item of this.#hooks.items()) {
      const p = map.pointOf(item.gridNo);
      const x = o.x + p.x;
      const y = o.y + p.y + ITEM_Y;
      list.fill(x, y, x, y, blink ? BLACK : WHITE);
    }
    const name = (s: SoldierView) => {
      const p = map.pointOf(s.gridNo);
      const lift = heightLift(s) + NAME_LIFT;
      const at = hCenterVCenterAlign(o.x + p.x, o.y + p.y - lift, 1, 1, s.name, tiny);
      mprint(list, tiny, at.x, at.y, s.name, fontColors(FontColor.MCOLOR_WHITE));
    };
    const sel = this.#hooks.soldiers().find((s) => s.id === selected);
    if (sel) name(sel);
    const hovered = this.mouseGridNo();
    const closest = hovered === null ? null : this.#closestSoldier(hovered);
    if (closest) name(closest);
  }
}
