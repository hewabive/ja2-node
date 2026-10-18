import { WORLD_COLS } from '../../src/content/world/grid.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView } from '../../src/protocol/view.ts';
import type { Session, SessionSim } from '../../src/server/session.ts';
import type { WorldTimeControl } from '../../src/sim/advance.ts';
import type { CommandResult } from '../../src/sim/command.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { OKLIFE, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

export class MeteredSim implements SessionSim {
  readonly inner: SessionSim;
  readonly events = new Map<string, number>();
  viewMs = 0;
  views = 0;

  constructor(inner: SessionSim) {
    this.inner = inner;
  }

  get tick(): number {
    return this.inner.tick;
  }

  get worldClock(): WorldTimeControl | null {
    return this.inner.worldClock ?? null;
  }

  isIdle(): boolean {
    return this.inner.isIdle();
  }

  hasPendingDecision(): boolean {
    return this.inner.hasPendingDecision();
  }

  ended(): boolean {
    return this.inner.ended?.() ?? false;
  }

  step(): void {
    this.inner.step();
  }

  drainEvents(): SimEvent[] {
    const events = this.inner.drainEvents();
    for (const e of events) this.events.set(e.type, (this.events.get(e.type) ?? 0) + 1);
    return events;
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return this.inner.dispatch(cmd);
  }

  async prepare(cmd: CommandEnvelope): Promise<void> {
    await this.inner.prepare?.(cmd);
  }

  view(): PlayerView {
    const t0 = performance.now();
    const v = this.inner.view();
    this.viewMs += performance.now() - t0;
    this.views++;
    return v;
  }

  count(type: string): number {
    return this.events.get(type) ?? 0;
  }
}

export interface Battlefield {
  readonly session: Session;
  readonly metered: MeteredSim;
  sim(): TacticalSim;
  resolve(): number;
}

export interface BattleSamples {
  readonly turnMs: number[];
  readonly turnTicks: number[];
  readonly outcome: string;
  readonly rounds: number;
}

const ENGAGE_STEPS = 20;
const APPROACH_TILES = 4;
const MAX_ROUNDS = 60;
export const TURN_BUDGET_TICKS = 50_000;
const SETTLE_ROUNDS = 20;
const PLAYER_TEAMS: readonly number[] = [Team.OUR, Team.MILITIA];
const HOSTILE_TEAMS: readonly number[] = [Team.ENEMY, Team.CREATURE];

const AI_ACTION_NAMES = new Map<number, string>(Object.entries(AiAction).map(([name, code]) => [code, name]));

class Stalled extends Error {}

function living(sim: TacticalSim, teams: readonly number[]): number {
  return sim.state.soldiers.filter((s) => s?.placed && teams.includes(s.team) && s.life >= OKLIFE).length;
}

function columnOf(g: number): number {
  return g % WORLD_COLS;
}

function rowOf(g: number): number {
  return Math.trunc(g / WORLD_COLS);
}

function distance(a: number, b: number): number {
  return Math.hypot(columnOf(a) - columnOf(b), rowOf(a) - rowOf(b));
}

function nearest(from: number, targets: readonly number[]): number | null {
  let best: number | null = null;
  for (const g of targets) if (best === null || distance(from, g) < distance(from, best)) best = g;
  return best;
}

function towards(from: number, to: number, tiles: number): number {
  const step = (d: number) => Math.sign(d) * Math.min(tiles, Math.abs(d));
  return (rowOf(from) + step(rowOf(to) - rowOf(from))) * WORLD_COLS + columnOf(from) + step(columnOf(to) - columnOf(from));
}

function ourMercs(sim: TacticalSim) {
  return sim.state.soldiers.filter((s) => s?.placed && s.team === Team.OUR && s.life >= OKLIFE).map((s) => s as NonNullable<typeof s>);
}

function settle(field: Battlefield): void {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const report = field.session.advance({ idle: true }, TURN_BUDGET_TICKS);
    if (report.reason === 'budget') throw new Stalled(`no idle within ${TURN_BUDGET_TICKS} ticks`);
    if (field.resolve() === 0) return;
  }
  throw new Error('bench: decisions keep coming');
}

function act(field: Battlefield, cmd: CommandEnvelope): CommandResult {
  const result = field.session.dispatch(cmd);
  settle(field);
  return result;
}

export function busySoldiers(sim: TacticalSim): string {
  const t = sim.state;
  const controls = t.content.animations.controls;
  return t.soldiers
    .filter((s) => s?.placed && (sim.isBusy(s) || s.ai.actionInProgress))
    .map((s) => {
      const x = s as NonNullable<typeof s>;
      const pending = x.pendingAnimation === -1 ? '' : ` pending ${controls[x.pendingAnimation]?.id ?? x.pendingAnimation}`;
      const action = AI_ACTION_NAMES.get(x.ai.action) ?? String(x.ai.action);
      return `#${x.id} team ${x.team} ${controls[x.state]?.id ?? x.state}${pending} ai ${action}${x.tempObject ? ' holding a thrown item' : ''} life ${x.life}`;
    })
    .join('; ');
}

