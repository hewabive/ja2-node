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

export interface CombatStartedEvent extends SimEventBase {
  readonly type: 'combatStarted';
  readonly team: number;
}

export interface TurnStartedEvent extends SimEventBase {
  readonly type: 'turnStarted';
  readonly team: number;
  readonly round: number;
}

export interface InterruptEvent extends SimEventBase {
  readonly type: 'interrupt';
  readonly team: number;
  readonly soldiers?: readonly number[];
}

export interface InterruptEndedEvent extends SimEventBase {
  readonly type: 'interruptEnded';
  readonly team: number;
}

export interface CombatEndedEvent extends SimEventBase {
  readonly type: 'combatEnded';
  readonly reason: 'lull' | 'won' | 'lost';
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

export interface RoomRevealedEvent extends SimEventBase {
  readonly type: 'roomRevealed';
  readonly room: number;
}

export type SimEvent =
  | TickBudgetEvent
  | ArrivedEvent
  | StoppedEvent
  | NoPathEvent
  | CombatStartedEvent
  | TurnStartedEvent
  | InterruptEvent
  | InterruptEndedEvent
  | CombatEndedEvent
  | DoorChangedEvent
  | NoiseHeardEvent
  | EnemySightedEvent
  | RoomRevealedEvent;
export type SimEventType = SimEvent['type'];
