import { type DrawItem, DrawList } from './draw-list.ts';
import type { UiInputEvent } from './input/events.ts';
import type { UiScreenKind } from './widgets/button-sounds.ts';
import type { WidgetInfo } from './widgets/widget-info.ts';

export interface Screen {
  readonly id: string;
  readonly soundScreen?: UiScreenKind | undefined;
  readonly rendersTooltips?: boolean;
  readonly drawsWorld?: boolean;
  enter(): void;
  exit(): void;
  update(now: number): void;
  input(event: UiInputEvent): boolean;
  render(list: DrawList): void;
  describe?(): readonly WidgetInfo[];
}

export interface Modal extends Screen {
  readonly passesUnhandledInput?: boolean;
  readonly freezesScreen?: boolean;
}

export class ScreenHost {
  readonly #screens: Screen[] = [];
  readonly #modals: Modal[] = [];
  #frozen: readonly DrawItem[] | null = null;
  #frozenBelow: Modal | null = null;

  get screen(): Screen | null {
    return this.#screens.at(-1) ?? null;
  }

  get modal(): Modal | null {
    return this.#modals.at(-1) ?? null;
  }

  get modals(): readonly Modal[] {
    return this.#modals;
  }

  get depth(): number {
    return this.#screens.length;
  }

  get frozen(): boolean {
    return this.#frozen !== null;
  }

  get top(): Screen | null {
    return this.modal ?? this.screen;
  }

  push(screen: Screen): void {
    this.screen?.exit();
    this.#screens.push(screen);
    screen.enter();
  }

  pop(): Screen | null {
    const top = this.#screens.pop() ?? null;
    top?.exit();
    this.screen?.enter();
    return top;
  }

  replace(screen: Screen): void {
    this.#screens.pop()?.exit();
    this.#screens.push(screen);
    screen.enter();
  }

  openModal(modal: Modal): void {
    if (modal.freezesScreen && !this.#frozenBelow) this.#freeze(modal);
    this.#modals.push(modal);
    modal.enter();
  }

  closeModal(modal: Modal | null = this.modal): void {
    if (!modal) return;
    const at = this.#modals.lastIndexOf(modal);
    if (at < 0) return;
    this.#modals.splice(at, 1);
    if (this.#frozenBelow === modal) {
      this.#frozen = null;
      this.#frozenBelow = null;
    }
    modal.exit();
  }

  #freeze(modal: Modal): void {
    const list = new DrawList();
    this.screen?.render(list);
    for (const below of this.#modals) below.render(list);
    this.#frozen = [...list.items];
    this.#frozenBelow = modal;
  }

  input(event: UiInputEvent): boolean {
    for (const modal of [...this.#modals].reverse()) {
      if (modal.input(event)) return true;
      if (!modal.passesUnhandledInput) return false;
    }
    return this.screen?.input(event) ?? false;
  }

  update(now: number): void {
    if (this.#modals.length === 0) this.screen?.update(now);
    for (const modal of [...this.#modals]) modal.update(now);
  }

  render(list: DrawList): void {
    if (this.#frozen && this.#frozenBelow) {
      list.items.push(...this.#frozen);
      const from = this.#modals.indexOf(this.#frozenBelow);
      for (const modal of this.#modals.slice(from)) modal.render(list);
      return;
    }
    this.screen?.render(list);
    for (const modal of this.#modals) modal.render(list);
  }

  describe(): WidgetInfo[] {
    const layers: Screen[] = [...(this.screen ? [this.screen] : []), ...this.#modals];
    return layers.flatMap((layer) => [...(layer.describe?.() ?? [])]);
  }
}
