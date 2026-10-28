import { appendToLog, type MessageEntry } from '../../protocol/message-log.ts';
import {
  type ClientMessage,
  type CommandEnvelope,
  type DriverMode,
  type RulePackIdentityView,
  type ServerMessage,
  type SessionHealthView,
  type SessionStopReport,
  type StopCondition,
  TICK_MS,
  type WelcomeIdentity,
} from '../../protocol/messages.ts';
import {
  type AutoresolveView,
  applyViewFrame,
  type BoxingView,
  type BulletView,
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
import type { SessionConnection } from '../../ui/client/front-end-client.ts';
import { BulletTrack } from './bullet-track.ts';
import { type LinkOptions, SessionLink } from './session-link.ts';

interface Pending {
  readonly resolve: (m: ServerMessage) => void;
  readonly reject: (e: Error) => void;
  readonly label: string;
  readonly sentAt: number;
}

export interface CommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface QueryReply extends CommandReply {
  readonly tick: number;
}

export interface OpenRequests {
  readonly oldest: string;
  readonly ageMs: number;
  readonly count: number;
}

export interface PingReply {
  readonly rttMs: number;
  readonly health: SessionHealthView | null;
}

const DRIVER_STOP_ID = 0;
const NOT_CONNECTED = 'not connected to the game session';
const CONNECTION_LOST = 'the connection to the game server was lost';
const SESSION_ENDED = 'the game session ended';
const LEFT = 'left the game session';

export class SessionClient {
  driver: DriverMode = { mode: 'manual' };
  playbackSpeed = 1;
  session: string | null = null;
  campaign: string | null = null;
  identity: WelcomeIdentity | null = null;
  onChange: (() => void) | null = null;
  onFrames: ((frames: readonly ViewFrame[]) => void) | null = null;
  onWelcome: (() => void) | null = null;
  onReceive: ((frames: readonly ViewFrame[]) => void) | null = null;
  onReply: ((label: string, ms: number) => void) | null = null;
  onConnection: ((connection: SessionConnection) => void) | null = null;
  connection: SessionConnection = { state: 'open' };
  rules: RulePackIdentityView | null = null;
  lastCommand: CommandEnvelope | null = null;
  lastReply: CommandReply | null = null;
  readonly #link: SessionLink;
  readonly #pending = new Map<number, Pending>();
  readonly #frames: ViewFrame[] = [];
  readonly #bullets = new BulletTrack();
  #nextId = 1;
  #shown: PlayerView | null = null;
  #latest: PlayerView | null = null;
  #shownTick = 0;
  #messages: MessageEntry[] = [];

  private constructor(session: string | undefined, options: LinkOptions) {
    this.#link = new SessionLink(session, { message: (m) => this.#receive(m), connection: (c) => this.#connectionChanged(c) }, options);
  }

  static async connect(session?: string, options: LinkOptions = {}): Promise<SessionClient> {
    const client = new SessionClient(session, options);
    await client.#link.start();
    return client;
  }

  get view(): PlayerView | null {
    return this.#shown;
  }

  get latestView(): PlayerView | null {
    return this.#latest;
  }

  get messages(): readonly MessageEntry[] {
    return this.#messages;
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

  get openContainers(): readonly number[] {
    return this.#shown?.openContainers ?? [];
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

  get bullets(): readonly BulletView[] {
    return this.#bullets.at(Math.floor(this.#shownTick));
  }

  get latestTick(): number {
    return this.#latest?.tick ?? 0;
  }

  get queuedFrames(): readonly ViewFrame[] {
    return this.#frames;
  }

  #request(message: ClientMessage & { id: number }, label: string): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.#link.open) return reject(new Error(NOT_CONNECTED));
      this.#pending.set(message.id, { resolve, reject, label, sentAt: performance.now() });
      this.#link.send(message);
    });
  }

  #rejectPending(reason: string): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const p of pending) p.reject(new Error(reason));
  }

  #connectionChanged(connection: SessionConnection): void {
    if (connection.state !== 'open') this.#rejectPending(connection.state === 'reconnecting' ? CONNECTION_LOST : SESSION_ENDED);
    this.connection = connection;
    this.onConnection?.(connection);
    this.onChange?.();
  }

  openRequests(now = performance.now()): OpenRequests | null {
    const oldest = this.#pending.values().next().value;
    return oldest ? { oldest: oldest.label, ageMs: now - oldest.sentAt, count: this.#pending.size } : null;
  }

  #receive(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.#frames.length = 0;
        this.#bullets.clear();
        this.session = m.session;
        this.campaign = m.campaign ?? null;
        this.identity = { engine: m.engine, rules: m.rules };
        this.rules = m.rules;
        this.driver = m.driver;
        this.#shown = m.view;
        this.#latest = m.view;
        this.#shownTick = m.view.tick;
        this.#messages = appendToLog([], m.messages);
        this.onWelcome?.();
        break;
      case 'frames':
        this.#frames.push(...m.frames);
        this.#bullets.add(m.frames);
        for (const frame of m.frames) this.#latest = this.#latest && applyViewFrame(this.#latest, frame);
        this.onReceive?.(m.frames);
        break;
      case 'result':
      case 'answer':
      case 'pong':
      case 'stopped': {
        if (m.t === 'stopped' && m.id === DRIVER_STOP_ID) this.driver = { mode: 'manual' };
        const p = this.#pending.get(m.id);
        this.#pending.delete(m.id);
        if (p) this.onReply?.(p.label, performance.now() - p.sentAt);
        p?.resolve(m);
        break;
      }
      case 'error': {
        if (m.id === undefined) {
          this.#rejectPending(m.message);
          break;
        }
        const p = this.#pending.get(m.id);
        this.#pending.delete(m.id);
        p?.reject(new Error(m.message));
        break;
      }
    }
    this.onChange?.();
  }

  playUntil(tick: number): boolean {
    const applied: ViewFrame[] = [];
    while (this.#frames.length > 0 && (this.#frames[0]?.tick ?? 0) <= tick) {
      const frame = this.#frames.shift() as ViewFrame;
      applied.push(frame);
      this.#shown = this.#shown && applyViewFrame(this.#shown, frame);
      if (frame.messages) this.#messages = appendToLog(this.#messages, frame.messages);
    }
    const target = Math.min(tick, this.latestTick);
    if (target > this.#shownTick) this.#shownTick = target;
    this.#bullets.forgetBefore(Math.floor(this.#shownTick));
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
    const reply = this.#reply(await this.#request({ t: 'cmd', id: this.#nextId++, cmd }, cmd.type));
    this.lastCommand = cmd;
    this.lastReply = reply;
    return reply;
  }

  async query(q: CommandEnvelope): Promise<QueryReply> {
    const m = await this.#request({ t: 'query', id: this.#nextId++, q }, `${q.type}?`);
    if (m.t !== 'answer') return { ok: false, reason: 'unexpected reply', tick: -1 };
    return { ok: m.ok, tick: m.tick, ...(m.reason ? { reason: m.reason } : {}), ...(m.data !== undefined ? { data: m.data } : {}) };
  }

  async advance(until: StopCondition): Promise<SessionStopReport | null> {
    const m = await this.#request({ t: 'advance', id: this.#nextId++, until }, 'advance');
    return m.t === 'stopped' ? m.report : null;
  }

  async save(request: { readonly name?: string; readonly description?: string } = {}): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'save', id: this.#nextId++, ...request }, 'save'));
  }

  async load(name: string, reseed?: boolean): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'load', id: this.#nextId++, name, ...(reseed !== undefined ? { reseed } : {}) }, 'load'));
  }

  async leave(): Promise<CommandReply> {
    return this.#reply(await this.#request({ t: 'leave', id: this.#nextId++ }, 'leave'));
  }

  #reply(m: ServerMessage): CommandReply {
    if (m.t !== 'result') return { ok: false, reason: 'unexpected reply' };
    return { ok: m.ok, ...(m.reason ? { reason: m.reason } : {}), ...(m.data !== undefined ? { data: m.data } : {}) };
  }

  async drive(driver: DriverMode): Promise<void> {
    this.driver = driver;
    await this.#request({ t: 'drive', id: this.#nextId++, driver }, 'drive');
  }

  async ping(): Promise<PingReply> {
    const sentAt = performance.now();
    const m = await this.#request({ t: 'ping', id: this.#nextId++ }, 'ping');
    return { rttMs: performance.now() - sentAt, health: m.t === 'pong' ? (m.health ?? null) : null };
  }

  close(): void {
    this.#link.close();
    this.#rejectPending(LEFT);
  }
}
