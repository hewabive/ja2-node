import { randomInt } from 'node:crypto';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { StopReport } from '../sim/advance.ts';
import type { CommandResult } from '../sim/command.ts';
import { type DroppedNativeOption, type GameOptions, importNativeGameOptions, type SaveMode } from '../sim/options.ts';
import { reseedMain } from '../sim/snapshot/session.ts';
import { CampaignSession } from './campaign-session.ts';
import { type ContentSource, type EngineIdentity, type LogicIdentity, textIdentityOf } from './content-identity.ts';
import { describeOrigin, encodeInputLog, encodeInputLogAsync, inputLogText, isReplayable, type LogSegment } from './input-log.ts';
import { TacticalSession } from './sandbox.ts';
import {
  clampDescription,
  encodeSaveFileAsync,
  inflateSave,
  musicOfPresentation,
  parseSaveText,
  presentationOf,
  RULE_PACK_SAVE_VERSION,
  SAVE_FORMAT,
  SAVE_VERSION,
  type SaveFile,
  SaveFileError,
  type SaveFileHead,
  type SaveHeader,
  type SaveKind,
  snapshotOf,
  summarizeSession,
} from './save-file.ts';
import {
  aboutToArriveFired,
  canGameBeSaved,
  deadIsDeadWritable,
  groupsAboutToArrive,
  inTurnBasedCombat,
  type PendingArrival,
  SAVE_REFUSAL_MESSAGES,
  type SaveRefusal,
  saveModeOf,
  saveRefusal,
  startsMeanwhile,
  startsOurTurn,
} from './save-rules.ts';
import { isReservedSaveName, isValidSaveName, MAX_UPLOAD_BYTES, playerSaveName, QUICK_SAVE_NAME, type SaveStore } from './save-store.ts';
import type { Session, SessionSim } from './session.ts';
import { type SessionSnapshot, snapshotSession } from './session-snapshot.ts';

export const QUICK_ALIAS = 'quick';
const SEED_LIMIT = 2 ** 32;
const WARNED_LOGIC_SOURCE: ContentSource = 'stubs';
const LOGIC_DIFFERENCE_WARNING: LoadWarning = 'stubPackDiffers';

export type LoadProblem =
  | 'notFound'
  | 'invalidName'
  | 'contentMismatch'
  | 'versionTooNew'
  | 'noMigration'
  | 'notASave'
  | 'corrupt'
  | 'tooLarge';

export type LoadWarning = 'dataVersionDiffers' | 'engineDiffers' | 'stubPackDiffers';

export type SaveProblem = SaveRefusal | 'invalidName' | 'reservedName' | 'notSaveable' | 'actionInProgress';

export class SaveLoadError extends Error {
  readonly problem: LoadProblem;

