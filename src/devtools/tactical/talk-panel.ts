import type { ConversationLineView, ConversationView, InventoryItemView, NpcRequestPromptView, SoldierView } from '../../protocol/view.ts';
import type { CommandReply } from '../net/session-client.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

interface TalkReplyData {
  readonly walking?: boolean;
  readonly to?: number;
  readonly bark?: unknown;
  readonly civQuote?: { readonly text?: string; readonly quote: number } | null;
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
  readonly #request = el('talkRequest');
  readonly #give = el('talkGive');
  readonly #result = el('talkResult');
  readonly #send: Send;
  #shown: ConversationView | null = null;
  #scripted = false;
  #shownRequest: NpcRequestPromptView | null = null;
  #shownInventory: readonly InventoryItemView[] | undefined = undefined;

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

  update(
    conversation: ConversationView | null,
    scripted: boolean,
    request: NpcRequestPromptView | null,
    soldiers: readonly SoldierView[],
  ): void {
    this.#renderRequest(request);
    this.#renderGive(conversation, soldiers);
    if (conversation === this.#shown && scripted === this.#scripted) return;
    this.#shown = conversation;
    this.#scripted = scripted;
    this.#root.hidden = !conversation && !scripted && !this.#shownRequest;
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

  #renderGive(conversation: ConversationView | null, soldiers: readonly SoldierView[]): void {
    const talkerId = conversation?.menu.includes('give') ? conversation.talker : null;
    const talker = talkerId !== null ? soldiers.find((s) => s.id === talkerId) : undefined;
    const inventory = talker?.inventory;
    if (inventory === this.#shownInventory && (talker !== undefined || this.#give.hidden)) return;
    this.#shownInventory = inventory;
    this.#give.hidden = !talker || !inventory?.length;
    if (!talker || !conversation || conversation.npc === null || !inventory) {
      this.#give.replaceChildren();
      return;
    }
    const npc = conversation.npc;
    const label = document.createElement('div');
    label.textContent = 'give:';
    const buttons = document.createElement('div');
    buttons.className = 'actions';
    buttons.append(
      ...inventory.map((item) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.money !== undefined ? `$${item.money}` : item.count > 1 ? `${item.item} ×${item.count}` : item.item;
        b.dataset.giveSlot = String(item.slot);
        b.addEventListener('click', () => {
          void this.#send({ type: 'give', soldier: talker.id, target: npc, slot: item.slot }).then((r) => {
            const outcome = (r.data as { outcome?: string } | undefined)?.outcome;
            this.#report(r, `gave ${item.item}${outcome ? `: ${outcome}` : ''}`);
          });
        });
        return b;
      }),
    );
    this.#give.replaceChildren(label, buttons);
  }

  #renderRequest(request: NpcRequestPromptView | null): void {
    if (request === this.#shownRequest) return;
    this.#shownRequest = request;
    this.#request.hidden = !request;
    if (!request) {
      this.#request.replaceChildren();
      return;
    }
    this.#root.hidden = false;
    const details = [request.amount !== undefined ? `$${request.amount}` : '', request.merc !== undefined ? `merc #${request.merc}` : '']
      .filter(Boolean)
      .join(', ');
    const text = document.createElement('div');
    text.textContent = `${request.name} asks: ${request.request}${details ? ` (${details})` : ''}`;
    const choices = document.createElement('div');
    choices.className = 'actions';
    choices.append(
      ...request.choices.map((choice) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = choice;
        b.dataset.choice = choice;
        b.addEventListener('click', () => {
          void this.#send({ type: 'answer', prompt: request.id, choice }).then((r) => this.#report(r, `answered ${choice}`));
        });
        return b;
      }),
    );
    this.#request.replaceChildren(text, choices);
  }

  talk(soldier: number, target: SoldierView): void {
    void this.#send({ type: 'talk', soldier, target: target.id }).then((r) => {
      const data = (r.data ?? {}) as TalkReplyData;
      if (r.ok && data.walking) this.#note(`walking to ${data.to}; run until idle to start the conversation`);
      else if (r.ok && data.bark !== undefined) this.#note('own merc barked');
      else if (r.ok && data.civQuote !== undefined) this.#note(data.civQuote?.text ?? 'no answer');
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
  const distance = (s: SoldierView) => Math.hypot(s.x - from.x, s.y - from.y);
  const nearest = (kind: string) => soldiers.filter((s) => s.talkable === kind).sort((a, b) => distance(a) - distance(b))[0];
  return nearest('npc') ?? nearest('civilian') ?? null;
}
