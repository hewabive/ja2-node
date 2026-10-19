// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/MouseSystem.cc MouseSystemHook, MSYS_AddRegionToList (priority, newest first among equals),
// @src MSYS_UpdateMouseRegion (inclusive hit test, LOST/GAIN/MOVE, the press lock g_clicked_region, OR-ed button reasons,
// @src cursor fall-through), DoubleDetectionState, MSYS_DefineRegion, MSYS_RemoveRegion, RefreshMouseRegions,
// @src MOUSE_REGION::ChangeCursor; src/sgp/Input.cc ButtonState (repeat after 250 ms, then every 50 ms).
// See docs/28 §3.1.

import { MouseButton, type UiPointerEvent } from './events.ts';
import {
  BUTTON_REPEAT_TIME_MS,
  BUTTON_REPEAT_TIMEOUT_MS,
  DOUBLE_CLICK_DELAY_MS,
  FAST_HELP_DELAY_MS,
  MouseButtonMask,
  MouseReason,
  NO_CURSOR,
  Priority,
} from './mouse.ts';

export type RegionCallback = (region: MouseRegion, reason: number) => void;

export interface RegionDefinition {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly priority?: number;
  readonly cursor?: number;
  readonly onMove?: RegionCallback | null;
  readonly onButton?: RegionCallback | null;
  readonly owner?: unknown;
  readonly id?: string | undefined;
}

const Action = {
  MOVE: 1 << 0,
  LBUTTON_DWN: 1 << 1,
  LBUTTON_UP: 1 << 2,
  LBUTTON_REPEAT: 1 << 3,
  RBUTTON_DWN: 1 << 4,
  RBUTTON_UP: 1 << 5,
  RBUTTON_REPEAT: 1 << 6,
  MBUTTON_DWN: 1 << 7,
  MBUTTON_UP: 1 << 8,
  MBUTTON_REPEAT: 1 << 9,
  X1BUTTON_DWN: 1 << 10,
  X1BUTTON_UP: 1 << 11,
  X1BUTTON_REPEAT: 1 << 12,
  X2BUTTON_DWN: 1 << 13,
  X2BUTTON_UP: 1 << 14,
  X2BUTTON_REPEAT: 1 << 15,
  WHEEL_UP: 1 << 16,
  WHEEL_DOWN: 1 << 17,
} as const;

const BUTTON_ACTIONS =
  Action.LBUTTON_DWN |
  Action.LBUTTON_UP |
  Action.RBUTTON_DWN |
  Action.RBUTTON_UP |
  Action.RBUTTON_REPEAT |
  Action.LBUTTON_REPEAT |
  Action.WHEEL_UP |
  Action.WHEEL_DOWN |
  Action.MBUTTON_DWN |
  Action.MBUTTON_UP |
  Action.MBUTTON_REPEAT |
  Action.X1BUTTON_DWN |
  Action.X1BUTTON_UP |
  Action.X1BUTTON_REPEAT |
  Action.X2BUTTON_DWN |
  Action.X2BUTTON_UP |
  Action.X2BUTTON_REPEAT;

interface ButtonActions {
  readonly mask: number;
  readonly down: number;
  readonly up: number;
  readonly repeat: number;
}

const BUTTONS: ReadonlyMap<number, ButtonActions> = new Map([
  [MouseButton.LEFT, { mask: MouseButtonMask.LEFT, down: Action.LBUTTON_DWN, up: Action.LBUTTON_UP, repeat: Action.LBUTTON_REPEAT }],
  [MouseButton.RIGHT, { mask: MouseButtonMask.RIGHT, down: Action.RBUTTON_DWN, up: Action.RBUTTON_UP, repeat: Action.RBUTTON_REPEAT }],
  [MouseButton.MIDDLE, { mask: MouseButtonMask.MIDDLE, down: Action.MBUTTON_DWN, up: Action.MBUTTON_UP, repeat: Action.MBUTTON_REPEAT }],
  [MouseButton.BACK, { mask: MouseButtonMask.X1, down: Action.X1BUTTON_DWN, up: Action.X1BUTTON_UP, repeat: Action.X1BUTTON_REPEAT }],
  [MouseButton.FORWARD, { mask: MouseButtonMask.X2, down: Action.X2BUTTON_DWN, up: Action.X2BUTTON_UP, repeat: Action.X2BUTTON_REPEAT }],
]);

