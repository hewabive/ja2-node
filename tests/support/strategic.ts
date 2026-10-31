import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MovementCosts } from '../../src/content/strategic/map-tables.ts';
import type { Sector } from '../../src/content/strategic/sector-ids.ts';
import { loadStrategicContent, type StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import { createStrategicContext } from '../../src/sim/strategic/forces/context.ts';
import type {
  HelicopterPort,
  MercPort,
  RollSource,
  StrategicAiPort,
  StrategicContext,
  StrategicMerc,
  TacticalWorldPort,
  TravelStat,
} from '../../src/sim/strategic/forces/ports.ts';
import { createStrategicState, type StrategicState, type StrategicStateOptions } from '../../src/sim/strategic/state.ts';

const DATA_DIR = join(import.meta.dirname, '../../data');

export function loadStrategicTestContent(): Promise<StrategicContent> {
  return loadStrategicContent(async (path) => new Uint8Array(readFileSync(join(DATA_DIR, path))));
}

export function withMovementCosts(content: StrategicContent, movementCosts: MovementCosts): StrategicContent {
  return { ...content, movementCosts };
}

export function uniformMovementCosts(edge: number, through = edge): MovementCosts {
  return {
    traversability: Array.from({ length: 256 }, () => [edge, edge, edge, edge, through]),
    travelRatings: new Array<number>(256).fill(0),
  };
}

export class ScriptedRolls implements RollSource {
  readonly ranges: number[] = [];
  readonly #values: number[];

  constructor(values: readonly number[] = []) {
    this.#values = [...values];
  }

  int(n: number): number {
    if (n === 0) return 0;
    this.ranges.push(n);
    const v = this.#values.shift() ?? 0;
    if (v >= n) throw new RangeError(`scripted roll ${v} out of range ${n}`);
    return v;
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

export interface FakeMercOptions {
  readonly id: number;
  readonly profile?: number;
  readonly sector: Sector;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly strength?: number;
  readonly assignment?: number;
  readonly isVehicle?: boolean;
  readonly isRobot?: boolean;
  readonly isEpc?: boolean;
  readonly encumbrance?: number;
  readonly tooTired?: boolean;
  readonly prevSectorId?: number;
}

export interface ExperienceAward {
  readonly id: number;
  readonly stat: TravelStat;
  readonly points: number;
}

export class FakeMercs implements MercPort {
  readonly mercs = new Map<number, StrategicMerc>();
  readonly encumbrance = new Map<number, number>();
  readonly tired = new Set<number>();
  readonly experience: ExperienceAward[] = [];
  readonly placedInSector: number[] = [];
  readonly removedFromSector: number[] = [];
  readonly collapsed: number[] = [];
  fuel = 10000;

  add(o: FakeMercOptions): StrategicMerc {
    const m: StrategicMerc = {
      id: o.id,
      profile: o.profile ?? o.id + 50,
      life: o.life ?? 80,
      lifeMax: o.lifeMax ?? 80,
      strength: o.strength ?? 80,
      isVehicle: o.isVehicle ?? false,
      isRobot: o.isRobot ?? false,
      isEpc: o.isEpc ?? false,
      isPassengerOrDriver: false,
      asleep: false,
      sector: o.sector,
      betweenSectors: false,
      groupId: 0,
      prevSectorId: o.prevSectorId ?? 255,
      insertionCode: 0,
      insertionDirection: 0,
      path: [],
      assignment: o.assignment ?? 20,
      vehicleId: -1,
    };
    this.mercs.set(o.id, m);
    if (o.encumbrance !== undefined) this.encumbrance.set(o.id, o.encumbrance);
    if (o.tooTired) this.tired.add(o.id);
    return m;
  }

  get(id: number): StrategicMerc | undefined {
    return this.mercs.get(id);
  }

  byProfile(profile: number): StrategicMerc | undefined {
    return [...this.mercs.values()].find((m) => m.profile === profile);
  }

  all(): readonly StrategicMerc[] {
    return [...this.mercs.values()];
  }

  carriedWeightPercent(id: number): number {
    return this.encumbrance.get(id) ?? 0;
  }

  changeAssignment(id: number, assignment: number): void {
    const m = this.mercs.get(id);
    if (m) m.assignment = assignment;
  }

  assignToSquad(id: number, squad: number): void {
    this.changeAssignment(id, squad);
  }

  awardTravelExperience(id: number, stat: TravelStat, points: number): void {
    this.experience.push({ id, stat, points });
  }

  removeFromTacticalSector(id: number): void {
    this.removedFromSector.push(id);
  }

  updateMercInSector(id: number): void {
    this.placedInSector.push(id);
  }

  tooTiredToTravel(id: number): boolean {
    return this.tired.has(id);
  }

  collapseFromFatigue(id: number): void {
    this.collapsed.push(id);
  }

  spendVehicleFuel(_vehicleSoldierId: number, fuel: number): number {
    this.fuel = Math.max(0, this.fuel - fuel);
    return this.fuel;
  }
}

export interface TestContextOptions {
  readonly content: StrategicContent;
  readonly state?: StrategicState;
  readonly stateOptions?: StrategicStateOptions;
  readonly mercs?: MercPort;
  readonly ai?: Partial<StrategicAiPort>;
  readonly world?: Partial<TacticalWorldPort>;
  readonly helicopter?: Partial<HelicopterPort>;
  readonly random?: RollSource;
  readonly preRandom?: RollSource;
}

export function testContext(o: TestContextOptions): StrategicContext {
  const base = createStrategicContext({ state: o.state ?? createStrategicState(o.stateOptions), content: o.content });
  return createStrategicContext({
    state: base.state,
    content: o.content,
    mercs: o.mercs ?? base.mercs,
    ai: { ...base.ai, ...o.ai },
    world: { ...base.world, ...o.world },
    helicopter: { ...base.helicopter, ...o.helicopter },
    random: o.random ?? base.random,
    preRandom: o.preRandom ?? base.preRandom,
  });
}
