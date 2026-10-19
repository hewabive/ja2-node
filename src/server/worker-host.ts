import { Worker } from 'node:worker_threads';
import type { ProfileFaceRecord } from '../content/narrative/profile-presentation.ts';
import type { CommandEnvelope, DriverMode, ServerMessage, SessionAdvanceReport } from '../protocol/messages.ts';
import type { StopCondition } from '../sim/advance.ts';
import type { CommandResult } from '../sim/command.ts';
import type { LogSegment } from './input-log.ts';
import type { QueryAnswer } from './query.ts';
import { SaveFileError } from './save-file.ts';
import { type LoadOutcome, type LoadProblem, SaveLoadError, type SaveOutcome, type SaveRequest } from './save-service.ts';
import type { Listener } from './session.ts';
import type { SessionEnvironmentConfig } from './session-environment.ts';
import type { CreationReport, HostFactory, SessionDescription, SessionHost, SessionObservation } from './session-host.ts';
import type { SessionRequest } from './session-registry.ts';

const WORKER_ENTRY = new URL('./session-worker.ts', import.meta.url);

export interface WorkerStart {
  readonly id: string;
  readonly request: SessionRequest;
  readonly config: SessionEnvironmentConfig;
}

export interface WireError {
  readonly message: string;
  readonly problem?: LoadProblem;
}

export const HOST_CALLS = [
  'dispatch',
  'prepareAndDispatch',
  'query',
  'advance',
  'setDriver',
  'save',
  'saveSnapshot',
  'load',
  'describe',
  'observe',
  'report',
  'snapshot',
  'inputLog',
  'profiles',
  'close',
] as const;

export type HostCall = (typeof HOST_CALLS)[number];

export type ToWorker =
  | { readonly op: 'call'; readonly seq: number; readonly method: HostCall; readonly args: readonly unknown[] }
  | { readonly op: 'subscribe'; readonly sub: number }
  | { readonly op: 'unsubscribe'; readonly sub: number };

export type FromWorker =
  | { readonly t: 'ready'; readonly savesAvailable: boolean }
  | { readonly t: 'failed'; readonly error: WireError }
  | { readonly t: 'result'; readonly seq: number; readonly value: unknown }
  | { readonly t: 'error'; readonly seq: number; readonly error: WireError }
  | { readonly t: 'message'; readonly sub: number; readonly message: ServerMessage }
  | { readonly t: 'warn'; readonly message: string };

export function wireError(err: unknown): WireError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SaveLoadError || err instanceof SaveFileError) return { message, problem: err.problem };
  return { message };
}

export function errorFromWire(error: WireError): Error {
  return error.problem ? new SaveLoadError(error.problem, error.message) : new Error(error.message);
}

