import type { SimEventBase } from '../events.ts';

export interface StealthChangedEvent extends SimEventBase {
  readonly type: 'stealthChanged';
  readonly soldier: number;
  readonly on: boolean;
}

export interface SquadStealthChangedEvent extends SimEventBase {
  readonly type: 'squadStealthChanged';
  readonly soldiers: readonly number[];
  readonly on: boolean;
}

export interface MuteChangedEvent extends SimEventBase {
  readonly type: 'muteChanged';
  readonly soldier: number;
  readonly on: boolean;
}

export interface PlacesSwappedEvent extends SimEventBase {
  readonly type: 'placesSwapped';
  readonly soldier: number;
  readonly with: number;
  readonly gridNo: number;
}

export interface NoPathForMercEvent extends SimEventBase {
  readonly type: 'noPathForMerc';
  readonly soldier: number;
  readonly to: number;
}

export type OrderEvent = StealthChangedEvent | SquadStealthChangedEvent | MuteChangedEvent | PlacesSwappedEvent | NoPathForMercEvent;
