import type { CommandRefused } from '../command.ts';

export interface Refusal {
  readonly token: string;
  readonly reason: string;
}

export type RefusalTexts<T extends string> = Readonly<Record<T, string>>;

export type RefusalDetail = object;

export function refuse(token: string, reason: string, detail: RefusalDetail = {}): CommandRefused {
  return { ok: false, reason, data: { refusal: token, ...detail } };
}

export function refused(refusal: Refusal): CommandRefused {
  return refuse(refusal.token, refusal.reason);
}

export function refuseWithText<T extends string>(texts: RefusalTexts<T>, token: T, detail?: RefusalDetail): CommandRefused {
  return refuse(token, `${token}: ${texts[token]}`, detail);
}
