import type { PointedCell } from './diagnostics-overlay.ts';
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
  pointedCell?(): PointedCell;
}

export interface Modal extends Screen {
  readonly passesUnhandledInput?: boolean;
  readonly freezesScreen?: boolean;
}

interface Settling {
  readonly modal: Modal;
  screenUpdated: boolean;
}

const NO_ART_LOADING = () => false;

export class ScreenHost {
  readonly #screens: Screen[] = [];
  readonly #modals: Modal[] = [];
  readonly #artLoading: () => boolean;
  #frozen: readonly DrawItem[] | null = null;
  #frozenBelow: Modal | null = null;
  #settling: Settling | null = null;
  #updatingScreen = false;

  constructor(artLoading: () => boolean = NO_ART_LOADING) {
    this.#artLoading = artLoading;
  }

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
    if (modal.freezesScreen && !this.#frozenBelow && !this.#settling)
      this.#settling = { modal, screenUpdated: this.#updatingScreen || this.#modals.length > 0 };
    this.#modals.push(modal);
    modal.enter();
  }

  closeModal(modal: Modal | null = this.modal): void {
    if (!modal) return;
    const at = this.#modals.lastIndexOf(modal);
    if (at < 0) return;
    this.#modals.splice(at, 1);
    if (this.#settling?.modal === modal) this.#settling = null;
    if (this.#frozenBelow === modal) {
      this.#frozen = null;
      this.#frozenBelow = null;
    }
    modal.exit();
  }

  #freeze(modal: Modal, below: readonly DrawItem[]): void {
    this.#frozen = [...below];
    this.#frozenBelow = modal;
    this.#settling = null;
  }

  input(event: UiInputEvent): boolean {
    for (const modal of [...this.#modals].reverse()) {
      if (modal.input(event)) return true;
      if (!modal.passesUnhandledInput) return false;
    }
    return this.screen?.input(event) ?? false;
  }

  update(now: number): void {
    if (this.#modals.length === 0 || this.#settling?.screenUpdated === false) this.#updateScreen(now);
    if (this.#settling) this.#settling.screenUpdated = true;
    for (const modal of [...this.#modals]) modal.update(now);
  }

  #updateScreen(now: number): void {
    this.#updatingScreen = true;
    this.screen?.update(now);
    this.#updatingScreen = false;
  }

  render(list: DrawList): void {
    if (this.#frozen && this.#frozenBelow) {
      list.items.push(...this.#frozen);
      const from = this.#modals.indexOf(this.#frozenBelow);
      for (const modal of this.#modals.slice(from)) modal.render(list);
      return;
    }
    if (this.#settling) {
      this.#renderSettling(list, this.#settling);
      return;
    }
    this.screen?.render(list);
    for (const modal of this.#modals) modal.render(list);
  }

  #renderSettling(list: DrawList, settling: Settling): void {
    const from = this.#modals.indexOf(settling.modal);
    const below = new DrawList();
    this.screen?.render(below);
    for (const modal of this.#modals.slice(0, from)) modal.render(below);
    list.items.push(...below.items);
    if (settling.screenUpdated && !this.#artLoading()) this.#freeze(settling.modal, below.items);
    for (const modal of this.#modals.slice(from)) modal.render(list);
  }

  describe(): WidgetInfo[] {
    const layers: Screen[] = [...(this.screen ? [this.screen] : []), ...this.#modals];
    return layers.flatMap((layer) => [...(layer.describe?.() ?? [])]);
  }
}
