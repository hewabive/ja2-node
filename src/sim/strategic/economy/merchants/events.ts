import type { SimEventBase } from '../../../events.ts';

export interface ShopItemRef {
  readonly item: string;
  readonly count: number;
  readonly status: number;
}

export interface ShopOpenedEvent extends SimEventBase {
  readonly type: 'shopOpened';
  readonly dealer: number;
  readonly soldier: number;
}

export interface ShopkeeperQuoteEvent extends SimEventBase {
  readonly type: 'shopkeeperQuote';
  readonly dealer: number;
  readonly quote: number;
}

export interface RepairDelayedEvent extends SimEventBase {
  readonly type: 'repairDelayed';
  readonly dealer: number;
}

export interface ItemsBoughtEvent extends SimEventBase {
  readonly type: 'itemsBought';
  readonly dealer: number;
  readonly items: readonly ShopItemRef[];
  readonly total: number;
}

export interface ItemsSoldEvent extends SimEventBase {
  readonly type: 'itemsSold';
  readonly dealer: number;
  readonly items: readonly ShopItemRef[];
  readonly total: number;
}

export interface GiftGivenEvent extends SimEventBase {
  readonly type: 'giftGiven';
  readonly dealer: number;
  readonly amount: number;
  readonly accepted: boolean;
}

export interface RepairQueuedEvent extends SimEventBase {
  readonly type: 'repairQueued';
  readonly dealer: number;
  readonly item: string;
  readonly owner: number;
  readonly doneAt: number;
}

export interface RepairCollectedEvent extends SimEventBase {
  readonly type: 'repairCollected';
  readonly dealer: number;
  readonly item: string;
  readonly owner: number;
  readonly to: number | null;
}

export interface ItemsDroppedEvent extends SimEventBase {
  readonly type: 'itemsDropped';
  readonly gridNo: number;
  readonly items: readonly ShopItemRef[];
}

export interface ShopMoneyChangedEvent extends SimEventBase {
  readonly type: 'moneyChanged';
  readonly code: number;
  readonly amount: number;
  readonly balance: number;
}

export interface ShopClosedEvent extends SimEventBase {
  readonly type: 'shopClosed';
  readonly dealer: number;
}

export type ShopEvent =
  | ShopOpenedEvent
  | ShopkeeperQuoteEvent
  | RepairDelayedEvent
  | ItemsBoughtEvent
  | ItemsSoldEvent
  | GiftGivenEvent
  | RepairQueuedEvent
  | RepairCollectedEvent
  | ItemsDroppedEvent
  | ShopMoneyChangedEvent
  | ShopClosedEvent;
