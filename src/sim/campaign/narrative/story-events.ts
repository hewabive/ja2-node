export interface StoryEventBase {
  readonly tick: number;
}

export interface MeanwhileResolvedEvent extends StoryEventBase {
  readonly type: 'meanwhile';
  readonly seq: number;
  readonly scene: string;
  readonly sector: string;
  readonly at: number;
}

export interface MeanwhileStartedEvent extends StoryEventBase {
  readonly type: 'meanwhileStarted';
  readonly seq: number;
  readonly scene: string;
}

export interface MeanwhileEndedEvent extends StoryEventBase {
  readonly type: 'meanwhileEnded';
  readonly seq: number;
  readonly scene: string;
}

export interface PowsFoundEvent extends StoryEventBase {
  readonly type: 'powsFound';
  readonly sector: string;
  readonly soldiers: readonly number[];
}

export interface PowFreedEvent extends StoryEventBase {
  readonly type: 'powFreed';
  readonly soldier: number;
  readonly sector: string;
}

export interface QueenKilledEvent extends StoryEventBase {
  readonly type: 'queenKilled';
  readonly sector: string;
  readonly gridNo: number;
  readonly level: number;
  readonly killer: number | null;
}

export interface SquadMovedUpstairsEvent extends StoryEventBase {
  readonly type: 'squadMovedUpstairs';
  readonly soldiers: readonly number[];
  readonly sector: string;
}

export interface EndgameDeferredEvent extends StoryEventBase {
  readonly type: 'endgameDeferred';
  readonly reason: 'creatures';
}

export interface CreatureQueenKilledEvent extends StoryEventBase {
  readonly type: 'creatureQueenKilled';
  readonly killer: number | null;
}

export interface EndingView {
  readonly miguelAlive: boolean;
  readonly skyriderAlive: boolean;
}

export interface CampaignWonEvent extends StoryEventBase {
  readonly type: 'campaignWon';
  readonly day: number;
  readonly worldTime: number;
  readonly difficulty: number;
  readonly sciFi: boolean;
  readonly ending: EndingView;
  readonly mercDeaths: number;
}

export interface StatueOpenedEvent extends StoryEventBase {
  readonly type: 'statueOpened';
  readonly sector: string;
  readonly destroyed: boolean;
}

export interface RemoteUsedEvent extends StoryEventBase {
  readonly type: 'remoteUsed';
  readonly soldier: number;
  readonly result: 'statueOpened' | 'nothing';
}

export type StoryEvent =
  | MeanwhileResolvedEvent
  | MeanwhileStartedEvent
  | MeanwhileEndedEvent
  | PowsFoundEvent
  | PowFreedEvent
  | QueenKilledEvent
  | SquadMovedUpstairsEvent
  | EndgameDeferredEvent
  | CreatureQueenKilledEvent
  | CampaignWonEvent
  | StatueOpenedEvent
  | RemoteUsedEvent;

type WithoutTick<E> = E extends StoryEventBase ? Omit<E, 'tick'> : never;
export type StoryEventWithoutTick = WithoutTick<StoryEvent>;
