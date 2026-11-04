import type { SimEventBase } from '../events.ts';

export interface TrapSpottedEvent extends SimEventBase {
  readonly type: 'trapSpotted';
  readonly soldier: number;
  readonly gridNo: number;
  readonly kind: 'item';
}

export interface TrapDisarmedEvent extends SimEventBase {
  readonly type: 'trapDisarmed';
  readonly soldier: number;
  readonly gridNo: number;
  readonly battleSound?: 'COOL1';
}

export interface TrapSetOffEvent extends SimEventBase {
  readonly type: 'trapSetOff';
  readonly soldier: number;
  readonly gridNo: number;
  readonly battleSound?: 'CURSE1';
}

export interface SwitchActivatedEvent extends SimEventBase {
  readonly type: 'switchActivated';
  readonly soldier: number;
}

export type TrapEvent = TrapSpottedEvent | TrapDisarmedEvent | TrapSetOffEvent | SwitchActivatedEvent;
