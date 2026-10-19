import type { MessageBoxButtons, MessageBoxes } from '../../ui/message-boxes.ts';
import type { Labels } from '../../ui/text/labels.ts';
import { MessageBoxReturn } from '../../ui/widgets/message-box.ts';

type MessageBoxKind = 'yesNo' | 'ok';

export class MessageBox implements MessageBoxes {
  readonly #dialog: HTMLDialogElement;
  readonly #text: HTMLElement;
  readonly #yes: HTMLButtonElement;
  readonly #no: HTMLButtonElement;
  readonly #labels: () => Labels;

  constructor(labels: () => Labels) {
    this.#dialog = document.getElementById('messageBox') as HTMLDialogElement;
    this.#text = document.getElementById('messageText') as HTMLElement;
    this.#yes = document.getElementById('messageYes') as HTMLButtonElement;
    this.#no = document.getElementById('messageNo') as HTMLButtonElement;
    this.#labels = labels;
  }

  #show(text: string, kind: MessageBoxKind): Promise<boolean> {
    const labels = this.#labels();
    this.#text.textContent = text;
    this.#yes.textContent = labels.text(kind === 'yesNo' ? 'yes' : 'ok');
    this.#no.textContent = labels.text('no');
    this.#no.hidden = kind === 'ok';
    return new Promise((resolve) => {
      const finish = (answer: boolean) => {
        this.#yes.removeEventListener('click', onYes);
        this.#no.removeEventListener('click', onNo);
        this.#dialog.removeEventListener('cancel', onCancel);
        this.#dialog.close();
        resolve(answer);
      };
      const onYes = () => finish(true);
      const onNo = () => finish(false);
      const onCancel = (event: Event) => {
        event.preventDefault();
        finish(false);
      };
      this.#yes.addEventListener('click', onYes);
      this.#no.addEventListener('click', onNo);
      this.#dialog.addEventListener('cancel', onCancel);
      this.#dialog.showModal();
      this.#yes.focus();
    });
  }

  confirm(text: string): Promise<boolean> {
    return this.#show(text, 'yesNo');
  }

  async alert(text: string): Promise<void> {
    await this.#show(text, 'ok');
  }

  async ask(text: string, buttons: MessageBoxButtons): Promise<number> {
    if (buttons === 'ok') {
      await this.#show(text, 'ok');
      return MessageBoxReturn.OK;
    }
    return (await this.#show(text, 'yesNo')) ? MessageBoxReturn.YES : MessageBoxReturn.NO;
  }
}