const REASON_OF_ACTION: readonly (readonly [number, number, 'lock' | 'unlock' | 'none'])[] = [
  [Action.LBUTTON_DWN, MouseReason.LBUTTON_DWN, 'lock'],
  [Action.LBUTTON_UP, MouseReason.LBUTTON_UP, 'unlock'],
  [Action.RBUTTON_DWN, MouseReason.RBUTTON_DWN, 'lock'],
  [Action.RBUTTON_UP, MouseReason.RBUTTON_UP, 'unlock'],
  [Action.MBUTTON_DWN, MouseReason.MBUTTON_DWN, 'lock'],
  [Action.MBUTTON_UP, MouseReason.MBUTTON_UP, 'unlock'],
  [Action.X1BUTTON_DWN, MouseReason.X1BUTTON_DWN, 'lock'],
  [Action.X2BUTTON_UP, MouseReason.X2BUTTON_UP, 'unlock'],
  [Action.LBUTTON_REPEAT, MouseReason.LBUTTON_REPEAT, 'none'],
  [Action.RBUTTON_REPEAT, MouseReason.RBUTTON_REPEAT, 'none'],
  [Action.MBUTTON_REPEAT, MouseReason.MBUTTON_REPEAT, 'none'],
  [Action.X1BUTTON_REPEAT, MouseReason.X1BUTTON_REPEAT, 'none'],
  [Action.X2BUTTON_REPEAT, MouseReason.X2BUTTON_REPEAT, 'none'],
  [Action.WHEEL_UP, MouseReason.WHEEL_UP, 'none'],
  [Action.WHEEL_DOWN, MouseReason.WHEEL_DOWN, 'none'],
];

const UP_ACTIONS = Action.RBUTTON_UP | Action.LBUTTON_UP | Action.MBUTTON_UP | Action.X1BUTTON_UP | Action.X2BUTTON_UP;

export class MouseRegion {
  readonly id: string | undefined;
  readonly owner: unknown;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  readonly priority: number;
  cursor: number;
  onMove: RegionCallback | null;
  onButton: RegionCallback | null;
  exists = true;
  enabled = true;
  allowDisabledTooltip = false;
  inArea = false;
  mouseX = 0;
  mouseY = 0;
  relativeX = 0;
  relativeY = 0;
  buttonState = 0;
  tooltip = '';
  tooltipTimer = 0;
  tooltipShown = false;
  tooltipReset = false;
  animatesCursor = false;
  flashesCursor = false;
  showsMouseText = false;
  readonly #system: RegionDispatcher;

  constructor(system: RegionDispatcher, definition: RegionDefinition) {
    this.#system = system;
    this.id = definition.id;
    this.owner = definition.owner;
    this.x1 = definition.x1;
    this.y1 = definition.y1;
    this.x2 = definition.x2;
    this.y2 = definition.y2;
    this.priority = Math.max(Priority.LOWEST, definition.priority ?? Priority.NORMAL);
    this.cursor = definition.cursor ?? NO_CURSOR;
    this.onMove = definition.onMove ?? null;
    this.onButton = definition.onButton ?? null;
  }

  contains(x: number, y: number): boolean {
    return this.x1 <= x && x <= this.x2 && this.y1 <= y && y <= this.y2;
  }

  get width(): number {
    return this.x2 - this.x1;
  }

  get height(): number {
    return this.y2 - this.y1;
  }

  enable(): void {
    if (!this.exists || this.enabled) return;
    this.enabled = true;
    this.#system.touch();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.#system.touch();
  }

  setEnabled(enabled: boolean): void {
    if (enabled) this.enable();
    else this.disable();
  }

  move(x1: number, y1: number, x2: number, y2: number): void {
    if (x1 === this.x1 && y1 === this.y1 && x2 === this.x2 && y2 === this.y2) return;
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.#system.touch();
  }

  changeCursor(cursor: number): void {
    this.cursor = cursor;
    if (cursor !== NO_CURSOR && this.inArea) this.#system.setCursor(cursor);
  }

  setTooltip(text: string): void {
    if (!this.exists) {
      this.tooltip = '';
      return;
    }
    this.tooltip = text;
    this.tooltipReset = false;
  }

  remove(): void {
    this.#system.remove(this);
  }
}

class DoubleClick {
  #lastDown: MouseRegion | null = null;
  #lastUp: MouseRegion | null = null;
  #lastDownTime = 0;

