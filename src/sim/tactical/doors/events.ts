import type { SimEventBase } from '../../events.ts';

export type DoorMenuAction = 'openManually' | 'unlock' | 'pickLock' | 'force' | 'crowbar' | 'explode' | 'untrap' | 'examine';

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

export type DoorEvent = DoorMenuEvent | DoorResultEvent | DoorTrapEvent | LockDestroyedEvent;
