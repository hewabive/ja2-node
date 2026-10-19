import type { ProfileFaceRecord } from '../content/narrative/profile-presentation.ts';
import { type DataVersion, STUB_DATA_VERSION, type UiLanguage } from '../content/text/data-version.ts';
import type { UiStrings } from '../content/text/strings.ts';
import { appendToLog, MESSAGE_LOG_SIZE, type MessageEntry } from '../protocol/message-log.ts';
import {
  type CommandEnvelope,
  type DriverMode,
  type ServerMessage,
  type SessionAdvanceReport,
  type SessionStopReport,
  UNKNOWN_IDENTITY,
  type WelcomeIdentity,
  type WelcomeMessage,
} from '../protocol/messages.ts';
import { initialMusic, type MusicFacts, type MusicState, musicMode, musicView } from '../protocol/music.ts';
import { diffPlayerView, type PlayerView, type ViewFrame } from '../protocol/view.ts';
import { AdvanceRun, type PauseCheck, type Steppable, type StopCondition, type StopReport } from '../sim/advance.ts';
import { TICK_MS } from '../sim/clock.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent, SimEventType } from '../sim/events.ts';
import { type InputEntry, InputLog, type LoadPayload, type LogOrigin, UNKNOWN_ORIGIN } from './input-log.ts';
import { gameSavedEntry, type MessageFacts, messageEntriesOf, NO_MESSAGE_FACTS, refusalEntry } from './message-entries.ts';
import { NEVER_DUE, type Slicer, UNSLICED } from './slicing.ts';

export const FRAME_TICKS = 10;
const REALTIME_INTERVAL_MS = 16;
const MAX_FRAMES_PER_MESSAGE = 500;
const LOADED_STOP_ID = 0;
const PAUSED_STOP_ID = 0;
const NO_MUSIC_FACTS: MusicFacts = { creature: false, inCombat: false, sectorLoaded: false, hostiles: 0, gameJustStarted: false };

export type { CommandResult };

export interface SessionSim extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
  view(): PlayerView;
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
  readonly dataVersion: DataVersion;
  readonly log: InputLog;
  language: UiLanguage;
  identity: WelcomeIdentity = UNKNOWN_IDENTITY;
  hooks: SessionHooks | null = null;
  #sim: SessionSim;
  #driver: DriverMode = { mode: 'manual' };
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastRealtime = 0;
  #carryMs = 0;
  #lastView: PlayerView;
  #music: MusicState;
  #fastFade = false;
  #depth = 0;
  #messages: MessageEntry[] = [];
  #labels: UiStrings | null = null;
  readonly #framedMessages: MessageEntry[] = [];
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

  get busy(): boolean {
    return this.#depth > 0;
  }

  subscribe(listener: Listener): () => void {
    const welcome = this.#welcome();
    if (!this.listening) this.#lastView = welcome.view;
    this.#listeners.add(listener);
    listener(welcome);
    return () => this.#listeners.delete(listener);
  }

  #welcome(): WelcomeMessage {
    return { t: 'welcome', session: this.id, view: this.#view(), driver: this.#driver, messages: this.#messages, ...this.identity };
  }

  #broadcast(message: ServerMessage): void {
    for (const l of this.#listeners) l(message);
  }

  #publish(frames: ViewFrame[]): void {
    if (!this.listening) return;
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

  holdEvents(): void {
    const events = this.#sim.drainEvents();
    this.#held.push(...events);
    this.#pendingEvents.push(...events);
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
        drain();
        if (sim.tick % FRAME_TICKS === 0) this.#capture(frames);
      },
    };
  }

  #capture(frames: ViewFrame[]): void {
    const events = this.#pendingEvents.splice(0);
    this.#followMusic(events);
    this.#followMessages(events);
    const messages = this.#takeFramedMessages();
    if (!this.listening) return;
    const view = this.#view();
    const diff = diffPlayerView(this.#lastView, view);
    this.#lastView = view;
    const extra = { ...(events.length > 0 ? { events } : {}), ...messages };
    const frame = Object.keys(extra).length > 0 ? { ...(diff ?? { tick: view.tick, changed: [], removed: [] }), ...extra } : diff;
    if (frame) frames.push(frame);
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
    this.hooks?.beforeDispatch?.(this, cmd);
    this.log.append(cmd.type === 'answer' ? 'answer' : 'cmd', this.#sim.tick, { cmd });
    const result = this.#sim.dispatch(cmd);
    const refusal = refusalEntry(this.#sim.tick, cmd, result, this.#messageFacts());
    if (refusal) this.#recordMessages([refusal]);
    this.hooks?.afterDispatch?.(this, cmd, result);
    const frames: ViewFrame[] = [];
    this.#capture(frames);
    this.#publish(frames);
    if (result.ok && this.#driver.mode === 'instant') yield* this.#loggedAdvance({ idle: true }, undefined, due);
    return result;
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
    const ticks = Math.floor(this.#carryMs / TICK_MS);
    if (ticks <= 0) return;
    this.#carryMs -= ticks * TICK_MS;
    const pauseOn = this.#driver.pauseOn ?? [];
    const report = finish(this.#input(this.#realtimeRun(ticks, pauseOn)));
    if (report.reason === 'decision') this.setDriver({ mode: 'manual' });
    if (report.reason === 'event') {
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
  ): void {
    const wasRunning = this.#driver.mode === 'realtime';
    this.#stopTimer();
    this.#driver = { mode: 'manual' };
    this.log.append('load', this.#sim.tick, { ...loaded });
    this.#held.length = 0;
    this.#pendingEvents.length = 0;
    this.#sim = sim;
    sim.useLabels?.(this.#labels);
    this.#music = music;
    this.#fastFade = false;
    this.restoreMessages(messages);
    const welcome = this.#welcome();
    this.#lastView = welcome.view;
    if (wasRunning) this.#broadcast({ t: 'stopped', id: LOADED_STOP_ID, report: this.#loadedStop() });
    this.#broadcast(welcome);
  }

  #loadedStop(): SessionStopReport {
    return { tick: this.#sim.tick, reason: 'loaded', events: [] };
  }

  close(): void {
    this.#stopTimer();
    this.#listeners.clear();
  }
}
