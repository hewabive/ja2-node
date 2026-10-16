import type { SimEventBase } from '../../events.ts';

export type BoxingStateName = 'notBoxing' | 'waitingForPlayer' | 'preBoxing' | 'boxing' | 'disqualified' | 'wonRound' | 'lostRound';
export type DisqualificationName = 'outOfRing' | 'nonBoxerInRing' | 'badAttack';

export interface BoxingStateEvent extends SimEventBase {
  readonly type: 'boxingState';
  readonly state: BoxingStateName;
  readonly previous: BoxingStateName;
}

export interface BoxerPickedEvent extends SimEventBase {
  readonly type: 'boxerPicked';
  readonly soldier: number;
  readonly slot: number;
}

export interface BoxingRoundOverEvent extends SimEventBase {
  readonly type: 'boxingRoundOver';
  readonly loser: number;
  readonly result: 'won' | 'lost';
}

export interface BoxerDisqualifiedEvent extends SimEventBase {
  readonly type: 'boxerDisqualified';
  readonly soldier: number | null;
  readonly reason: DisqualificationName;
}

export interface BoxingEndedEvent extends SimEventBase {
  readonly type: 'boxingEnded';
  readonly soldier: number | null;
  readonly result: 'won' | 'lost' | 'disqualified' | null;
}

export type BoxingEvent = BoxingStateEvent | BoxerPickedEvent | BoxingRoundOverEvent | BoxerDisqualifiedEvent | BoxingEndedEvent;
