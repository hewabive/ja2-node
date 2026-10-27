import type { SimEventBase } from '../../events.ts';

export type DoorMenuAction =
  | 'openManually'
  | 'closeManually'
  | 'unlock'
  | 'pickLock'
  | 'force'
  | 'crowbar'
  | 'explode'
  | 'untrap'
  | 'examine';

export interface DoorMenuOption {
  readonly action: DoorMenuAction;
  readonly ap: number;
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface DoorMenuEvent extends SimEventBase {
  readonly type: 'doorMenu';
  readonly soldier: number;
  readonly gridNo: number;
  readonly options: readonly DoorMenuOption[];
  readonly closing?: true;
}

export interface DoorResultEvent extends SimEventBase {
  readonly type: 'doorResult';
  readonly soldier: number;
  readonly gridNo: number;
  readonly action: string;
  readonly result: string;
  readonly trap?: string;
}

export interface DoorTrapEvent extends SimEventBase {
  readonly type: 'doorTrap';
  readonly soldier: number;
  readonly gridNo: number;
  readonly trap: string;
}

export interface LockDestroyedEvent extends SimEventBase {
  readonly type: 'lockDestroyed';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface OpenableChangedEvent extends SimEventBase {
  readonly type: 'openableChanged';
  readonly soldier: number;
  readonly gridNo: number;
  readonly open: boolean;
  readonly material: number;
}

export type ContentsExclamation = 'NOTHING' | 'HUMM' | 'COOL1';

export interface ContentsExclaimedEvent extends SimEventBase {
  readonly type: 'contentsExclaimed';
  readonly soldier: number;
  readonly sound: ContentsExclamation;
  readonly delayMs: number;
}

export type DoorEvent =
  | DoorMenuEvent
  | DoorResultEvent
  | DoorTrapEvent
  | LockDestroyedEvent
  | OpenableChangedEvent
  | ContentsExclaimedEvent;
