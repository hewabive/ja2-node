import type { SoldierView } from '../../src/protocol/view.ts';
import { bandageWounded, hasKit, holdsKit, kitInHand } from './first-aid.ts';
import { handGun, readyHand } from './gear.ts';
import { centroid, gridNo, nearest, ring, tiles, towards, WORLD_SIDE } from './grid.ts';
import type { AdvanceReport, Observation } from './mcp-game.ts';
import { isHostile, newMemory, OK_LIFE, ourMercs, type Player, Team, usable } from './player.ts';
import { answerPrompts } from './prompts.ts';
import { type Edge, planRetreat, type Retreat, retreatStep, shouldRetreat } from './retreat.ts';

export type BattleResult = 'won' | 'lost' | 'stuck' | 'reached' | 'retreated';

export interface BattleOptions {
  readonly objective?: number;
  readonly done?: (view: Observation) => boolean;
  readonly retreat?: Edge;
  readonly casualtyLimit?: number;
}

const MAX_BATTLE_STEPS = 1000;
const QUIET_SEEKS_BEFORE_WAITING = 160;
const STRAGGLER_TICKS = 40_000;
const STRAGGLER_WAITS = 100;
const MAX_ROUNDS = 150;
const MAX_PASSES = 6;
const MIN_AP_TO_ACT = 2;
const AIM_LEVELS = 4;
const FAIR_SHOT = 0.15;
const HOLDING_SHOT = 0.08;
const FOCUS_BONUS = 0.25;
const SEEK_STEP_TILES = 8;
const SEEK_TICKS = 3000;
const ADVANCE_STEPS = [5, 4, 3, 2, 1] as const;
const REGROUP_STEPS = [4, 3, 2, 1] as const;
const TILE_UNITS = 10;
const WORLD_CENTER = gridNo(80, 80);
const SWEEP_STEP = 12;
const SWEEP_RADIUS = 36;
const REACHED_TILES = 5;
const SWEEP_PATIENCE = 4;
const TIRED_FRACTION = 0.4;
const FULL_BREATH = 100;
const MAX_BREATHERS = 12;
const BREATHER_TICKS = 2000;
const ORDER_TICKS = 4000;
const OBJECTIVE_RANGE = 2;
const SQUAD_RADIUS = 6;
const IDLE_ROUNDS_BEFORE_ADVANCE = 1;
const IDLE_ROUNDS_BEFORE_FLANKING = 3;
const STILL_ACTING = /soldier (\d+) is still acting/;
const END_TURN_ATTEMPTS = 4;
const NOT_BLEEDING = 'notBleeding';

interface Shot {
  readonly target: SoldierView;
  readonly aim: number;
  readonly score: number;
}

interface Estimate {
  readonly apCost: number;
  readonly chanceToHit: number;
  readonly chanceToGetThrough: number;
}

interface TurnState {
  readonly contact: boolean;
  readonly idleRounds: number;
  readonly lowered: Set<number>;
}

export function sectorEnemies(view: Observation): number {
  const world = view.strategic?.worldSector;
  const here = view.strategic?.sectors.find((s) => s.sector === world);
  const known = here?.enemies;
  if (typeof known === 'number') return known;
  return known === '?' ? 1 : 0;
}

export function hostilesInSight(p: Player, view: Observation): SoldierView[] {
  return view.soldiers.filter((s) => isHostile(s) && !p.memory.dead.has(s.id));
}

function ourTurn(view: Observation): boolean {
  return view.combat?.team === Team.OUR;
}

async function estimate(p: Player, merc: SoldierView, target: SoldierView, aim: number): Promise<Estimate | null> {
  const result = await p.act({ type: 'estimateAttack', soldier: merc.id, target: target.gridNo, level: target.level, aimTime: aim });
  if (!result.ok || !result.data) return null;
  return result.data as unknown as Estimate;
}

function focus(p: Player, target: SoldierView): number {
  return 1 + FOCUS_BONUS * Math.min(4, p.memory.hits.get(target.id) ?? 0);
}

