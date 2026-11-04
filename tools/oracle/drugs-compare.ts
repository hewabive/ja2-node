import { NOTHING } from '../../src/content/items/items.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { createItems, type ItemObject } from '../../src/sim/items/object.ts';
import { applyDrugs, drunkLevel, mercUnderTheInfluence } from '../../src/sim/tactical/drugs.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import { profileProgress } from '../../src/sim/tactical/profiles.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveExplosive,
  effectiveLeadership,
  effectiveMarksmanship,
  effectiveMechanical,
  effectiveMedical,
  effectiveWisdom,
} from '../../src/sim/tactical/skills.ts';
import { type DrugCourse, NO_PROFILE, type Soldier } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { beginMercTurn } from '../../src/sim/tactical/turns/turns.ts';
import { type Draw, firstDifference, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const DRUG_PROBES: ReadonlySet<string> = new Set(['drug', 'mercturn', 'regenhour']);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const num = (v: unknown) => Number(v ?? 0);
const list = (v: unknown) => (v === undefined ? [] : String(v).split(',').map(Number));

interface ProbeRun {
  readonly problems: string[];
  readonly extra: unknown;
}

function courseRow(c: DrugCourse): number[] {
  return [c.future, c.rate, c.effect, c.sideEffectRate, c.sideEffect];
}

function effectiveStats(t: TacticalState, s: Soldier): number[] {
  return [
    effectiveAgility(s),
    effectiveDexterity(s),
    effectiveWisdom(s),
    effectiveLeadership(s),
    effectiveMarksmanship(s),
    effectiveMechanical(s),
    effectiveExplosive(s),
    effectiveMedical(s),
    effectiveExpLevel(t, s),
  ];
}

function drugSoldier(t: TacticalState, s: Soldier): Json {
  return {
    id: s.id,
    courses: [courseRow(s.drugs.adrenaline), courseRow(s.drugs.alcohol)],
    regen: [s.regenerationCounter, s.regenBoostersUsedToday],
    drunkLevel: drunkLevel(s),
    underInfluence: mercUnderTheInfluence(s),
    life: [s.life, s.lifeMax, s.bleeding],
    breath: [s.breath, s.breathMax, s.breathRed],
    morale: [s.morale, s.tacticalMoraleMod],
    ap: [s.actionPoints, s.initialActionPoints, calcActionPoints(t, s)],
    effective: effectiveStats(t, s),
  };
}

function summary(s: Soldier): string {
  const { adrenaline, alcohol } = s.drugs;
  return `adrenaline ${JSON.stringify(courseRow(adrenaline))} alcohol ${JSON.stringify(courseRow(alcohol))} ap ${s.actionPoints}`;
}

function drugObject(o: ItemObject): Json {
  return { item: o.item, count: o.count, status: o.status.slice(0, o.count) };
}

export class DrugComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
  }

  async #campaignSession(): Promise<CampaignSession> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('drug probes need a save');
      this.#session = (await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
    }
    return this.#session;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const c = (await this.#campaignSession()).campaign;
      const a = (p.args as Json | undefined) ?? {};
      if (p.probe === 'regenhour') return this.#regenHour(label, c, p, a);
      return this.#soldierProbe(label, c, p, a);
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #t(c: CampaignSim): TacticalState {
    const t = c.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #soldier(t: TacticalState, id: unknown): Soldier {
    const s = t.soldiers[num(id)];
    if (!s?.placed) throw new Error(`soldier ${String(id)} is not in the loaded sector`);
    return s;
  }

  #regenHour(label: string, c: CampaignSim, p: Json, a: Json): number {
    const flow = c.battle;
    if (!flow) throw new Error('no battle flow');
    const count = a.count === undefined ? 1 : num(a.count);
    for (let i = 0; i < count; i++) flow.updateRegenCounters();
    const team = flow.roster
      .all()
      .map((m) => [m.id, m.soldier.regenBoostersUsedToday])
      .sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));
    const diff = firstDifference(team, p.team);
    return report(label, diff === null, diff ?? JSON.stringify(team));
  }

  #replay(t: TacticalState, p: Json, action: () => void): string[] {
    const draws = (p.draws as Draw[] | undefined) ?? [];
    const main = new StrictReplay(
      draws.filter((d) => d[0] === MAIN_STREAM),
      'Random',
    );
    const pre = new StrictReplay(
      draws.filter((d) => d[0] === PRE_STREAM),
      'PreRandom',
    );
    const rng = t.rng as unknown as Record<string, unknown>;
    const preRng = t.pre as unknown as Record<string, unknown>;
    Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
    Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
    const problems: string[] = [];
    try {
      action();
      if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
    } catch (e) {
      if (e instanceof ReplayMismatch) problems.push(e.message);
      else throw e;
    } finally {
      delete rng.int;
      delete rng.chance;
      delete preRng.int;
      delete preRng.chance;
    }
    return problems;
  }

  #drugObject(t: TacticalState, a: Json): ItemObject {
    const items = t.content.items;
    const name = String(a.item ?? '');
    const item = /^\d+$/.test(name) ? Number(name) : (items.byName.get(name)?.index ?? NOTHING);
    const statuses = list(a.status);
    if (statuses.length === 0) throw new Error('drug needs status=<s>[,<s>...]');
    const count = a.count === undefined ? statuses.length : num(a.count);
    const o = createItems(items, item, statuses[0] ?? 0, count);
    statuses.forEach((status, i) => {
      if (i > 0 && i < count) o.status[i] = status;
    });
    return o;
  }

  #lifetime(t: TacticalState, s: Soldier): number {
    return s.profile === NO_PROFILE ? 0 : (profileProgress(t, s.profile)?.numTimesDrugUseInLifetime ?? 0);
  }

  #run(t: TacticalState, s: Soldier, p: Json, a: Json): ProbeRun {
    if (p.probe === 'drug') {
      const o = this.#drugObject(t, a);
      const progress = profileProgress(t, s.profile);
      if (a.lifetime !== undefined && progress) progress.numTimesDrugUseInLifetime = num(a.lifetime);
      let applied = false;
      const problems = this.#replay(t, p, () => {
        applied = applyDrugs(t, s, o);
      });
      return { problems, extra: { applied, object: drugObject(o) } };
    }
    if (a.life !== undefined) s.life = num(a.life);
    if (a.bleeding !== undefined) s.bleeding = num(a.bleeding);
    if (a.ap !== undefined) s.actionPoints = num(a.ap);
    const turns = a.count === undefined ? 1 : num(a.count);
    const inCombat = t.inCombat;
    t.inCombat = num(a.combat) !== 0;
    try {
      const problems = this.#replay(t, p, () => {
        for (let i = 0; i < turns; i++) beginMercTurn(t, s);
      });
      return { problems, extra: null };
    } finally {
      t.inCombat = inCombat;
    }
  }

  #soldierProbe(label: string, c: CampaignSim, p: Json, a: Json): number {
    const t = this.#t(c);
    const s = this.#soldier(t, a.who);
    const { problems, extra } = this.#run(t, s, p, a);
    const ours = { extra, lifetime: this.#lifetime(t, s), soldier: drugSoldier(t, s) };
    const theirs = { extra: p.extra, lifetime: p.lifetime, soldier: p.soldier };
    const diff = firstDifference(ours, theirs);
    if (diff) problems.push(diff);
    return report(label, problems.length === 0, problems.join('; ') || summary(s));
  }
}
