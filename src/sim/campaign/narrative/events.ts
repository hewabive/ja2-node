export interface NarrativeEventBase {
  readonly tick: number;
}

export interface QuestStartedEvent extends NarrativeEventBase {
  readonly type: 'questStarted';
  readonly quest: string;
  readonly id: number;
  readonly sector: string | null;
}

export interface QuestFinishedEvent extends NarrativeEventBase {
  readonly type: 'questFinished';
  readonly quest: string;
  readonly id: number;
  readonly sector: string | null;
}

export type NarrativeEvent = QuestStartedEvent | QuestFinishedEvent;

type WithoutTick<E> = E extends NarrativeEventBase ? Omit<E, 'tick'> : never;
export type NarrativeEventWithoutTick = WithoutTick<NarrativeEvent>;
