import { randomUUID } from 'node:crypto';
import type { AnimationTimelines } from '../content/anim/timelines.ts';
import type { ProfileFaceRecord } from '../content/narrative/profile-presentation.ts';
import { type DataVersion, STUB_DATA_VERSION, type UiLanguage } from '../content/text/data-version.ts';
import type { UiStrings } from '../content/text/strings.ts';
import { appendToLog, MESSAGE_LOG_SIZE, type MessageEntry } from '../protocol/message-log.ts';
import {
  type CommandEnvelope,
  type DriverMode,
  type ServerMessage,
  type SessionAdvanceReport,
  type SessionCloseReason,
  type SessionStopReport,
  UNKNOWN_IDENTITY,
  type WelcomeIdentity,
  type WelcomeMessage,
} from '../protocol/messages.ts';
import { initialMusic, type MusicFacts, type MusicState, musicMode, musicView } from '../protocol/music.ts';
import { applyViewFrame, type BulletAtTick, type BulletView, diffPlayerView, type PlayerView, type ViewFrame } from '../protocol/view.ts';
import {
  AdvanceRun,
  isStrategicCondition,
  type PauseCheck,
  type Steppable,
  type StopCondition,
  type StopReason,
  type StopReport,
} from '../sim/advance.ts';
import { TICK_MS } from '../sim/clock.ts';
import type { CommandResult } from '../sim/command.ts';
import { type EffectEvent, isEffectEvent, type SimEvent, type SimEventType } from '../sim/events.ts';
import type { StrategicRules } from '../sim/knowledge/strategic.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { refuse } from '../sim/tactical/refusal.ts';
import { type AnchoredView, keepPredictableFrames } from './frame-anchors.ts';
import { type InputEntry, InputLog, type LoadPayload, type LogOrigin, UNKNOWN_ORIGIN } from './input-log.ts';
import { gameSavedEntry, type MessageFacts, messageEntriesOf, NO_MESSAGE_FACTS, refusalEntry } from './message-entries.ts';
import type { QueryAnswer, QueryService, QuerySubject } from './query.ts';
import { NEVER_DUE, type Slicer, UNSLICED } from './slicing.ts';

export const FRAME_TICKS = 10;
const REALTIME_INTERVAL_MS = 16;
const MAX_FRAMES_PER_MESSAGE = 500;
const PRESENTATION_HEARTBEAT_TICKS = 2000 / TICK_MS;
const LOADED_STOP_ID = 0;
const PAUSED_STOP_ID = 0;
export const REALTIME_WAIT_MS = 30_000;
export const SET_SPEECH = 'setSpeech';
export const SPEECH_MODES = ['listen', 'skip'] as const;
const REALTIME_COMPRESSION = 'the session runs in real time: time compression belongs to the viewer on the map screen';
const REALTIME_LEFT = 'the session no longer runs in real time';
const NO_MUSIC_FACTS: MusicFacts = { creature: false, inCombat: false, sectorLoaded: false, hostiles: 0, gameJustStarted: false };

export type { CommandResult };

export type SpeechMode = (typeof SPEECH_MODES)[number];

export interface SessionSim extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
  skipSpeech?(skip: boolean): void;
  view(): PlayerView;
  tacticalContent?(): TacticalContent | null;
  animationTimelines?(): AnimationTimelines | null;
  bulletViews?(): readonly BulletView[];
  strategicRules?(): StrategicRules | null;
  musicFacts?(): MusicFacts;
  messageFacts?(): MessageFacts;
  profileFaceRecords?(): readonly ProfileFaceRecord[];
  useLabels?(labels: UiStrings | null): void;
  readonly holdsCreationEvents?: boolean;
  readonly initialMusic?: MusicState;
  prepare?(cmd: CommandEnvelope): Promise<void>;
  preparedMaps?(): readonly string[];
  prepareMaps?(paths: readonly string[]): Promise<void>;
}

export type Listener = (message: ServerMessage) => void;

export interface SessionText {
  readonly language: UiLanguage;
  readonly dataVersion: DataVersion;
}

export interface SessionHooks {
  beforeDispatch?(session: Session, cmd: CommandEnvelope): void;
  afterDispatch?(session: Session, cmd: CommandEnvelope, result: CommandResult): void;
  beforeAdvance?(session: Session): void;
  afterAdvance?(session: Session, report: StopReport): void;
  afterInput?(session: Session): void;
  failed?(session: Session, error: unknown): void;
}

