import type { SimEventBase } from '../events.ts';

export interface FirstAidStartedEvent extends SimEventBase {
  readonly type: 'firstAidStarted';
  readonly soldier: number;
  readonly patient: number;
}

export interface FirstAidRefusedEvent extends SimEventBase {
  readonly type: 'firstAidRefused';
  readonly soldier: number;
  readonly patient: number;
}

export interface FirstAidEndedEvent extends SimEventBase {
  readonly type: 'firstAidEnded';
  readonly soldier: number;
  readonly patient: number;
}

export interface BandagedEvent extends SimEventBase {
  readonly type: 'bandaged';
  readonly soldier: number;
  readonly patient: number;
  readonly life: number;
  readonly bleeding: number;
}

export interface FirstAidDoneEvent extends SimEventBase {
  readonly type: 'firstAidDone';
  readonly soldier: number;
  readonly patient: number;
}

export interface OutOfBandagesEvent extends SimEventBase {
  readonly type: 'outOfBandages';
  readonly soldier: number;
}

export interface ItemMovedEvent extends SimEventBase {
  readonly type: 'itemMoved';
  readonly soldier: number;
  readonly item: string;
  readonly count: number;
  readonly from: number | 'ground';
  readonly to: number | 'ground';
  readonly toSoldier?: number;
}

export interface MoneySplitEvent extends SimEventBase {
  readonly type: 'moneySplit';
  readonly soldier: number;
  readonly slot: number;
  readonly to: number;
  readonly toSoldier?: number;
  readonly amount: number;
}

export interface CashWithdrawnEvent extends SimEventBase {
  readonly type: 'cashWithdrawn';
  readonly soldier: number;
  readonly amount: number;
}

export interface CashDepositedEvent extends SimEventBase {
  readonly type: 'cashDeposited';
  readonly soldier: number;
  readonly amount: number;
}

export interface ItemDiscardedEvent extends SimEventBase {
  readonly type: 'itemDiscarded';
  readonly soldier: number;
  readonly item: string;
  readonly count: number;
}

export interface ItemAttachedEvent extends SimEventBase {
  readonly type: 'itemAttached';
  readonly soldier: number;
  readonly item: string;
  readonly to: string;
  readonly result: string;
}

export interface ItemDetachedEvent extends SimEventBase {
  readonly type: 'itemDetached';
  readonly soldier: number;
  readonly item: string;
  readonly from: string;
}

export interface GunUnloadedEvent extends SimEventBase {
  readonly type: 'gunUnloaded';
  readonly soldier: number;
  readonly item: string;
  readonly magazine: string;
  readonly rounds: number;
}

export interface ItemAppliedEvent extends SimEventBase {
  readonly type: 'itemApplied';
  readonly soldier: number;
  readonly target: number;
  readonly item: string;
}

export interface HandsSwappedEvent extends SimEventBase {
  readonly type: 'handsSwapped';
  readonly soldier: number;
}

export type InventoryEvent =
  | FirstAidStartedEvent
  | FirstAidRefusedEvent
  | FirstAidEndedEvent
  | BandagedEvent
  | FirstAidDoneEvent
  | OutOfBandagesEvent
  | ItemMovedEvent
  | MoneySplitEvent
  | CashWithdrawnEvent
  | CashDepositedEvent
  | ItemDiscardedEvent
  | ItemAttachedEvent
  | ItemDetachedEvent
  | GunUnloadedEvent
  | ItemAppliedEvent
  | HandsSwappedEvent;
