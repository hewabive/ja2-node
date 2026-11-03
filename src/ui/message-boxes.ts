import type { UiServices } from './services.ts';
import { TextCode } from './text/wrap.ts';
import { type ViewerPromptPort, type ViewerPromptRef, viewerBoxPrompt } from './viewer-prompts.ts';
import {
  MessageBox,
  MessageBoxFlag,
  type MessageBoxLabels,
  type MessageBoxRect,
  MessageBoxReturn,
  type MessageBoxStyle,
  MessageBoxStyleId,
} from './widgets/message-box.ts';

export type MessageBoxButtons = 'ok' | 'yesNo' | 'okSkip' | 'yesNoLie' | 'continueStop' | 'numbered';

export interface MessageBoxRequest {
  readonly style?: number;
  readonly centering?: MessageBoxRect;
  readonly id?: string;
  readonly closeWhen?: () => boolean;
  readonly viewer?: ViewerPromptRef;
}

export interface MessageBoxes {
  confirm(text: string): Promise<boolean>;
  alert(text: string): Promise<void>;
  ask(text: string, buttons: MessageBoxButtons, request?: MessageBoxRequest): Promise<number>;
}

const FLAGS: Readonly<Record<MessageBoxButtons, MessageBoxFlag>> = {
  ok: MessageBoxFlag.OK,
  yesNo: MessageBoxFlag.YESNO,
  okSkip: MessageBoxFlag.OKSKIP,
  yesNoLie: MessageBoxFlag.YESNOLIE,
  continueStop: MessageBoxFlag.CONTINUESTOP,
  numbered: MessageBoxFlag.FOUR_NUMBERED_BUTTONS,
};
const IAN_NEWLINE = String.fromCharCode(TextCode.NEWLINE);

export interface CanvasMessageBoxesOptions {
  readonly services: UiServices;
  readonly style: (id: number) => MessageBoxStyle;
  readonly labels: () => MessageBoxLabels;
  readonly prompts?: () => ViewerPromptPort | null;
}

export class CanvasMessageBoxes implements MessageBoxes {
  readonly #options: CanvasMessageBoxesOptions;

  constructor(options: CanvasMessageBoxesOptions) {
    this.#options = options;
  }

  ask(text: string, buttons: MessageBoxButtons, request: MessageBoxRequest = {}): Promise<number> {
    const { services, style, labels } = this.#options;
    const prompt = viewerBoxPrompt(this.#options.prompts?.() ?? null, request.viewer, text, FLAGS[buttons]);
    return new Promise((resolve) => {
      services.host.openModal(
        new MessageBox(services, {
          style: style(request.style ?? MessageBoxStyleId.BASIC),
          text: text.replaceAll('\n', IAN_NEWLINE),
          flags: FLAGS[buttons],
          labels: labels(),
          ...(request.centering ? { centeringRect: request.centering } : {}),
          ...(request.id ? { id: request.id } : {}),
          ...(request.closeWhen ? { closeWhen: request.closeWhen } : {}),
          ...(prompt ? { answered: () => prompt.answered() } : {}),
          onClose: (result) => {
            prompt?.closed(result);
            resolve(result);
          },
        }),
      );
    });
  }

  async confirm(text: string): Promise<boolean> {
    return (await this.ask(text, 'yesNo')) === MessageBoxReturn.YES;
  }

  async alert(text: string): Promise<void> {
    await this.ask(text, 'ok');
  }
}