  constructor(problem: LoadProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export type SaveOutcome =
  | { readonly ok: true; readonly name: string; readonly kind: SaveKind; readonly header: SaveHeader }
  | { readonly ok: false; readonly refused: SaveProblem; readonly reason: string };

export interface LoadOutcome {
  readonly ok: true;
  readonly name: string;
  readonly seed: number | null;
  readonly warnings: readonly LoadWarning[];
  readonly header: SaveHeader;
}

export interface OpenedSave {
  readonly name: string;
  readonly digest: string;
  readonly file: SaveFile;
  readonly sim: SessionSim;
  readonly warnings: readonly LoadWarning[];
}

export interface SaveRequest {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
}

export interface SaveContextInput {
  readonly deadIsDeadName?: string | null | undefined;
}

export interface SaveServiceOptions {
  readonly store: SaveStore;
  readonly identity: LogicIdentity;
  readonly dataVersion: string;
  readonly engine: EngineIdentity;
  readonly restore: (snapshot: SessionSnapshot) => Promise<SessionSim>;
  readonly entropy?: () => number;
  readonly now?: () => Date;
  readonly warn?: (message: string) => void;
}

export type SaveListing =
  | {
      readonly name: string;
      readonly native: false;
      readonly modified: string;
      readonly header: SaveHeader | null;
      readonly version: number | null;
      readonly compatible: boolean;
      readonly problems: readonly string[];
      readonly warnings: readonly LoadWarning[];
    }
  | {
      readonly name: string;
      readonly native: true;
      readonly modified: string;
      readonly header: NativeListingHeader;
      readonly compatible: boolean;
      readonly problems: readonly string[];
    };

export interface NativeListingHeader {
  readonly description: string;
  readonly world: { readonly day: number; readonly hour: number; readonly minute: number };
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
  readonly mercs: number;
  readonly balance: number;
  readonly version: number;
  readonly options: GameOptions;
  readonly droppedOptions?: readonly DroppedNativeOption[];
}

export interface UploadOutcome {
  readonly ok: true;
  readonly name: string;
  readonly header: SaveHeader;
  readonly warnings: readonly LoadWarning[];
}

interface SessionSaveState {
  deadIsDeadName: string | null;
  pendingEndTurn: Capture | null;
  deadIsDeadDue: boolean;
  arrivals: PendingArrival[];
}

interface Capture {
  readonly kind: SaveKind;
  readonly name: string;
  readonly file: SaveFile;
  readonly log: LogSegment | null;
}

const DEFAULT_DEAD_IS_DEAD_NAME = 'DeadIsDead';
const AUTO_PENDING_NAME = 'Auto';

function sessionStateOf(sim: SessionSim): { readonly rng: Parameters<typeof reseedMain>[0]['rng'] } {
  if (sim instanceof CampaignSession) return sim.campaign.state;
  if (sim instanceof TacticalSession) return sim.sim.state;
  throw new Error('this session kind cannot be reseeded');
}

export function reseedSessionSim(sim: SessionSim, seed: number): void {
  reseedMain(sessionStateOf(sim), seed);
}

export function sessionSnapshot(session: Session): SessionSnapshot {
  if (session.sim instanceof CampaignSession) session.holdEvents();
  return snapshotSession(session.sim);
}

export function loadProblemOf(err: unknown): LoadProblem {
  if (err instanceof SaveLoadError) return err.problem;
  if (err instanceof SaveFileError) return err.problem;
  return 'corrupt';
}

function textOf(sim: SessionSim): unknown {
  return sim instanceof CampaignSession ? sim.origin?.parts.narrative.texts : null;
}

export class SaveService {
  readonly store: SaveStore;
  readonly identity: LogicIdentity;
  readonly #options: SaveServiceOptions;
  readonly #states = new WeakMap<Session, SessionSaveState>();
  readonly #attached = new Set<Session>();
  readonly #loads = new WeakMap<Session, LoadOutcome>();
  #writes: Promise<unknown> = Promise.resolve();

  constructor(options: SaveServiceOptions) {
    this.#options = options;
    this.store = options.store;
    this.identity = options.identity;
  }

  get engine(): EngineIdentity {
    return this.#options.engine;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #entropy(): number {
    return this.#options.entropy?.() ?? randomInt(0, SEED_LIMIT);
  }

  #warn(message: string): void {
    this.#options.warn?.(message);
  }

  #state(session: Session): SessionSaveState {
    let state = this.#states.get(session);
    if (!state) {
      state = { deadIsDeadName: null, pendingEndTurn: null, deadIsDeadDue: false, arrivals: [] };
      this.#states.set(session, state);
    }
    return state;
  }

  attach(session: Session, context: SaveContextInput = {}): void {
    const state = this.#state(session);
    if (context.deadIsDeadName !== undefined) state.deadIsDeadName = context.deadIsDeadName;
    this.#attached.add(session);
    session.hooks = {
      beforeDispatch: (s, cmd) => this.#guarded(() => this.#beforeDispatch(s, cmd)),
      afterDispatch: (s, cmd, result) => this.#guarded(() => this.#afterDispatch(s, cmd, result)),
      beforeAdvance: (s) => this.#guarded(() => this.#beforeAdvance(s)),
      afterAdvance: (s, report) => this.#guarded(() => this.#afterAdvance(s, report)),
      afterInput: (s) => this.#guarded(() => this.#afterInput(s)),
      failed: (s) => this.#guarded(() => this.#failed(s)),
    };
  }

