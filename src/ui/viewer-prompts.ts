import type { ViewerPromptView } from '../protocol/messages.ts';
import { MessageBoxFlag, MessageBoxReturn } from './widgets/message-box.ts';

export interface ViewerPromptPort {
  showPrompt(prompt: ViewerPromptView): void;
  promptAnswer(id: string): string | null;
  closePrompt(id: string, choice: string | null): void;
}

export interface ViewerPromptRef {
  readonly id: string;
  readonly kind: string;
}

export type PromptChoice = readonly [name: string, result: number];

const BOX_CHOICES: ReadonlyMap<number, readonly PromptChoice[]> = new Map([
  [MessageBoxFlag.OK, [['ok', MessageBoxReturn.OK]]],
  [
    MessageBoxFlag.OKSKIP,
    [
      ['ok', MessageBoxReturn.YES],
      ['skip', MessageBoxReturn.NO],
    ],
  ],
  [
    MessageBoxFlag.YESNO,
    [
      ['yes', MessageBoxReturn.YES],
      ['no', MessageBoxReturn.NO],
    ],
  ],
  [
    MessageBoxFlag.CONTINUESTOP,
    [
      ['continue', MessageBoxReturn.YES],
      ['stop', MessageBoxReturn.NO],
    ],
  ],
]);

export function messageBoxChoices(flags: number): readonly PromptChoice[] | null {
  return BOX_CHOICES.get(flags) ?? null;
}

export class ViewerPrompt {
  readonly #port: ViewerPromptPort;
  readonly #id: string;
  readonly #choices: readonly PromptChoice[];
  #answeredElsewhere = false;

  constructor(port: ViewerPromptPort, ref: ViewerPromptRef, text: string, choices: readonly PromptChoice[]) {
    this.#port = port;
    this.#id = ref.id;
    this.#choices = choices;
    port.showPrompt({ id: ref.id, kind: ref.kind, text, choices: choices.map(([name]) => name) });
  }

  answered(): number | null {
    const choice = this.#port.promptAnswer(this.#id);
    const result = this.#choices.find(([name]) => name === choice)?.[1];
    if (result === undefined) return null;
    this.#answeredElsewhere = true;
    return result;
  }

  closed(result: number | null): void {
    const choice = this.#answeredElsewhere ? null : (this.#choices.find(([, r]) => r === result)?.[0] ?? null);
    this.#port.closePrompt(this.#id, choice);
  }
}

export function viewerBoxPrompt(
  port: ViewerPromptPort | null,
  ref: ViewerPromptRef | undefined,
  text: string,
  flags: number,
): ViewerPrompt | null {
  const choices = messageBoxChoices(flags);
  return port && ref && choices ? new ViewerPrompt(port, ref, text, choices) : null;
}

export interface GameEventRef {
  readonly type: string;
  readonly tick: number;
}

export function eventPrompt(event: GameEventRef, detail: string): ViewerPromptRef {
  return { id: `${event.type}-${event.tick}-${detail}`, kind: event.type };
}

export interface PromptedText {
  readonly text: string;
  readonly prompt: ViewerPromptRef;
}
