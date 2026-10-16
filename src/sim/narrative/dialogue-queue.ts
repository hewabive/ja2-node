// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc HandleDialogue, DialogueEvent::Add, EmptyDialogueQueue, DialogueQueueIsEmpty,
// @src DialogueQueueIsEmptyAndNobodyIsTalking, CanSayQuote, TacticalCharacterDialogue, CharacterDialogue (DialogueEventQuote),
// @src ExecuteCharacterDialogue, GetDialogue, FindDelayForString, TEXT_DELAY_MODIFIER; Tactical/Interface_Dialogue.cc
// @src TalkingMenuDialogue, ProfileCurrentlyTalkingInDialoguePanel; src/externalized/content/Dialogs.cc
// @src GetDialogueTextFilename; Tactical/Faces.cc SetFaceTalking (talking duration without speech); Strategic/Assignments.cc
// @src DialogueEventRemoveEPC. See docs/24 §1.5, §7, §9.4.

import { alternateDialogueFile, mercDialogueFile, npcDialogueFile, type TextKey, textKey } from '../../content/narrative/dialogue-text.ts';
import { NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { TICK_MS } from '../clock.ts';
import { Body, OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import type { NarrativeHost } from './host.ts';
import { ProfileFlag } from './narrative-ids.ts';
import { isNpcOrRpc } from './records.ts';
import type { DialogueEvent } from './talk-state.ts';

export const TEXT_DELAY_MODIFIER_MS = 60;
export const TICKS_PER_CHARACTER = TEXT_DELAY_MODIFIER_MS / TICK_MS;
const CONSCIOUSNESS = 10;
const QUOTE_SERIOUSLY_WOUNDED = 10;

export interface DialogueHandlers {
  handlePendingInitConv(): void;
  deleteTalkingMenu(): void;
  handleNpcItemGiven(npc: number, slot: number): void;
  handleNpcTriggerNpc(npc: number, record: number, show: boolean, approach: number): void;
  handleNpcGotoGridNo(npc: number, gridNo: number, record: number): void;
  handleNpcDoAction(npc: number, code: number, record: number): void;
  triggerNpcRecord(npc: number, record: number): void;
  mikeCheck(): void;
  autoBandage(): boolean;
  removeEpc(npc: number): void;
}

export function addDialogueEvent(host: Pick<NarrativeHost, 'talk'>, e: DialogueEvent): void {
  host.talk.queue.push(e);
}

export function emptyDialogueQueue(host: Pick<NarrativeHost, 'talk'>): void {
  host.talk.queue.length = 0;
  host.talk.waitingForTrigger = false;
}

export function soldierByProfile(host: Pick<NarrativeHost, 'tactical'>, profile: number): Soldier | null {
  const t = host.tactical();
  if (!t || profile === NO_PROFILE) return null;
  return t.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

export function soldierOnPlayerTeam(host: Pick<NarrativeHost, 'tactical'>, profile: number): Soldier | null {
  const t = host.tactical();
  if (!t || profile === NO_PROFILE) return null;
  return t.soldiers.find((s) => s?.placed && s.team === Team.OUR && s.profile === profile) ?? null;
}

export function profileCurrentlyTalkingInDialoguePanel(host: NarrativeHost, profile: number): boolean {
  if (!host.talk.inPanel || host.context.dest === null) return false;
  return host.tactical()?.soldiers[host.context.dest]?.profile === profile;
}

function forcedNpcQuote(host: NarrativeHost, profile: number): boolean {
  return ((host.profile(profile)?.miscFlags ?? 0) & ProfileFlag.FORCENPCQUOTE) !== 0;
}

export function dialogueTextKey(host: NarrativeHost, profile: number, quote: number, alternate: boolean): TextKey {
  if (alternate) return textKey(alternateDialogueFile(profile), quote);
  const usesNpcFile =
    isNpcOrRpc(host, profile) &&
    (!host.recruited(profile) || profileCurrentlyTalkingInDialoguePanel(host, profile) || forcedNpcQuote(host, profile));
  return textKey(usesNpcFile ? npcDialogueFile(profile) : mercDialogueFile(host.voice(profile)), quote);
}

export function characterDialogue(
  host: Pick<NarrativeHost, 'talk'>,
  speaker: number,
  quote: number,
  npcUi: boolean,
  fromSoldier: boolean,
  delayed = false,
  record: number | null = null,
): void {
  addDialogueEvent(host, { kind: 'quote', speaker, quote, npcUi, fromSoldier, delayed, record });
}

export function talkingMenuDialogue(host: Pick<NarrativeHost, 'talk'>, quote: number, record: number | null = null): void {
  characterDialogue(host, host.talk.charNum, quote, true, false, false, record);
}

function isRobot(s: Soldier): boolean {
  return s.bodyType === Body.ROBOTNOWEAPON;
}

export function canSayQuote(s: Soldier, quote: number): boolean {
  if (s.profile === NO_PROFILE) return false;
  const minLife = quote === QUOTE_SERIOUSLY_WOUNDED ? CONSCIOUSNESS : OKLIFE;
  return s.life >= minLife && !isRobot(s);
}

export function tacticalCharacterDialogue(host: NarrativeHost, s: Soldier, quote: number): boolean {
  if (!canSayQuote(s, quote) || host.inMeanwhile()) return false;
  if (s.profile === host.talk.lastQuoteProfile && quote === host.talk.lastQuoteSaid) return false;
  if (host.isEpc(s) && !forcedNpcQuote(host, s.profile)) return false;
  characterDialogue(host, s.profile, quote, false, true);
  return true;
}

function speakerSilenced(s: Soldier, quote: number): boolean {
  if (s.life < CONSCIOUSNESS || isRobot(s)) return true;
  return s.life < OKLIFE && quote !== QUOTE_SERIOUSLY_WOUNDED;
}

export function executeCharacterDialogue(
  host: NarrativeHost,
  speaker: number,
  quote: number,
  npcUi: boolean,
  fromSoldier: boolean,
  record: number | null,
  alternate = false,
): boolean {
  const tick = host.tick();
  host.talk.face = { speaker, busyUntil: tick, pcTrigger: null };
  const s = soldierOnPlayerTeam(host, speaker) ?? host.offSectorPlayerSoldier?.(speaker) ?? null;
  if (!s && fromSoldier) return false;
  if (s && speakerSilenced(s, quote)) return false;
  const key = dialogueTextKey(host, speaker, quote, alternate);
  const chars = host.quoteLengths.chars(key);
  if (chars === 0) return false;
  host.talk.face = { speaker, busyUntil: tick + chars * TICKS_PER_CHARACTER + 1, pcTrigger: null };
  const soldier = (s ?? soldierByProfile(host, speaker))?.id ?? null;
  const withRecord = record !== null ? { record } : {};
  const line = { profile: speaker, quote, ...withRecord, textKey: key, chars };
  host.talk.lines.push(line);
  host.talk.said.push(line);
  if (npcUi) host.emit({ type: 'npcQuote', profile: speaker, soldier, quote, ...withRecord, textKey: key, chars });
  else host.emit({ type: 'mercQuote', soldier: soldier ?? -1, profile: speaker, quote: `quote${quote}`, id: quote, textKey: key, chars });
  return true;
}

function executeQuote(host: NarrativeHost, e: Extract<DialogueEvent, { kind: 'quote' }>): boolean {
  const t = host.tactical();
  if (e.delayed && t && t.turn.currentTeam !== Team.OUR) return true;
  host.talk.lastQuoteSaid = e.quote;
  host.talk.lastQuoteProfile = e.speaker;
  executeCharacterDialogue(host, e.speaker, e.quote, e.npcUi, e.fromSoldier, e.record);
  return false;
}

function executePcTrigger(host: NarrativeHost, e: Extract<DialogueEvent, { kind: 'pcTriggerNpc' }>): boolean {
  executeCharacterDialogue(host, e.speaker, e.quote, false, true, null);
  const face = host.talk.face;
  if (face) face.pcTrigger = { npc: e.npc, record: e.record };
  return false;
}

function execute(host: NarrativeHost, h: DialogueHandlers, e: DialogueEvent): boolean {
  switch (e.kind) {
    case 'quote':
      return executeQuote(host, e);
    case 'closePanel':
      h.deleteTalkingMenu();
      return false;
    case 'giveItem':
      h.handleNpcItemGiven(e.npc, e.slot);
      return false;
    case 'triggerNpc':
      h.handleNpcTriggerNpc(e.npc, e.record, e.show, e.approach);
      return false;
    case 'goto':
      h.handleNpcGotoGridNo(e.npc, e.gridNo, e.record);
      return false;
    case 'doAction':
      h.handleNpcDoAction(e.npc, e.code, e.record);
      return false;
    case 'pcTriggerNpc':
      return executePcTrigger(host, e);
    case 'removeEpc':
      h.removeEpc(e.npc);
      return false;
  }
}

function engagedTransition(host: NarrativeHost): void {
  const talk = host.talk;
  const engaged = host.engaged();
  if (!talk.engagedSeen && engaged) {
    talk.engagedSeen = true;
    host.pauseForConversation(true);
  } else if (talk.engagedSeen && !engaged) {
    talk.engagedSeen = false;
    host.pauseForConversation(false);
  }
}

function faceFinished(host: NarrativeHost, h: DialogueHandlers): boolean {
  const talk = host.talk;
  const face = talk.face;
  if (!face) return true;
  if (host.tick() < face.busyUntil) return false;
  if (face.pcTrigger) {
    talk.referenceCount--;
    h.triggerNpcRecord(face.pcTrigger.npc, face.pcTrigger.record);
  }
  talk.face = null;
  talk.lastQuoteProfile = NO_PROFILE;
  return true;
}

export function handleDialogue(host: NarrativeHost, h: DialogueHandlers): void {
  const talk = host.talk;
  const empty = talk.queue.length === 0;
  if (empty && talk.face === null) h.handlePendingInitConv();
  engagedTransition(host);
  if (!faceFinished(host, h)) return;
  if (empty) {
    h.mikeCheck();
    return;
  }
  const head = talk.queue[0] as DialogueEvent;
  const keep = h.autoBandage() ? false : execute(host, h, head);
  if (!keep && talk.queue.length > 0) talk.queue.shift();
}