  isDouble(region: MouseRegion, reason: number, now: number): boolean {
    if (reason & MouseReason.LBUTTON_DWN) {
      if (this.#lastDown === region && this.#lastUp === region && now <= this.#lastDownTime + DOUBLE_CLICK_DELAY_MS) {
        this.#lastDown = null;
        this.#lastUp = null;
        this.#lastDownTime = 0;
        return true;
      }
      this.#lastDown = region;
      this.#lastDownTime = now;
    } else if (reason & MouseReason.LBUTTON_UP) {
      if (this.#lastDown === region && now <= this.#lastDownTime + DOUBLE_CLICK_DELAY_MS) this.#lastUp = region;
      else {
        this.#lastDown = null;
        this.#lastUp = null;
        this.#lastDownTime = 0;
      }
    }
    return false;
  }
}

export type CursorListener = (cursor: number) => void;
export type LeftUpListener = (x: number, y: number) => void;

export class RegionDispatcher {
  readonly #regions: MouseRegion[] = [];
  readonly #repeatTimers = new Map<number, number>();
  readonly #doubleClick = new DoubleClick();
  readonly #leftUpListeners: LeftUpListener[] = [];
  #mouseX = -1;
  #mouseY = -1;
  #buttons = 0;
  #action = 0;
  #clicked: MouseRegion | null = null;
  #previous: MouseRegion | null = null;
  #current: MouseRegion | null = null;
  #cursor: number;
  #cursorListener: CursorListener | null = null;
  #now = 0;
  #dirty = false;
  #pointerKnown = false;

  constructor(initialCursor = 0) {
    this.#cursor = initialCursor;
  }

  get regions(): readonly MouseRegion[] {
    return this.#regions;
  }

  get current(): MouseRegion | null {
    return this.#current;
  }

  get clicked(): MouseRegion | null {
    return this.#clicked;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get mouseX(): number {
    return this.#mouseX;
  }

  get mouseY(): number {
    return this.#mouseY;
  }

  get pointerKnown(): boolean {
    return this.#pointerKnown;
  }

  get buttons(): number {
    return this.#buttons;
  }

  get now(): number {
    return this.#now;
  }

  isButtonDown(mask: number): boolean {
    return (this.#buttons & mask) !== 0;
  }

  onCursor(listener: CursorListener | null): void {
    this.#cursorListener = listener;
  }

  onLeftUp(listener: LeftUpListener): () => void {
    this.#leftUpListeners.push(listener);
    return () => {
      const at = this.#leftUpListeners.indexOf(listener);
      if (at >= 0) this.#leftUpListeners.splice(at, 1);
    };
  }

  setCursor(cursor: number): void {
    this.#cursor = cursor;
    this.#cursorListener?.(cursor);
  }

  touch(): void {
    this.#dirty = true;
  }

  define(definition: RegionDefinition): MouseRegion {
    const region = new MouseRegion(this, definition);
    this.#insert(region);
    this.#dirty = true;
    return region;
  }

  #insert(region: MouseRegion): void {
    const at = this.#regions.findIndex((r) => r.priority <= region.priority);
    if (at < 0) this.#regions.push(region);
    else this.#regions.splice(at, 0, region);
  }

