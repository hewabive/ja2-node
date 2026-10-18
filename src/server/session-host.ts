import type { DataVersion, UiLanguage } from '../content/text/data-version.ts';
import type { CommandEnvelope, DriverMode } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { StopCondition, StopReport } from '../sim/advance.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SaveImportReport } from '../sim/tactical/save-import.ts';
import type { LogSegment } from './input-log.ts';
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
  advance(until: StopCondition, budget?: number): Promise<StopReport>;
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
  close(): Promise<void>;
}

export type HostFactory = (id: string, request: SessionRequest) => Promise<SessionHost>;

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

  #queued<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.#closing) return Promise.reject(new Error(`session ${this.id} is closed`));
    const run = this.#tail.then(work);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #withSaves<T>(work: (saves: SaveService) => T | Promise<T>): Promise<T> {
    return this.#queued(() => {
      if (!this.#saves) throw new SaveLoadError('notFound', NO_SAVES);
      return work(this.#saves);
    });
  }

  dispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    return this.#queued(() => this.session.dispatchSliced(cmd, this.#slicer));
  }

  prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    return this.#queued(() => this.session.prepareAndDispatch(cmd, this.#slicer));
  }

  advance(until: StopCondition, budget?: number): Promise<StopReport> {
    return this.#queued(() => this.session.advanceSliced(until, budget, this.#slicer));
  }

  setDriver(driver: DriverMode): Promise<void> {
    return this.#queued(() => this.session.setDriverSliced(driver, this.#slicer));
  }

  subscribe(listener: Listener): () => void {
    return this.session.subscribe(listener);
  }

  save(request: SaveRequest): Promise<SaveOutcome> {
    return this.#withSaves((saves) => saves.save(this.session, request));
  }

  saveSnapshot(name: string, description?: string): Promise<SaveOutcome> {
    return this.#withSaves((saves) => saves.snapshot(this.session, name, description));
  }

  load(name: string, reseed: boolean): Promise<LoadOutcome> {
    return this.#withSaves((saves) => saves.loadInto(this.session, name, reseed));
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
    return this.#queued(() => snapshotText(sessionSnapshot(this.session)));
  }

  inputLog(): Promise<LogSegment> {
    return this.#queued(() => this.session.log.full());
  }

  close(): Promise<void> {
    this.#closing ??= this.#queued(async () => {
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
