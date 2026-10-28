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
  readonly skipped?: boolean;
}

export interface LineCutEvent extends SimEventBase {
  readonly type: 'lineCut';
  readonly profile: number;
  readonly saidAt: number;
  readonly tail: boolean;
}

export interface CivQuoteEvent extends SimEventBase {
  readonly type: 'civQuote';
  readonly soldier: number;
  readonly quote: number;
  readonly entry: number;
  readonly hint: boolean;
  readonly textKey: TextKey;
  readonly chars: number;
}

export interface SurrenderOfferedEvent extends SimEventBase {
  readonly type: 'surrenderOffered';
  readonly soldier: number;
  readonly prompt: string;
}

export interface NpcMessageEvent extends SimEventBase {
  readonly type: 'npcMessage';
  readonly kind: string;
  readonly profile?: number;
  readonly amount?: number;
  readonly item?: string;
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

export interface GivenItemRef {
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly money?: number;
}

export interface ItemGivenEvent extends SimEventBase, GivenItemRef {
  readonly type: 'itemGiven';
  readonly soldier: number;
  readonly target: number;
  readonly dropped: boolean;
}

export interface GiveAbortedEvent extends SimEventBase {
  readonly type: 'giveAborted';
  readonly soldier: number;
  readonly target: number;
  readonly reason: 'targetMoved' | 'otherSoldierThere' | 'notAtTarget';
  readonly dropped: boolean;
}

export interface NpcTookItemEvent extends SimEventBase, GivenItemRef {
  readonly type: 'npcTookItem';
  readonly npc: number | null;
  readonly profile: number;
  readonly from: number | null;
}

export interface ItemReturnedEvent extends SimEventBase, GivenItemRef {
  readonly type: 'itemReturned';
  readonly to: number;
  readonly dropped: boolean;
}

export interface NpcGaveItemEvent extends SimEventBase, GivenItemRef {
  readonly type: 'npcGaveItem';
  readonly npc: number;
  readonly profile: number;
  readonly to: number | null;
  readonly dropped: boolean;
}

export interface SexSceneEvent extends SimEventBase {
  readonly type: 'sexScene';
  readonly soldier: number;
}

export interface AlarmEvent extends SimEventBase {
  readonly type: 'alarm';
  readonly gridNo: number;
  readonly kind: 'kingpin' | 'museum';
}

export type GiveEvent = ItemGivenEvent | GiveAbortedEvent | NpcTookItemEvent | ItemReturnedEvent | NpcGaveItemEvent;

export type NarrativeEvent =
  | ConversationOpenedEvent
  | ConversationClosedEvent
  | NpcQuoteEvent
  | LineCutEvent
  | CivQuoteEvent
  | SurrenderOfferedEvent
  | NpcMessageEvent
  | ScriptedSequenceEvent
  | TalkAbortedEvent
  | GiveEvent
  | SexSceneEvent
  | AlarmEvent;

type Emitted = NarrativeEvent | MercQuoteEvent;

export type NarrativeEventWithoutTick = Emitted extends infer E ? (E extends Emitted ? Omit<E, 'tick'> : never) : never;
