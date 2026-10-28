// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc SMInvMoneyButtonCallback (the money region: the money box over the account
// @src balance, or the deposit question with money in the cursor), ConfirmationToDepositMoneyToPlayersAccount
// @src (MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT); src/game/Tactical/Interface_Items.cc RemoveMoney (TRANSFER_FUNDS_TO_MERC),
// @src BtnMoneyButtonCallbackPrimary (a withdrawal stops at MAX_MONEY_PER_SLOT); src/game/Tactical/Interface.cc
// @src SetCurrentTacticalPanelCurrentMerc (no single merc panel for escorts and non-merc bodies).

import { ItemClass } from '../../content/items/items.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { createMoney, deleteObject, MAX_MONEY_PER_SLOT } from '../items/object.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { handleTacticalEffectsOfEquipmentChange } from '../tactical/hand-item.ts';
import { moneyAmount, parseSlot } from '../tactical/inventory-commands.ts';
import { Body, type Soldier, Team } from '../tactical/soldier.ts';
import { soldierInventoryContext } from '../tactical/soldier-inventory.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import type { CampaignCommand, CampaignSim } from './campaign-sim.ts';
import { addTransaction, FinanceCode, type FinanceRecord } from './finances.ts';
import { addToMercInventory, fitsInMercInventory } from './merc-placement.ts';

export const MONEY_COMMANDS: ReadonlySet<string> = new Set(['withdrawCash', 'depositCash', 'splitMoney']);

export const MoneyRefusal = {
  NOT_IN_TACTICAL: 'notInTactical',
  NO_SUCH_SOLDIER: 'noSuchSoldier',
  NO_INVENTORY: 'noInventory',
  BAD_SLOT: 'badSlot',
  EMPTY_SLOT: 'emptySlot',
  NOT_MONEY: 'notMoney',
  BAD_AMOUNT: 'badAmount',
  NOT_ENOUGH_MONEY: 'notEnoughMoney',
  NO_ROOM: 'noRoom',
} as const;

export type MoneyRefusal = (typeof MoneyRefusal)[keyof typeof MoneyRefusal];

export const MONEY_REFUSAL_TEXT: Readonly<Record<MoneyRefusal, string>> = {
  notInTactical: 'money is moved on the tactical screen only',
  noSuchSoldier: 'no such soldier of yours in the sector',
  noInventory: 'that soldier has no single merc panel (escort, vehicle or robot)',
  badSlot: 'slot must be 0..18 or a slot name such as hand, bigPocket1, smallPocket1',
  emptySlot: 'that slot is empty',
  notMoney: 'that slot holds no money',
  badAmount: `amount must be a positive whole number of dollars, at most ${MAX_MONEY_PER_SLOT} for a withdrawal`,
  notEnoughMoney: 'there is not that much money',
  noRoom: 'no pocket has room for the money',
};

function refusal(code: MoneyRefusal): CommandResult {
  return { ok: false, reason: `${code}: ${MONEY_REFUSAL_TEXT[code]}`, data: { refusal: code } };
}

export class MoneyFlow {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: Record<string, unknown> & { readonly type: string }): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  dispatch(cmd: CampaignCommand): CommandResult | null {
    if (!MONEY_COMMANDS.has(cmd.type)) return null;
    const tactical = this.#campaign.tactical;
    if (this.#campaign.state.flow !== 'tactical' || !tactical) return refusal(MoneyRefusal.NOT_IN_TACTICAL);
    if (cmd.type === 'splitMoney') return null;
    const s = tactical.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return refusal(MoneyRefusal.NO_SUCH_SOLDIER);
    const turn = tactical.actRefusal(s);
    if (turn) return { ok: false, reason: turn.reason, data: { refusal: turn.token } };
    if (!this.#hasPanel(tactical, s)) return refusal(MoneyRefusal.NO_INVENTORY);
    return cmd.type === 'withdrawCash' ? this.#withdraw(tactical, s, cmd) : this.#deposit(tactical, s, cmd);
  }

  #hasPanel(tactical: TacticalSim, s: Soldier): boolean {
    return s.bodyType <= Body.REGFEMALE && !tactical.state.narrative.isEpc(s);
  }

  #now(): number {
    return worldTotalMinutes(this.#campaign.state.clock);
  }

  #moneyChanged(record: FinanceRecord): void {
    this.#emit({ type: 'moneyChanged', code: record.code, amount: record.amount, balance: record.balanceAfter });
  }

  #withdraw(tactical: TacticalSim, s: Soldier, cmd: CampaignCommand): CommandResult {
    const amount = moneyAmount(cmd.amount);
    if (amount === null || amount > MAX_MONEY_PER_SLOT) return refusal(MoneyRefusal.BAD_AMOUNT);
    const finances = this.#campaign.state.finances;
    if (amount > finances.balance) return refusal(MoneyRefusal.NOT_ENOUGH_MONEY);
    const t = tactical.state;
    const items = t.content.items;
    const moneyItem = items.byName.get('MONEY')?.index;
    if (moneyItem === undefined) return refusal(MoneyRefusal.NO_ROOM);
    const money = createMoney(items, amount);
    if (!fitsInMercInventory(items, t.inCombat, s, money, moneyItem)) return refusal(MoneyRefusal.NO_ROOM);
    this.#moneyChanged(addTransaction(finances, FinanceCode.TRANSFER_FUNDS_TO_MERC, s.profile, this.#now(), -amount));
    addToMercInventory(soldierInventoryContext(t, s), s, money, moneyItem);
    this.#emit({ type: 'cashWithdrawn', soldier: s.id, amount });
    return { ok: true, data: { amount, balance: finances.balance } };
  }

  #deposit(tactical: TacticalSim, s: Soldier, cmd: CampaignCommand): CommandResult {
    const slot = parseSlot(cmd.slot);
    if (slot === null) return refusal(MoneyRefusal.BAD_SLOT);
    const o = s.inv[slot];
    if (!o || o.count === 0) return refusal(MoneyRefusal.EMPTY_SLOT);
    const t = tactical.state;
    if (t.content.items.byIndex.get(o.item)?.itemClass !== ItemClass.MONEY) return refusal(MoneyRefusal.NOT_MONEY);
    const amount = cmd.amount === undefined ? o.money : moneyAmount(cmd.amount);
    if (amount === null || amount <= 0) return refusal(MoneyRefusal.BAD_AMOUNT);
    if (amount > o.money) return refusal(MoneyRefusal.NOT_ENOUGH_MONEY);
    const finances = this.#campaign.state.finances;
    const item = o.item;
    o.money -= amount;
    if (o.money === 0) {
      deleteObject(o);
      handleTacticalEffectsOfEquipmentChange(t, s, slot, item, o.item);
    }
    this.#moneyChanged(addTransaction(finances, FinanceCode.MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT, s.profile, this.#now(), amount));
    this.#emit({ type: 'cashDeposited', soldier: s.id, amount });
    return { ok: true, data: { amount, balance: finances.balance } };
  }
}
