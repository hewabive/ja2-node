import type { DrawList } from '../../draw-list.ts';
import type { LayoutController } from '../../layout/controller.ts';
import { LayoutScreen } from '../../layout/layout-screen.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { CustomRenderer } from '../../layout/view.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { ClientSettings, SettingsChange } from '../../settings.ts';
import type { Labels } from '../../text/labels.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { UiScreenKind } from '../../widgets/button-sounds.ts';
import type { MessageBoxLabels, MessageBoxStyle } from '../../widgets/message-box.ts';

export const FrontEndLayout = {
  MAIN_MENU: 'main-menu',
  GAME_INIT: 'game-init',
  OPTIONS: 'options',
  SAVE_LOAD: 'save-load',
  CREDITS: 'credits',
  LOADING: 'loading',
  EXIT_BOX: 'exit-box',
  SAN_MONA: 'san-mona',
  SCREEN_UNAVAILABLE: 'screen-unavailable',
  MESSAGE_BOX: 'message-box',
} as const;
export type FrontEndLayout = (typeof FrontEndLayout)[keyof typeof FrontEndLayout];
export const FRONT_END_LAYOUTS: readonly FrontEndLayout[] = Object.values(FrontEndLayout);

export interface SettingsStore {
  current(): ClientSettings;
  change(change: SettingsChange): void;
  persist(): void;
}

export interface FrontEndEnvironment {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly labels: () => Labels;
  readonly layout: (name: FrontEndLayout) => LayoutModel;
  readonly boxes: MessageBoxes;
  readonly messageBoxStyle: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels: MessageBoxLabels;
}

export interface FrontEndScreenOptions {
  readonly id: string;
  readonly layout: FrontEndLayout;
  readonly controller: LayoutController;
  readonly soundScreen?: UiScreenKind;
  readonly custom?: Readonly<Record<string, CustomRenderer>>;
  readonly onEnter?: () => void;
  readonly onExit?: () => void;
  readonly onUpdate?: (now: number) => void;
  readonly onRender?: (list: DrawList) => void;
  readonly hidesCursor?: boolean;
}

export class FrontEndScreen extends LayoutScreen {
  readonly hidesCursor: boolean;
  readonly #hooks: FrontEndScreenOptions;

  constructor(env: FrontEndEnvironment, options: FrontEndScreenOptions) {
    super({
      id: options.id,
      model: env.layout(options.layout),
      controller: options.controller,
      services: env.runtime,
      sliders: env.runtime.sliders,
      text: env.text,
      messageBoxStyle: env.messageBoxStyle,
      messageBoxLabels: env.messageBoxLabels,
      ...(options.soundScreen ? { soundScreen: options.soundScreen } : {}),
      ...(options.custom ? { custom: options.custom } : {}),
      ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
      ...(options.onRender ? { onRender: (list: DrawList) => options.onRender?.(list) } : {}),
    });
    this.hidesCursor = options.hidesCursor === true;
    this.#hooks = options;
  }

  override enter(): void {
    super.enter();
    this.#hooks.onEnter?.();
  }

  override exit(): void {
    this.#hooks.onExit?.();
    super.exit();
  }
}
