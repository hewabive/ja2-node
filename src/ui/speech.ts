// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc (one line at a time from the dialogue queue, CreateTalkingUI: the subtitles
// @src when SUBTITLES is on or the line has no voice, the speech surfaces when SPEECH is on, HandleDialogueEnd,
// @src DialogueAdvanceSpeech, StopAnyCurrentlyTalkingSpeech, FindDelayForString with TEXT_DELAY_MODIFIER 60);
// @src src/game/Tactical/Faces.cc SetFaceTalking (the voice only with TOPTION_SPEECH, the text duration otherwise),
// @src InternalShutupaYoFace (a click is ignored during the first 500 ms, Backspace forces; a voiced line lasts as long
// @src as its voice), SetupFinalTalkingDelay
// @src (300 ms with the mouth closed, the key wait of a FACE_POTENTIAL_KEYWAIT face with KEY_ADVANCE_SPEECH when the
// @src line had no voice or subtitles are on); src/game/Tactical/Civ_Quotes.cc BeginCivQuote (a new quote replaces
// @src the old one, the lifetime of the quoted text plus 500 ms), ShutDownQuoteBox (a click closes after 300 ms).

import { speechPathForLine } from '../content/audio/speech.ts';
import type { ViewFrame } from '../protocol/view.ts';

export const TEXT_DELAY_MODIFIER_MS = 60;
export const FINAL_TALKING_DELAY_MS = 300;
export const MIN_TALK_BEFORE_SKIP_MS = 500;
export const CIV_QUOTE_EXTRA_MS = 500;
export const CIV_QUOTE_MIN_LIFE_MS = 300;
const QUOTE_MARKS = 2;

export const SpeechSurface = {
  PANEL: 'panel',
  TACTICAL: 'tactical',
  EXTERNAL: 'external',
  SHOPKEEPER: 'shopkeeper',
} as const;
export type SpeechSurface = (typeof SpeechSurface)[keyof typeof SpeechSurface];

export interface TextKeyRef {
  readonly file: string;
  readonly row: number;
  readonly width: number;
}

export interface SpeechLineRequest {
  readonly surface: SpeechSurface;
  readonly profile: number;
  readonly soldier: number | null;
  readonly text: string;
  readonly chars: number;
  readonly voice: string | null;
  readonly sector: string | null;
  readonly keyWait: boolean;
  readonly saidAt?: number;
}

export interface SpeechLine extends SpeechLineRequest {
  readonly id: number;
}

export interface SpeechVoice {
  readonly active: boolean;
  readonly playing: boolean;
  readonly failed: boolean;
  readonly elapsedMs: number;
  readonly file: string;
  stop(): void;
}

export interface SpeechVoices {
  play(path: string): SpeechVoice | null;
}

export interface SpeechSettings {
  readonly speech: boolean;
  readonly subtitles: boolean;
  readonly keyAdvance: boolean;
}

export type LinePhase = 'talking' | 'tail' | 'keyWait';
export type LineStop = 'cut' | 'talkEnded';

export interface ActiveLine {
  readonly line: SpeechLine;
  readonly startedAt: number;
  readonly phase: LinePhase;
  readonly subtitles: boolean;
  readonly voice: SpeechVoice | null;
}

export interface CivQuoteRequest {
  readonly soldier: number;
  readonly text: string;
  readonly chars: number;
  readonly hint: boolean;
}

export interface CivQuoteLine extends CivQuoteRequest {
  readonly id: number;
  readonly createdAt: number;
  readonly endsAt: number;
}

export interface SpeakingFace {
  readonly speaker: number;
  readonly profile: number;
  readonly surface: SpeechSurface;
  readonly file: string;
  readonly elapsedMs: number;
  readonly playing: boolean;
}

export interface SpeechPresenterOptions {
  readonly voices: SpeechVoices | null;
  readonly settings: () => SpeechSettings;
}

interface Running {
  readonly line: SpeechLine;
  readonly startedAt: number;
  phase: LinePhase;
  voice: SpeechVoice | null;
  talkingUntil: number | null;
  tailFrom: number;
}

export function textDelay(chars: number): number {
  return chars * TEXT_DELAY_MODIFIER_MS;
}

export function civQuoteLifetime(chars: number): number {
  return textDelay(chars + QUOTE_MARKS) + CIV_QUOTE_EXTRA_MS;
}

export function quoted(text: string): string {
  return `"${text}"`;
}

export class SpeechPresenter {
  readonly #o: SpeechPresenterOptions;
  readonly #queue: SpeechLine[] = [];
  #running: Running | null = null;
  #civ: CivQuoteLine | null = null;
  #nextId = 1;
  #now = 0;
  readonly #started: ((line: SpeechLine) => void)[] = [];
  readonly #ended: ((line: SpeechLine) => void)[] = [];
  readonly #stopped: ((line: SpeechLine, how: LineStop) => void)[] = [];

  constructor(options: SpeechPresenterOptions) {
    this.#o = options;
  }

  onLineStarted(listener: (line: SpeechLine) => void): void {
    this.#started.push(listener);
  }

