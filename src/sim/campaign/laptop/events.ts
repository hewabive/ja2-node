export interface LaptopEventBase {
  readonly tick: number;
}

export interface LaptopOpenedEvent extends LaptopEventBase {
  readonly type: 'laptopOpened';
}

export interface LaptopClosedEvent extends LaptopEventBase {
  readonly type: 'laptopClosed';
}

export type HireSite = 'aim' | 'merc' | 'imp';

export interface MercHiredEvent extends LaptopEventBase {
  readonly type: 'mercHired';
  readonly site: HireSite;
  readonly profile: number;
  readonly soldier: number;
  readonly arrivalMinute: number;
  readonly sector: string;
}

export interface MercArrivedEvent extends LaptopEventBase {
  readonly type: 'mercArrived';
  readonly soldier: number;
  readonly profile: number;
  readonly sector: string;
}

export interface ArrivalReroutedEvent extends LaptopEventBase {
  readonly type: 'arrivalRerouted';
  readonly from: string;
  readonly to: string;
}

export interface LandingZoneResetEvent extends LaptopEventBase {
  readonly type: 'landingZoneReset';
  readonly from: string;
  readonly to: string;
}

export interface EmailReceivedEvent extends LaptopEventBase {
  readonly type: 'emailReceived';
  readonly id: number;
  readonly mail: string;
  readonly sender: number;
}

export interface LaptopHistoryEvent extends LaptopEventBase {
  readonly type: 'historyAdded';
  readonly code: number;
  readonly profile: number;
  readonly sector: string | null;
}

export interface LaptopMoneyEvent extends LaptopEventBase {
  readonly type: 'moneyChanged';
  readonly code: number;
  readonly amount: number;
  readonly balance: number;
}

export interface BobbyRayOpenEvent extends LaptopEventBase {
  readonly type: 'bobbyRayOpen';
}

export interface ShipmentDeliveredEvent extends LaptopEventBase {
  readonly type: 'shipmentDelivered';
  readonly shipment: number;
  readonly sector: string;
  readonly items: number;
  readonly stolen: number;
}

export interface ShipmentLostEvent extends LaptopEventBase {
  readonly type: 'shipmentLost';
  readonly shipment: number;
  readonly reason: 'crashed' | 'prevented' | 'enemyHeld';
}

export interface InsurancePaidEvent extends LaptopEventBase {
  readonly type: 'insurancePaid';
  readonly profile: number;
  readonly amount: number;
}

export interface LaptopMercAccountEvent extends LaptopEventBase {
  readonly type: 'mercAccountStatus';
  readonly status: string;
}

export type LaptopEvent =
  | LaptopOpenedEvent
  | LaptopClosedEvent
  | MercHiredEvent
  | MercArrivedEvent
  | ArrivalReroutedEvent
  | LandingZoneResetEvent
  | EmailReceivedEvent
  | LaptopHistoryEvent
  | LaptopMoneyEvent
  | BobbyRayOpenEvent
  | ShipmentDeliveredEvent
  | ShipmentLostEvent
  | InsurancePaidEvent
  | LaptopMercAccountEvent;

export type LaptopEventWithoutTick = LaptopEvent extends infer E ? (E extends LaptopEvent ? Omit<E, 'tick'> : never) : never;
