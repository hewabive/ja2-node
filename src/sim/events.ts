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
  readonly team: number;
  readonly soldier: number;
}

export interface DoorChangedEvent extends SimEventBase {
  readonly type: 'doorChanged';
  readonly gridNo: number;
  readonly open: boolean;
}

export interface NoiseHeardEvent extends SimEventBase {
  readonly type: 'noiseHeard';
  readonly listener: number;
  readonly kind: number;
  readonly volumeClass: number;
  readonly direction: number | 'above' | 'below';
}

export interface EnemySightedEvent extends SimEventBase {
  readonly type: 'enemySighted';
  readonly soldier: number;
  readonly newEnemies: number;
  readonly revealedEnemies: number;
}

export type SimEvent =
  | TickBudgetEvent
  | ArrivedEvent
  | StoppedEvent
  | NoPathEvent
  | CombatWouldStartEvent
  | DoorChangedEvent
  | NoiseHeardEvent
  | EnemySightedEvent;
export type SimEventType = SimEvent['type'];
