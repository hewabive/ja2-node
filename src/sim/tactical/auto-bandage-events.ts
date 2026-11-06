import type { SimEventBase } from '../events.ts';

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

export type AutoBandageEvent = AutoBandageStartedEvent | AutoBandageCompleteEvent | AutoBandageEndedEvent;
