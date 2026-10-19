import type { CommandReply } from '../../app/net/session-client.ts';
import type { PromptView } from '../../protocol/view.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function choicesOf(prompt: PromptView): readonly string[] {
  if ('options' in prompt) return prompt.options.map((o) => o.choice);
  return prompt.choices;
}

function describe(prompt: PromptView): string {
  if (prompt.kind === 'surrender') return prompt.context === 'tactical' ? 'The enemy offers you to surrender' : 'Surrender?';
  return prompt.kind;
}

export class PromptPanel {
  readonly #root = el('prompt');
  readonly #title = el('promptTitle');
  readonly #choices = el('promptChoices');
  readonly #result = el('promptResult');
  readonly #send: Send;
  #shown: PromptView | null = null;

  constructor(send: Send) {
    this.#send = send;
  }

  update(prompt: PromptView | null): void {
    if (prompt === this.#shown) return;
    this.#shown = prompt;
    this.#root.hidden = !prompt;
    if (!prompt) return;
    this.#title.textContent = describe(prompt);
    this.#result.textContent = '';
    this.#choices.replaceChildren(
      ...choicesOf(prompt).map((choice) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = choice;
        b.dataset.choice = choice;
        b.addEventListener('click', () => {
          void this.#send({ type: 'answer', prompt: prompt.id, choice }).then((r) => {
            this.#result.textContent = r.ok ? `answered ${choice}` : (r.reason ?? 'refused');
          });
        });
        return b;
      }),
    );
  }
}
