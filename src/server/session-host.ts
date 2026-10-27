import type { ProfileFaceRecord } from '../content/narrative/profile-presentation.ts';
import type { DataVersion, UiLanguage } from '../content/text/data-version.ts';
import type { CommandEnvelope, DriverMode, InputTimingView, SessionAdvanceReport, SessionHealthView } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { StopCondition } from '../sim/advance.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SaveImportReport } from '../sim/tactical/save-import.ts';
import type { LogSegment } from './input-log.ts';
import { threadLoopDelay } from './loop-delay.ts';
import { isQueryCommand, type QueryAnswer } from './query.ts';
import { snapshotText } from './save-file.ts';
import { saveStatus } from './save-rules.ts';
import { type LoadOutcome, SaveLoadError, type SaveOutcome, type SaveRequest, type SaveService, sessionSnapshot } from './save-service.ts';
import type { Listener, Session } from './session.ts';
import { describeSession, importReport, optionsStatus, type SessionFactory, type SessionRequest } from './session-registry.ts';
import { type Slicer, SliceScheduler, TimeSlicer } from './slicing.ts';

export const SESSION_HOST_ENV = 'JA2_SESSION_HOST';
export const SESSION_HOST_KINDS = ['inprocess', 'worker'] as const;

export type SessionHostKind = (typeof SESSION_HOST_KINDS)[number];

export type SessionDescription = Record<string, unknown>;

export interface SessionObservation {
  readonly view: PlayerView;
  readonly language: UiLanguage;
  readonly dataVersion: DataVersion;
  readonly status: Readonly<Record<string, unknown>>;
}

export interface CreationReport {
  readonly load?: LoadOutcome;
  readonly import?: SaveImportReport;
}

export interface SessionHost {
  readonly id: string;
  readonly kind: SessionHostKind;
  readonly savesAvailable: boolean;
  dispatch(cmd: CommandEnvelope): Promise<CommandResult>;
  prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult>;
  query(q: CommandEnvelope): Promise<QueryAnswer>;
  advance(until: StopCondition, budget?: number, options?: AdvanceOptions): Promise<SessionAdvanceReport>;
  setDriver(driver: DriverMode): Promise<void>;
  subscribe(listener: Listener): () => void;
  save(request: SaveRequest): Promise<SaveOutcome>;
  saveSnapshot(name: string, description?: string): Promise<SaveOutcome>;
  load(name: string, reseed: boolean): Promise<LoadOutcome>;
  describe(): Promise<SessionDescription>;
  observe(): Promise<SessionObservation>;
  report(): Promise<CreationReport>;
  snapshot(): Promise<string>;
  inputLog(): Promise<LogSegment>;
  profiles(): Promise<readonly ProfileFaceRecord[]>;
  health(): Promise<SessionHealthView>;
  close(): Promise<void>;
}

export type HostFactory = (id: string, request: SessionRequest) => Promise<SessionHost>;

export interface AdvanceOptions {
  readonly waitInRealtime?: boolean;
}

export function sessionHostKind(env: NodeJS.ProcessEnv = process.env): SessionHostKind {
  const wanted = env[SESSION_HOST_ENV]?.trim() || 'inprocess';
  const kind = SESSION_HOST_KINDS.find((k) => k === wanted);
  if (!kind) throw new Error(`${SESSION_HOST_ENV} must be one of ${SESSION_HOST_KINDS.join(', ')}`);
  return kind;
}

export function observeSession(session: Session): SessionObservation {
  return {
    view: session.sim.view(),
    language: session.language,
    dataVersion: session.dataVersion,
    status: { ...optionsStatus(session.sim), ...saveStatus(session.sim) },
  };
}

export interface InProcessHostOptions {
  readonly saves?: SaveService | null;
  readonly slicer?: Slicer;
}

const NO_SAVES = 'saves are not available';

export class InProcessHost implements SessionHost {
  readonly kind = 'inprocess';
  readonly session: Session;
  readonly #saves: SaveService | null;
  readonly #slicer: Slicer;
  #tail: Promise<unknown> = Promise.resolve();
  #closing: Promise<void> | null = null;
  #pending = 0;
  #last: InputTimingView | null = null;

  constructor(session: Session, options: InProcessHostOptions = {}) {
    this.session = session;
    this.#saves = options.saves ?? null;
    this.#slicer = options.slicer ?? new TimeSlicer(new SliceScheduler());
  }

  get id(): string {
    return this.session.id;
  }

  get savesAvailable(): boolean {
    return this.#saves !== null;
  }

