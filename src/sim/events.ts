export interface SimEventBase {
  readonly tick: number;
}

export interface TickBudgetEvent extends SimEventBase {
  readonly type: 'budgetExhausted';
}

export interface ArrivedEvent extends SimEventBase {
  readonly type: 'arrived';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface StoppedEvent extends SimEventBase {
  readonly type: 'stopped';
  readonly soldier: number;
  readonly gridNo: number;
  readonly reason: string;
}

export interface NoPathEvent extends SimEventBase {
  readonly type: 'noPath';
  readonly soldier: number;
  readonly to: number;
}

export interface CombatWouldStartEvent extends SimEventBase {
  readonly type: 'combatWouldStart';
  readonly soldier: number;
  readonly seen: number;
}

export interface DoorChangedEvent extends SimEventBase {
  readonly type: 'doorChanged';
  readonly gridNo: number;
  readonly open: boolean;
}

export type SimEvent = TickBudgetEvent | ArrivedEvent | StoppedEvent | NoPathEvent | CombatWouldStartEvent | DoorChangedEvent;
export type SimEventType = SimEvent['type'];
