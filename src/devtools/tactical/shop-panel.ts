import type { CommandReply } from '../../app/net/session-client.ts';
import type { InventoryItemView, ShopBoxView, ShopView, SoldierView } from '../../protocol/view.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

interface TradeData {
  readonly cost?: number;
  readonly value?: number;
  readonly giftAccepted?: boolean;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function boxCondition(box: ShopBoxView): string {
  if (box.eta) return `ready day ${box.eta.day} ${String(box.eta.hour).padStart(2, '0')}:${String(box.eta.minute).padStart(2, '0')}`;
  if (box.owner !== undefined) return 'ready';
  return box.unitPrice !== undefined ? `$${box.unitPrice}` : '';
}

function itemCondition(item: InventoryItemView): string {
  if (item.money !== undefined) return `$${item.money}`;
  return item.status.join('/');
}

export class ShopPanel {
  readonly #root = el('shop');
  readonly #title = el('shopTitle');
  readonly #boxes = el<HTMLTableElement>('shopBoxes');
  readonly #inventory = el<HTMLTableElement>('shopInventory');
  readonly #result = el('shopResult');
  readonly #send: Send;
  #shown: ShopView | null = null;
  #shownInventory: readonly InventoryItemView[] | undefined = undefined;

  constructor(send: Send) {
    this.#send = send;
    el<HTMLButtonElement>('closeShop').addEventListener('click', () => {
      void this.#send({ type: 'closeShop' }).then((r) => this.#report(r, 'shop closed'));
    });
  }

  update(shop: ShopView | null, soldiers: readonly SoldierView[]): void {
    const inventory = shop ? soldiers.find((s) => s.id === shop.soldier)?.inventory : undefined;
    if (shop === this.#shown && inventory === this.#shownInventory) return;
    this.#shown = shop;
    this.#shownInventory = inventory;
    this.#root.hidden = !shop;
    if (!shop) return;
    this.#title.textContent = `${shop.name} · ${shop.kind} · balance $${shop.balance}`;
    this.#boxes.replaceChildren(...shop.boxes.map((box) => this.#boxRow(shop, box)));
    this.#inventory.replaceChildren(...(inventory ?? []).map((item) => this.#itemRow(shop, item)));
  }

  #boxRow(shop: ShopView, box: ShopBoxView): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.append(cell(box.item), cell(`×${box.count}`), cell(`${box.status}%`), cell(boxCondition(box)));
    const action = document.createElement('td');
    if (box.unitPrice !== undefined && (shop.kind === 'buySell' || shop.kind === 'buy'))
      action.append(
        button('buy', () => this.#trade({ buy: [{ item: box.key.item, element: box.key.element, count: 1 }], useBalance: true })),
      );
    tr.append(action);
    return tr;
  }

  #itemRow(shop: ShopView, item: InventoryItemView): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.append(cell(item.item), cell(`×${item.count}`), cell(itemCondition(item)));
    const action = document.createElement('td');
    const from = { soldier: shop.soldier, slot: item.slot };
    if (shop.kind === 'buySell' || shop.kind === 'sell') action.append(button('sell', () => this.#trade({ sell: [from] })));
    if (shop.kind === 'repair') action.append(button('repair', () => this.#trade({ repair: [from], useBalance: true })));
    tr.append(action);
    return tr;
  }

  #trade(offer: Record<string, unknown>): void {
    const soldier = this.#shown?.soldier;
    void this.#send({ type: 'trade', soldier, ...offer }).then((r) => {
      const data = r.data as TradeData | undefined;
      const done = data?.giftAccepted ? 'gift accepted' : `done: cost $${data?.cost ?? 0}, value $${data?.value ?? 0}`;
      this.#report(r, done);
    });
  }

  #report(r: CommandReply, ok: string): void {
    this.#result.textContent = r.ok ? ok : (r.reason ?? 'refused');
    this.#result.classList.toggle('error', !r.ok);
  }
}

export function nearestMerchant(soldiers: readonly SoldierView[], from: SoldierView | undefined): SoldierView | null {
  if (!from) return null;
  const merchants = soldiers.filter((s) => s.merchant && s.profile !== undefined);
  const distance = (s: SoldierView) => Math.hypot(s.x - from.x, s.y - from.y);
  return merchants.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}