  #queued<T>(label: string, work: () => T | Promise<T>): Promise<T> {
    if (this.#closing) return Promise.reject(new Error(`session ${this.id} is closed`));
    const queuedAt = performance.now();
    this.#pending++;
    const run = this.#tail.then(() => this.#timed(label, queuedAt, work));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #timed<T>(label: string, queuedAt: number, work: () => T | Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const tick = this.session.sim.tick;
    try {
      return await work();
    } finally {
      this.#pending--;
      this.#last = {
        label,
        waitedMs: Math.round(startedAt - queuedAt),
        ranMs: Math.round(performance.now() - startedAt),
        ticks: this.session.sim.tick - tick,
      };
    }
  }

  #withSaves<T>(label: string, work: (saves: SaveService) => T | Promise<T>): Promise<T> {
    return this.#queued(label, () => {
      if (!this.#saves) throw new SaveLoadError('notFound', NO_SAVES);
      return work(this.#saves);
    });
  }

  dispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    if (isQueryCommand(cmd)) return this.query(cmd);
    return this.#queued(cmd.type, () => this.session.dispatchSliced(cmd, this.#slicer));
  }

  prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    if (isQueryCommand(cmd)) return this.query(cmd);
    return this.#queued(cmd.type, () => this.session.prepareAndDispatch(cmd, this.#slicer));
  }

  query(q: CommandEnvelope): Promise<QueryAnswer> {
    if (this.#closing) return Promise.reject(new Error(`session ${this.id} is closed`));
    return Promise.resolve().then(() => this.session.query(q));
  }

  advance(until: StopCondition, budget?: number, options: AdvanceOptions = {}): Promise<SessionAdvanceReport> {
    if (!options.waitInRealtime) return this.#queued('advance', () => this.session.advanceSliced(until, budget, this.#slicer));
    return this.#queued('advance', () => this.#advanceOrWait(until, budget)).then((started) => started.report);
  }

  async #advanceOrWait(until: StopCondition, budget: number | undefined): Promise<{ readonly report: Promise<SessionAdvanceReport> }> {
    const waiting = this.session.waitInRealtime(until, budget);
    if (waiting) return { report: waiting };
    return { report: Promise.resolve(await this.session.advanceSliced(until, budget, this.#slicer)) };
  }

  setDriver(driver: DriverMode): Promise<void> {
    return this.#queued('drive', () => this.session.setDriverSliced(driver, this.#slicer));
  }

  subscribe(listener: Listener): () => void {
    return this.session.subscribe(listener);
  }

  save(request: SaveRequest): Promise<SaveOutcome> {
    return this.#withSaves('save', (saves) => saves.save(this.session, request));
  }

  saveSnapshot(name: string, description?: string): Promise<SaveOutcome> {
    return this.#withSaves('saveSnapshot', (saves) => saves.snapshot(this.session, name, description));
  }

  load(name: string, reseed: boolean): Promise<LoadOutcome> {
    return this.#withSaves('load', (saves) => saves.loadInto(this.session, name, reseed));
  }

  describe(): Promise<SessionDescription> {
    return Promise.resolve().then(() => describeSession(this.session));
  }

  observe(): Promise<SessionObservation> {
    return Promise.resolve().then(() => observeSession(this.session));
  }

  report(): Promise<CreationReport> {
    return Promise.resolve().then(() => {
      const load = this.#saves?.lastLoad(this.session);
      return { ...(load ? { load } : {}), ...importReport(this.session) };
    });
  }

  snapshot(): Promise<string> {
    return this.#queued('snapshot', () => snapshotText(sessionSnapshot(this.session)));
  }

  inputLog(): Promise<LogSegment> {
    return this.#queued('inputLog', () => this.session.log.full());
  }

  profiles(): Promise<readonly ProfileFaceRecord[]> {
    return Promise.resolve().then(() => this.session.sim.profileFaceRecords?.() ?? []);
  }

  health(): Promise<SessionHealthView> {
    return Promise.resolve().then(() => ({
      tick: this.session.sim.tick,
      pending: this.#pending,
      last: this.#last,
      loopDelayMs: threadLoopDelay().takeMaxMs(),
    }));
  }

  close(): Promise<void> {
    this.#closing ??= this.#queued('close', async () => {
      if (this.#saves) await this.#saves.closeSession(this.session);
      this.session.close();
    });
    return this.#closing;
  }
}

export function inProcessHostFactory(
  create: SessionFactory,
  saves: SaveService | null,
  scheduler: SliceScheduler = new SliceScheduler(),
): HostFactory {
  return async (id, request) => new InProcessHost(await create(id, request), { saves, slicer: new TimeSlicer(scheduler) });
}
