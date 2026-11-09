// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc HandleDialogue (with the end of a line's map screen pause),
// @src DialogueEvent::Add, EmptyDialogueQueue, DialogueQueueIsEmpty, DialogueQueueIsEmptyAndNobodyIsTalking, CanSayQuote,
// @src TacticalCharacterDialogue (with the ME_TOO bleeding line), BeginLoggingForBleedMeToos, CharacterDialogue
// @src (DialogueEventQuote, with the map screen pause under LOCK_PAUSE_MERC_TALKING and the sleeping speaker's wake),
// @src MakeCharacterDialogueEventSleep, CharacterDialogueUsingAlternateFile,
// @src ExecuteCharacterDialogue, GetDialogue, FindDelayForString, TEXT_DELAY_MODIFIER; Tactical/Interface_Dialogue.cc
// @src TalkingMenuDialogue, ProfileCurrentlyTalkingInDialoguePanel; src/externalized/content/Dialogs.cc
// @src GetDialogueTextFilename; Tactical/Faces.cc SetFaceTalking (talking duration without speech), InternalShutupaYoFace
// @src (a line cut short by StopAnyCurrentlyTalkingSpeech or DialogueAdvanceSpeech), HandleTalkingAutoFace and
// @src SetupFinalTalkingDelay (300 ms with the mouth closed after the voice or the text duration), SetFaceTalking (a line
// @src lasts as long as its sample with speech on, its text without); Strategic/Assignments.cc
// @src DialogueEventRemoveEPC; Overhead.cc MakeCharacterDialogueEventSignalItemLocatorStart (the slide to its location,
// @src 2026-11-03); Dialogue_Control.cc
// @src HandleImportantMercQuote, CreateTalkingUI (the DIALOGUE_EXTERNAL_NPC_UI faces of Skyrider and the head miners)
// @src and DialogueEvent::Execute returning true for a special event that waits (2026-11-01); SaveLoadGame.cc
// @src LoadSavedGame (EmptyDialogueQueue and StopAnyCurrentlyTalkingSpeech, the silenced face ending at the next
// @src HandleDialogue, 2026-11-04); Dialogue_Control.cc gusStopTimeQuoteList, IsStopTimeQuote, CheckForStopTimeQuotes,
// @src SetStopTimeQuoteCallback, HandleDialogue (FACE_MODAL), GameScreen.cc EnterModalTactical, EndModalTactical and
// @src MainGameScreenHandle (one more full frame after the modal starts, then HandleModalTactical, 2026-11-04);
// @src Dialogue_Control.cc HandleExternNPCSpeechFace and DisplayTextForExternalNPC (an external line takes the panel
// @src placement set since the last line ended), HandleDialogueEnd (the default placement again, 2026-11-09);
// @src RenderFaceOverlay (an external speaker's soldier, FindSoldierByProfileID, picks the popup's panel, 2026-11-09).

import { alternateDialogueFile, mercDialogueFile, npcDialogueFile, type TextKey, textKey } from '../../content/narrative/dialogue-text.ts';
import { NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { i8 } from '../../core/int.ts';
import { TICK_MS } from '../clock.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { Body, NOWHERE, OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import type { NarrativeEventWithoutTick } from './events.ts';
import type { NarrativeHost } from './host.ts';
import { NarrativeProfile, ProfileFlag } from './narrative-ids.ts';
import { isNpcOrRpc } from './records.ts';
import { type DialogueEvent, TacticalModal, type TalkState } from './talk-state.ts';

export const TEXT_DELAY_MODIFIER_MS = 60;
export const TICKS_PER_CHARACTER = TEXT_DELAY_MODIFIER_MS / TICK_MS;
export const FINAL_TALKING_DELAY_MS = 300;
export const FINAL_TALKING_DELAY_TICKS = FINAL_TALKING_DELAY_MS / TICK_MS;

export function lineTicks(chars: number): number {
  return chars * TICKS_PER_CHARACTER + 1 + FINAL_TALKING_DELAY_TICKS;
}

export function voicedLineTicks(voiceMs: number): number {
  return Math.ceil(voiceMs / TICK_MS) + FINAL_TALKING_DELAY_TICKS;
}

function talkingTicks(host: NarrativeHost, speaker: number, textKey: TextKey, chars: number): number {
  const recruitedNpcOrRpc = isNpcOrRpc(host, speaker) && host.recruited(speaker);
  const voiceMs = host.voiceLengths.ms({ profile: speaker, textKey, recruitedNpcOrRpc });
  return voiceMs === null ? lineTicks(chars) : Math.max(voicedLineTicks(voiceMs), lineTicks(chars));
}
const CONSCIOUSNESS = 10;
const QUOTE_SPOTTED_SOMETHING_ONE = 11;
const SPOTTED_SOMETHING_QUOTES = 2;
const STOP_TIME_QUOTES: ReadonlySet<number> = new Set([MercQuote.BOOBYTRAP_ITEM, MercQuote.SUSPICIOUS_GROUND]);

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
  callback(name: string, args: readonly number[]): boolean;
}

