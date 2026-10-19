import type { TextKey } from '../../../content/narrative/dialogue-text.ts';
import type { SimEventBase } from '../../events.ts';

export type HoverStage = 'started' | 'long' | 'tooLong';
export type SkyriderTopic = 'drassenSam' | 'cambriaHospital' | 'otherSams' | 'estoniRefuel';

export interface HelicopterSetUpEvent extends SimEventBase {
  readonly type: 'helicopterSetUp';
  readonly sector: string;
}

export interface SkyriderQuoteEvent extends SimEventBase {
  readonly type: 'skyriderQuote';
  readonly quote: number;
  readonly profile?: number;
  readonly textKey?: TextKey;
  readonly chars?: number;
}

export interface HeliTakeOffEvent extends SimEventBase {
  readonly type: 'heliTakeOff';
  readonly sector: string;
}

export interface HeliArrivedEvent extends SimEventBase {
  readonly type: 'heliArrived';
  readonly sector: string;
  readonly hostile: boolean;
}

export interface HeliHoveringEvent extends SimEventBase {
  readonly type: 'heliHovering';
  readonly sector: string;
  readonly stage: HoverStage;
}

export interface HeliReturningEvent extends SimEventBase {
  readonly type: 'heliReturning';
  readonly to: string;
  readonly safe: boolean;
}

export interface HeliLandedEvent extends SimEventBase {
  readonly type: 'heliLanded';
  readonly sector: string;
}

export interface HeliHitEvent extends SimEventBase {
  readonly type: 'heliHit';
  readonly sector: string;
  readonly hits: number;
}

export interface HeliDestroyedEvent extends SimEventBase {
  readonly type: 'heliDestroyed';
  readonly sector: string;
  readonly killed: readonly number[];
}

export interface HeliPaidEvent extends SimEventBase {
  readonly type: 'heliPaid';
  readonly amount: number;
  readonly balance: number;
}

export interface HeliOwedEvent extends SimEventBase {
  readonly type: 'heliOwed';
  readonly amount: number;
}

export interface HeliEmptyHintEvent extends SimEventBase {
  readonly type: 'heliEmptyHint';
  readonly sector: string;
}

export interface EnemiesSpottedFromAirEvent extends SimEventBase {
  readonly type: 'enemiesSpottedFromAir';
  readonly sector: string;
}

export interface SamSitesRevealedEvent extends SimEventBase {
  readonly type: 'samSitesRevealed';
  readonly sites: readonly string[];
}

export interface SkyriderMonologueEvent extends SimEventBase {
  readonly type: 'skyriderMonologue';
  readonly topic: SkyriderTopic;
}

export interface PassengersDroppedEvent extends SimEventBase {
  readonly type: 'passengersDropped';
  readonly sector: string;
  readonly soldiers: readonly number[];
  readonly squad: number;
}

export interface VehicleBoardedEvent extends SimEventBase {
  readonly type: 'vehicleBoarded';
  readonly soldier: number;
  readonly vehicle: number;
}

export interface VehicleLeftEvent extends SimEventBase {
  readonly type: 'vehicleLeft';
  readonly soldier: number;
  readonly vehicle: number;
}

export type ArrivedWho =
  | { readonly kind: 'merc'; readonly soldier: number }
  | { readonly kind: 'squad'; readonly squad: number }
  | { readonly kind: 'vehicle'; readonly vehicleType: number };

export interface GroupArrivedEvent extends SimEventBase {
  readonly type: 'groupArrived';
  readonly group: number;
  readonly sector: string;
  readonly final: boolean;
  readonly who: ArrivedWho;
}

export type InvasionKind = 'sam' | 'town' | 'other';

export interface InvasionEvent extends SimEventBase {
  readonly type: 'invasion';
  readonly sector: string;
  readonly kind: InvasionKind;
}

export type HelicopterEvent =
  | HelicopterSetUpEvent
  | GroupArrivedEvent
  | InvasionEvent
  | SkyriderQuoteEvent
  | HeliTakeOffEvent
  | HeliArrivedEvent
  | HeliHoveringEvent
  | HeliReturningEvent
  | HeliLandedEvent
  | HeliHitEvent
  | HeliDestroyedEvent
  | HeliPaidEvent
  | HeliOwedEvent
  | HeliEmptyHintEvent
  | EnemiesSpottedFromAirEvent
  | SamSitesRevealedEvent
  | SkyriderMonologueEvent
  | PassengersDroppedEvent
  | VehicleBoardedEvent
  | VehicleLeftEvent;

export type HelicopterEventWithoutTick = HelicopterEvent extends infer E ? (E extends HelicopterEvent ? Omit<E, 'tick'> : never) : never;
