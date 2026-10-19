import { HttpAssetSource } from '../../app/assets/asset-source.ts';
import { ClientKnowledge } from '../../app/hints/client-knowledge.ts';
import { attachHintHook, createHintHook, type HintHook } from '../../app/hints/hint-hook.ts';
import { HintProvider } from '../../app/hints/hint-provider.ts';
import type { SessionClient } from '../../app/net/session-client.ts';
import type { CommandEnvelope } from '../../protocol/messages.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { HintReply } from '../../ui/game-client.ts';

const OUR_TEAM = 0;

export interface HintFocus {
  readonly selected: number | null;
  readonly hoverGridNo: number | null;
  readonly hoveredSoldier: number | null;
  readonly soldiers: readonly SoldierView[];
}

function describeReply(request: CommandEnvelope, reply: HintReply): string {
  if (reply.state === 'pending') return `${request.type}: …`;
  const a = reply.answer;
  if (!a.ok) return `${request.type}: ${a.reason ?? 'refused'} (${reply.source})`;
  const d = a.data as Record<string, unknown>;
  const ap = typeof d.apCost === 'number' ? ` ${d.apCost} AP` : '';
  const extra = request.type === 'estimateAttack' ? ` hit ${String(d.chanceToHit)}% through ${String(d.chanceToGetThrough)}%` : '';
  const destination = typeof d.destination === 'string' && d.destination !== 'ok' ? ` [${d.destination}]` : '';
  return `${request.type}:${ap}${extra}${destination} (${reply.source})`;
}

export class HintPanel {
  readonly provider: HintProvider;
  readonly hook: HintHook;
  readonly #slots: HTMLElement;
  readonly #text: HTMLElement;
  #knowledge: ClientKnowledge | null = null;
  #hoveredSlot: number | null = null;
  #inventoryKey = '';

  constructor(client: SessionClient, shadow: boolean, host: HTMLElement) {
    this.provider = new HintProvider({
      channel: client,
      knowledge: () => this.#knowledge,
      now: () => performance.now(),
      shadow,
    });
    this.hook = createHintHook(this.provider);
    attachHintHook(this.hook);
    const aside = document.createElement('aside');
    aside.className = 'hints';
    aside.id = 'hints';
    this.#slots = document.createElement('div');
    this.#slots.className = 'hint-slots';
    this.#text = document.createElement('div');
    this.#text.className = 'hint-text';
    aside.append(this.#slots, this.#text);
    host.append(aside);
  }

  async start(client: SessionClient): Promise<void> {
    const identity = client.identity;
    if (!identity) return;
    const source = await HttpAssetSource.open();
    const knowledge = await ClientKnowledge.open(source, identity);
    const mapPath = client.latestView?.mapPath;
    if (mapPath) await knowledge.worlds.ensure(mapPath);
    this.#knowledge = knowledge;
    this.hook.error = mapPath ? (knowledge.worlds.failures.get(mapPath) ?? null) : null;
    this.hook.usable = knowledge.usable;
    this.hook.ready = true;
  }

  #syncSlots(merc: SoldierView | undefined): void {
    const items = merc?.inventory ?? [];
    const key = `${merc?.id ?? -1}:${items.map((i) => `${i.slot}=${i.item}`).join(',')}`;
    if (key === this.#inventoryKey) return;
    this.#inventoryKey = key;
    this.#slots.replaceChildren(
      ...items.map((item) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.slot = String(item.slot);
        b.textContent = `${item.slot}: ${item.item}`;
        b.addEventListener('pointerenter', () => {
          this.#hoveredSlot = item.slot;
        });
        b.addEventListener('pointerleave', () => {
          this.#hoveredSlot = null;
        });
        return b;
      }),
    );
  }

  #requests(focus: HintFocus): CommandEnvelope[] {
    const soldier = focus.selected;
    if (soldier === null) return [];
    if (this.#hoveredSlot !== null)
      return [
        { type: 'placements', soldier, slot: this.#hoveredSlot },
        { type: 'itemInfo', soldier, slot: this.#hoveredSlot },
      ];
    const target = focus.soldiers.find((s) => s.id === focus.hoveredSoldier && s.team !== OUR_TEAM);
    if (target) return [{ type: 'estimateAttack', soldier, target: target.gridNo, level: target.level }];
    if (focus.hoverGridNo !== null) return [{ type: 'previewMove', soldier, to: focus.hoverGridNo }];
    return [];
  }

  update(focus: HintFocus): string {
    this.#syncSlots(focus.soldiers.find((s) => s.id === focus.selected && s.team === OUR_TEAM));
    const lines = this.#requests(focus).map((request) => {
      const reply = this.provider.hint(request);
      this.hook.last = { request, reply };
      return describeReply(request, reply);
    });
    const stats = this.provider.stats;
    const shadow = this.provider.shadow ? `  shadow ${stats.shadowCompared} compared, ${stats.mismatchCount} differ` : '';
    const text = [...lines, `hints: ${stats.local} local, ${stats.server} server${shadow}`].join('\n');
    this.#text.textContent = text;
    return lines.join('  ·  ');
  }
}