async function bestShot(p: Player, merc: SoldierView, targets: readonly SoldierView[]): Promise<Shot | null> {
  const ap = merc.ap ?? 0;
  let best: Shot | null = null;
  for (const target of targets) {
    const quick = await estimate(p, merc, target, 0);
    if (!quick || quick.apCost > ap || quick.chanceToGetThrough <= 0) continue;
    const spare = ap - quick.apCost;
    const aim = Math.max(0, Math.min(AIM_LEVELS, spare >= quick.apCost ? spare - quick.apCost : spare));
    const aimed = aim > 0 ? await estimate(p, merc, target, aim) : quick;
    if (!aimed || aimed.apCost > ap) continue;
    const score = (aimed.chanceToHit / 100) * (aimed.chanceToGetThrough / 100) * focus(p, target);
    if (!best || score > best.score) best = { target, aim, score };
  }
  return best;
}

async function settle(p: Player): Promise<AdvanceReport> {
  return p.advance({ idle: true });
}

async function settleOrder(p: Player, merc: SoldierView): Promise<AdvanceReport> {
  const report = await p.advance({ idle: true, ticks: ORDER_TICKS });
  if (report.reason !== 'ticks') return report;
  p.log(`  ${merc.name} keeps waiting for a blocked tile: stop`);
  await p.act({ type: 'stop', soldier: merc.id });
  return settle(p);
}

function squadAnchor(view: Observation): number | null {
  const points = ourMercs(view)
    .filter(usable)
    .map((m) => m.gridNo);
  return points.length > 0 ? centroid(points) : null;
}

function enemyGoal(p: Player, from: number, view: Observation): number | null {
  const seen = hostilesInSight(p, view).map((s) => s.gridNo);
  return nearest(from, seen.length > 0 ? seen : [...p.memory.lastSeen.values()]);
}

function preferredRange(p: Player, merc: SoldierView): number {
  const range = handGun(p, merc)?.weapon?.range ?? 0;
  return Math.max(2, Math.trunc(range / TILE_UNITS / 2));
}

async function moveTowards(p: Player, merc: SoldierView, goal: number, steps: readonly number[], mode: string): Promise<boolean> {
  for (const n of steps) {
    const spot = towards(merc.gridNo, goal, n);
    if (spot === merc.gridNo) continue;
    const candidates = [spot, ...ring(spot, 1).sort((a, b) => tiles(a, goal) - tiles(b, goal) || a - b)];
    for (const to of candidates) {
      if (to === merc.gridNo) continue;
      const moved = await p.act({ type: 'move', soldier: merc.id, to, mode });
      if (moved.ok) return true;
      if (moved.reason?.startsWith('not enough APs')) break;
    }
  }
  return false;
}

async function lower(p: Player, merc: SoldierView, turn: TurnState, stance: 'crouch' | 'prone'): Promise<boolean> {
  if (turn.lowered.has(merc.id)) return false;
  turn.lowered.add(merc.id);
  return (await p.act({ type: 'stance', soldier: merc.id, stance })).ok;
}

async function hold(p: Player, view: Observation, merc: SoldierView, turn: TurnState): Promise<boolean> {
  const anchor = squadAnchor(view);
  if (anchor !== null && tiles(merc.gridNo, anchor) > SQUAD_RADIUS && (await moveTowards(p, merc, anchor, REGROUP_STEPS, 'swat'))) {
    turn.lowered.delete(merc.id);
    return true;
  }
  return lower(p, merc, turn, 'prone');
}

async function push(p: Player, view: Observation, merc: SoldierView, turn: TurnState): Promise<boolean> {
  const anchor = squadAnchor(view) ?? merc.gridNo;
  const enemy = enemyGoal(p, anchor, view);
  const goal = enemy ?? p.memory.objective;
  const range = enemy !== null ? preferredRange(p, merc) : OBJECTIVE_RANGE;
  if (goal !== null && tiles(merc.gridNo, goal) > range) {
    const lead = towards(anchor, goal, SQUAD_RADIUS);
    const target = tiles(merc.gridNo, anchor) > SQUAD_RADIUS ? anchor : lead;
    if (await moveTowards(p, merc, target, ADVANCE_STEPS, 'swat')) {
      turn.lowered.delete(merc.id);
      return true;
    }
  }
  return lower(p, merc, turn, 'crouch');
}