export interface WorkerHostOptions {
  readonly warn?: (message: string) => void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class WorkerHost implements SessionHost {
  readonly kind = 'worker';
  readonly id: string;
  readonly savesAvailable: boolean;
  readonly #worker: Worker;
  readonly #warn: (message: string) => void;
  readonly #pending = new Map<number, PendingCall>();
  readonly #listeners = new Map<number, Listener>();
  #seq = 0;
  #sub = 0;
  #gone: Error | null = null;
  #closing: Promise<void> | null = null;

  private constructor(id: string, worker: Worker, savesAvailable: boolean, options: WorkerHostOptions) {
    this.id = id;
    this.#worker = worker;
    this.savesAvailable = savesAvailable;
    this.#warn = options.warn ?? ((message) => console.warn(message));
    worker.on('message', (m: FromWorker) => this.#receive(m));
    worker.on('error', (err) => this.#lost(err));
    worker.on('exit', (code) => this.#lost(new Error(`session ${id}: worker exited with code ${code}`)));
  }

  static open(id: string, request: SessionRequest, config: SessionEnvironmentConfig, options: WorkerHostOptions = {}): Promise<WorkerHost> {
    const start: WorkerStart = { id, request, config };
    const worker = new Worker(WORKER_ENTRY, { workerData: start });
    const warn = options.warn ?? ((message: string) => console.warn(message));
    return new Promise((resolve, reject) => {
      const settle = () => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onMessage = (m: FromWorker) => {
        if (m.t === 'warn') return warn(m.message);
        if (m.t === 'ready') {
          settle();
          resolve(new WorkerHost(id, worker, m.savesAvailable, options));
        }
        if (m.t === 'failed') {
          settle();
          void worker.terminate();
          reject(errorFromWire(m.error));
        }
      };
      const onError = (err: Error) => {
        settle();
        reject(err);
      };
      const onExit = (code: number) => {
        settle();
        reject(new Error(`session ${id}: worker exited with code ${code} before it was ready`));
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
    });
  }

  #receive(m: FromWorker): void {
    switch (m.t) {
      case 'result':
      case 'error': {
        const call = this.#pending.get(m.seq);
        this.#pending.delete(m.seq);
        if (m.t === 'result') call?.resolve(m.value);
        else call?.reject(errorFromWire(m.error));
        return;
      }
      case 'message':
        this.#listeners.get(m.sub)?.(m.message);
        return;
      case 'warn':
        this.#warn(m.message);
        return;
      default:
        return;
    }
  }

  #lost(err: Error): void {
    this.#gone ??= err;
    for (const call of this.#pending.values()) call.reject(this.#gone);
    this.#pending.clear();
    this.#listeners.clear();
  }

  #post(message: ToWorker): void {
    this.#worker.postMessage(message);
  }

  #call<T>(method: HostCall, ...args: unknown[]): Promise<T> {
    if (this.#gone) return Promise.reject(this.#gone);
    if (this.#closing && method !== 'close') return Promise.reject(new Error(`session ${this.id} is closed`));
    const seq = ++this.#seq;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(seq, { resolve: resolve as (value: unknown) => void, reject });
      this.#post({ op: 'call', seq, method, args });
    });
  }

  dispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    return this.#call('dispatch', cmd);
  }

  prepareAndDispatch(cmd: CommandEnvelope): Promise<CommandResult> {
    return this.#call('prepareAndDispatch', cmd);
  }

  query(q: CommandEnvelope): Promise<QueryAnswer> {
    return this.#call('query', q);
  }

  advance(until: StopCondition, budget?: number): Promise<SessionAdvanceReport> {
    return this.#call('advance', until, budget);
  }

  setDriver(driver: DriverMode): Promise<void> {
    return this.#call('setDriver', driver);
  }

  subscribe(listener: Listener): () => void {
    if (this.#gone) return () => undefined;
    const sub = ++this.#sub;
    this.#listeners.set(sub, listener);
    this.#post({ op: 'subscribe', sub });
    return () => {
      if (this.#listeners.delete(sub) && !this.#gone) this.#post({ op: 'unsubscribe', sub });
    };
  }

  save(request: SaveRequest): Promise<SaveOutcome> {
    return this.#call('save', request);
  }

  saveSnapshot(name: string, description?: string): Promise<SaveOutcome> {
    return this.#call('saveSnapshot', name, description);
  }

  load(name: string, reseed: boolean): Promise<LoadOutcome> {
    return this.#call('load', name, reseed);
  }

  describe(): Promise<SessionDescription> {
    return this.#call('describe');
  }

  observe(): Promise<SessionObservation> {
    return this.#call('observe');
  }

  report(): Promise<CreationReport> {
    return this.#call('report');
  }

  snapshot(): Promise<string> {
    return this.#call('snapshot');
  }

  inputLog(): Promise<LogSegment> {
    return this.#call('inputLog');
  }

  profiles(): Promise<readonly ProfileFaceRecord[]> {
    return this.#call('profiles');
  }

  close(): Promise<void> {
    this.#closing ??= (this.#gone ? Promise.resolve() : this.#call<void>('close'))
      .finally(() => this.#worker.terminate())
      .then(() => undefined);
    return this.#closing;
  }
}

export function workerHostFactory(config: SessionEnvironmentConfig, options: WorkerHostOptions = {}): HostFactory {
  return (id, request) => WorkerHost.open(id, request, config, options);
}
