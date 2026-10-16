import type { DoorView } from '../../protocol/view.ts';
import type { CommandReply } from '../net/session-client.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

interface DoorOption {
  readonly action: string;
  readonly ap: number;
  readonly enabled: boolean;
  readonly reason?: string;
}

interface DoorReplyData {
  readonly walking?: boolean;
  readonly to?: number;
  readonly started?: string;
  readonly opened?: boolean;
  readonly locked?: boolean;
  readonly options?: readonly DoorOption[];
  readonly trapNoticed?: boolean;
  readonly refusal?: string;
}

function outcome(action: string, data: DoorReplyData): string {
  if (data.walking) return `walking to ${data.to}; ctrl+click the door again on arrival`;
  if (data.trapNoticed) return 'the merc noticed a trap';
  if (data.locked) return 'locked: pick an action';
  return data.started ? `${data.started} started` : `${action} ok`;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

export class DoorPanel {
  readonly #root = el('door');
  readonly #title = el('doorTitle');
  readonly #state = el('doorState');
  readonly #options = el('doorOptions');
  readonly #result = el('doorResult');
  readonly #send: Send;
  #gridNo: number | null = null;
  #soldier: number | null = null;
  #doors: readonly DoorView[] = [];
  #open = false;

  constructor(send: Send) {
    this.#send = send;
    el<HTMLButtonElement>('closeDoorPanel').addEventListener('click', () => this.hide());
  }

  get result(): string {
    return this.#result.textContent ?? '';
  }

  hide(): void {
    this.#gridNo = null;
    this.#root.hidden = true;
  }

  update(doors: readonly DoorView[], openDoors: ReadonlySet<number>): void {
    const open = this.#gridNo !== null && openDoors.has(this.#gridNo);
    if (doors === this.#doors && open === this.#open) return;
    this.#doors = doors;
    this.#open = open;
    this.#renderState();
  }

  act(soldier: number, gridNo: number, action = 'open'): void {
    this.#soldier = soldier;
    this.#gridNo = gridNo;
    this.#root.hidden = false;
    this.#title.textContent = `Door ${gridNo}`;
    this.#renderState();
    void this.#send({ type: 'door', soldier, gridNo, action }).then((r) => this.#show(action, r));
  }

  #renderState(): void {
    if (this.#gridNo === null) return;
    const known = this.#doors.find((d) => d.gridNo === this.#gridNo);
    const lock = known ? `lock ${known.locked}, trap ${known.trap}` : 'lock and trap unknown';
    this.#state.textContent = `${this.#open ? 'open' : 'closed'} · ${lock}`;
  }

  #show(action: string, r: CommandReply): void {
    const data = (r.data ?? {}) as DoorReplyData;
    if (r.ok && data.options) this.#renderOptions(data.options);
    if (!r.ok) this.#report(data.refusal ?? r.reason ?? 'refused', true);
    else this.#report(outcome(action, data));
  }

  #renderOptions(options: readonly DoorOption[]): void {
    this.#options.replaceChildren(
      ...options.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.ap > 0 ? `${o.action} (${o.ap} AP)` : o.action;
        b.disabled = !o.enabled;
        b.title = o.reason ?? '';
        b.dataset.doorAction = o.action;
        b.addEventListener('click', () => {
          if (this.#soldier !== null && this.#gridNo !== null) this.act(this.#soldier, this.#gridNo, o.action);
        });
        return b;
      }),
    );
  }

  #report(text: string, error = false): void {
    this.#result.textContent = text;
    this.#result.classList.toggle('error', error);
  }
}