  onLineEnded(listener: (line: SpeechLine) => void): void {
    this.#ended.push(listener);
  }

  onLineStopped(listener: (line: SpeechLine, how: LineStop) => void): void {
    this.#stopped.push(listener);
  }

  get busy(): boolean {
    return this.#running !== null || this.#queue.length > 0;
  }

  get queued(): readonly SpeechLine[] {
    return this.#queue;
  }

  get current(): ActiveLine | null {
    const r = this.#running;
    if (!r) return null;
    return { line: r.line, startedAt: r.startedAt, phase: r.phase, subtitles: this.#showsSubtitles(r), voice: r.voice };
  }

  get civQuote(): CivQuoteLine | null {
    return this.#civ;
  }

  get speaking(): SpeakingFace | null {
    const r = this.#running;
    if (!r) return null;
    const voice = r.voice && !r.voice.failed ? r.voice : null;
    return {
      speaker: r.line.soldier ?? -1,
      profile: r.line.profile,
      surface: r.line.surface,
      file: voice?.file ?? '',
      elapsedMs: voice ? voice.elapsedMs : this.#now - r.startedAt,
      playing: r.phase === 'talking',
    };
  }

  enqueue(request: SpeechLineRequest): SpeechLine {
    const line = { ...request, id: this.#nextId++ };
    this.#queue.push(line);
    if (!this.#running) this.#startNext(this.#now);
    return line;
  }

  showCivQuote(request: CivQuoteRequest, now: number): CivQuoteLine {
    const line = { ...request, id: this.#nextId++, createdAt: now, endsAt: now + civQuoteLifetime(request.chars) };
    this.#civ = line;
    return line;
  }

  closeCivQuote(now: number, force: boolean): boolean {
    const civ = this.#civ;
    if (!civ) return false;
    if (!force && now - civ.createdAt <= CIV_QUOTE_MIN_LIFE_MS) return false;
    this.#civ = null;
    return true;
  }

  update(now: number): void {
    this.#now = now;
    if (this.#civ && now >= this.#civ.endsAt) this.#civ = null;
    for (let guard = 0; guard < this.#queue.length + 2; guard++) {
      const r = this.#running;
      if (!r) {
        if (!this.#startNext(now)) return;
        continue;
      }
      if (!this.#advance(r, now)) return;
    }
  }

  skip(now: number, force: boolean): boolean {
    const r = this.#running;
    if (!r) return false;
    if (!force && now - r.startedAt < MIN_TALK_BEFORE_SKIP_MS) return false;
    this.#cutShort(r);
    return true;
  }

  advanceKey(now: number): boolean {
    if (this.#running?.phase !== 'keyWait') return false;
    return this.skip(now, false);
  }

  get waitingForKey(): boolean {
    return this.#running?.phase === 'keyWait';
  }

  flush(): void {
    this.#queue.length = 0;
    const r = this.#running;
    if (r) this.#cutShort(r);
    this.#queue.length = 0;
  }

  cut(profile: number, saidAt: number, tail: boolean): void {
    const said = (line: SpeechLine) => line.profile === profile && line.saidAt === saidAt;
    const r = this.#running;
    if (r && said(r.line)) {
      if (!tail) this.#finish(r);
      else if (r.phase === 'talking' && !this.#validSpeech(r)) this.#finalDelay(r, this.#now);
      return;
    }
    const queued = tail ? -1 : this.#queue.findIndex(said);
    if (queued >= 0) this.#queue.splice(queued, 1);
  }

  cutSpeaker(soldier: number): void {
    const r = this.#running;
    if (r && r.line.soldier === soldier && r.voice?.active) this.#finish(r);
  }

  #showsSubtitles(r: Running): boolean {
    return this.#o.settings().subtitles || !this.#validSpeech(r);
  }

  #validSpeech(r: Running): boolean {
    return r.voice !== null && !r.voice.failed;
  }

  #startNext(now: number): boolean {
    const line = this.#queue.shift();
    if (!line) return false;
    const settings = this.#o.settings();
    const voice = settings.speech && line.voice ? (this.#o.voices?.play(line.voice) ?? null) : null;
    const running: Running = { line, startedAt: now, phase: 'talking', voice, talkingUntil: null, tailFrom: 0 };
    if (!voice || voice.failed) running.talkingUntil = now + textDelay(line.chars);
    this.#running = running;
    for (const listener of this.#started) listener(line);
    return true;
  }

  #advance(r: Running, now: number): boolean {
    if (r.phase === 'talking') {
      if (r.voice?.failed && r.talkingUntil === null) r.talkingUntil = r.startedAt + textDelay(r.line.chars);
      const done = r.talkingUntil !== null ? now >= r.talkingUntil : !(r.voice?.active ?? false);
      if (!done) return false;
      this.#stop(r.line, 'talkEnded');
      this.#finalDelay(r, r.talkingUntil !== null ? Math.min(now, r.talkingUntil) : now);
      return true;
    }
    if (r.phase === 'keyWait') return false;
    if (now - r.tailFrom < FINAL_TALKING_DELAY_MS) return false;
    this.#finish(r);
    return true;
  }

  #finalDelay(r: Running, at: number): void {
    const settings = this.#o.settings();
    if (settings.keyAdvance && r.line.keyWait && (!this.#validSpeech(r) || settings.subtitles)) {
      r.phase = 'keyWait';
      return;
    }
    r.phase = 'tail';
    r.tailFrom = at;
  }

  #cutShort(r: Running): void {
    if (r.phase === 'talking') this.#stop(r.line, 'cut');
    this.#finish(r);
  }

  #stop(line: SpeechLine, how: LineStop): void {
    for (const listener of this.#stopped) listener(line, how);
  }

  #finish(r: Running): void {
    if (r.voice?.active) r.voice.stop();
    this.#running = null;
    for (const listener of this.#ended) listener(r.line);
  }
}

export type QuoteEvent = Extract<
  NonNullable<ViewFrame['events']>[number],
  { type: 'npcQuote' | 'mercQuote' | 'skyriderQuote' | 'headMinerQuote' | 'shopkeeperQuote' | 'civQuote' }
>;

export interface SpeechRouting {
  readonly conversationProfile: number | null;
  readonly shopDealer: number | null;
  readonly rpcSpeechPrefixed: boolean;
  recruited(soldier: number | null): boolean;
  text(key: TextKeyRef): string | null;
}

const QUOTE_EVENTS: ReadonlySet<string> = new Set([
  'npcQuote',
  'mercQuote',
  'skyriderQuote',
  'headMinerQuote',
  'shopkeeperQuote',
  'civQuote',
]);

export function isQuoteEvent(event: { readonly type: string }): event is QuoteEvent {
  return QUOTE_EVENTS.has(event.type);
}

export function isQueuedQuoteEvent(event: { readonly type: string }): boolean {
  return isQuoteEvent(event) && event.type !== 'civQuote' && !skippedQuote(event);
}

function skippedQuote(event: QuoteEvent): boolean {
  return 'skipped' in event && event.skipped === true;
}

interface QuoteFields {
  readonly textKey?: TextKeyRef;
  readonly chars?: number;
  readonly text?: string;
}

function codePoints(text: string): number {
  return [...text].length;
}

function lineText(fields: QuoteFields, routing: SpeechRouting): string {
  if (typeof fields.text === 'string') return fields.text;
  return fields.textKey ? (routing.text(fields.textKey) ?? '') : '';
}

function voiceOf(profile: number, key: TextKeyRef | undefined, recruited: boolean, routing: SpeechRouting): string | null {
  if (!key || profile < 0) return null;
  return speechPathForLine({ profile, textKey: key, recruitedNpcOrRpc: recruited }, routing.rpcSpeechPrefixed);
}

function request(
  surface: SpeechSurface,
  profile: number,
  soldier: number | null,
  fields: QuoteFields,
  routing: SpeechRouting,
  extra: { sector?: string | null; recruited?: boolean } = {},
): SpeechLineRequest | null {
  if (!fields.textKey) return null;
  const text = lineText(fields, routing);
  if (text.length === 0 && (fields.chars ?? 0) === 0) return null;
  return {
    surface,
    profile,
    soldier,
    text,
    chars: fields.chars ?? codePoints(text),
    voice: voiceOf(profile, fields.textKey, extra.recruited ?? false, routing),
    sector: extra.sector ?? null,
    keyWait: surface === SpeechSurface.PANEL,
  };
}

export function speechLineOf(event: QuoteEvent, routing: SpeechRouting): SpeechLineRequest | null {
  if (skippedQuote(event)) return null;
  const line = speechRequestOf(event, routing);
  return line && { ...line, saidAt: event.tick };
}

function speechRequestOf(event: QuoteEvent, routing: SpeechRouting): SpeechLineRequest | null {
  const fields = event as QuoteFields;
  switch (event.type) {
    case 'npcQuote': {
      const surface = routing.conversationProfile === event.profile ? SpeechSurface.PANEL : SpeechSurface.TACTICAL;
      return request(surface, event.profile, event.soldier, fields, routing);
    }
    case 'mercQuote': {
      const soldier = event.soldier >= 0 ? event.soldier : null;
      return request(SpeechSurface.TACTICAL, event.profile, soldier, fields, routing, {
        sector: event.sector ?? null,
        recruited: routing.recruited(soldier),
      });
    }
    case 'skyriderQuote':
      return request(SpeechSurface.EXTERNAL, event.profile ?? -1, null, fields, routing);
    case 'headMinerQuote':
      return event.quote < 0 ? null : request(SpeechSurface.EXTERNAL, event.profile, null, fields, routing);
    case 'shopkeeperQuote':
      return request(SpeechSurface.SHOPKEEPER, event.dealer, null, fields, routing);
    default:
      return null;
  }
}

export function civQuoteOf(event: QuoteEvent, routing: SpeechRouting): CivQuoteRequest | null {
  if (event.type !== 'civQuote') return null;
  const text = lineText(event as QuoteFields, routing);
  if (text.length === 0) return null;
  return { soldier: event.soldier, text, chars: event.chars ?? codePoints(text), hint: event.hint };
}
