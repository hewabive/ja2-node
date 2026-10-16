import type { TextKey } from '../../content/narrative/dialogue-text.ts';
import type { MercQuoteEvent } from '../campaign/contracts/events.ts';
import type { SimEventBase } from '../events.ts';

export interface ConversationOpenedEvent extends SimEventBase {
  readonly type: 'conversationOpened';
  readonly npc: number;
  readonly profile: number;
  readonly talker: number | null;
  readonly initiatedBy: 'player' | 'npc';
}

export interface ConversationClosedEvent extends SimEventBase {
  readonly type: 'conversationClosed';
  readonly npc: number | null;
  readonly profile: number;
  readonly by: 'player' | 'script';
}

export interface NpcQuoteEvent extends SimEventBase {
  readonly type: 'npcQuote';
  readonly profile: number;
  readonly soldier: number | null;
  readonly quote: number;
  readonly record?: number;
  readonly textKey: TextKey;
  readonly chars: number;
}

export interface NpcMessageEvent extends SimEventBase {
  readonly type: 'npcMessage';
  readonly kind: string;
  readonly profile?: number;
  readonly amount?: number;
}

export interface ScriptedSequenceEvent extends SimEventBase {
  readonly type: 'scriptedSequence';
  readonly active: boolean;
}

export interface TalkAbortedEvent extends SimEventBase {
  readonly type: 'talkAborted';
  readonly soldier: number;
  readonly reason: string;
}

export type NarrativeEvent =
  | ConversationOpenedEvent
  | ConversationClosedEvent
  | NpcQuoteEvent
  | NpcMessageEvent
  | ScriptedSequenceEvent
  | TalkAbortedEvent;

type Emitted = NarrativeEvent | MercQuoteEvent;

export type NarrativeEventWithoutTick = Emitted extends infer E ? (E extends Emitted ? Omit<E, 'tick'> : never) : never;
