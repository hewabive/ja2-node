import type { CommandEnvelope, DriverMode } from '../../protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../protocol/view.ts';
import type { HintAnswer, HintReply } from '../../ui/game-client.ts';
import type { CommandReply, TacticalClient } from '../../ui/screens/tactical/environment.ts';
import type { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';

const REAL_TIME: DriverMode = { mode: 'realtime', speed: 1 };
const MANUAL: DriverMode = { mode: 'manual' };
const PAUSED_REFUSAL = 'paused';

export interface CommandRecord {
  readonly cmd: CommandEnvelope;
  readonly reply: CommandReply;
}

export class SessionTacticalClient implements TacticalClient {
  readonly commands: CommandRecord[] = [];
  readonly #session: SessionClient;
  readonly #hints: HintProvider;
  readonly #keepDriver: boolean;
  #paused = false;

  constructor(session: SessionClient, hints: HintProvider, keepDriver: boolean) {
    this.#session = session;
    this.#hints = hints;
    this.#keepDriver = keepDriver;
  }

  get view(): PlayerView | null {
    return this.#session.view;
  }

  get latestView(): PlayerView | null {
    return this.#session.latestView;
  }

  get shownTick(): number {
    return this.#session.shownTick;
  }

  get queuedFrames(): readonly ViewFrame[] {
    return this.#session.queuedFrames;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get driver(): DriverMode['mode'] {
    return this.#session.driver.mode;
  }

  start(): void {
    if (this.#keepDriver || this.#paused || this.#session.driver.mode !== 'manual') return;
    void this.#session.drive(REAL_TIME);
  }

  setPaused(paused: boolean): void {
    if (paused === this.#paused) return;
    this.#paused = paused;
    void this.#session.drive(paused ? MANUAL : REAL_TIME);
  }

  async command(cmd: CommandEnvelope): Promise<CommandReply> {
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
