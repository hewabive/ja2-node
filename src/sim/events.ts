export interface SimEventBase {
  readonly tick: number;
}

export interface TickBudgetEvent extends SimEventBase {
  readonly type: 'budgetExhausted';
}

export type SimEvent = TickBudgetEvent;
export type SimEventType = SimEvent['type'];
