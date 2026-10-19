import {
  type ClientMessage,
  type CommandEnvelope,
  type DriverMode,
  type ServerMessage,
  type SessionStopReport,
  type StopCondition,
  TICK_MS,
  type WelcomeIdentity,
} from '../../protocol/messages.ts';
import {
  type AutoresolveView,
  applyViewFrame,
  type BoxingView,
  type CampaignEndedView,
  type ClockView,
  type CombatView,
  type ContractPromptView,
  type ConversationView,
  type DoorView,
  type ItemView,
  type LaptopView,
  type MeanwhileSceneView,
  type MusicView,
  type NpcRequestPromptView,
  type PlayerView,
  type PromptView,
  type ShopView,
  type SoldierView,
  type StrategicView,
  type ViewFrame,
} from '../../protocol/view.ts';

type Pending = { resolve: (m: ServerMessage) => void; reject: (e: Error) => void };

export interface CommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface QueryReply extends CommandReply {
  readonly tick: number;
}

export class SessionClient {
  driver: DriverMode = { mode: 'manual' };
  playbackSpeed = 1;
  session: string | null = null;
  identity: WelcomeIdentity | null = null;
  onChange: (() => void) | null = null;
  onFrames: ((frames: readonly ViewFrame[]) => void) | null = null;
  onWelcome: (() => void) | null = null;
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #frames: ViewFrame[] = [];
  #nextId = 1;
  #shown: PlayerView | null = null;
  #latest: PlayerView | null = null;
  #shownTick = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (e) => this.#receive(JSON.parse(String(e.data)) as ServerMessage));
  }

  static connect(session?: string): Promise<SessionClient> {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    const client = new SessionClient(socket);
    return new Promise((resolve, reject) => {
      socket.addEventListener('error', () => reject(new Error('cannot connect to the game server')));
      socket.addEventListener('open', () => {
        client.#send({ t: 'hello', ...(session ? { session } : {}) });
        const wait = () => (client.view ? resolve(client) : setTimeout(wait, 10));
        wait();
      });
    });
  }

  get view(): PlayerView | null {
    return this.#shown;
  }

  get latestView(): PlayerView | null {
    return this.#latest;
  }

  get soldiers(): readonly SoldierView[] {
    return this.#shown?.soldiers ?? [];
  }

  get items(): readonly ItemView[] {
    return this.#shown?.items ?? [];
  }

  get revealedRooms(): readonly number[] {
    return this.#shown?.revealedRooms ?? [];
  }

  get combat(): CombatView | null {
    return this.#shown?.combat ?? null;
  }

  get openDoors(): readonly number[] {
    return this.#shown?.openDoors ?? [];
  }

  get mapPath(): string | null {
    return this.#shown?.mapPath ?? null;
  }

  get clock(): ClockView | null {
    return this.#shown?.clock ?? null;
  }

  get strategic(): StrategicView | null {
    return this.#shown?.strategic ?? null;
  }

  get prompt(): PromptView | null {
    return this.#shown?.prompt ?? null;
  }

  get autoresolve(): AutoresolveView | null {
    return this.#shown?.autoresolve ?? null;
  }

  get contractPrompt(): ContractPromptView | null {
    return this.#shown?.contractPrompt ?? null;
  }

  get shop(): ShopView | null {
    return this.#shown?.shop ?? null;
  }

  get laptop(): LaptopView | null {
    return this.#shown?.laptop ?? null;
  }

  get doors(): readonly DoorView[] {
    return this.#shown?.doors ?? [];
  }

  get conversation(): ConversationView | null {
    return this.#shown?.conversation ?? null;
  }

  get scriptedSequence(): boolean {
    return this.#shown?.scriptedSequence ?? false;
  }

  get npcRequest(): NpcRequestPromptView | null {
    return this.#shown?.npcRequest ?? null;
  }

  get boxing(): BoxingView | null {
    return this.#shown?.boxing ?? null;
  }

  get meanwhile(): MeanwhileSceneView | null {
    return this.#shown?.meanwhile ?? null;
  }

  get ended(): CampaignEndedView | null {
    return this.#shown?.ended ?? null;
  }

  get music(): MusicView | null {
    return this.#shown?.music ?? null;
  }

  get shownTick(): number {
    return this.#shownTick;
  }

  get latestTick(): number {
    return this.#latest?.tick ?? 0;
  }

  #send(message: ClientMessage): void {
    this.#socket.send(JSON.stringify(message));
  }

  #request(message: ClientMessage & { id: number }): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      this.#pending.set(message.id, { resolve, reject });
      this.#send(message);
    });
  }

  #receive(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.#frames.length = 0;
        this.session = m.session;
        this.identity = { engine: m.engine, rules: m.rules };
        this.driver = m.driver;
        this.#shown = m.view;
        this.#latest = m.view;
        this.#shownTick = m.view.tick;
        this.onWelcome?.();
        break;
      case 'frames':
        this.#frames.push(...m.frames);
        for (const frame of m.frames) this.#latest = this.#latest && applyViewFrame(this.#latest, frame);
        break;
      case 'result':
      case 'answer':
      case 'stopped': {
        const p = this.#pending.get(m.id);
        this.#pending.delete(m.id);
        p?.resolve(m);
        break;
      }
      case 'error':
        for (const p of this.#pending.values()) p.reject(new Error(m.message));
        this.#pending.clear();
        break;
    }
    this.onChange?.();
  }

  playUntil(tick: number): boolean {
    const applied: ViewFrame[] = [];
    while (this.#frames.length > 0 && (this.#frames[0]?.tick ?? 0) <= tick) {
      const frame = this.#frames.shift() as ViewFrame;
      applied.push(frame);
      this.#shown = this.#shown && applyViewFrame(this.#shown, frame);
    }
    const target = Math.min(tick, this.latestTick);
    if (target > this.#shownTick) this.#shownTick = target;
    if (applied.length > 0) this.onFrames?.(applied);
    return applied.length > 0;
  }

  playFor(elapsedMs: number): boolean {
    return this.playUntil(this.#shownTick + (elapsedMs / TICK_MS) * this.playbackSpeed);
  }

  skipToLatest(): void {
    this.playUntil(Number.POSITIVE_INFINITY);
  }

  async command(cmd: CommandEnvelope): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'cmd', id: this.#nextId++, cmd }));
  }

  async query(q: CommandEnvelope): Promise<QueryReply> {
    const m = await this.#request({ t: 'query', id: this.#nextId++, q });
    if (m.t !== 'answer') return { ok: false, reason: 'unexpected reply', tick: -1 };
    return { ok: m.ok, tick: m.tick, ...(m.reason ? { reason: m.reason } : {}), ...(m.data !== undefined ? { data: m.data } : {}) };
  }

  async advance(until: StopCondition): Promise<SessionStopReport | null> {
    const m = await this.#request({ t: 'advance', id: this.#nextId++, until });
    return m.t === 'stopped' ? m.report : null;
  }

  async save(request: { readonly name?: string; readonly description?: string } = {}): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'save', id: this.#nextId++, ...request }));
  }

  async load(name: string, reseed?: boolean): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'load', id: this.#nextId++, name, ...(reseed !== undefined ? { reseed } : {}) }));
  }

  async closeSession(): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'closeSession', id: this.#nextId++ }));
  }

  #reply(m: ServerMessage): CommandReply {
    if (m.t !== 'result') return { ok: false, reason: 'unexpected reply' };
    return { ok: m.ok, ...(m.reason ? { reason: m.reason } : {}), ...(m.data !== undefined ? { data: m.data } : {}) };
  }

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    await this.#request({ t: 'drive', id: this.#nextId++, driver });
  }

  close(): void {
    this.#socket.close();
  }
}
