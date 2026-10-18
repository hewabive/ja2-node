import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ArmyContent, loadArmyContent } from '../../src/content/strategic/army.ts';
import { parseSectorId } from '../../src/content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import { gameOptions } from '../../src/sim/options.ts';
import type { MineIncomePort, QueenContext, QueenHooks } from '../../src/sim/strategic/ai/context.ts';
import { initStrategicAiForNewCampaign, StrategicAi } from '../../src/sim/strategic/ai/strategic-ai.ts';
import { garrisonWeight } from '../../src/sim/strategic/ai/weights.ts';
import { createStrategicContext } from '../../src/sim/strategic/forces/context.ts';
import { defaultTacticalWorldPort, type MercPort, type RollSource, type TacticalWorldPort } from '../../src/sim/strategic/forces/ports.ts';
import { initStrategicLayerMap } from '../../src/sim/strategic/map/init.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createStrategicState, type StrategicState } from '../../src/sim/strategic/state.ts';

const DATA_DIR = join(import.meta.dirname, '../../data');

export function loadArmyTestContent(): Promise<ArmyContent> {
  return loadArmyContent(async (path) => new Uint8Array(readFileSync(join(DATA_DIR, path))));
}

export interface QueenTestOptions {
  readonly content: StrategicContent;
  readonly army: ArmyContent;
  readonly state?: StrategicState;
  readonly difficulty?: number;
  readonly random?: RollSource;
  readonly mercs?: MercPort;
  readonly world?: Partial<TacticalWorldPort>;
  readonly mines?: MineIncomePort;
  readonly hooks?: Partial<QueenHooks>;
}

export function queenTestContext(o: QueenTestOptions): QueenContext {
  const state = o.state ?? createStrategicState({ options: gameOptions({ difficulty: o.difficulty ?? 2, sciFi: false }) });
  const ai = new StrategicAi({ army: o.army, ...(o.mines ? { mines: o.mines } : {}), ...(o.hooks ? { hooks: o.hooks } : {}) });
  const ctx = createStrategicContext({
    state,
    content: o.content,
    ai,
    random: o.random ?? state.rng,
    ...(o.mercs ? { mercs: o.mercs } : {}),
    world: { ...defaultTacticalWorldPort, ...o.world },
  });
  return ai.bind(ctx);
}

export function newCampaign(o: QueenTestOptions): QueenContext {
  const q = queenTestContext(o);
  initStrategicLayerMap(q, { initStrategicAI: () => initStrategicAiForNewCampaign(q) });
  return q;
}

export interface GarrisonFixture {
  readonly sector: string;
  readonly composition: number;
  readonly admins?: number;
  readonly troops?: number;
  readonly elites?: number;
}

export function useGarrisons(q: QueenContext, list: readonly GarrisonFixture[]): void {
  const queen = q.state.queen;
  for (const si of q.state.map.sectors) {
    si.garrisonId = 255;
    si.numAdmins = 0;
    si.numTroops = 0;
    si.numElites = 0;
  }
  queen.compositions = q.army.compositions.map((c) => ({ ...c }));
  queen.garrisons = list.map((g) => ({ sector: parseSectorId(g.sector), composition: g.composition, weight: 0, pendingGroup: 0 }));
  queen.garrisonDenied = list.map(() => 0);
  queen.requestPoints = 0;
  queen.reinforcementPoints = 0;
  list.forEach((g, gi) => {
    const si = sectorInfo(q.state.map, { x: (parseSectorId(g.sector) % 16) + 1, y: Math.trunc(parseSectorId(g.sector) / 16) + 1 });
    si.garrisonId = gi;
    si.numAdmins = g.admins ?? 0;
    si.numTroops = g.troops ?? 0;
    si.numElites = g.elites ?? 0;
    const comp = queen.compositions[g.composition];
    const w = garrisonWeight(comp?.desired ?? 0, si.numAdmins + si.numTroops + si.numElites, comp?.priority ?? 0);
    if (w > 0) queen.requestPoints += w;
    else if (w < 0) queen.reinforcementPoints -= w;
    const gg = queen.garrisons[gi];
    if (gg) gg.weight = w;
  });
}

export function usePatrols(q: QueenContext, list: readonly { size: number; priority: number; points: readonly string[] }[]): void {
  q.state.queen.patrols = list.map((p) => ({
    size: p.size,
    priority: p.priority,
    points: [...p.points.map(parseSectorId), 0, 0, 0, 0].slice(0, 4),
    fillDayMod100: -1,
    group: 0,
    weight: 0,
    pendingGroup: 0,
  }));
}

export class RecordingRolls implements RollSource {
  readonly ranges: number[] = [];
  readonly #pick: (n: number) => number;

  constructor(pick: (n: number) => number) {
    this.#pick = pick;
  }

  static zeros(): RecordingRolls {
    return new RecordingRolls(() => 0);
  }

  static maxima(): RecordingRolls {
    return new RecordingRolls((n) => n - 1);
  }

  int(n: number): number {
    if (n === 0) return 0;
    this.ranges.push(n);
    return this.#pick(n);
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

export class QueuedRolls implements RollSource {
  readonly ranges: number[] = [];
  readonly #values: number[] = [];

  push(...values: number[]): this {
    this.#values.push(...values);
    return this;
  }

  reset(): this {
    this.ranges.length = 0;
    this.#values.length = 0;
    return this;
  }

  get left(): number {
    return this.#values.length;
  }

  int(n: number): number {
    if (n === 0) return 0;
    this.ranges.push(n);
    const v = this.#values.shift() ?? 0;
    if (v >= n) throw new RangeError(`queued roll ${v} out of range ${n}`);
    return v;
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

export interface AwakeFixture {
  readonly q: QueenContext;
  readonly rolls: QueuedRolls;
}

export function awakeFixture(o: Omit<QueenTestOptions, 'random'>, garrisons: readonly GarrisonFixture[], day = 4, hour = 12): AwakeFixture {
  const rolls = new QueuedRolls();
  const q = queenTestContext({ ...o, random: rolls });
  initStrategicLayerMap(q);
  const queen = q.state.queen;
  queen.minGroupSize = o.army.policy.minEnemyGroupSize[(o.difficulty ?? 2) - 1] ?? 4;
  queen.graceHours = o.army.policy.gracePeriodInHours[(o.difficulty ?? 2) - 1] ?? 96;
  queen.alertness = 20;
  queen.alertnessDecay = 50;
  queen.reinforcementPool = 200;
  queen.awake = true;
  queen.massFortificationOrdered = true;
  useGarrisons(q, garrisons);
  usePatrols(q, []);
  q.state.clock.seconds = day * 86400 + hour * 3600;
  rolls.reset();
  return { q, rolls };
}
