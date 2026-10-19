import { isDeepStrictEqual } from 'node:util';
import type { ItemDef, ItemTable } from '../../src/content/items/items.ts';
import { isSessionMessage } from '../../src/protocol/message-log.ts';
import type { SoldierView } from '../../src/protocol/view.ts';
import { column, gridNo, row, WORLD_SIDE } from './grid.ts';
import type { ActResult, AdvanceReport, AdvanceRequest, Command, Game, GameEvent, Observation } from './mcp-game.ts';
import type { Reloads } from './reload.ts';

export const Team = { OUR: 0, ENEMY: 1, CREATURE: 2, MILITIA: 3, CIV: 4 } as const;
export const OK_LIFE = 15;
export const QUEEN = 75;
const OUR_TEAM_SIZE = 20;
const NOISE_DISTANCE = 10;
const DIRECTION_STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const KEPT_EVENTS: ReadonlySet<string> = new Set([
  'militiaTrained',
  'mineIncome',
  'helicopterSetUp',
  'battleResult',
  'queenKilled',
  'campaignWon',
  'meanwhile',
  'mercHired',
  'mercArrived',
  'shipmentDelivered',
  'bobbyRayOpen',
]);

const SESSION_EVENTS: ReadonlySet<string> = new Set(['gameSaved', 'gameLoaded']);
const SESSION_FIELDS = ['language', 'dataVersion'] as const;

export interface BattleMemory {
  readonly lastSeen: Map<number, number>;
  readonly life: Map<number, number>;
  readonly dead: Set<number>;
  readonly hits: Map<number, number>;
  readonly bleeding: Set<number>;
  readonly bandaging: Set<number>;
  readonly visited: Set<number>;
  shots: number;
  noise: number | null;
  sweepTarget: number | null;
  sweepSteps: number;
  objective: number | null;
  breathers: number;
}

export interface Tally {
  battles: number;
  battlesWon: number;
  rounds: number;
  readonly mercsLost: Set<number>;
  readonly enemiesKilled: Set<string>;
}

export interface MirrorReport {
  readonly session: string;
  steps: number;
  readonly differences: string[];
}

export function newMemory(): BattleMemory {
  return {
    lastSeen: new Map(),
    life: new Map(),
    dead: new Set(),
    hits: new Map(),
    bleeding: new Set(),
    bandaging: new Set(),
    visited: new Set(),
    shots: 0,
    noise: null,
    sweepTarget: null,
    sweepSteps: 0,
    objective: null,
    breathers: 0,
  };
}

function comparableView(view: Observation): unknown {
  const copy: Record<string, unknown> = { ...view };
  for (const field of SESSION_FIELDS) delete copy[field];
  return copy;
}

function comparableReport(report: AdvanceReport): unknown {
  return {
    ...report,
    events: report.events.filter((e) => !SESSION_EVENTS.has(e.type)),
    messages: (report.messages ?? []).filter((m) => !isSessionMessage(m)),
  };
}

export class Player {
  readonly game: Game;
  readonly items: ItemTable;
  readonly log: (line: string) => void;
  readonly tally: Tally = { battles: 0, battlesWon: 0, rounds: 0, mercsLost: new Set(), enemiesKilled: new Set() };
  session: string;
  memory: BattleMemory = newMemory();
  mirror: MirrorReport | null = null;
  medics: readonly number[] = [];
  reloads: Reloads | null = null;
  readonly events: GameEvent[] = [];
  trace = false;
  verbose = false;
  #view: Observation | null = null;

  constructor(game: Game, session: string, items: ItemTable, log: (line: string) => void) {
    this.game = game;
    this.session = session;
    this.items = items;
    this.log = log;
  }

