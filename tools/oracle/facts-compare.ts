import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { checkFact } from '../../src/sim/strategic/narrative/check-fact.ts';
import { Fact } from '../../src/sim/strategic/narrative/fact-ids.ts';
import { NUM_FACTS, setQuestStatus } from '../../src/sim/strategic/narrative/facts.ts';
import { hourlyQuestUpdate } from '../../src/sim/strategic/narrative/hourly.ts';
import { endQuest, internalEndQuest, internalStartQuest, startQuest } from '../../src/sim/strategic/narrative/quests.ts';
import type { SectorPosition } from '../../src/sim/strategic/state.ts';
import type { ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { NO_PROFILE, Team } from '../../src/sim/tactical/soldier.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const FACT_PROBES: ReadonlySet<string> = new Set([
  'narrative',
  'setquest',
  'setnpcprofile',
  'checkfact',
  'quest',
  'earlymorning',
  'hourlynpc',
  'questentry',
  'questexit',
  'entersector',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const NO_SOLDIER = -1;
const UNKNOWN_INPUT_FACTS: ReadonlySet<number> = new Set([Fact.PC_HAS_CONRADS_RECRUIT_OPINION]);

const num = (v: unknown) => Number(v ?? 0);

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class StrictReplay {
  readonly #draws: Draw[];
  readonly #stream: string;
  #at = 0;

  constructor(draws: Draw[], stream: string) {
    this.#draws = draws;
    this.#stream = stream;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`${this.#stream} draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n)
      throw new ReplayMismatch(`${this.#stream} draw #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

function replayed(c: CampaignSim, draws: readonly Draw[], run: () => void): string | null {
  const s = c.state;
  const main = new StrictReplay(
    draws.filter((d) => d[0] === MAIN_STREAM),
    'Random',
  );
  const pre = new StrictReplay(
    draws.filter((d) => d[0] === PRE_STREAM),
    'PreRandom',
  );
  const saved = { rng: s.rng, pre: s.pre };
  Object.assign(s, { rng: main, pre });
  try {
    run();
    if (main.left || pre.left) return `${main.left} Random and ${pre.left} PreRandom draws left over`;
    return null;
  } catch (e) {
    if (e instanceof ReplayMismatch) return e.message;
    throw e;
  } finally {
    Object.assign(s, saved);
  }
}

function maskedFacts(facts: readonly number[]): number[] {
  return facts.map((v, id) => (UNKNOWN_INPUT_FACTS.has(id) ? -1 : v));
}

function ourState(c: CampaignSim): Json {
  const n = c.state.narrative;
  return {
    facts: maskedFacts([...n.facts]),
    quests: [...n.quests],
    boxing: { won: n.boxing.matchesWon, rests: n.boxing.rests, resting: n.boxing.resting, fought: n.boxing.fought.map((f) => (f ? 1 : 0)) },
    terrorists: c.state.terrorists.count,
    balance: c.state.finances.balance,
  };
}

function theirState(p: Json): Json {
  const st = p.state as Json;
  const boxing = st.boxing as Json;
  return {
    facts: maskedFacts(st.facts as number[]),
    quests: st.quests as number[],
    boxing: { won: boxing.won, rests: boxing.rests, resting: boxing.resting, fought: boxing.fought },
    terrorists: st.terrorists,
    balance: st.balance,
  };
}

function profileDump(id: number, p: ProfileProgress | null): Json {
  if (!p) return { id, missing: true };
  return {
    id,
    sector: [p.sectorX, p.sectorY, p.sectorZ],
    flags: [p.miscFlags, p.miscFlags2, p.miscFlags3],
    npcData: [p.npcData, p.npcData2],
    money: p.money,
    balance: p.balance,
    life: p.life,
    lifeMax: p.stats.lifeMax,
    status: p.mercStatus,
    town: p.town,
    spokenTo: p.lastDateSpokenTo,
    insertion: [p.useProfileInsertion ? 1 : 0, p.insertionCode, p.insertionData],
    quote: [p.quoteRecord, p.quoteActionId],
    inventory: [...p.inventory],
    invCount: [...p.inventoryCount],
  };
}

function firstDifference(ours: unknown, theirs: unknown, path = ''): string | null {
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    if (ours.length !== theirs.length) return `${path}: length ${ours.length} vs ${theirs.length}`;
    for (let i = 0; i < ours.length; i++) {
      const d = firstDifference(ours[i], theirs[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object') {
    const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
    for (const k of keys) {
      const d = firstDifference((ours as Json)[k], (theirs as Json)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return ours === theirs ? null : `${path}: ours ${JSON.stringify(ours)} oracle ${JSON.stringify(theirs)}`;
}

function sectorArg(a: Json): SectorPosition {
  const s = parseSectorString(String(a.sector));
  return { x: s.x, y: s.y, z: num(a.z) };
}

export class FactComparer {
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
    if (this.#session) return this.#session;
    if (!this.#bytes) throw new Error('fact probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    this.#session = session;
    return session;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    const session = await this.#campaignSession();
    const c = session.campaign;
    const a = (p.args as Json | undefined) ?? {};
    const draws = (p.draws as Draw[] | undefined) ?? [];
    let replay: string | null = null;
    let extraOurs: unknown = null;
    let extraTheirs: unknown = null;
    switch (p.probe) {
      case 'narrative':
        break;
      case 'setquest':
        setQuestStatus(c.state.narrative, num(a.id), a.status === undefined ? 1 : num(a.status));
        break;
      case 'setnpcprofile':
        this.#setProfile(c, a);
        break;
      case 'checkfact': {
        const result = this.#checkFacts(c, a);
        extraOurs = result;
        const theirs = p.result as Json;
        extraTheirs = { before: maskedFacts(theirs.before as number[]), results: maskedFacts(theirs.results as number[]) };
        break;
      }
      case 'quest':
        extraOurs = this.#quest(c, a);
        extraTheirs = (p.result as Json).history;
        break;
      case 'earlymorning':
        replay = replayed(c, draws, () => c.narrative.earlyMorning());
        break;
      case 'hourlynpc':
        replay = replayed(c, draws, () => this.#hourly(c, num(a.hour)));
        break;
      case 'questentry': {
        const before = c.state.laptop.history.length;
        replay = replayed(c, draws, () => c.narrative.handleQuestCodeOnSectorEntry(sectorArg(a)));
        extraOurs = c.state.laptop.history.slice(before).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]);
        extraTheirs = ((p.result as Json).history as number[][]).map(([code, second, date, x, y, z]) =>
          x === -1 && y === -1 ? [code, second, date, -1, -1, 0] : [code, second, date, x, y, z],
        );
        break;
      }
      case 'questexit':
        replay = replayed(c, draws, () => c.narrative.handleQuestCodeOnSectorExit(sectorArg(a)));
        break;
      case 'entersector': {
        const sector = sectorArg(a);
        await session.prepare({ type: 'enterSector', sector: `${String(a.sector)}` });
        if (!c.sectors?.setCurrentWorldSector(sector)) return report(label, false, 'sector map not loaded');
        extraOurs = this.#activeNpcs(c);
        extraTheirs = ((p.result as Json).soldiers as Json[]).map((s) => num(s.profile)).sort((x, y) => x - y);
        break;
      }
      default:
        return report(label, false, 'unknown fact probe');
    }
    if (replay) return report(label, false, replay);
    const ours = { state: ourState(c), extra: extraOurs, profiles: this.#profiles(c, p) };
    const theirs = { state: theirState(p), extra: extraTheirs, profiles: p.profiles };
    const diff = firstDifference(ours, theirs);
    return report(label, diff === null, diff ?? `${(p.profiles as unknown[]).length} profiles`);
  }

  #profiles(c: CampaignSim, p: Json): Json[] {
    return ((p.profiles as Json[] | undefined) ?? []).map((native) => profileDump(num(native.id), c.narrative.profile(num(native.id))));
  }

  #setProfile(c: CampaignSim, a: Json): void {
    const p = c.narrative.profile(num(a.id));
    if (!p) throw new Error(`no profile ${String(a.id)}`);
    if (a.sector !== undefined) {
      const s = parseSectorString(String(a.sector));
      p.sectorX = s.x;
      p.sectorY = s.y;
      p.sectorZ = 0;
    }
    if (a.z !== undefined) p.sectorZ = num(a.z);
    if (a.nowhere !== undefined) {
      p.sectorX = 0;
      p.sectorY = 0;
      p.sectorZ = 0;
    }
    if (a.npcdata !== undefined) p.npcData = num(a.npcdata);
    if (a.npcdata2 !== undefined) p.npcData2 = num(a.npcdata2);
    if (a.flags !== undefined) p.miscFlags = num(a.flags);
    if (a.flags2 !== undefined) p.miscFlags2 = num(a.flags2);
    if (a.flags3 !== undefined) p.miscFlags3 = num(a.flags3);
    if (a.money !== undefined) p.money = num(a.money);
    if (a.balance !== undefined) p.balance = num(a.balance);
    if (a.life !== undefined) p.life = num(a.life);
    if (a.spokento !== undefined) p.lastDateSpokenTo = num(a.spokento);
    if (a.insertion !== undefined) p.useProfileInsertion = num(a.insertion) !== 0;
    if (a.code !== undefined) p.insertionCode = num(a.code);
    if (a.data !== undefined) p.insertionData = num(a.data);
  }

  #checkFacts(c: CampaignSim, a: Json): Json {
    const talk = c.narrative.talk;
    if (a.src !== undefined || a.dest !== undefined) {
      const src = num(a.src ?? NO_SOLDIER);
      const dest = num(a.dest ?? NO_SOLDIER);
      talk.src = src < 0 ? null : src;
      talk.dest = dest < 0 ? null : dest;
      if (talk.src !== null)
        talk.srcProfile = c.narrative.roster()?.get(talk.src)?.profile ?? c.tactical?.state.soldiers[talk.src]?.profile ?? NO_PROFILE;
    }
    if (a.srcprofile !== undefined) talk.srcProfile = num(a.srcprofile);
    const before = maskedFacts([...c.state.narrative.facts]);
    const ctx = c.narrative.factContext();
    const profile = num(a.profile);
    const ids = a.id !== undefined ? [num(a.id)] : Array.from({ length: NUM_FACTS }, (_, i) => i);
    const results = ids.map((id) => {
      checkFact(ctx, id, profile);
      return c.state.narrative.facts[id] ?? 0;
    });
    return { before, results: maskedFacts(results) };
  }

  #quest(c: CampaignSim, a: Json): number[][] {
    const ctx = c.narrative.questContext();
    const quest = num(a.id);
    const sector = a.sector === undefined ? null : sectorArg(a);
    const before = c.state.laptop.history.length;
    const action = String(a.action ?? 'start');
    if (action === 'start') startQuest(ctx, quest, sector);
    else if (action === 'end') endQuest(ctx, quest, sector);
    else if (action === 'istart') internalStartQuest(ctx, quest, sector, false);
    else internalEndQuest(ctx, quest, sector, false);
    return c.state.laptop.history.slice(before).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]);
  }

  #hourly(c: CampaignSim, hour: number): void {
    const clock = c.state.clock;
    clock.seconds = Math.trunc(clock.seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY + hour * SECONDS_PER_HOUR;
    hourlyQuestUpdate(c.state.narrative, hour);
    const slots = c.narrative.periodicSlots(null);
    slots.hourlyCheckIfSlayAloneSoHeCanLeave?.();
    c.helicopter.payOffSkyriderDebtIfAny();
  }

  #activeNpcs(c: CampaignSim): number[] {
    const t = c.tactical?.state;
    if (!t) return [];
    return t.soldiers
      .filter((s) => s && (s.placed || s.offMap || s.away) && s.team !== Team.OUR && s.profile !== NO_PROFILE)
      .map((s) => s?.profile ?? 0)
      .sort((x, y) => x - y);
  }
}
