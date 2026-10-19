import type { CommandResult } from '../command.ts';

export interface Refusal {
  readonly token: string;
  readonly reason: string;
}

export function refuse(token: string, reason: string): CommandResult {
  return { ok: false, reason, data: { refusal: token } };
}

export function refused(refusal: Refusal): CommandResult {
  return refuse(refusal.token, refusal.reason);
}