export type SessionEvent =
  | { readonly type: 'gameSaved'; readonly tick: number; readonly name: string; readonly kind: string }
  | { readonly type: 'gameLoaded'; readonly tick: number; readonly name: string; readonly seed: number | null };

export const DEFAULT_SESSION_TEXT: SessionText = { language: 'eng', dataVersion: STUB_DATA_VERSION };

type Yield = 'claim' | 'pause';

interface RealtimeWait {
  readonly run: AdvanceRun;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (report: SessionAdvanceReport) => void;
}

function isSpeechMode(value: unknown): value is SpeechMode {
  return SPEECH_MODES.includes(value as SpeechMode);
}

type Run<T> = Generator<Yield, T, void>;

function finish<T>(run: Run<T>): T {
  for (;;) {
    const next = run.next();
    if (next.done) return next.value;
  }
}

async function sliced<T>(run: Run<T>, slicer: Slicer): Promise<T> {
  slicer.begin();
  for (let next = run.next(); ; next = run.next()) {
    if (next.done) return next.value;
    if (next.value === 'pause' || !slicer.claim()) await slicer.pause();
    slicer.begin();
  }
}

export class Session {
  readonly id: string;
  readonly instance = randomUUID();
  readonly dataVersion: DataVersion;
  readonly log: InputLog;
  language: UiLanguage;
  identity: WelcomeIdentity = UNKNOWN_IDENTITY;
  hooks: SessionHooks | null = null;
  queries: QueryService | null = null;
  #sim: SessionSim;
  #driver: DriverMode = { mode: 'manual' };
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastRealtime = 0;
  #carryMs = 0;
  #speech: SpeechMode = 'listen';
  readonly #waits = new Set<RealtimeWait>();
  #lastView: PlayerView;
  #sentView: PlayerView;
  #shownTick: number;
  #music: MusicState;
  #fastFade = false;
  #depth = 0;
  #messages: MessageEntry[] = [];
  #labels: UiStrings | null = null;
  #campaign: string | null = null;
  readonly #framedMessages: MessageEntry[] = [];
  readonly #framedBullets: BulletAtTick[] = [];
  readonly #framedEffects: EffectEvent[] = [];
  #presentationUntil = -1;
  readonly #unreportedMessages: MessageEntry[] = [];
  readonly #held: SimEvent[] = [];
  readonly #pendingEvents: SimEvent[] = [];
  readonly #listeners = new Set<Listener>();

  constructor(id: string, sim: SessionSim, text: SessionText = DEFAULT_SESSION_TEXT, origin: LogOrigin = UNKNOWN_ORIGIN) {
    this.id = id;
    this.#sim = sim;
    this.dataVersion = text.dataVersion;
    this.language = text.language;
    this.log = new InputLog(origin);
    this.#music = sim.initialMusic ?? initialMusic();
    const created = sim.holdsCreationEvents ? sim.drainEvents() : [];
    this.#held.push(...created);
    this.#followMusic(created);
    this.#followMessages(created);
    this.#lastView = this.#view();
    this.#sentView = this.#lastView;
    this.#shownTick = this.#lastView.tick;
  }

  useLabels(labels: UiStrings | null): void {
    this.#labels = labels;
    this.#sim.useLabels?.(labels);
  }

  get music(): MusicState {
    return this.#music;
  }

  get messages(): readonly MessageEntry[] {
    return this.#messages;
  }

  get campaign(): string | null {
    return this.#campaign;
  }

  useCampaign(campaign: string | null): void {
    this.#campaign = campaign;
  }

