// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc SMInvMoneyButtonCallback (money in the cursor: A_CHANGE_TO_MOVE, then the
// @src CONFIRMATION_TO_DEPOSIT_MONEY_TO_ACCOUNT question, 2026-11-02; no item: the money box over LaptopSaveInfo.iCurrentBalance;
// @src nothing while gfSMDisableForItems), ConfirmationToDepositMoneyToPlayersAccount; src/game/Tactical/Interface_Items.cc
// @src RemoveMoney (a withdrawal books TRANSFER_FUNDS_TO_MERC, a split goes into the cursor, in the shop into the shop's
// @src cursor to be offered; a withdrawal goes into the cursor too and is booked as it is dropped, 2026-11-15).

import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { TacticalEnvironment } from './environment.ts';
import type { InventoryPanel } from './inventory.ts';
import { cursorFromAccount, cursorFromMoney, depositCommand, type ItemCursor, slotItem } from './item-cursor.ts';
import type { DescribedObject } from './item-description.ts';
import { soldierById } from './soldiers.ts';

const MONEY_CLASS = 'MONEY';
const MONEY_MESSAGES = 'gzMoneyWithdrawMessageText';
const CONFIRMATION_TO_DEPOSIT_MONEY_TO_ACCOUNT = 1;

export interface MoneyActionHooks {
  readonly env: TacticalEnvironment;
  readonly inventory: InventoryPanel;
  view(): PlayerView | null;
  smSoldier(): SoldierView | null;
  disabled(): boolean;
  changeToMove(): void;
  shopOpen(): boolean;
  showBalance(soldier: number, amount: number): void;
  offerCash(soldier: number, slot: number, amount: number): boolean;
}

export class MoneyActions {
  readonly #hooks: MoneyActionHooks;

  constructor(hooks: MoneyActionHooks) {
    this.#hooks = hooks;
  }

  async region(): Promise<void> {
    const { env, inventory } = this.#hooks;
    const s = this.#hooks.smSoldier();
    if (!s || this.#hooks.disabled() || this.#hooks.shopOpen()) return;
    const cursor = inventory.cursor;
    if (!cursor) {
      const balance = this.#hooks.view()?.strategic?.balance;
      if (balance !== undefined) this.#hooks.showBalance(s.id, balance);
      return;
    }
    const amount = this.#heldMoney(cursor);
    if (amount === null) return;
    this.#hooks.changeToMove();
    const question = printf(env.text.string(MONEY_MESSAGES, CONFIRMATION_TO_DEPOSIT_MONEY_TO_ACCOUNT) ?? '', [sprintMoney(amount)]);
    if (!(await env.boxes.confirm(question))) return;
    const deposit = depositCommand(cursor);
    const reply = deposit ? await inventory.send(deposit) : { ok: true };
    if (reply.ok) inventory.setCursor(null);
  }

  #heldMoney(cursor: ItemCursor): number | null {
    if (this.#hooks.env.media.item(cursor.item)?.class !== MONEY_CLASS) return null;
    const source = cursor.source;
    switch (source.kind) {
      case 'account':
      case 'money':
        return source.amount;
      case 'slot':
        return slotItem(soldierById(this.#hooks.view(), source.soldier), source.slot)?.money ?? 0;
      default:
        return null;
    }
  }

  done(object: DescribedObject, amount: number): void {
    const inventory = this.#hooks.inventory;
    if (object.kind === 'balance') {
      const withdrawn = cursorFromAccount(object.soldier, amount);
      if (withdrawn) inventory.setCursor(withdrawn);
      return;
    }
    if (object.kind !== 'slot') return;
    if (this.#hooks.shopOpen()) {
      this.#hooks.offerCash(object.soldier, object.slot, amount);
      return;
    }
    const s = soldierById(this.#hooks.view(), object.soldier);
    const cursor = s ? cursorFromMoney(s, object.slot, amount) : null;
    if (cursor) inventory.setCursor(cursor);
  }
}
