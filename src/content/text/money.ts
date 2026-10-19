// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc InternalSPrintMoney, SPrintMoney (a comma every three digits, the minus sign after
// @src the dollar), for the texts the server renders (mail subjects and bodies).

const DIGIT_GROUP = 3;

export function sprintMoney(amount: number): string {
  const digits = String(Math.trunc(amount) | 0);
  const start = amount < 0 ? 1 : 0;
  let money = '$';
  for (let i = 0; i < digits.length; i++) {
    if (i > start && (digits.length - i) % DIGIT_GROUP === 0) money += ',';
    money += digits[i];
  }
  return money;
}
