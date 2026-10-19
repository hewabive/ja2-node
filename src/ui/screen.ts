import type { DrawList } from './draw-list.ts';
import type { UiInputEvent } from './input/events.ts';

export interface Screen {
  readonly id: string;
  enter(): void;
  exit(): void;
  update(now: number): void;
  input(event: UiInputEvent): boolean;
  render(list: DrawList): void;
}

export interface Modal extends Screen {
  readonly passesUnhandledInput?: boolean;
}

export class ScreenHost {
  readonly #screens: Screen[] = [];
  readonly #modals: Modal[] = [];

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
    this.#modals.push(modal);
    modal.enter();
  }

  closeModal(modal: Modal | null = this.modal): void {
    if (!modal) return;
    const at = this.#modals.lastIndexOf(modal);
    if (at < 0) return;
    this.#modals.splice(at, 1);
    modal.exit();
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
    this.screen?.render(list);
    for (const modal of this.#modals) modal.render(list);
  }
}
