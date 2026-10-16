import type { ConversationLineView, ConversationView, SoldierView } from '../../protocol/view.ts';
import type { CommandReply } from '../net/session-client.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

interface TalkReplyData {
  readonly walking?: boolean;
  readonly to?: number;
  readonly bark?: unknown;
  readonly refusal?: string;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function approachOf(entry: string): string {
  return entry.split(':')[0] ?? entry;
}

function lineText(line: ConversationLineView): string {
  return line.text ?? `[${line.textKey.file} row ${line.textKey.row}]`;
}

export class TalkPanel {
  readonly #root = el('talk');
  readonly #title = el('talkTitle');
  readonly #lines = el('talkLines');
  readonly #menu = el('talkMenu');
  readonly #result = el('talkResult');
  readonly #send: Send;
  #shown: ConversationView | null = null;
  #scripted = false;

  constructor(send: Send) {
    this.#send = send;
    el<HTMLButtonElement>('closeTalk').addEventListener('click', () => {
      void this.#send({ type: 'closeTalk' }).then((r) => this.#report(r, 'conversation closed'));
    });
  }

  get open(): boolean {
    return this.#shown !== null;
  }

  get result(): string {
    return this.#result.textContent ?? '';
  }

  update(conversation: ConversationView | null, scripted: boolean): void {
    if (conversation === this.#shown && scripted === this.#scripted) return;
    this.#shown = conversation;
    this.#scripted = scripted;
    this.#root.hidden = !conversation && !scripted;
    if (!conversation) {
      this.#title.textContent = scripted ? 'Scripted sequence: run until idle' : 'Talk';
      this.#lines.replaceChildren();
      this.#menu.replaceChildren();
      return;
    }
    const by = conversation.initiatedBy === 'npc' ? ' (started by the NPC)' : '';
    this.#title.textContent = `${conversation.name}${by}`;
    this.#lines.replaceChildren(
      ...conversation.lastQuotes.map((line) => {
        const p = document.createElement('p');
        p.textContent = lineText(line);
        p.title = `profile ${line.profile}, quote ${line.quote}${line.record !== undefined ? `, record ${line.record}` : ''}`;
        return p;
      }),
    );
    this.#lines.scrollTop = this.#lines.scrollHeight;
    this.#menu.replaceChildren(
      ...conversation.menu.map((entry) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = entry;
        b.dataset.approach = approachOf(entry);
        b.addEventListener('click', () => this.#approach(approachOf(entry)));
        return b;
      }),
    );
  }

  talk(soldier: number, target: SoldierView): void {
    void this.#send({ type: 'talk', soldier, target: target.id }).then((r) => {
      const data = (r.data ?? {}) as TalkReplyData;
      if (r.ok && data.walking) this.#note(`walking to ${data.to}; run until idle to start the conversation`);
      else if (r.ok && data.bark !== undefined) this.#note('own merc barked');
      else this.#report(r, `talking to ${target.name || `#${target.id}`}`);
    });
  }

  #approach(kind: string): void {
    void this.#send({ type: 'approach', kind }).then((r) => this.#report(r, `${kind} ok`));
  }

  #note(text: string): void {
    this.#root.hidden = false;
    this.#result.textContent = text;
    this.#result.classList.remove('error');
  }

  #report(r: CommandReply, ok: string): void {
    const data = (r.data ?? {}) as TalkReplyData;
    this.#result.textContent = r.ok ? ok : (data.refusal ?? r.reason ?? 'refused');
    this.#result.classList.toggle('error', !r.ok);
    if (!r.ok) this.#root.hidden = false;
  }
}

export function nearestTalkable(soldiers: readonly SoldierView[], from: SoldierView | undefined): SoldierView | null {
  if (!from) return null;
  const npcs = soldiers.filter((s) => s.talkable === 'npc');
  const distance = (s: SoldierView) => Math.hypot(s.x - from.x, s.y - from.y);
  return npcs.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}