async function treatSelf(p: Player, merc: SoldierView): Promise<boolean> {
  if (!p.memory.bleeding.has(merc.id) || !hasKit(merc)) return false;
  if (!(await kitInHand(p, merc))) return false;
  const started = await p.act({ type: 'bandage', soldier: merc.id, target: merc.id });
  if (!started.ok && JSON.stringify(started).includes(NOT_BLEEDING)) p.memory.bleeding.delete(merc.id);
  return started.ok;
}

async function mercAction(p: Player, view: Observation, merc: SoldierView, turn: TurnState): Promise<boolean> {
  const ap = merc.ap ?? 0;
  if (ap < MIN_AP_TO_ACT || !usable(merc)) return false;
  if (p.memory.bandaging.has(merc.id) && holdsKit(merc)) return false;
  p.memory.bandaging.delete(merc.id);
  const ready = await readyHand(p, merc, true);
  if (ready === 'acted') return true;
  const targets = hostilesInSight(p, view);
  if (ready === 'armed' && targets.length > 0) {
    const shot = await bestShot(p, merc, targets);
    const threshold = turn.contact ? HOLDING_SHOT : FAIR_SHOT;
    if (shot && shot.score >= threshold) {
      const fired = await p.act({
        type: 'attack',
        soldier: merc.id,
        target: shot.target.gridNo,
        level: shot.target.level,
        aimTime: shot.aim,
      });
      if (fired.ok) return true;
    }
  }
  if (await treatSelf(p, merc)) return true;
  const advance = targets.length > 0 ? turn.idleRounds >= IDLE_ROUNDS_BEFORE_FLANKING : turn.idleRounds >= IDLE_ROUNDS_BEFORE_ADVANCE;
  if (!advance) return hold(p, view, merc, turn);
  return push(p, view, merc, turn);
}

async function playTurn(p: Player, idleRounds: number): Promise<'done' | 'decision' | 'over' | 'stuck'> {
  const first = await p.observe();
  const turn: TurnState = { contact: hostilesInSight(p, first).length > 0, idleRounds, lowered: new Set() };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let acted = false;
    const view = await p.observe();
    if (!view.combat) return 'over';
    if (!ourTurn(view)) return 'decision';
    const mercs = ourMercs(view).filter((m) => usable(m) && (m.ap ?? 0) >= MIN_AP_TO_ACT);
    for (const merc of mercs) {
      const fresh = (await p.observe()).soldiers.find((s) => s.id === merc.id);
      if (!p.view.combat) return 'over';
      if (!fresh) continue;
      if (!(await mercAction(p, p.view, fresh, turn))) continue;
      acted = true;
      const report = await settleOrder(p, fresh);
      if (report.reason === 'budget') return 'stuck';
      if (report.reason === 'decision' || report.reason === 'ended') return 'decision';
    }
    if (!acted) break;
  }
  return 'done';
}

async function endTurn(p: Player): Promise<boolean> {
  let reason = '';
  for (let attempt = 0; attempt < END_TURN_ATTEMPTS; attempt++) {
    const ended = await p.act({ type: 'endTurn' });
    reason = ended.reason ?? '';
    if (ended.ok) {
      const report = await settle(p);
      return report.reason !== 'budget';
    }
    const busy = STILL_ACTING.exec(ended.reason ?? '');
    if (attempt > 0 && busy) {
      p.log(`  endTurn refused: ${ended.reason ?? ''}: stop`);
      await p.act({ type: 'stop', soldier: Number(busy[1]) });
    }
    const report = await p.advance({ idle: true, ticks: ORDER_TICKS });
    if (report.reason === 'decision' || !(await p.observe()).combat) return true;
  }
  p.log(`  endTurn keeps being refused: ${reason}`);
  return false;
}

