// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/GameLoop.cc HandleShortCutExitState (the box per screen), EndGameMessageBoxCallBack (Yes leaves the game).
// @src See docs/28 §4.11.

import type { DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import { LayoutView } from '../../layout/view.ts';
import type { Modal } from '../../screen.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { type FrontEndEnvironment, FrontEndLayout } from './environment.ts';

export const EXIT_BOX = 'exitBox';

export const EXIT_BOX_CONTRACT: ControllerContract = {
  id: EXIT_BOX,
  actions: { answer: { args: 1 } },
  bindings: { open: 'string' },
};

export type ExitBoxStyle = 'game' | 'map' | 'laptop';

export class ExitBoxController extends ViewModelController {
  constructor(style: ExitBoxStyle, answered: (leave: boolean) => void) {
    const view = { open: style as string };
    super(EXIT_BOX_CONTRACT, view, {
      answer: ([result]) => {
        view.open = '';
        answered(result === MessageBoxReturn.YES);
      },
    });
  }
}

export class LayoutModal implements Modal {
  readonly id: string;
  readonly passesUnhandledInput = true;
  readonly #view: LayoutView;
  readonly #env: FrontEndEnvironment;

  constructor(env: FrontEndEnvironment, id: string, view: LayoutView) {
    this.id = id;
    this.#view = view;
    this.#env = env;
  }

  enter(): void {
    this.#view.build();
  }

  exit(): void {
    this.#view.dispose();
  }

  update(): void {
    this.#view.update();
  }

  input(event: UiInputEvent): boolean {
    return this.#view.input(event);
  }

  render(list: DrawList): void {
    this.#view.render(list);
  }

  describe(): readonly WidgetInfo[] {
    return this.#view.describe();
  }

  close(): void {
    this.#env.runtime.host.closeModal(this);
  }
}

export function openExitBox(env: FrontEndEnvironment, style: ExitBoxStyle, answered: (leave: boolean) => void): LayoutModal {
  let modal: LayoutModal | null = null;
  const controller = new ExitBoxController(style, (leave) => {
    modal?.close();
    answered(leave);
  });
  const view = new LayoutView({
    model: env.layout(FrontEndLayout.EXIT_BOX),
    controller,
    services: env.runtime,
    sliders: env.runtime.sliders,
    text: env.text,
    messageBoxStyle: env.messageBoxStyle,
    messageBoxLabels: env.messageBoxLabels,
  });
  modal = new LayoutModal(env, EXIT_BOX, view);
  env.runtime.host.openModal(modal);
  return modal;
}
