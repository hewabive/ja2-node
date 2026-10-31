import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ItemTable, loadItemTable } from '../../src/content/items/items.ts';
import { type EconomyContent, loadEconomyContent } from '../../src/content/strategic/economy-content.ts';
import { type Sector, sectorFromId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import { createItem, createItems, emptyObject, type ItemObject } from '../../src/sim/items/object.ts';
import { Assignment } from '../../src/sim/strategic/economy/constants.ts';
import { createEconomyContext, type EconomySetup } from '../../src/sim/strategic/economy/context.ts';
import type { CrewMember, CrewPort, EconomyContext, MercStats, StatDamage } from '../../src/sim/strategic/economy/ports.ts';
import { applySquadAssignment } from '../../src/sim/strategic/economy/set-assignment.ts';
import type { HelicopterPort } from '../../src/sim/strategic/forces/ports.ts';
import { createStrategicState, type StrategicStateOptions } from '../../src/sim/strategic/state.ts';
import { loadStrategicTestContent, testContext } from './strategic.ts';

const DATA_DIR = join(import.meta.dirname, '../../data');
const INVENTORY_SLOTS = 19;

export interface EconomyTestContent {
  readonly strategic: StrategicContent;
  readonly economy: EconomyContent;
  readonly items: ItemTable;
}

const readData = async (path: string) => new Uint8Array(readFileSync(join(DATA_DIR, path)));

export async function loadEconomyTestContent(): Promise<EconomyTestContent> {
  const strategic = await loadStrategicTestContent();
  const economy = await loadEconomyContent(readData, strategic.towns);
  const items = await loadItemTable(async (path) => JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8')));
  return { strategic, economy, items };
}

export interface StatChangeCall {
  readonly id: number;
  readonly stat: number;
  readonly chances: number;
  readonly cause: number;
}

export interface CrewOptions {
  readonly id: number;
  readonly profile?: number;
  readonly sector: Sector;
  readonly assignment?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breathMax?: number;
  readonly stats?: Partial<MercStats>;
  readonly effective?: Partial<MercStats>;
  readonly skillTraits?: readonly number[];
  readonly profileTraits?: readonly number[];
  readonly needForSleep?: number;
  readonly isVehicle?: boolean;
  readonly isRobot?: boolean;
  readonly isEpc?: boolean;
  readonly lastAssignmentChangeMin?: number;
  readonly inSector?: boolean;
}

const DEFAULT_STATS: MercStats = {
  strength: 70,
  dexterity: 80,
  agility: 70,
  wisdom: 80,
  leadership: 70,
  marksmanship: 70,
  mechanical: 80,
  medical: 80,
  explosives: 40,
  expLevel: 4,
};

export class FakeCrew implements CrewPort {
  readonly mercs = new Map<number, CrewMember>();
  readonly statChanges: StatChangeCall[] = [];
  readonly opinions = new Map<string, number>();
  readonly encumbrance = new Map<number, number>();
  economy: EconomyContext | null = null;
  dressWoundResult = 0;

  add(o: CrewOptions): CrewMember {
    const stats = { ...DEFAULT_STATS, ...o.stats };
    const m: CrewMember = {
      id: o.id,
      profile: o.profile ?? o.id + 50,
      life: o.life ?? 80,
      lifeMax: o.lifeMax ?? 80,
      strength: stats.strength,
      isVehicle: o.isVehicle ?? false,
      isRobot: o.isRobot ?? false,
      isEpc: o.isEpc ?? false,
      isPassengerOrDriver: false,
      asleep: false,
      sector: o.sector,
      betweenSectors: false,
      groupId: 0,
      prevSectorId: 255,
      insertionCode: 0,
      insertionDirection: 0,
      path: [],
      assignment: o.assignment ?? Assignment.ON_DUTY,
      vehicleId: -1,
      fractLife: 0,
      bleeding: 0,
      breath: o.breathMax ?? 100,
      breathMax: o.breathMax ?? 100,
      collapsed: false,
      forcedToStayAwake: false,
      complainedThatTired: false,
      nothingToDo: false,
      doneQuoteSaid: false,
      trainStat: 0,
      lastAssignmentChangeMin: o.lastAssignmentChangeMin ?? 0,
      hospitalPriceModifier: 0,
      fixingRobot: false,
      vehicleUnderRepair: -1,
      inSector: o.inSector ?? false,
      stats,
      effective: { ...stats, ...o.effective },
      statDamage: { agility: 0, dexterity: 0, strength: 0, wisdom: 0 },
      skillTraits: o.skillTraits ?? [0, 0],
      profileTraits: o.profileTraits ?? o.skillTraits ?? [0, 0],
      needForSleep: o.needForSleep ?? 7,
      inv: Array.from({ length: INVENTORY_SLOTS }, emptyObject),
    };
    this.mercs.set(o.id, m);
    return m;
  }

  get(id: number): CrewMember | undefined {
    return this.mercs.get(id);
  }

  byProfile(profile: number): CrewMember | undefined {
    return this.all().find((m) => m.profile === profile);
  }

  all(): readonly CrewMember[] {
    return [...this.mercs.values()].sort((a, b) => a.id - b.id);
  }

  carriedWeightPercent(id: number): number {
    return this.encumbrance.get(id) ?? 0;
  }

  changeAssignment(id: number, assignment: number): void {
    const m = this.mercs.get(id);
    if (m) m.assignment = assignment;
  }

  assignToSquad(id: number, squad: number): void {
    const m = this.mercs.get(id);
    if (!m) return;
    if (this.economy) applySquadAssignment(this.economy, m, squad);
    else m.assignment = squad;
  }

  awardTravelExperience(): void {}
  removeFromTacticalSector(): void {}
  updateMercInSector(): void {}

  tooTiredToTravel(): boolean {
    return false;
  }

  collapseFromFatigue(): void {}

  spendVehicleFuel(): number {
    return 0;
  }

  statChange(id: number, stat: number, chances: number, cause: number): void {
    this.statChanges.push({ id, stat, chances, cause });
  }

  healStat(id: number, stat: keyof StatDamage, points: number): void {
    const m = this.mercs.get(id);
    if (m) (m.stats as unknown as Record<string, number>)[stat] = ((m.stats as unknown as Record<string, number>)[stat] ?? 0) + points;
  }

  opinion(profile: number, about: number): number {
    return this.opinions.get(`${profile}:${about}`) ?? 0;
  }

  dressWound(): number {
    return this.dressWoundResult;
  }
}

export interface EconomyTestOptions {
  readonly content: EconomyTestContent;
  readonly stateOptions?: StrategicStateOptions;
  readonly crew?: FakeCrew;
  readonly setup?: Partial<Omit<EconomySetup, 'economy' | 'items' | 'crew'>>;
  readonly random?: { int(n: number): number; chance(p: number): boolean };
  readonly preRandom?: { int(n: number): number; chance(p: number): boolean };
  readonly helicopter?: Partial<HelicopterPort>;
}

export function economyTestContext(o: EconomyTestOptions): { ctx: EconomyContext; crew: FakeCrew } {
  const crew = o.crew ?? new FakeCrew();
  const strategic = testContext({
    content: o.content.strategic,
    state: createStrategicState(o.stateOptions),
    mercs: crew,
    ...(o.random ? { random: o.random } : {}),
    ...(o.preRandom ? { preRandom: o.preRandom } : {}),
    ...(o.helicopter ? { helicopter: o.helicopter } : {}),
  });
  const ctx = createEconomyContext(strategic, { economy: o.content.economy, items: o.content.items, crew, ...o.setup });
  crew.economy = ctx;
  return { ctx, crew };
}

export function setTownNames(ctx: EconomyContext): void {
  for (const town of ctx.content.towns) {
    for (const id of town.sectors) {
      const e = ctx.state.map.elements[strategicIndex(sectorFromId(id))];
      if (e) e.nameId = town.townId;
    }
  }
}

export function setPlayerControlled(ctx: EconomyContext, ids: readonly number[]): void {
  for (const id of ids) {
    const e = ctx.state.map.elements[strategicIndex(sectorFromId(id))];
    if (e) e.enemyControlled = false;
  }
}

export function itemId(items: ItemTable, name: string): number {
  const def = items.byName.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return def.index;
}

export function kit(items: ItemTable, name: string, statuses: readonly number[]): ItemObject {
  const o = createItems(items, itemId(items, name), statuses[0] ?? 100, statuses.length);
  statuses.forEach((s, k) => {
    o.status[k] = s;
  });
  return o;
}

export function item(items: ItemTable, name: string, status: number): ItemObject {
  return createItem(items, itemId(items, name), status);
}
