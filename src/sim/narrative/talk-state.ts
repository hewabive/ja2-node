// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc gTalkPanel.ubCharNum, gfInTalkPanel, gpSrcSoldier, gpDestSoldier,
// @src gubSrcSoldierProfile, gubNiceNPCProfile, gubNastyNPCProfile, gubTargetNPC, gubTargetRecord, gubTargetApproach,
// @src gfShowDialogueMenu, gfWaitingForTriggerTimer, guiWaitingForTriggerTime, gfConversationPending and the pending
// @src soldiers; Dialogue_Control.cc ghDialogueQ, gpCurrentTalkingFace,
// @src gubCurrentTalkingID, giNPCReferenceCount, fOldEngagedInConvFlagOn; TacticalAI/NPC.cc giNPCSpecialReferenceCount;
// @src Overhead_Types.h ubLastQuoteSaid, ubLastQuoteProfileNUm. See docs/24 §0, §7, docs/25 §1.4.

import type { TextKey } from '../../content/narrative/dialogue-text.ts';
import { NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { Rng } from '../../core/rng.ts';
import type { ItemObject } from '../items/object.ts';

export interface TalkContext {
  src: number | null;
  dest: number | null;
  srcProfile: number;
}

export function createTalkContext(): TalkContext {
  return { src: null, dest: null, srcProfile: NO_PROFILE };
}

export type GiftObject = ItemObject;

export type DialogueEvent =
  | {
      readonly kind: 'quote';
      readonly speaker: number;
      readonly quote: number;
      readonly npcUi: boolean;
      readonly fromSoldier: boolean;
      readonly delayed: boolean;
      readonly record: number | null;
      readonly alternate?: boolean;
    }
  | { readonly kind: 'closePanel' }
  | { readonly kind: 'giveItem'; readonly npc: number; readonly slot: number }
  | { readonly kind: 'triggerNpc'; readonly npc: number; readonly record: number; readonly approach: number; readonly show: boolean }
  | { readonly kind: 'goto'; readonly npc: number; readonly gridNo: number; readonly record: number }
  | { readonly kind: 'doAction'; readonly npc: number; readonly code: number; readonly record: number }
  | { readonly kind: 'pcTriggerNpc'; readonly speaker: number; readonly quote: number; readonly npc: number; readonly record: number }
  | { readonly kind: 'removeEpc'; readonly npc: number }
  | { readonly kind: 'callback'; readonly name: string };

export interface TalkingFace {
  readonly speaker: number;
  readonly saidAt: number;
  readonly busyUntil: number;
  pcTrigger: { readonly npc: number; readonly record: number } | null;
}

export interface PendingConversation {
  readonly dest: number;
  readonly src: number | null;
  readonly approach: number;
  readonly record: number;
  readonly object: GiftObject | null;
  readonly initiatedBy: 'player' | 'npc';
}

export interface TriggerTarget {
  readonly npc: number;
  readonly record: number;
  readonly approach: number;
  readonly show: boolean;
}

export interface SpokenLine {
  readonly profile: number;
  readonly quote: number;
  readonly record?: number;
  readonly textKey: TextKey;
  readonly chars: number;
}

export interface TalkState {
  readonly queue: DialogueEvent[];
  face: TalkingFace | null;
  lastQuoteSaid: number;
  lastQuoteProfile: number;
  engagedSeen: boolean;
  inPanel: boolean;
  charNum: number;
  initiatedBy: 'player' | 'npc';
  pending: PendingConversation | null;
  trigger: TriggerTarget | null;
  waitingForTrigger: boolean;
  triggerWaitStart: number;
  referenceCount: number;
  specialReferenceCount: number;
  niceNpc: number;
  nastyNpc: number;
  readonly lines: SpokenLine[];
  readonly fx: Rng;
}

const COSMETIC_SEED = 0x7a1c;

export function createTalkState(seed = 0): TalkState {
  return {
    queue: [],
    face: null,
    lastQuoteSaid: 0,
    lastQuoteProfile: NO_PROFILE,
    engagedSeen: false,
    inPanel: false,
    charNum: NO_PROFILE,
    initiatedBy: 'player',
    pending: null,
    trigger: null,
    waitingForTrigger: false,
    triggerWaitStart: 0,
    referenceCount: 0,
    specialReferenceCount: 0,
    niceNpc: NO_PROFILE,
    nastyNpc: NO_PROFILE,
    lines: [],
    fx: Rng.fromSeed(seed ^ COSMETIC_SEED),
  };
}

export function dialogueQueueIsEmptyAndNobodyIsTalking(talk: TalkState): boolean {
  return talk.face === null && talk.queue.length === 0;
}

export function dialogueIdle(talk: TalkState): boolean {
  return dialogueQueueIsEmptyAndNobodyIsTalking(talk) && !talk.waitingForTrigger && talk.pending === null;
}
