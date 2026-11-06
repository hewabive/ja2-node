import type { SimEventBase } from '../events.ts';
import type { AutoBandageRefusal } from './auto-bandage.ts';

export interface AutoBandageStartedEvent extends SimEventBase {
  readonly type: 'autoBandageStarted';
  readonly medics: readonly number[];
  readonly patients: readonly number[];
}

export interface AutoBandageCompleteEvent extends SimEventBase {
  readonly type: 'autoBandageComplete';
}

export interface AutoBandageEndedEvent extends SimEventBase {
  readonly type: 'autoBandageEnded';
  readonly failed: boolean;
  readonly worldSecondsWarped: number;
}

export interface AutoBandageRefusedEvent extends SimEventBase {
  readonly type: 'autoBandageRefused';
  readonly refusal: AutoBandageRefusal;
}

export type AutoBandageEvent = AutoBandageStartedEvent | AutoBandageCompleteEvent | AutoBandageEndedEvent | AutoBandageRefusedEvent;