  remove(region: MouseRegion): void {
    if (!region.exists) return;
    const at = this.#regions.indexOf(region);
    if (at >= 0) this.#regions.splice(at, 1);
    if (this.#previous === region) this.#previous = null;
    if (this.#current === region) this.#current = null;
    if (this.#clicked === region) this.#clicked = null;
    region.exists = false;
    region.enabled = false;
    region.allowDisabledTooltip = false;
    region.inArea = false;
    region.onMove = null;
    region.onButton = null;
    region.tooltip = '';
    region.tooltipShown = false;
    this.#dirty = true;
  }

  removeOwner(owner: unknown): void {
    for (const region of [...this.#regions]) if (region.owner === owner) this.remove(region);
  }

  pointer(event: UiPointerEvent, now: number): void {
    this.#now = now;
    this.#pointerKnown = true;
    switch (event.kind) {
      case 'pointerMove':
        this.#hook(0, event.x, event.y);
        return;
      case 'wheel':
        if (event.wheel !== 0) this.#hook(event.wheel < 0 ? Action.WHEEL_UP : Action.WHEEL_DOWN, event.x, event.y);
        return;
      case 'pointerDown':
      case 'pointerUp': {
        const button = BUTTONS.get(event.button);
        if (!button) return;
        if (event.kind === 'pointerDown') {
          this.#buttons |= button.mask;
          this.#repeatTimers.set(event.button, now + BUTTON_REPEAT_TIMEOUT_MS);
          this.#hook(button.down, event.x, event.y);
          return;
        }
        this.#buttons &= ~button.mask;
        this.#repeatTimers.set(event.button, 0);
        if (event.button === MouseButton.LEFT) for (const listener of [...this.#leftUpListeners]) listener(event.x, event.y);
        this.#hook(button.up, event.x, event.y);
        return;
      }
    }
  }

  frame(now: number): void {
    this.#now = now;
    if (!this.#pointerKnown) return;
    if (this.#dirty) this.refresh();
    for (const [button, actions] of BUTTONS) {
      const timer = this.#repeatTimers.get(button) ?? 0;
      if (!(this.#buttons & actions.mask)) {
        this.#repeatTimers.set(button, 0);
        continue;
      }
      if (timer > 0 && timer <= now) {
        this.#repeatTimers.set(button, now + BUTTON_REPEAT_TIME_MS);
        this.#hook(actions.repeat, this.#mouseX, this.#mouseY);
      }
    }
  }

  refresh(): void {
    if (!this.#pointerKnown) return;
    this.#dirty = false;
    this.#action |= Action.MOVE;
    this.#update();
  }

  #hook(action: number, x: number, y: number): void {
    let next = action;
    if (x !== this.#mouseX || y !== this.#mouseY) {
      next |= Action.MOVE;
      this.#mouseX = x;
      this.#mouseY = y;
    } else next &= ~Action.MOVE;
    this.#action = next;
    if (next !== 0) this.#update();
  }

  #hit(): MouseRegion | null {
    for (const region of this.#regions) {
      if ((region.enabled || region.allowDisabledTooltip) && region.contains(this.#mouseX, this.#mouseY)) return region;
    }
    return null;
  }

  #cursorBelow(region: MouseRegion): number | null {
    const start = this.#regions.indexOf(region);
    for (let i = start + 1; i < this.#regions.length; i++) {
      const r = this.#regions[i] as MouseRegion;
      if (r.enabled && r.contains(this.#mouseX, this.#mouseY) && r.cursor !== NO_CURSOR) return r.cursor;
    }
    return null;
  }

  #leave(previous: MouseRegion, current: MouseRegion | null): void {
    previous.inArea = false;
    if (previous === current) return;
    if (previous.tooltip.length > 0) {
      previous.tooltipShown = false;
      previous.tooltipReset = false;
    }
    if (previous.onMove && previous.enabled) previous.onMove(previous, MouseReason.LOST_MOUSE);
  }

  #enter(current: MouseRegion): void {
    current.tooltipTimer = FAST_HELP_DELAY_MS;
    if (current.onMove) {
      if (current.tooltip.length > 0 && !current.tooltipReset) {
        current.tooltipShown = false;
        current.tooltipReset = true;
      }
      if (current.enabled) current.onMove(current, MouseReason.GAIN_MOUSE);
    }
    if (current.enabled && current.cursor !== NO_CURSOR) this.setCursor(current.cursor);
    else {
      const below = this.#cursorBelow(current);
      if (below !== null) this.setCursor(below);
    }
  }

  #track(region: MouseRegion): void {
    region.inArea = true;
    region.mouseX = this.#mouseX;
    region.mouseY = this.#mouseY;
    region.relativeX = this.#mouseX - region.x1;
    region.relativeY = this.#mouseY - region.y1;
  }

  #buttonReason(region: MouseRegion): number {
    let reason = MouseReason.NONE;
    for (const [action, bit, lock] of REASON_OF_ACTION) {
      if (!(this.#action & action)) continue;
      reason |= bit;
      if (lock === 'lock') this.#clicked = region;
      else if (lock === 'unlock') this.#clicked = null;
    }
    return reason;
  }

  #dispatchButtons(region: MouseRegion): void {
    if (!region.onButton || !(this.#action & BUTTON_ACTIONS) || !region.enabled) return;
    let reason = this.#buttonReason(region);
    if (reason === MouseReason.NONE) return;
    if (region.tooltipShown) {
      region.tooltipShown = false;
      region.tooltipReset = false;
      region.tooltipTimer = FAST_HELP_DELAY_MS;
    }
    if (this.#doubleClick.isDouble(region, reason, this.#now)) reason |= MouseReason.LBUTTON_DOUBLECLICK;
    region.onButton(region, reason);
  }

  #update(): void {
    const current = this.#hit();
    this.#current = current;
    const previous = this.#previous;
    if (current && current !== previous && current.enabled) current.inArea = true;
    if (previous) this.#leave(previous, current);
    if (current?.exists) {
      if (current !== previous) this.#enter(current);
      if (!this.#clicked || this.#clicked === current) {
        this.#track(current);
        current.buttonState = this.#buttons;
        if (current.enabled && current.onMove && this.#action & Action.MOVE) current.onMove(current, MouseReason.MOVE);
        this.#action &= ~Action.MOVE;
        if (current.exists) this.#dispatchButtons(current);
        this.#action &= ~BUTTON_ACTIONS;
      } else if (current.enabled) {
        if (this.#action & UP_ACTIONS) this.#clicked = null;
        this.#track(current);
        if (current.onMove && this.#action & Action.MOVE) current.onMove(current, MouseReason.MOVE);
        this.#action &= ~Action.MOVE;
      }
    }
    this.#previous = this.#current;
  }
}
