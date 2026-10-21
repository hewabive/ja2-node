// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InternalInitItemDescriptionBox (REMOVE_MONEY from the object, the $1000,
// @src $100 and $10 buttons disabled below their amount), BtnMoneyButtonCallbackPrimary (a step moves from remaining to
// @src removing when enough remains; a withdrawal above MAX_MONEY_PER_SLOT shows MONEY_TEXT_WITHDRAW_MORE_THEN_MAXIMUM),
// @src BtnMoneyButtonCallbackSecondary (a step back); src/game/Tactical/Items.h MAX_MONEY_PER_SLOT. See docs/28 §5.4.

export const MONEY_STEPS = [1000, 100, 10] as const;
export const MAX_MONEY_PER_SLOT = 20000;

export type MoneyStepResult = 'added' | 'overMaximum' | 'unchanged';

export class MoneyBox {
  readonly total: number;
  readonly withdraw: boolean;
  #remaining: number;
  #removing = 0;

  constructor(total: number, withdraw: boolean) {
    this.total = total;
    this.withdraw = withdraw;
    this.#remaining = total;
  }

  get remaining(): number {
    return this.#remaining;
  }

  get removing(): number {
    return this.#removing;
  }

  stepEnabled(step: number): boolean {
    return this.total >= (MONEY_STEPS[step] ?? Number.POSITIVE_INFINITY);
  }

  add(step: number): MoneyStepResult {
    const amount = MONEY_STEPS[step] ?? 0;
    if (amount === 0 || this.#remaining < amount) return 'unchanged';
    if (this.withdraw && this.#removing + amount > MAX_MONEY_PER_SLOT) return 'overMaximum';
    this.#remaining -= amount;
    this.#removing += amount;
    return 'added';
  }

  subtract(step: number): boolean {
    const amount = MONEY_STEPS[step] ?? 0;
    if (amount === 0 || this.#removing < amount) return false;
    this.#remaining += amount;
    this.#removing -= amount;
    return true;
  }
}