  #messageFacts(): MessageFacts {
    return this.#sim.messageFacts?.() ?? NO_MESSAGE_FACTS;
  }

  #followMessages(events: readonly SimEvent[]): void {
    if (events.length > 0) this.#recordMessages(messageEntriesOf(events, this.#messageFacts()));
  }

  #recordMessages(entries: readonly MessageEntry[]): void {
    if (entries.length === 0) return;
    this.#messages = appendToLog(this.#messages, entries);
    this.#framedMessages.push(...entries);
    this.#unreportedMessages.push(...entries);
    const excess = this.#unreportedMessages.length - MESSAGE_LOG_SIZE;
    if (excess > 0) this.#unreportedMessages.splice(0, excess);
  }

  #takeFramedMessages(): { readonly messages?: readonly MessageEntry[] } {
    if (this.#framedMessages.length === 0) return {};
    return { messages: this.#framedMessages.splice(0) };
  }

  #recordPresentation(events: readonly SimEvent[]): void {
    if (!this.listening) return;
    const tick = this.#sim.tick;
    const before = this.#framedBullets.length + this.#framedEffects.length;
    for (const bullet of this.#sim.bulletViews?.() ?? []) this.#framedBullets.push({ tick, ...bullet });
    for (const e of events) if (isEffectEvent(e)) this.#framedEffects.push({ ...e, tick });
    if (this.#framedBullets.length + this.#framedEffects.length > before) this.#presentationUntil = tick + PRESENTATION_HEARTBEAT_TICKS;
  }

  #takeFramedPresentation(): { readonly bullets?: readonly BulletAtTick[]; readonly effects?: readonly EffectEvent[] } {
    return {
      ...(this.#framedBullets.length > 0 ? { bullets: this.#framedBullets.splice(0) } : {}),
      ...(this.#framedEffects.length > 0 ? { effects: this.#framedEffects.splice(0) } : {}),
    };
  }

  #facts(): MusicFacts {
    return this.#sim.musicFacts?.() ?? NO_MUSIC_FACTS;
  }

  #view(): PlayerView {
    return { ...this.#sim.view(), music: musicView(this.#music, this.#facts().creature, this.#fastFade) };
  }

  #followMusic(events: readonly SimEvent[]): void {
    this.#fastFade = false;
    if (events.length === 0) return;
    const next = musicMode(this.#music, events, this.#facts());
    this.#fastFade = next.fastFade;
    this.#music = { mode: next.mode, previous: next.previous };
  }

  get sim(): SessionSim {
    return this.#sim;
  }

  get driver(): DriverMode {
    return this.#driver;
  }

  get listening(): boolean {
    return this.#listeners.size > 0;
  }

  get viewers(): number {
    return this.#listeners.size;
  }

  get busy(): boolean {
    return this.#depth > 0;
  }

  subscribe(listener: Listener): () => void {
    const welcome = this.#welcome(this.listening ? this.#sentView : this.#view());
    if (!this.listening) this.#lastView = welcome.view;
    this.#sentView = welcome.view;
    this.#shownTick = welcome.view.tick;
    this.#listeners.add(listener);
    listener(welcome);
    return () => this.#listeners.delete(listener);
  }

  #welcome(view: PlayerView): WelcomeMessage {
    return {
      t: 'welcome',
      session: this.id,
      instance: this.instance,
      view,
      driver: this.#driver,
      messages: this.#messages,
      ...(this.#campaign ? { campaign: this.#campaign } : {}),
      ...this.identity,
    };
  }

  #broadcast(message: ServerMessage): void {
    for (const l of this.#listeners) l(message);
  }

  #publish(frames: ViewFrame[]): void {
    if (!this.listening) return;
    for (const frame of frames) this.#sentView = applyViewFrame(this.#sentView, frame);
    for (let i = 0; i < frames.length; i += MAX_FRAMES_PER_MESSAGE)
      this.#broadcast({ t: 'frames', frames: frames.slice(i, i + MAX_FRAMES_PER_MESSAGE) });
  }

  restoreMusic(music: MusicState): void {
    this.#music = music;
    this.#fastFade = false;
    this.#lastView = this.#view();
  }

  restoreMessages(messages: readonly MessageEntry[]): void {
    this.#messages = appendToLog([], messages);
    this.#framedMessages.length = 0;
    this.#unreportedMessages.length = 0;
  }

  holdEvents(): SimEvent[] {
    const events = this.#sim.drainEvents();
    this.#held.push(...events);
    this.#pendingEvents.push(...events);
    return events;
  }

  notify(event: SessionEvent): void {
    this.#held.push(event as unknown as SimEvent);
    if (event.type === 'gameSaved') this.#recordMessages([gameSavedEntry(event.tick)]);
  }

  #recordingStepper(frames: ViewFrame[]): Steppable {
    const sim = this.#sim;
    const held = this.#held;
    const drained: SimEvent[] = [];
    const drain = () => {
      const events = sim.drainEvents();
      drained.push(...events);
      this.#pendingEvents.push(...events);
      return events;
    };
    return {
      get tick() {
        return sim.tick;
      },
      get worldClock() {
        return sim.worldClock ?? null;
      },
      isIdle: () => sim.isIdle(),
      hasPendingDecision: () => sim.hasPendingDecision(),
      ended: () => sim.ended?.() ?? false,
      drainEvents: () => {
        drain();
        return [...held.splice(0), ...drained.splice(0)];
      },
      step: () => {
        sim.step();
        this.#recordPresentation(drain());
        this.#captureOnFrameTick(frames);
      },
    };
  }

  #captureOnFrameTick(frames: ViewFrame[]): void {
    if (this.#sim.tick % FRAME_TICKS === 0) this.#capture(frames);
  }

  #anchored(view: PlayerView): AnchoredView {
    const timelines = this.#sim.animationTimelines?.() ?? null;
    return timelines ? keepPredictableFrames(timelines, this.#lastView, view) : { view, predicting: false };
  }

  #capture(frames: ViewFrame[]): void {
    const events = this.#pendingEvents.splice(0);
    this.#followMusic(events);
    this.#followMessages(events);
    const messages = this.#takeFramedMessages();
    const presentation = this.#takeFramedPresentation();
    if (!this.listening) return;
    const { view, predicting } = this.#anchored(this.#view());
    const diff = diffPlayerView(this.#lastView, view);
    this.#lastView = view;
    const extra = { ...(events.length > 0 ? { events } : {}), ...messages, ...presentation };
    const animating = predicting || view.tick <= this.#presentationUntil;
    const heartbeat = animating && view.tick % FRAME_TICKS === 0 && view.tick !== this.#shownTick;
    const frame =
      Object.keys(extra).length > 0 || (heartbeat && !diff)
        ? { ...(diff ?? { tick: view.tick, changed: [], removed: [] }), ...extra }
        : diff;
    if (!frame) return;
    frames.push(frame);
    this.#shownTick = frame.tick;
  }

  *#input<T>(work: Run<T>): Run<T> {
    this.#depth++;
    let failed = false;
    try {
      return yield* work;
    } catch (err) {
      failed = true;
      if (this.#depth === 1) this.hooks?.failed?.(this, err);
      throw err;
    } finally {
      this.#depth--;
      if (this.#depth === 0 && !failed) this.hooks?.afterInput?.(this);
    }
  }

  async prepareAndDispatch(cmd: CommandEnvelope, slicer: Slicer = UNSLICED): Promise<CommandResult> {
    const before = new Set(this.#sim.preparedMaps?.() ?? []);
    await this.#sim.prepare?.(cmd);
    const maps = (this.#sim.preparedMaps?.() ?? []).filter((path) => !before.has(path));
    if (maps.length > 0) this.log.append('prepare', this.#sim.tick, { maps });
    return this.dispatchSliced(cmd, slicer);
  }

  async prepareMaps(maps: readonly string[]): Promise<void> {
    if (maps.length === 0) return;
    this.log.append('prepare', this.#sim.tick, { maps });
    await this.#sim.prepareMaps?.(maps);
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return finish(this.#input(this.#dispatchRun(cmd, NEVER_DUE)));
  }

  dispatchSliced(cmd: CommandEnvelope, slicer: Slicer): Promise<CommandResult> {
    return sliced(this.#input(this.#dispatchRun(cmd, slicer.due)), slicer);
  }

  *#dispatchRun(cmd: CommandEnvelope, due: PauseCheck): Run<CommandResult> {
    if (cmd.type === SET_SPEECH) return this.#setSpeech(cmd.mode);
    this.hooks?.beforeDispatch?.(this, cmd);
    this.log.append(cmd.type === 'answer' ? 'answer' : 'cmd', this.#sim.tick, { cmd });
    const result = this.#sim.dispatch(cmd);
    this.holdEvents();
    const refusal = refusalEntry(this.#sim.tick, cmd, result, this.#messageFacts());
    if (refusal) this.#recordMessages([refusal]);
    this.hooks?.afterDispatch?.(this, cmd, result);
    const frames: ViewFrame[] = [];
    this.#capture(frames);
    this.#publish(frames);
    if (result.ok && this.#driver.mode === 'instant') yield* this.#loggedAdvance({ idle: true }, undefined, due);
    return result;
  }

  #setSpeech(mode: unknown): CommandResult {
    if (!isSpeechMode(mode)) return refuse('unknownSpeech', `speech is one of ${SPEECH_MODES.join(', ')}`);
    this.setSpeech(mode);
    return { ok: true, data: { speech: mode } };
  }

  get speech(): SpeechMode {
    return this.#speech;
  }

  setSpeech(mode: SpeechMode): void {
    this.log.append('speech', this.#sim.tick, { mode });
    this.#speech = mode;
    this.#sim.skipSpeech?.(mode === 'skip');
  }

  waitInRealtime(until: StopCondition, budget?: number, waitMs = REALTIME_WAIT_MS): Promise<SessionAdvanceReport> | null {
    if (this.#driver.mode !== 'realtime') return null;
    const run = new AdvanceRun(this.#sim, until, budget);
    const stop = isStrategicCondition(until) ? run.stopped('refused', REALTIME_COMPRESSION) : run.observe([]);
    if (stop) return Promise.resolve(this.#reported(stop));
    return new Promise((resolve) => {
      const wait: RealtimeWait = { run, resolve, timer: setTimeout(() => this.#settle(wait, run.stopped('timeout')), waitMs) };
      this.#waits.add(wait);
    });
  }

  #reported(report: StopReport): SessionAdvanceReport {
    return { ...report, messages: this.#unreportedMessages.splice(0) };
  }

  #serveWaits(events: readonly SimEvent[]): void {
    for (const wait of this.#waits) {
      const stop = wait.run.observe(events);
      if (stop) this.#settle(wait, stop);
    }
  }

  #settle(wait: RealtimeWait, report: StopReport): void {
    clearTimeout(wait.timer);
    this.#waits.delete(wait);
    wait.resolve(this.#reported(report));
  }

  #settleWaits(reason: StopReason, refusal: string): void {
    for (const wait of this.#waits) this.#settle(wait, wait.run.stopped(reason, refusal));
  }

  advance(until: StopCondition, budget?: number): SessionAdvanceReport {
    return finish(this.#loggedAdvance(until, budget, NEVER_DUE));
  }

  advanceSliced(until: StopCondition, budget: number | undefined, slicer: Slicer): Promise<SessionAdvanceReport> {
    return sliced(this.#loggedAdvance(until, budget, slicer.due), slicer);
  }

  *#loggedAdvance(until: StopCondition, budget: number | undefined, due: PauseCheck): Run<SessionAdvanceReport> {
    return yield* this.#input(this.#loggedAdvanceRun(until, budget, due));
  }

  *#loggedAdvanceRun(until: StopCondition, budget: number | undefined, due: PauseCheck): Run<SessionAdvanceReport> {
    this.log.append('advance', this.#sim.tick, { until, ...(budget !== undefined ? { budget } : {}) });
    return yield* this.#advanceRun(until, budget, due);
  }

  *#advanceRun(until: StopCondition, budget: number | undefined, due: PauseCheck): Run<SessionAdvanceReport> {
    yield 'claim';
    this.hooks?.beforeAdvance?.(this);
    const frames: ViewFrame[] = [];
    const run = new AdvanceRun(this.#recordingStepper(frames), until, budget);
    let report = run.resume(due);
    while (report === null) {
      this.#publish(frames.splice(0));
      yield 'pause';
      report = run.resume(due);
    }
    this.#capture(frames);
    this.#publish(frames);
    this.hooks?.afterAdvance?.(this, report);
    return { ...report, messages: this.#unreportedMessages.splice(0) };
  }

  async query(q: CommandEnvelope): Promise<QueryAnswer> {
    const queries = this.queries;
    if (!queries) return { ...refuse('noQueries', 'queries are not available'), tick: this.#sim.tick };
    await queries.prepare(this.#querySubject());
    return queries.answer(this.#querySubject(), q);
  }

  #querySubject(): QuerySubject {
    if (!this.listening) return this.#sim;
    const held = (): PlayerView => this.#sentView;
    return {
      get tick() {
        return held().tick;
      },
      view: held,
      dispatch: (cmd) => this.#sim.dispatch(cmd),
      tacticalContent: () => this.#sim.tacticalContent?.() ?? null,
      strategicRules: () => this.#sim.strategicRules?.() ?? null,
    };
  }

  reseed(seed: number, apply: () => void): void {
    this.log.append('reseed', this.#sim.tick, { seed });
    apply();
  }

  setDriver(driver: DriverMode, now: () => number = () => performance.now()): void {
    finish(this.#driverRun(driver, now, NEVER_DUE));
  }

  setDriverSliced(driver: DriverMode, slicer: Slicer, now: () => number = () => performance.now()): Promise<void> {
    return sliced(this.#driverRun(driver, now, slicer.due), slicer);
  }

  *#driverRun(driver: DriverMode, now: () => number, due: PauseCheck): Run<void> {
    this.log.append('drive', this.#sim.tick, { driver });
    this.#driver = driver;
    this.#stopTimer();
    if (driver.mode !== 'realtime') this.#settleWaits('refused', REALTIME_LEFT);
    if (driver.mode === 'realtime') {
      this.#lastRealtime = now();
      this.#carryMs = 0;
      this.#timer = setInterval(() => this.runRealtime(now()), REALTIME_INTERVAL_MS);
    }
    if (driver.mode === 'instant') yield* this.#loggedAdvance({ idle: true }, undefined, due);
  }

  #stopTimer(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  runRealtime(at: number): void {
    if (this.#driver.mode !== 'realtime' || this.busy) return;
    this.#carryMs += (at - this.#lastRealtime) * this.#driver.speed;
    this.#lastRealtime = at;
    const ticks = Math.max(0, Math.floor(this.#carryMs / TICK_MS));
    this.#carryMs -= ticks * TICK_MS;
    const runs = ticks > 0 && !this.#sim.hasPendingDecision();
    const report = runs ? finish(this.#input(this.#realtimeRun(ticks, this.#driver.pauseOn ?? []))) : null;
    this.#serveWaits(report?.events ?? []);
    if (report?.reason === 'event') {
      this.setDriver({ mode: 'manual' });
      this.#broadcast({ t: 'stopped', id: PAUSED_STOP_ID, report });
    }
  }

  *#realtimeRun(ticks: number, pauseOn: readonly SimEventType[]): Run<SessionAdvanceReport> {
    const entry: InputEntry = this.log.appendRealtime(this.#sim.tick, ticks, pauseOn);
    const until: StopCondition = pauseOn.length > 0 ? { ticks, events: [...pauseOn] } : { ticks };
    const stopped = yield* this.#advanceRun(until, undefined, NEVER_DUE);
    if (stopped.reason === 'ticks') this.log.realtimeBatchCompleted(entry);
    return stopped;
  }

  replace(
    sim: SessionSim,
    loaded: LoadPayload,
    music: MusicState = sim.initialMusic ?? initialMusic(),
    messages: readonly MessageEntry[] = [],
    campaign: string | null = this.#campaign,
  ): void {
    const wasRunning = this.#driver.mode === 'realtime';
    this.#stopTimer();
    this.#driver = { mode: 'manual' };
    this.#settleWaits('refused', REALTIME_LEFT);
    this.log.append('load', this.#sim.tick, { ...loaded });
    this.#held.length = 0;
    this.#pendingEvents.length = 0;
    this.#framedBullets.length = 0;
    this.#framedEffects.length = 0;
    this.#presentationUntil = -1;
    this.#sim = sim;
    sim.useLabels?.(this.#labels);
    if (this.#speech !== 'listen') this.setSpeech(this.#speech);
    this.#music = music;
    this.#campaign = campaign;
    this.#fastFade = false;
    this.restoreMessages(messages);
    const welcome = this.#welcome(this.#view());
    this.#lastView = welcome.view;
    this.#sentView = welcome.view;
    this.#shownTick = welcome.view.tick;
    if (wasRunning) this.#broadcast({ t: 'stopped', id: LOADED_STOP_ID, report: this.#loadedStop() });
    this.#broadcast(welcome);
  }

  #loadedStop(): SessionStopReport {
    return { tick: this.#sim.tick, reason: 'loaded', events: [] };
  }

  close(reason: SessionCloseReason = 'closed'): void {
    this.#stopTimer();
    this.#settleWaits('refused', REALTIME_LEFT);
    this.#broadcast({ t: 'closed', session: this.id, reason });
    this.#listeners.clear();
  }
}