interface LineUi {
  readonly npcUi: boolean;
  readonly fromSoldier: boolean;
  readonly record: number | null;
  readonly alternate?: boolean;
  readonly subject?: number;
  readonly external?: boolean;
}

const MERC_LINE: LineUi = { npcUi: false, fromSoldier: true, record: null };

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

function playerTeamSoldier(host: NarrativeHost, profile: number): Soldier | null {
  return soldierOnPlayerTeam(host, profile) ?? host.offSectorPlayerSoldier?.(profile) ?? null;
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

export function characterDialogueUsingAlternateFile(host: Pick<NarrativeHost, 'talk'>, speaker: number, quote: number): void {
  addDialogueEvent(host, { kind: 'quote', speaker, quote, npcUi: false, fromSoldier: true, delayed: false, record: null, alternate: true });
}

function mercLine(host: Pick<NarrativeHost, 'talk'>, s: Soldier, quote: number, delayed: boolean, subject?: number): void {
  const about = subject !== undefined ? { subject } : {};
  addDialogueEvent(host, { kind: 'quote', speaker: s.profile, quote, npcUi: false, fromSoldier: true, delayed, record: null, ...about });
}

export function externalNpcDialogue(host: Pick<NarrativeHost, 'talk'>, profile: number, quote: number): void {
  addDialogueEvent(host, {
    kind: 'quote',
    speaker: profile,
    quote,
    npcUi: false,
    fromSoldier: false,
    delayed: false,
    record: null,
    external: true,
  });
}

export function signalItemLocatorStart(host: Pick<NarrativeHost, 'talk'>, s: Soldier, gridNo: number): void {
  addDialogueEvent(host, { kind: 'itemLocator', speaker: s.profile, gridNo });
}

export function talkingMenuDialogue(host: Pick<NarrativeHost, 'talk'>, quote: number, record: number | null = null): void {
  characterDialogue(host, host.talk.charNum, quote, true, false, false, record);
}

function isRobot(s: Soldier): boolean {
  return s.bodyType === Body.ROBOTNOWEAPON;
}

function heldPrisoner(host: Pick<NarrativeHost, 'assignment'>, s: Soldier): boolean {
  return host.assignment?.(s) === Assignment.ASSIGNMENT_POW;
}

export function canSayQuote(host: NarrativeHost, s: Soldier, quote: number): boolean {
  if (s.profile === NO_PROFILE) return false;
  const minLife = quote === MercQuote.SERIOUSLY_WOUNDED ? CONSCIOUSNESS : OKLIFE;
  if (s.life < minLife || isRobot(s)) return false;
  return !s.gassed && !heldPrisoner(host, s);
}

export function delayedTacticalCharacterDialogue(host: NarrativeHost, s: Soldier, quote: number): boolean {
  if (!canSayQuote(host, s, quote)) return false;
  mercLine(host, s, quote, true);
  return true;
}

export function beginLoggingForBleedMeToos(talk: TalkState, on: boolean): void {
  talk.meTooBleedLog = on ? 1 : 0;
}

function bleedingLineOrMeToo(talk: TalkState, quote: number): number {
  if (quote !== MercQuote.STARTING_TO_BLEED || talk.meTooBleedLog === 0) return quote;
  const said = talk.meTooBleedLog > 1 ? MercQuote.ME_TOO : quote;
  talk.meTooBleedLog = i8(talk.meTooBleedLog + 1);
  return said;
}

export function tacticalCharacterDialogue(host: NarrativeHost, s: Soldier, quote: number, subject?: number): boolean {
  if (!canSayQuote(host, s, quote) || host.inMeanwhile()) return false;
  if (s.profile === host.talk.lastQuoteProfile && quote === host.talk.lastQuoteSaid) return false;
  if (host.isEpc(s) && !forcedNpcQuote(host, s.profile)) return false;
  mercLine(host, s, bleedingLineOrMeToo(host.talk, quote), false, subject);
  return true;
}

export function makeCharacterDialogueEventSleep(host: Pick<NarrativeHost, 'talk'>, s: Soldier, asleep: boolean): void {
  addDialogueEvent(host, asleep ? { kind: 'backToSleep', speaker: s.profile } : { kind: 'wakeUp', speaker: s.profile });
}

export function handleImportantMercQuote(host: NarrativeHost, s: Soldier, quote: number, subject?: number): void {
  const asleep = host.mercAsleep?.(s) ?? false;
  if (asleep) makeCharacterDialogueEventSleep(host, s, false);
  tacticalCharacterDialogue(host, s, quote, subject);
  if (asleep) makeCharacterDialogueEventSleep(host, s, true);
}

function speakerSilenced(host: NarrativeHost, s: Soldier, quote: number): boolean {
  if (s.life < CONSCIOUSNESS || s.gassed || isRobot(s)) return true;
  if (s.life < OKLIFE && quote !== MercQuote.SERIOUSLY_WOUNDED) return true;
  return heldPrisoner(host, s);
}

interface SaidLine {
  readonly record?: number;
  readonly textKey: TextKey;
  readonly chars: number;
  readonly skipped?: boolean;
}

function externalLineEvent(
  host: NarrativeHost,
  speaker: number,
  quote: number,
  soldier: number | null,
  said: SaidLine,
): NarrativeEventWithoutTick {
  const panel = host.talk.externPanel;
  const withSoldier = soldier === null ? said : { ...said, soldier };
  const placed = panel ? { ...withSoldier, panel } : withSoldier;
  if (speaker === NarrativeProfile.SKYRIDER) return { type: 'skyriderQuote', quote, profile: speaker, ...placed };
  return { type: 'headMinerQuote', mine: host.headMinerMine?.(speaker) ?? -1, profile: speaker, quote, ...placed };
}

function lineEvent(host: NarrativeHost, speaker: number, quote: number, soldier: number | null, ui: LineUi, said: SaidLine) {
  if (ui.external) return externalLineEvent(host, speaker, quote, soldier, said);
  if (ui.npcUi) return { type: 'npcQuote', profile: speaker, soldier, quote, ...said } as const;
  const about = ui.subject !== undefined ? { subject: ui.subject } : {};
  return { type: 'mercQuote', soldier: soldier ?? -1, profile: speaker, quote: `quote${quote}`, id: quote, ...about, ...said } as const;
}

export function executeCharacterDialogue(host: NarrativeHost, speaker: number, quote: number, ui: LineUi): boolean {
  const tick = host.tick();
  host.talk.face = { speaker, saidAt: tick, busyUntil: tick, pcTrigger: null, modal: false };
  const s = playerTeamSoldier(host, speaker);
  if (!s && ui.fromSoldier) return false;
  if (s && speakerSilenced(host, s, quote)) return false;
  const key = dialogueTextKey(host, speaker, quote, ui.alternate ?? false);
  const chars = host.quoteLengths.chars(key);
  if (chars === 0) return false;
  const skipped = host.skipsSpeech?.() ?? false;
  const busyUntil = skipped ? tick : tick + talkingTicks(host, speaker, key, chars);
  host.talk.face = { speaker, saidAt: tick, busyUntil, pcTrigger: null, modal: false };
  const soldier = (s ?? soldierByProfile(host, speaker))?.id ?? null;
  const withRecord = ui.record !== null ? { record: ui.record } : {};
  const said = { ...withRecord, textKey: key, chars, ...(skipped ? { skipped } : {}) };
  host.talk.lines.push({ profile: speaker, quote, ...withRecord, textKey: key, chars });
  host.emit(lineEvent(host, speaker, quote, soldier, ui, said));
  return true;
}

export function cutTalkingFace(talk: TalkState, tick: number): boolean {
  const face = talk.face;
  if (!face || face.busyUntil <= tick) return false;
  talk.face = { ...face, busyUntil: tick };
  return true;
}

export function finishTalking(talk: TalkState, tick: number): boolean {
  return cutTalkingFace(talk, tick + FINAL_TALKING_DELAY_TICKS);
}

function wakeSpeakerForHisLine(host: NarrativeHost, speaker: number): void {
  const s = playerTeamSoldier(host, speaker);
  if (!s || !host.mercAsleep?.(s)) return;
  host.setMercAsleepFlag?.(s, false);
  addDialogueEvent(host, { kind: 'backToSleep', speaker });
}

function pauseMapScreenForLine(host: NarrativeHost): void {
  if (!host.inMapMode?.() || host.gamePaused?.()) return;
  host.pauseForLine?.(true);
  host.talk.pausedForLine = true;
}

function endLinePause(host: NarrativeHost): void {
  if (!host.talk.pausedForLine) return;
  host.talk.pausedForLine = false;
  host.pauseForLine?.(false);
}

export function setStopTimeQuoteCallback(talk: TalkState, callback: string): void {
  talk.stopTimeCallback = callback;
}

function checkForStopTimeQuotes(host: NarrativeHost, speaker: number, quote: number): void {
  const face = host.talk.face;
  if (!STOP_TIME_QUOTES.has(quote) || !face || playerTeamSoldier(host, speaker) === null) return;
  host.talk.tacticalModal = TacticalModal.ENTERED;
  face.modal = true;
}

function endModalTactical(host: NarrativeHost, h: DialogueHandlers): void {
  const talk = host.talk;
  const callback = talk.stopTimeCallback;
  talk.stopTimeCallback = null;
  if (callback !== null) h.callback(callback, []);
  talk.tacticalModal = TacticalModal.OFF;
}

export function tacticalFrameIsModal(talk: TalkState): boolean {
  if (talk.tacticalModal === TacticalModal.ENTERED) {
    talk.tacticalModal = TacticalModal.FROZEN;
    return false;
  }
  return talk.tacticalModal === TacticalModal.FROZEN;
}

function executeQuote(host: NarrativeHost, e: Extract<DialogueEvent, { kind: 'quote' }>): boolean {
  if (e.alternate) {
    executeCharacterDialogue(host, e.speaker, e.quote, e);
    return false;
  }
  const t = host.tactical();
  if (e.delayed && t && t.turn.currentTeam !== Team.OUR) return true;
  pauseMapScreenForLine(host);
  wakeSpeakerForHisLine(host, e.speaker);
  host.talk.lastQuoteSaid = e.quote;
  host.talk.lastQuoteProfile = e.speaker;
  executeCharacterDialogue(host, e.speaker, e.quote, e);
  checkForStopTimeQuotes(host, e.speaker, e.quote);
  return false;
}

function executePcTrigger(host: NarrativeHost, e: Extract<DialogueEvent, { kind: 'pcTriggerNpc' }>): boolean {
  executeCharacterDialogue(host, e.speaker, e.quote, MERC_LINE);
  const face = host.talk.face;
  if (face) face.pcTrigger = { npc: e.npc, record: e.record };
  return false;
}

function executeItemLocatorStart(host: NarrativeHost, e: Extract<DialogueEvent, { kind: 'itemLocator' }>): boolean {
  const t = host.tactical();
  if (t) t.turn.lockItemLocators = false;
  if (t && e.gridNo !== NOWHERE) host.emit({ type: 'itemsLocated', gridNo: e.gridNo });
  const quote = QUOTE_SPOTTED_SOMETHING_ONE + host.random(SPOTTED_SOMETHING_QUOTES);
  executeCharacterDialogue(host, e.speaker, quote, MERC_LINE);
  return false;
}

function executeSleep(host: NarrativeHost, speaker: number, asleep: boolean): boolean {
  const s = playerTeamSoldier(host, speaker);
  if (s) host.setMercAsleepFlag?.(s, asleep);
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
    case 'itemLocator':
      return executeItemLocatorStart(host, e);
    case 'backToSleep':
      return executeSleep(host, e.speaker, true);
    case 'wakeUp':
      return executeSleep(host, e.speaker, false);
    case 'callback':
      return h.callback(e.name, e.args ?? []);
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

export function faceFinished(host: NarrativeHost, h: DialogueHandlers): boolean {
  const talk = host.talk;
  const face = talk.face;
  if (!face) return true;
  if (host.tick() < face.busyUntil) return false;
  if (face.pcTrigger) {
    talk.referenceCount--;
    h.triggerNpcRecord(face.pcTrigger.npc, face.pcTrigger.record);
  }
  if (face.modal) endModalTactical(host, h);
  talk.face = null;
  talk.lastQuoteProfile = NO_PROFILE;
  talk.externPanel = null;
  endLinePause(host);
  return true;
}

function dropTalkingFace(host: NarrativeHost): void {
  const talk = host.talk;
  if (!talk.face) return;
  if (talk.face.modal) talk.tacticalModal = TacticalModal.OFF;
  talk.face = null;
  talk.lastQuoteProfile = NO_PROFILE;
  talk.externPanel = null;
  endLinePause(host);
}

export function quietDialogueForLoad(host: NarrativeHost): void {
  emptyDialogueQueue(host);
  dropTalkingFace(host);
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