function sweepPoints(): number[] {
  const points: number[] = [];
  const center = WORLD_SIDE / 2;
  for (let y = center - SWEEP_RADIUS; y <= center + SWEEP_RADIUS; y += SWEEP_STEP)
    for (let x = center - SWEEP_RADIUS; x <= center + SWEEP_RADIUS; x += SWEEP_STEP) points.push(gridNo(x, y));
  return points;
}

const SWEEP = sweepPoints();

function reached(anchor: number, goal: number): boolean {
  return tiles(anchor, goal) <= REACHED_TILES;
}

function sweepGoal(p: Player, anchor: number): number {
  const m = p.memory;
  if (m.sweepTarget !== null && (reached(anchor, m.sweepTarget) || m.sweepSteps >= SWEEP_PATIENCE)) {
    m.visited.add(m.sweepTarget);
    m.sweepTarget = null;
  }
  if (m.sweepTarget === null) {
    const open = SWEEP.filter((g) => !m.visited.has(g));
    if (open.length === 0) m.visited.clear();
    m.sweepTarget = nearest(anchor, open.length > 0 ? open : SWEEP);
    m.sweepSteps = 0;
  }
  m.sweepSteps++;
  return m.sweepTarget ?? WORLD_CENTER;
}

function seekGoal(p: Player, view: Observation): number {
  const anchor = squadAnchor(view) ?? WORLD_CENTER;
  const m = p.memory;
  for (const [id, g] of m.lastSeen) if (reached(anchor, g)) m.lastSeen.delete(id);
  const known = nearest(anchor, [...m.lastSeen.values()]);
  if (known !== null) return known;
  if (m.objective !== null) return m.objective;
  if (m.noise !== null && reached(anchor, m.noise)) m.noise = null;
  if (m.noise !== null) return m.noise;
  return sweepGoal(p, anchor);
}

function breathMax(view: Observation, id: number): number {
  return view.strategic?.mercs.find((m) => m.id === id)?.breathMax ?? FULL_BREATH;
}

async function catchBreath(p: Player, view: Observation): Promise<boolean> {
  const tired = ourMercs(view).filter((m) => usable(m) && (m.breath ?? FULL_BREATH) < breathMax(view, m.id) * TIRED_FRACTION);
  if (tired.length === 0 || p.memory.breathers >= MAX_BREATHERS) return false;
  p.memory.breathers++;
  await p.advance({ ticks: BREATHER_TICKS, events: ['combatStarted', 'enemySighted'] });
  return true;
}

async function waitForStragglers(p: Player): Promise<void> {
  await p.advance({ ticks: STRAGGLER_TICKS, events: ['combatStarted', 'enemySighted'] });
}

async function stopBleeding(p: Player, view: Observation): Promise<boolean> {
  const bleeders = ourMercs(view).filter((m) => p.memory.bleeding.has(m.id) && (m.life ?? 0) > 0);
  if (bleeders.length === 0 || hostilesInSight(p, view).length > 0) return false;
  await bandageWounded(p, p.medics, p.memory.bleeding);
  for (const m of bleeders) p.memory.bleeding.delete(m.id);
  return true;
}

async function seek(p: Player, view: Observation): Promise<void> {
  if (await stopBleeding(p, view)) return;
  if (await catchBreath(p, view)) return;
  const goal = seekGoal(p, view);
  const anchor = squadAnchor(view) ?? goal;
  if (p.verbose) p.log(`   seek from ${anchor} to ${goal} (visited ${p.memory.visited.size})`);
  for (const merc of ourMercs(view).filter(usable)) {
    await readyHand(p, merc, false);
    const target = tiles(merc.gridNo, anchor) > SQUAD_RADIUS ? anchor : goal;
    await moveTowards(p, merc, target, [SEEK_STEP_TILES, 4, 2], 'walk');
  }
  await p.advance({ idle: true, ticks: SEEK_TICKS, events: ['combatStarted', 'enemySighted'] });
}

