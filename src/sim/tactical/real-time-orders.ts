import type { Refusal } from './refusal.ts';
import type { TacticalState } from './state.ts';

export const REAL_TIME_ORDER_IN_COMBAT: Refusal = {
  token: 'realTimeOrder',
  reason: 'the order was given in real time and combat has begun',
};

export interface Order {
  readonly type: string;
  readonly [key: string]: unknown;
}

export function realTimeOrderRefusal(t: TacticalState, cmd: Order): Refusal | null {
  return cmd.realTime === true && t.inCombat ? REAL_TIME_ORDER_IN_COMBAT : null;
}
