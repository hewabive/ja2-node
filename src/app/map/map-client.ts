import type { CommandEnvelope, DriverMode } from '../../protocol/messages.ts';
import { sameJson } from '../../protocol/same-json.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { SimEventType } from '../../sim/events.ts';
import type { HintAnswer, HintReply } from '../../ui/game-client.ts';
import type { RefusalListener } from '../../ui/refusal-fallback.ts';
import type { MapClient, MapCommandReply } from '../../ui/screens/map/environment.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';

const UPDATE_BOX_EVENTS: readonly SimEventType[] = ['assignmentDone', 'fellAsleep', 'wokeUp', 'contractsExpiringSoon'];
const SCREEN_INDEPENDENT_BOX_EVENTS: readonly SimEventType[] = ['sectorLost', 'invasion', 'vehicleOutOfGas', 'militiaTrainingRejected'];
const BOX_EVENTS: readonly SimEventType[] = [...UPDATE_BOX_EVENTS, ...SCREEN_INDEPENDENT_BOX_EVENTS];
const MANUAL: DriverMode = { mode: 'manual' };
const AUTORESOLVE_FLOW = 'autoresolve';
const PAUSED_HOLD = 'mapPaused';
const CATCHING_UP_HOLD = 'catchingUp';

export interface MapCommandRecord {
  readonly cmd: CommandEnvelope;
  readonly reply: MapCommandReply;
}

export class SessionMapClient implements MapClient {
  readonly commands: MapCommandRecord[] = [];
  readonly #session: SessionClient;
  readonly #hints: HintProvider;
  readonly #holds = new Set<string>();
  readonly #sentHolds = new Set<string>();
  readonly #timeHeld: boolean;
  #paused = false;
  #enabled = false;
  #driving = false;
  #serverStopped = false;
  #refused: RefusalListener | null = null;

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

  #realTime(): DriverMode {
    return { mode: 'realtime', speed: this.#session.realtimeSpeed, pauseOn: BOX_EVENTS };
  }

  #runsTime(): boolean {
    const view = this.#session.latestView;
    return this.#enabled && !view?.prompt && !view?.contractPrompt && view?.strategic?.flow !== AUTORESOLVE_FLOW;
  }

  #timeHolds(): Set<string> {
    const holds = new Set(this.#holds);
    if (this.#paused) holds.add(PAUSED_HOLD);
    if (this.#serverStopped) holds.add(CATCHING_UP_HOLD);
    return holds;
  }

  #sendHolds(wanted: ReadonlySet<string>): void {
    for (const reason of [...this.#sentHolds, ...wanted]) {
      const held = wanted.has(reason);
      this.#session.hold(reason, held);
      if (held) this.#sentHolds.add(reason);
      else this.#sentHolds.delete(reason);
    }
  }

  sync(): void {
    if (this.#timeHeld) return;
    const realtime = this.#session.driver.mode === 'realtime';
    if (this.#driving && !realtime) this.#serverStopped = true;
    if (this.#serverStopped && this.caughtUp) this.#serverStopped = false;
    const runs = this.#runsTime();
    const realTime = this.#realTime();
    const ours = sameJson(this.#session.driver, realTime);
    if (runs && !ours) void this.#session.drive(realTime);
    else if (!runs && ours) void this.#session.drive(MANUAL);
    this.#driving = sameJson(this.#session.driver, realTime);
    this.#sendHolds(runs ? this.#timeHolds() : new Set());
  }

  onRefused(listener: RefusalListener | null): void {
    this.#refused = listener;
  }

  async command(cmd: CommandEnvelope): Promise<MapCommandReply> {
    const reply = await this.#session.command(cmd);
    this.commands.push({ cmd, reply });
    if (!reply.ok) this.#refused?.(reply);
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