function stuck(p: Player, why: string): BattleResult {
  p.log(`  stuck: ${why}`);
  return 'stuck';
}

function roundLine(p: Player, rounds: number, view: Observation): string {
  const ours = ourMercs(view)
    .map((m) => `${m.id}:${m.life}@${m.gridNo}`)
    .join(' ');
  const seen = hostilesInSight(p, view)
    .map((s) => `${s.id}@${s.gridNo}`)
    .join(' ');
  return `   round ${rounds}: ours ${ours} | seen ${seen} | dead ${p.memory.dead.size}`;
}

export async function fightHere(p: Player, options: BattleOptions = {}): Promise<BattleResult> {
  try {
    return await fight(p, options);
  } finally {
    p.reloads?.finishExactLoad(p);
  }
}

async function fight(p: Player, options: BattleOptions): Promise<BattleResult> {
  p.memory = newMemory();
  p.memory.objective = options.objective ?? null;
  p.tally.battles++;
  let rounds = 0;
  let lastRound = -1;
  let idleRounds = 0;
  let shotsAtRound = 0;
  let quietSeeks = 0;
  let retreat: Retreat | null = null;
  for (let step = 0; step < MAX_BATTLE_STEPS; step++) {
    const view = await p.observe();
    if (await answerPrompts(p, view)) continue;
    if (options.retreat && !retreat && ourMercs(view).length > 0) retreat = planRetreat(options.retreat, view, options.casualtyLimit);
    if (ourMercs(view).filter(usable).length === 0) return retreat?.active ? 'retreated' : 'lost';
    if (options.done?.(view)) return 'reached';
    if (retreat && (!view.combat || ourTurn(view)) && shouldRetreat(retreat, view, hostilesInSight(p, view).length)) {
      const moved = await retreatStep(p, view, retreat);
      if (view.combat && !(await endTurn(p))) return stuck(p, 'endTurn failed while retreating');
      if (!view.combat && !moved) await p.advance({ ticks: SEEK_TICKS });
      continue;
    }
    if (view.combat) {
      if (view.combat.round !== lastRound) {
        lastRound = view.combat.round;
        rounds++;
        p.tally.rounds++;
        idleRounds = p.memory.shots > shotsAtRound ? 0 : idleRounds + 1;
        shotsAtRound = p.memory.shots;
        if (p.verbose) p.log(roundLine(p, rounds, view));
      }
      if (rounds > MAX_ROUNDS) return stuck(p, `more than ${MAX_ROUNDS} rounds`);
      if (ourTurn(view) && p.reloads?.wantsExactLoad(p, rounds)) await p.reloads.startExactLoad(p, rounds);
      if (!ourTurn(view)) {
        const report = await settle(p);
        if (report.reason === 'budget') return stuck(p, 'the enemy turn does not end');
        continue;
      }
      const turn = await playTurn(p, idleRounds);
      if (turn === 'stuck') return stuck(p, 'an order does not settle');
      if (turn !== 'done') continue;
      if (!(await endTurn(p))) return stuck(p, 'endTurn failed');
      continue;
    }
    if (sectorEnemies(view) === 0 && hostilesInSight(p, view).length === 0) {
      p.tally.battlesWon++;
      await bandageWounded(p, p.medics);
      return 'won';
    }
    if (hostilesInSight(p, view).length > 0 || p.memory.lastSeen.size > 0) quietSeeks = 0;
    else quietSeeks++;
    if (quietSeeks <= QUIET_SEEKS_BEFORE_WAITING) await seek(p, view);
    else if (quietSeeks <= QUIET_SEEKS_BEFORE_WAITING + STRAGGLER_WAITS) await waitForStragglers(p);
    else return stuck(p, `nobody found to fight (${sectorEnemies(view)} enemies left)`);
  }
  return stuck(p, `no result after ${MAX_BATTLE_STEPS} steps (${sectorEnemies(p.view)} enemies left)`);
}

export function standingMercs(view: Observation): number {
  return ourMercs(view).filter((m) => (m.life ?? 0) >= OK_LIFE).length;
}