function mustAct(field: Battlefield, cmd: CommandEnvelope): void {
  const result = act(field, cmd);
  if (!result.ok) throw new Error(`bench: ${cmd.type} refused: ${result.reason ?? 'no reason'} (busy: ${busySoldiers(field.sim())})`);
}

export function engage(field: Battlefield): void {
  if (!startsBattle(field)) throw new Error('bench: the battle did not start');
}

export function startsBattle(field: Battlefield): boolean {
  const { session, sim } = field;
  for (let step = 0; step < ENGAGE_STEPS && !sim().state.inCombat; step++) {
    const enemies = sim()
      .state.soldiers.filter((s) => s?.placed && HOSTILE_TEAMS.includes(s.team) && s.life >= OKLIFE)
      .map((s) => s?.gridNo ?? 0);
    for (const merc of ourMercs(sim())) {
      const target = nearest(merc.gridNo, enemies);
      if (target === null) continue;
      for (const tiles of [APPROACH_TILES, APPROACH_TILES / 2, 1]) {
        if (session.dispatch({ type: 'move', soldier: merc.id, to: towards(merc.gridNo, target, tiles), mode: 'swat' }).ok) break;
      }
    }
    session.advance({ idle: true, events: ['combatStarted'] }, TURN_BUDGET_TICKS);
    field.resolve();
  }
  return sim().state.inCombat;
}

function takeCover(field: Battlefield): void {
  for (const merc of ourMercs(field.sim())) act(field, { type: 'stance', soldier: merc.id, stance: 'prone' });
}

export interface FirePolicy {
  readonly shots: number;
  readonly aimTime: number;
}

export const RETURN_FIRE: FirePolicy = { shots: 1, aimTime: 0 };

function fireBack(field: Battlefield, policy: FirePolicy): void {
  const { shots, aimTime } = policy;
  for (let shot = 0; shot < shots; shot++) {
    const view = field.metered.inner.view();
    const visible = view.soldiers.filter((s) => HOSTILE_TEAMS.includes(s.team)).map((s) => s.gridNo);
    for (const merc of view.soldiers.filter((s) => s.team === Team.OUR && (s.life ?? 0) >= OKLIFE)) {
      const target = nearest(merc.gridNo, visible);
      if (target !== null) act(field, { type: 'attack', soldier: merc.id, target, aimTime });
    }
  }
}

function outcome(sim: TacticalSim, rounds: number): string {
  if (living(sim, PLAYER_TEAMS) === 0) return 'lost';
  if (living(sim, HOSTILE_TEAMS) === 0) return 'won';
  if (!sim.state.inCombat) return 'combatEnded';
  return rounds >= MAX_ROUNDS ? 'rounds' : 'stopped';
}

function battleGoesOn(sim: TacticalSim): boolean {
  return sim.state.inCombat && living(sim, PLAYER_TEAMS) > 0 && living(sim, HOSTILE_TEAMS) > 0;
}

function endInterrupts(field: Battlefield): void {
  while (field.metered.hasPendingDecision() && field.sim().state.inCombat) mustAct(field, { type: 'endTurn' });
}

export function fight(field: Battlefield, policy: FirePolicy = RETURN_FIRE): BattleSamples {
  const { metered, sim } = field;
  const turnMs: number[] = [];
  const turnTicks: number[] = [];
  const timed = (work: () => void) => {
    const t0 = performance.now();
    const tick0 = metered.tick;
    work();
    const ticks = metered.tick - tick0;
    if (ticks > 0) {
      turnMs.push(performance.now() - t0);
      turnTicks.push(ticks);
    }
  };
  let rounds = 0;
  try {
    timed(() => {
      settle(field);
      endInterrupts(field);
    });
    takeCover(field);
    for (; rounds < MAX_ROUNDS && battleGoesOn(sim()); rounds++) {
      fireBack(field, policy);
      if (!battleGoesOn(sim())) break;
      timed(() => {
        mustAct(field, { type: 'endTurn' });
        endInterrupts(field);
      });
    }
  } catch (err) {
    if (!(err instanceof Stalled)) throw err;
    return { turnMs, turnTicks, outcome: `stalled in round ${rounds}: ${err.message} (busy: ${busySoldiers(sim())})`, rounds };
  }
  return { turnMs, turnTicks, outcome: outcome(sim(), rounds), rounds };
}
