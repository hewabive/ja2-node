import { RestrictedScroll } from '../../src/content/world/render-bounds.ts';
import { PreRandom, Rng } from '../../src/core/rng.ts';
import { createItem, createItems } from '../../src/sim/items/object.ts';
import type { MilitiaCounts } from '../../src/sim/strategic/forces/autoresolve/close.ts';
import { ScriptedStream } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import {
  type ArRng,
  type AutoresolveEnv,
  type AutoresolveHooks,
  type AutoresolveInput,
  type AutoresolveState,
  type AutoresolveWorld,
  createAutoresolveState,
} from '../../src/sim/strategic/forces/autoresolve/state.ts';
import { EncounterCode } from '../../src/sim/strategic/forces/constants.ts';
import type { RandomStream } from '../../src/sim/tactical/combat/context.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { noCampaignFields, noRelations, type ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { Body, createSoldier, NO_PROFILE, NOWHERE, type Soldier, SoldierClass, Team } from '../../src/sim/tactical/soldier.ts';

export interface ArSoldierOptions {
  readonly id?: number;
  readonly team?: number;
  readonly profile?: number;
  readonly soldierClass?: number;
  readonly body?: number;
  readonly strength?: number;
  readonly dexterity?: number;
  readonly wisdom?: number;
  readonly marksmanship?: number;
  readonly agility?: number;
  readonly medical?: number;
  readonly leadership?: number;
  readonly experience?: number;
  readonly morale?: number;
  readonly breath?: number;
  readonly breathMax?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly gun?: string | null;
  readonly magazines?: number;
}

const PALETTES = { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' } as const;

let nextId = 0;

export function arSoldier(content: TacticalContent, o: ArSoldierOptions = {}): Soldier {
  const s = createSoldier({
    id: o.id ?? nextId++,
    team: o.team ?? Team.OUR,
    name: 'ar',
    profile: o.profile ?? NO_PROFILE,
    soldierClass: o.soldierClass ?? SoldierClass.NONE,
    bodyType: o.body ?? Body.REGMALE,
    palettes: PALETTES,
    stats: {
      agility: o.agility ?? 60,
      dexterity: o.dexterity ?? 60,
      strength: o.strength ?? 60,
      wisdom: o.wisdom ?? 60,
      leadership: o.leadership ?? 30,
      marksmanship: o.marksmanship ?? 60,
      mechanical: 20,
      explosives: 20,
      medical: o.medical ?? 20,
      experience: o.experience ?? 3,
    },
    life: o.life ?? 60,
    lifeMax: o.lifeMax ?? o.life ?? 60,
    morale: o.morale ?? 50,
    breath: o.breathMax ?? 100,
    gridNo: NOWHERE,
    direction: 0,
    state: 0,
  });
  s.breath = o.breath ?? s.breath;
  const gun = o.gun === undefined ? 'GLOCK_17' : o.gun;
  if (gun) {
    const def = content.items.byName.get(gun);
    if (!def) throw new Error(`no item ${gun}`);
    s.inv[InvSlot.HAND] = createItem(content.items, def.index, 100);
    const mags = o.magazines ?? 0;
    const mag = content.items.byIndex.get(s.inv[InvSlot.HAND]?.gunAmmoItem ?? 0);
    if (mags > 0 && mag) s.inv[InvSlot.BIGPOCK1] = createItems(content.items, mag.index, 100, mags);
  }
  return s;
}

export function enemySoldier(content: TacticalContent, o: ArSoldierOptions = {}): Soldier {
  return arSoldier(content, { team: Team.ENEMY, soldierClass: SoldierClass.ARMY, ...o });
}

export function militiaSoldier(content: TacticalContent, o: ArSoldierOptions = {}): Soldier {
  return arSoldier(content, { team: Team.MILITIA, soldierClass: SoldierClass.GREEN_MILITIA, ...o });
}

export function itemIndex(content: TacticalContent, name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

export function scripted(values: readonly number[] = [], fallback: number | null = null): ScriptedStream {
  return new ScriptedStream(values, fallback);
}

export function seededRng(seed: number): ArRng {
  const main = Rng.fromSeed(seed);
  return { main, pre: PreRandom.create(main), fx: Rng.fromSeed(seed ^ 0x5f3759df) };
}

export interface EnvOptions {
  readonly pre?: RandomStream;
  readonly main?: RandomStream;
  readonly fx?: RandomStream;
  readonly rng?: ArRng;
  readonly world?: Partial<AutoresolveWorld>;
  readonly hooks?: AutoresolveHooks;
  readonly profiles?: Map<number, ProfileProgress>;
}

export function arEnv(content: TacticalContent, o: EnvOptions = {}): AutoresolveEnv {
  const base = o.rng ?? { pre: scripted([], 0), main: Rng.fromSeed(1), fx: scripted([], 0) };
  return {
    content,
    profiles: o.profiles ?? new Map(),
    rng: { pre: o.pre ?? base.pre, main: o.main ?? base.main, fx: o.fx ?? base.fx },
    world: { day: 1, playerCapturedForRescue: false, lastMapRestrictedScroll: RestrictedScroll.NONE, ...o.world },
    hooks: o.hooks ?? {},
  };
}

export function arState(o: Partial<AutoresolveInput> & Pick<AutoresolveInput, 'mercs'>): AutoresolveState {
  return createAutoresolveState({
    sector: 0,
    encounter: EncounterCode.ENEMY_INVASION,
    militia: [],
    enemies: [],
    ...o,
  });
}

export function progressFor(id: number, overrides: Partial<ProfileProgress> = {}): ProfileProgress {
  const stats = {
    lifeMax: 60,
    agility: 60,
    dexterity: 60,
    wisdom: 60,
    medical: 20,
    explosives: 20,
    mechanical: 20,
    marksmanship: 60,
    experience: 3,
    strength: 60,
    leadership: 30,
  };
  const gains = Object.fromEntries(Object.keys(stats).map((k) => [k, 0])) as typeof stats;
  return {
    id,
    evolution: 0,
    attitude: 0,
    buddies: [],
    hated: [],
    ...noRelations(),
    life: 60,
    stats,
    gains,
    statChangeChances: new Array<number>(12).fill(0),
    statChangeSuccesses: new Array<number>(12).fill(0),
    kills: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    timesWounded: 0,
    battlesFought: 0,
    ...noCampaignFields(),
    ...overrides,
  };
}

export class TestMilitia implements MilitiaCounts {
  readonly counts: number[];
  readonly removed: number[] = [];
  readonly promoted: number[] = [];

  constructor(green: number, regular: number, elite: number) {
    this.counts = [green, regular, elite];
  }

  count(rank: number): number {
    return this.counts[rank] ?? 0;
  }

  remove(rank: number): void {
    this.removed.push(rank);
    if ((this.counts[rank] ?? 0) > 0) this.counts[rank] = (this.counts[rank] ?? 0) - 1;
  }

  promote(rank: number): void {
    this.promoted.push(rank);
    this.counts[rank] = (this.counts[rank] ?? 0) - 1;
    this.counts[rank + 1] = (this.counts[rank + 1] ?? 0) + 1;
  }
}
