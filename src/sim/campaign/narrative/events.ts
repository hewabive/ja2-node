export interface QuestEventBase {
  readonly tick: number;
}

export interface QuestStartedEvent extends QuestEventBase {
  readonly type: 'questStarted';
  readonly quest: string;
  readonly id: number;
  readonly sector: string | null;
}

export interface QuestFinishedEvent extends QuestEventBase {
  readonly type: 'questFinished';
  readonly quest: string;
  readonly id: number;
  readonly sector: string | null;
}

export type QuestEvent = QuestStartedEvent | QuestFinishedEvent;

type WithoutTick<E> = E extends QuestEventBase ? Omit<E, 'tick'> : never;
export type QuestEventWithoutTick = WithoutTick<QuestEvent>;
