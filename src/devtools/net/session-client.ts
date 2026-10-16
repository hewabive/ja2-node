import {
  type ClientMessage,
  type CommandEnvelope,
  type DriverMode,
  type ServerMessage,
  type StopCondition,
  type StopReport,
  TICK_MS,
} from '../../protocol/messages.ts';
import {
  type AutoresolveView,
  applyFrame,
  type ClockView,
  type CombatView,
  type ItemView,
  type PlayerView,
  type PromptView,
  type SoldierView,
  type StrategicView,
  type ViewFrame,
} from '../../protocol/view.ts';

type Pending = { resolve: (m: ServerMessage) => void; reject: (e: Error) => void };

export class SessionClient {
  view: PlayerView | null = null;
  driver: DriverMode = { mode: 'manual' };
  playbackSpeed = 1;
  onChange: (() => void) | null = null;
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #frames: ViewFrame[] = [];
  #nextId = 1;
  #shown: SoldierView[] = [];
  #openDoors: readonly number[] = [];
  #combat: CombatView | null = null;
  #revealedRooms: readonly number[] = [];
  #items: readonly ItemView[] = [];
  #mapPath: string | null = null;
  #clock: ClockView | null = null;
  #strategic: StrategicView | null = null;
  #prompt: PromptView | null = null;
  #autoresolve: AutoresolveView | null = null;
  #shownTick = 0;
  #latestTick = 0;

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

  get soldiers(): readonly SoldierView[] {
    return this.#shown;
  }

  get items(): readonly ItemView[] {
    return this.#items;
  }

  get revealedRooms(): readonly number[] {
    return this.#revealedRooms;
  }

  get combat(): CombatView | null {
    return this.#combat;
  }

  get openDoors(): readonly number[] {
    return this.#openDoors;
  }

  get mapPath(): string | null {
    return this.#mapPath;
  }

  get clock(): ClockView | null {
    return this.#clock;
  }

  get strategic(): StrategicView | null {
    return this.#strategic;
  }

  get prompt(): PromptView | null {
    return this.#prompt;
  }

  get autoresolve(): AutoresolveView | null {
    return this.#autoresolve;
  }

  get shownTick(): number {
    return this.#shownTick;
  }

  get latestTick(): number {
    return this.#latestTick;
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
        this.view = m.view;
        this.driver = m.driver;
        this.#shown = [...m.view.soldiers];
        this.#openDoors = m.view.openDoors ?? [];
        this.#combat = m.view.combat ?? null;
        this.#revealedRooms = m.view.revealedRooms ?? [];
        this.#items = m.view.items ?? [];
        this.#mapPath = m.view.mapPath;
        this.#clock = m.view.clock ?? null;
        this.#strategic = m.view.strategic ?? null;
        this.#prompt = m.view.prompt ?? null;
        this.#autoresolve = m.view.autoresolve ?? null;
        this.#shownTick = m.view.tick;
        this.#latestTick = m.view.tick;
        break;
      case 'frames':
        this.#frames.push(...m.frames);
        this.#latestTick = Math.max(this.#latestTick, m.frames.at(-1)?.tick ?? 0);
        break;
      case 'result':
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
    let changed = false;
    while (this.#frames.length > 0 && (this.#frames[0]?.tick ?? 0) <= tick) {
      const frame = this.#frames.shift() as ViewFrame;
      this.#shown = applyFrame(this.#shown, frame);
      if (frame.openDoors) this.#openDoors = frame.openDoors;
      if (frame.combat !== undefined) this.#combat = frame.combat;
      if (frame.revealedRooms) this.#revealedRooms = frame.revealedRooms;
      if (frame.items) this.#items = frame.items;
      if (frame.mapPath !== undefined) this.#mapPath = frame.mapPath;
      if (frame.clock) this.#clock = frame.clock;
      if (frame.strategic) this.#strategic = frame.strategic;
      if (frame.prompt !== undefined) this.#prompt = frame.prompt;
      if (frame.autoresolve !== undefined) this.#autoresolve = frame.autoresolve;
      changed = true;
    }
    const target = Math.min(tick, this.#latestTick);
    if (target > this.#shownTick) this.#shownTick = target;
    return changed;
  }

  playFor(elapsedMs: number): boolean {
    return this.playUntil(this.#shownTick + (elapsedMs / TICK_MS) * this.playbackSpeed);
  }

  skipToLatest(): void {
    this.playUntil(Number.POSITIVE_INFINITY);
  }

  async command(cmd: CommandEnvelope): Promise<{ ok: boolean; reason?: string }> {
    const m = await this.#request({ t: 'cmd', id: this.#nextId++, cmd });
    return m.t === 'result' ? { ok: m.ok, ...(m.reason ? { reason: m.reason } : {}) } : { ok: false, reason: 'unexpected reply' };
  }

  async advance(until: StopCondition): Promise<StopReport | null> {
    const m = await this.#request({ t: 'advance', id: this.#nextId++, until });
    return m.t === 'stopped' ? m.report : null;
  }

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    await this.#request({ t: 'drive', id: this.#nextId++, driver });
  }

  close(): void {
    this.#socket.close();
  }
}