  #guarded(work: () => void): void {
    try {
      work();
    } catch (err) {
      this.#warn(`automatic save skipped: ${(err as Error).message}`);
    }
  }

  detach(session: Session): void {
    this.#attached.delete(session);
    session.hooks = null;
  }

  deadIsDeadName(session: Session): string {
    return this.#state(session).deadIsDeadName ?? DEFAULT_DEAD_IS_DEAD_NAME;
  }

  lastLoad(session: Session): LoadOutcome | null {
    return this.#loads.get(session) ?? null;
  }

  flush(): Promise<void> {
    return this.#writes.then(() => undefined);
  }

  #enqueue(work: () => Promise<unknown>): Promise<void> {
    const next = this.#writes.then(work);
    this.#writes = next.catch((err: Error) => this.#warn(`save failed: ${err.message}`));
    return next.then(() => undefined);
  }

  saveFileOf(session: Session, description = ''): SaveFile {
    return this.#capture(session, 'player', '', description).file;
  }

  #capture(session: Session, kind: SaveKind, name: string, description: string): Capture {
    const snapshot = sessionSnapshot(session);
    const summary = summarizeSession(session.sim);
    const segment = session.log.segment();
    const header: SaveHeader = {
      kind,
      description: clampDescription(description),
      savedAt: this.#now().toISOString(),
      engine: this.#options.engine,
      content: {
        source: this.identity.source,
        dataVersion: this.#options.dataVersion,
        logic: this.identity.hash,
        text: textIdentityOf(textOf(session.sim)),
      },
      options: summary.options,
      world: summary.world,
      sector: summary.sector,
      flow: summary.flow,
      mercs: summary.mercs,
      balance: summary.balance,
      campaign: summary.campaign,
      session: snapshot.session,
      tick: summary.tick,
    };
    const file: SaveFile = {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      header,
      session: { kind: snapshot.session, origin: describeOrigin(segment.origin), tick: summary.tick, preparedMaps: snapshot.preparedMaps },
      sim: snapshot.sim,
      presentation: presentationOf(session.music),
    };
    return { kind, name, file, log: isReplayable(segment.origin) ? segment : null };
  }

  async #encode(capture: Capture, name: string): Promise<{ bytes: Uint8Array; log: Uint8Array | null }> {
    const file: SaveFile =
      capture.kind === 'auto' ? { ...capture.file, header: { ...capture.file.header, description: name } } : capture.file;
    const bytes = (await encodeSaveFileAsync(file)).bytes;
    return { bytes, log: capture.log ? await encodeInputLogAsync(inputLogText(capture.log, name)) : null };
  }

  #write(capture: Capture): Promise<void> {
    return this.#enqueue(async () =>
      this.store.write(capture.name, { ...(await this.#encode(capture, capture.name)), backups: capture.kind === 'deadIsDead' }),
    );
  }

  #refused(refused: SaveProblem, reason: string): SaveOutcome {
    return { ok: false, refused, reason };
  }

  #saveable(session: Session): boolean {
    const sim = session.sim;
    return sim instanceof CampaignSession ? sim.origin !== null : sim instanceof TacticalSession;
  }

  #target(session: Session, request: SaveRequest): { kind: SaveKind; name: string } | SaveOutcome {
    const quick = request.name === QUICK_ALIAS || request.name === QUICK_SAVE_NAME;
    if (quick && saveModeOf(session.sim) === 'deadIsDead') return { kind: 'deadIsDead', name: this.deadIsDeadName(session) };
    if (quick) return { kind: 'quick', name: QUICK_SAVE_NAME };
    if (request.name !== undefined) {
      if (!isValidSaveName(request.name)) return this.#refused('invalidName', `invalid save name ${JSON.stringify(request.name)}`);
      if (isReservedSaveName(request.name)) return this.#refused('reservedName', `${request.name} is reserved`);
      return { kind: 'player', name: request.name };
    }
    return { kind: 'player', name: playerSaveName(request.description ?? '', this.#now()) };
  }

  async save(session: Session, request: SaveRequest = {}): Promise<SaveOutcome> {
    if (!this.#saveable(session)) return this.#refused('notSaveable', 'this session kind cannot be saved');
    const target = this.#target(session, request);
    if ('ok' in target) return target;
    const refusal = saveRefusal(session.sim, target.kind === 'player' ? 'player' : 'quick');
    if (refusal) return this.#refused(refusal, SAVE_REFUSAL_MESSAGES[refusal]);
    if (target.kind === 'deadIsDead' && !deadIsDeadWritable(session.sim))
      return this.#refused('actionInProgress', 'Dead is Dead saves only on our turn with nothing in progress');
    const description = request.description ?? (target.kind === 'quick' ? QUICK_SAVE_NAME : target.name);
    const capture = this.#capture(session, target.kind, target.name, description);
    await this.#write(capture);
    if (target.kind !== 'deadIsDead') session.notify({ type: 'gameSaved', name: target.name, kind: target.kind, tick: session.sim.tick });
    return { ok: true, name: target.name, kind: target.kind, header: capture.file.header };
  }

  async snapshot(session: Session, name: string, description = name): Promise<SaveOutcome> {
    if (!this.#saveable(session)) return this.#refused('notSaveable', 'this session kind cannot be saved');
    if (!isValidSaveName(name)) return this.#refused('invalidName', `invalid save name ${JSON.stringify(name)}`);
    const capture = this.#capture(session, 'player', name, description);
    await this.#write(capture);
    return { ok: true, name, kind: 'player', header: capture.file.header };
  }

  async #verify(name: string, file: SaveFile): Promise<LoadWarning[]> {
    const content = file.header.content;
    if (content.source !== this.identity.source)
      throw new SaveLoadError(
        'contentMismatch',
        `${name} was made with ${content.source} content, the server runs ${this.identity.source}`,
      );
    const warnings: LoadWarning[] = [];
    if (!(await this.#sameLogic(file))) {
      if (!this.#logicDifferenceWarns())
        throw new SaveLoadError('contentMismatch', `${name} was made with other game data (the rule pack differs)`);
      warnings.push(LOGIC_DIFFERENCE_WARNING);
    }
    if (content.dataVersion !== this.#options.dataVersion) warnings.push('dataVersionDiffers');
    const engine = file.header.engine;
    if (engine.version !== this.#options.engine.version || engine.commit !== this.#options.engine.commit) warnings.push('engineDiffers');
    return warnings;
  }

  #sameLogic(file: SaveFile): Promise<boolean> {
    const logic = file.header.content.logic;
    if (!file.legacyContent) return Promise.resolve(this.identity.matches(logic));
    return this.identity.matchesLegacy(file.legacyContent.files, { logic, commit: file.header.engine.commit });
  }

  #logicDifferenceWarns(): boolean {
    return this.identity.source === WARNED_LOGIC_SOURCE;
  }

  async #decode(name: string, bytes: Uint8Array): Promise<{ file: SaveFile; digest: string; warnings: LoadWarning[] }> {
    const { text, digest } = inflateSave(bytes);
    const file = parseSaveText(text);
    const warnings = await this.#verify(name, file);
    return { file, digest, warnings };
  }

  async open(name: string): Promise<OpenedSave> {
    if (!isValidSaveName(name)) throw new SaveLoadError('invalidName', `invalid save name ${JSON.stringify(name)}`);
    const bytes = await this.store.read(name);
    if (!bytes) throw new SaveLoadError('notFound', `no save named ${name}`);
    const { file, digest, warnings } = await this.#decode(name, bytes);
    const sim = await this.#options.restore(snapshotOf(file));
    const text = textIdentityOf(textOf(sim));
    if (text !== file.header.content.text && !warnings.includes('dataVersionDiffers')) warnings.push('dataVersionDiffers');
    return { name, digest, file, sim, warnings };
  }

  completeLoad(session: Session, opened: OpenedSave, reseed: boolean): LoadOutcome {
    const state = this.#state(session);
    if (opened.file.header.options.saveMode === 'deadIsDead') state.deadIsDeadName = opened.name;
    state.pendingEndTurn = null;
    state.deadIsDeadDue = false;
    let seed: number | null = null;
    if (reseed) {
      const chosen = this.#entropy();
      session.reseed(chosen, () => reseedSessionSim(session.sim, chosen));
      seed = chosen;
    }
    session.notify({ type: 'gameLoaded', name: opened.name, seed, tick: session.sim.tick });
    const outcome: LoadOutcome = { ok: true, name: opened.name, seed, warnings: opened.warnings, header: opened.file.header };
    this.#loads.set(session, outcome);
    return outcome;
  }

  async loadInto(session: Session, name: string, reseed = true): Promise<LoadOutcome> {
    if (!isValidSaveName(name)) throw new SaveLoadError('invalidName', `invalid save name ${JSON.stringify(name)}`);
    this.#deadIsDeadSavePoint(session);
    const opened = await this.open(name);
    session.replace(opened.sim, { name: opened.name, digest: opened.digest }, musicOfPresentation(opened.file.presentation));
    return this.completeLoad(session, opened, reseed);
  }

  async list(): Promise<SaveListing[]> {
    const own = (await this.store.list()).map((s): SaveListing => {
      const problems: string[] = [];
      const warnings: LoadWarning[] = [];
      if (s.problem) problems.push(s.problem);
      if (s.head && s.head.version > SAVE_VERSION) problems.push('versionTooNew');
      if (s.head && this.#otherSource(s.head)) problems.push('contentMismatch');
      else if (s.head && this.#otherLogic(s.head)) {
        if (this.#logicDifferenceWarns()) warnings.push(LOGIC_DIFFERENCE_WARNING);
        else problems.push('contentMismatch');
      }
      return {
        name: s.name,
        native: false,
        modified: s.head?.header.savedAt ?? new Date(s.modifiedMs).toISOString(),
        header: s.head?.header ?? null,
        version: s.head?.version ?? null,
        compatible: problems.length === 0,
        problems,
        warnings,
      };
    });
    const native = (await this.store.listNative()).map((s): SaveListing => {
      const h = s.header;
      const problems = this.identity.source === 'original' ? [] : ['needsOriginalData'];
      const imported = importNativeGameOptions(h.initialGameOptions);
      return {
        name: s.name,
        native: true,
        modified: new Date(s.modifiedMs).toISOString(),
        header: {
          description: h.description,
          world: { day: h.day, hour: h.hour, minute: h.minute },
          sector: h.sector,
          mercs: h.mercsOnPlayerTeam,
          balance: h.currentBalance,
          version: h.version,
          options: imported.options,
          ...(imported.dropped.length > 0 ? { droppedOptions: imported.dropped } : {}),
        },
        compatible: problems.length === 0,
        problems,
      };
    });
    return [...own, ...native].sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : a.name < b.name ? -1 : 1));
  }

  #otherSource(head: SaveFileHead): boolean {
    return head.header.content?.source !== this.identity.source;
  }

  #otherLogic(head: SaveFileHead): boolean {
    return head.version >= RULE_PACK_SAVE_VERSION && !this.identity.matches(head.header.content.logic);
  }

  async delete(name: string): Promise<boolean> {
    if (!isValidSaveName(name)) throw new SaveLoadError('invalidName', `invalid save name ${JSON.stringify(name)}`);
    return this.store.delete(name);
  }

  async download(name: string): Promise<Uint8Array> {
    if (!isValidSaveName(name)) throw new SaveLoadError('invalidName', `invalid save name ${JSON.stringify(name)}`);
    const bytes = await this.store.read(name);
    if (!bytes) throw new SaveLoadError('notFound', `no save named ${name}`);
    return bytes;
  }

  async upload(name: string, bytes: Uint8Array): Promise<UploadOutcome> {
    if (!isValidSaveName(name) || isReservedSaveName(name))
      throw new SaveLoadError('invalidName', `invalid or reserved save name ${JSON.stringify(name)}`);
    if (bytes.length > MAX_UPLOAD_BYTES) throw new SaveLoadError('tooLarge', `a save may hold at most ${MAX_UPLOAD_BYTES} bytes`);
    const { file, warnings } = await this.#decode(name, bytes);
    await this.#enqueue(() => this.store.write(name, { bytes, log: null, backups: false }));
    return { ok: true, name, header: file.header, warnings };
  }

  #beforeDispatch(session: Session, cmd: CommandEnvelope): void {
    const state = this.#state(session);
    state.pendingEndTurn = null;
    if (cmd.type !== 'endTurn' || !inTurnBasedCombat(session.sim) || !this.#saveable(session)) return;
    const mode: SaveMode = saveModeOf(session.sim);
    if (mode === 'deadIsDead') {
      if (deadIsDeadWritable(session.sim))
        state.pendingEndTurn = this.#capture(session, 'deadIsDead', this.deadIsDeadName(session), this.deadIsDeadName(session));
      return;
    }
    if (canGameBeSaved(session.sim)) state.pendingEndTurn = this.#capture(session, 'auto', AUTO_PENDING_NAME, AUTO_PENDING_NAME);
  }

  #afterDispatch(session: Session, _cmd: CommandEnvelope, result: CommandResult): void {
    const state = this.#state(session);
    const pending = state.pendingEndTurn;
    state.pendingEndTurn = null;
    if (!pending || !result.ok) return;
    if (pending.kind === 'deadIsDead') {
      void this.#write(pending);
      return;
    }
    if (!inTurnBasedCombat(session.sim)) return;
    void this.#writeAuto(pending);
  }

  async #writeAuto(pending: Capture): Promise<void> {
    await this.#enqueue(async () => {
      const name = await this.store.nextAutoName();
      await this.store.write(name, { ...(await this.#encode(pending, name)), backups: false });
      this.store.noteAutoWritten(name);
    });
  }

  #beforeAdvance(session: Session): void {
    if (saveModeOf(session.sim) !== 'deadIsDead') return;
    this.#state(session).arrivals = groupsAboutToArrive(session.sim);
  }

  #afterAdvance(session: Session, report: StopReport): void {
    if (saveModeOf(session.sim) !== 'deadIsDead') return;
    const state = this.#state(session);
    if (startsOurTurn(report.events) || startsMeanwhile(report.events) || aboutToArriveFired(session.sim, state.arrivals))
      state.deadIsDeadDue = true;
    state.arrivals = [];
  }

  #afterInput(session: Session): void {
    const state = this.#state(session);
    if (!state.deadIsDeadDue || saveModeOf(session.sim) !== 'deadIsDead') return;
    if (!deadIsDeadWritable(session.sim)) return;
    state.deadIsDeadDue = false;
    this.#deadIsDeadSave(session);
  }

  #deadIsDeadSave(session: Session): void {
    const name = this.deadIsDeadName(session);
    void this.#write(this.#capture(session, 'deadIsDead', name, name));
  }

  #deadIsDeadSavePoint(session: Session): void {
    if (!this.#saveable(session) || saveModeOf(session.sim) !== 'deadIsDead' || !deadIsDeadWritable(session.sim)) return;
    this.#deadIsDeadSave(session);
  }

  #failed(session: Session): void {
    const text = inputLogText(session.log.full(), null);
    void this.#enqueue(async () => {
      const path = await this.store.writeErrorLog(encodeInputLog(text));
      this.#warn(`a command threw; the input log is in ${path}`);
    });
  }

  async closeSession(session: Session): Promise<void> {
    this.#deadIsDeadSavePoint(session);
    this.detach(session);
    await this.flush();
  }

  async shutdown(): Promise<void> {
    for (const session of [...this.#attached]) this.#deadIsDeadSavePoint(session);
    await this.flush();
  }
}
