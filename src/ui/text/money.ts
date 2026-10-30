// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc InternalSPrintMoney, SPrintMoney, SPrintMoneyNoDollarOnZero (a comma every three
// @src digits, the minus sign after the dollar).

import { i32 } from '../../core/int.ts';

const DIGIT_GROUP = 3;

function internalSprintMoney(dollar: boolean, amount: number): string {
  const digits = String(i32(amount));
  const start = amount < 0 ? 1 : 0;
  let money = dollar ? '$' : '';
  for (let i = 0; i < digits.length; i++) {
    if (i > start && (digits.length - i) % DIGIT_GROUP === 0) money += ',';
    money += digits[i];
  }
  return money;
}

export function sprintMoney(amount: number): string {
  return internalSprintMoney(true, amount);
}

export function sprintMoneyNoDollarOnZero(amount: number): string {
  return internalSprintMoney(amount !== 0, amount);
}
