import type { CommandEnvelope, DriverMode } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { SimEventType } from '../../sim/events.ts';
import type { HintAnswer, HintReply } from '../../ui/game-client.ts';
import type { MapClient, MapCommandReply } from '../../ui/screens/map/environment.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';

const UPDATE_BOX_EVENTS: readonly SimEventType[] = ['assignmentDone', 'fellAsleep', 'wokeUp', 'contractsExpiringSoon'];
const SCREEN_INDEPENDENT_BOX_EVENTS: readonly SimEventType[] = ['sectorLost', 'invasion'];
const BOX_EVENTS: readonly SimEventType[] = [...UPDATE_BOX_EVENTS, ...SCREEN_INDEPENDENT_BOX_EVENTS];
const REAL_TIME: DriverMode = { mode: 'realtime', speed: 1, pauseOn: BOX_EVENTS };
const MANUAL: DriverMode = { mode: 'manual' };
const PAUSED_REFUSAL = 'paused';
const AUTORESOLVE_FLOW = 'autoresolve';

export interface MapCommandRecord {
  readonly cmd: CommandEnvelope;
  readonly reply: MapCommandReply;
}

export class SessionMapClient implements MapClient {
  readonly commands: MapCommandRecord[] = [];
  readonly #session: SessionClient;
  readonly #hints: HintProvider;
  readonly #holds = new Set<string>();
  readonly #timeHeld: boolean;
  #paused = false;
  #enabled = false;
  #driving = false;
  #serverStopped = false;

  constructor(session: SessionClient, hints: HintProvider, timeHeld = false) {
    this.#session = session;
    this.#hints = hints;
    this.#timeHeld = timeHeld;
  }

  get view(): PlayerView | null {
    return this.#session.view;
  }

  get latestView(): PlayerView | null {
    return this.#session.latestView;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get holds(): readonly string[] {
    return [...this.#holds];
  }

  get caughtUp(): boolean {
    return this.#session.shownTick >= this.#session.latestTick;
  }

  start(): void {
    this.#enabled = true;
    this.sync();
  }

  stop(): void {
    this.#enabled = false;
    this.#holds.clear();
    this.sync();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    this.sync();
  }

  holdTime(reason: string, held: boolean): void {
    if (held) this.#holds.add(reason);
    else this.#holds.delete(reason);
    this.sync();
  }

  #wantsTime(): boolean {
    const view = this.#session.latestView;
    return (
      this.#enabled &&
      !this.#paused &&
      !this.#serverStopped &&
      this.#holds.size === 0 &&
      !view?.prompt &&
      !view?.contractPrompt &&
      view?.strategic?.flow !== AUTORESOLVE_FLOW
    );
  }

  sync(): void {
    if (this.#timeHeld) return;
    const realtime = this.#session.driver.mode === 'realtime';
    if (this.#driving && !realtime) this.#serverStopped = true;
    if (this.#serverStopped && this.caughtUp) this.#serverStopped = false;
    this.#driving = realtime;
    const wants = this.#wantsTime();
    if (wants && !realtime) {
      this.#driving = true;
      void this.#session.drive(REAL_TIME);
    } else if (!wants && realtime) {
      this.#driving = false;
      void this.#session.drive(MANUAL);
    }
  }

  async command(cmd: CommandEnvelope): Promise<MapCommandReply> {
    const reply = this.#paused ? { ok: false, reason: PAUSED_REFUSAL } : await this.#session.command(cmd);
    this.commands.push({ cmd, reply });
    return reply;
  }

  hint(request: CommandEnvelope): HintReply {
    return this.#hints.hint(request);
  }

  hintNow(request: CommandEnvelope): Promise<HintAnswer> {
    return this.#hints.hintNow(request);
  }

  query(request: CommandEnvelope): Promise<HintAnswer> {
    return this.#hints.query(request);
  }
}