  get view(): Observation {
    if (!this.#view) throw new Error('nothing observed yet');
    return this.#view;
  }

  item(name: string | undefined): ItemDef | undefined {
    return name === undefined ? undefined : this.items.byName.get(name);
  }

  async observe(): Promise<Observation> {
    const view = await this.game.observe(this.session);
    if (this.mirror) this.#compare('observe', comparableView(view), comparableView(await this.game.observe(this.mirror.session)));
    this.#view = view;
    this.#remember(view);
    return view;
  }

  async act(command: Command): Promise<ActResult> {
    const result = await this.game.act(this.session, command);
    if (this.trace && command.type !== 'estimateAttack' && command.type !== 'inventory')
      this.log(`    act ${JSON.stringify(command)} -> ${result.ok ? 'ok' : `refused: ${result.reason ?? ''}`}`);
    if (this.mirror) this.#compare(`act ${command.type}`, result, await this.game.act(this.mirror.session, command));
    return result;
  }

  async advance(request: AdvanceRequest): Promise<AdvanceReport> {
    const report = await this.game.advance(this.session, request);
    if (this.trace) this.log(`    advance ${JSON.stringify(request)} -> ${report.reason} at tick ${report.tick}`);
    if (this.mirror)
      this.#compare(
        `advance ${JSON.stringify(request)}`,
        comparableReport(report),
        comparableReport(await this.game.advance(this.mirror.session, request)),
      );
    this.note(report.events);
    this.events.push(...report.events.filter((e) => KEPT_EVENTS.has(e.type)));
    return report;
  }

  note(events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'soldierDied') {
        const id = e.soldier as number;
        this.memory.dead.add(id);
        this.memory.lastSeen.delete(id);
        if (id < OUR_TEAM_SIZE) this.#lostMerc(id);
        else this.tally.enemiesKilled.add(`${this.tally.battles}:${id}`);
      } else if (e.type === 'shotFired' && (e.soldier as number) < OUR_TEAM_SIZE) {
        this.memory.shots++;
      } else if (e.type === 'noiseHeard') {
        this.#hear(e.listener as number, e.direction);
      } else if (e.type === 'soldierHit') {
        const id = e.soldier as number;
        this.memory.life.set(id, e.life as number);
        this.memory.hits.set(id, (this.memory.hits.get(id) ?? 0) + 1);
        if (id < OUR_TEAM_SIZE && (e.damage as number) > 0) this.memory.bleeding.add(id);
      } else if (e.type === 'firstAidStarted') {
        this.memory.bandaging.add(e.soldier as number);
      } else if (e.type === 'bandaged' && e.bleeding === 0) {
        this.memory.bleeding.delete(e.patient as number);
      } else if (e.type === 'firstAidDone' || e.type === 'firstAidEnded' || e.type === 'outOfBandages') {
        this.memory.bandaging.delete(e.soldier as number);
        if (e.type === 'firstAidDone') this.memory.bleeding.delete(e.patient as number);
      }
    }
  }

  #lostMerc(id: number): void {
    const merc = this.#view?.strategic?.mercs.find((m) => m.id === id);
    if (merc && merc.kind === 'epc') return;
    this.tally.mercsLost.add(id);
  }

  #hear(listener: number, direction: unknown): void {
    const at = this.#view?.soldiers.find((s) => s.id === listener)?.gridNo;
    if (at === undefined || typeof direction !== 'number') return;
    const [dx, dy] = DIRECTION_STEPS[direction] ?? [0, 0];
    const x = Math.min(WORLD_SIDE - 1, Math.max(0, column(at) + dx * NOISE_DISTANCE));
    const y = Math.min(WORLD_SIDE - 1, Math.max(0, row(at) + dy * NOISE_DISTANCE));
    this.memory.noise = gridNo(x, y);
  }

  #remember(view: Observation): void {
    for (const s of view.soldiers) if (isHostile(s) && !this.memory.dead.has(s.id)) this.memory.lastSeen.set(s.id, s.gridNo);
  }

  #compare(step: string, a: unknown, b: unknown): void {
    const mirror = this.mirror;
    if (!mirror) return;
    mirror.steps++;
    if (!isDeepStrictEqual(a, b) && mirror.differences.length < 5) mirror.differences.push(`${step} (step ${mirror.steps})`);
  }
}

export function isHostile(s: SoldierView): boolean {
  return s.team === Team.ENEMY || s.team === Team.CREATURE || (s.team === Team.CIV && s.profile === QUEEN);
}

export function ourMercs(view: Observation): SoldierView[] {
  return view.soldiers.filter((s) => s.team === Team.OUR);
}

export function usable(s: SoldierView): boolean {
  return (s.life ?? 0) >= OK_LIFE;
}
