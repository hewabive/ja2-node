import type { SimEventBase } from '../events.ts';

export interface TrapSpottedEvent extends SimEventBase {
  readonly type: 'trapSpotted';
  readonly soldier: number;
  readonly gridNo: number;
  readonly kind: 'item' | 'ground';
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

export interface MineLocatorEvent extends SimEventBase {
  readonly type: 'mineLocator';
  readonly gridNo: number;
  readonly level: number;
}

export interface BombPlantedEvent extends SimEventBase {
  readonly type: 'bombPlanted';
  readonly soldier: number;
  readonly gridNo: number;
  readonly item: string;
}

export interface BombFumbledEvent extends SimEventBase {
  readonly type: 'bombFumbled';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface PitOpenedEvent extends SimEventBase {
  readonly type: 'pitOpened';
  readonly gridNo: number;
}

export interface FellIntoPitEvent extends SimEventBase {
  readonly type: 'fellIntoPit';
  readonly soldier: number;
  readonly gridNo: number;
}

export type TrapEvent =
  | TrapSpottedEvent
  | TrapDisarmedEvent
  | TrapSetOffEvent
  | SwitchActivatedEvent
  | MineLocatorEvent
  | BombPlantedEvent
  | BombFumbledEvent
  | PitOpenedEvent
  | FellIntoPitEvent;
