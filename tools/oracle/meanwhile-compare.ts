import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import { StructureFlags } from '../../src/content/world/structures.ts';
import { loadTacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { beginCaptureSequence, endCaptureSequence, enemyCapturesPlayerSoldier } from '../../src/sim/campaign/merc-fate.ts';
import { Meanwhile, StrategicAiAction } from '../../src/sim/strategic/ai/constants.ts';
import type { QueenContext } from '../../src/sim/strategic/ai/context.ts';
import { progressMilestones } from '../../src/sim/strategic/ai/difficulty.ts';
import {
  handleCreatureRelease,
  handleFirstBattleEndingWhileInTown,
  handleFirstMeanwhileSetUpWithTrashWorld,
  handleFlowersMeanwhileScene,
  handleKillChopperMeanwhileScene,
  handleMeanwhileEvent,
  handleMeanwhileEventPostingForSamLiberation,
  handleMeanwhileEventPostingForTownLiberation,
  handleMeanwhileEventPostingForTownLoss,
  handleOutskirtsOfMedunaMeanwhileScene,
  handleScientistAwolMeanwhileScene,
  INTERROGATION_SECTOR,
  MEDUNA_QUEEN_SECTOR,
  processImplicationsOfMeanwhile,
  scheduleInterrogation,
} from '../../src/sim/strategic/ai/meanwhile.ts';
import type { MeanwhileDefinition } from '../../src/sim/strategic/ai/queen-state.ts';
import { executeStrategicAIAction } from '../../src/sim/strategic/ai/reactions.ts';
import { Fact, Quest } from '../../src/sim/strategic/narrative/fact-ids.ts';
import { applyProgressMilestones } from '../../src/sim/strategic/narrative/hourly.ts';
import { Npc } from '../../src/sim/strategic/narrative/npc-ids.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { unLockPauseState, unPauseGame } from '../../src/sim/strategic/time/world-clock.ts';
import { changeO3SectorStatue, statueTakesExplosion } from '../../src/sim/tactical/narrative/statue.ts';
import { RevealedFlags } from '../../src/sim/tactical/perception/fov.ts';
import { exitGridAt } from '../../src/sim/tactical/sector-exit.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { describeGroup } from './sai-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const MEANWHILE_PROBES: ReadonlySet<string> = new Set([
  'meanwhiles',
  'meanwhilepost',
  'firstbattle',
  'trashworld',
  'meanwhilerun',
  'meanwhileplayed',
  'hourlyprogress',
  'capture',
  'queendead',
  'statue',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MEANWHILE_PROFILES: readonly number[] = [Npc.QUEEN, Npc.ELLIOT, Npc.JOE, Npc.RAT, Npc.MADLAB, Npc.ROBOT, Npc.IGGY];
const O3 = { x: 3, y: 15, z: 0 };
const STATUE_GRIDNO = 13830;
const STATUE_EXIT_GRIDNO = 13669;
const EIGHTOSTRUCT = 19;
const NATIVE_EIGHTOSTRUCT_FIRST_TILE = 483;
const STATUE_SUB_INDEXES: readonly number[] = [5, 7, 8];
const statueTiles = (first: number) => STATUE_SUB_INDEXES.map((sub) => first + sub - 1);
const NATIVE_STATUE_TILES = statueTiles(NATIVE_EIGHTOSTRUCT_FIRST_TILE);

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

function replayed(c: CampaignSim, q: QueenContext, draws: readonly Draw[], run: () => void): string | null {
  const s = c.state;
  const main = new StrictReplay(
    draws.filter((d) => d[0] === MAIN_STREAM),
    'Random',
  );
  const pre = new StrictReplay(
    draws.filter((d) => d[0] === PRE_STREAM),
    'PreRandom',
  );
  const saved = { rng: s.rng, pre: s.pre, random: q.random, preRandom: q.preRandom };
  Object.assign(s, { rng: main, pre });
  Object.assign(q, { random: main, preRandom: pre });
  try {
    run();
    if (main.left || pre.left) return `${main.left} Random and ${pre.left} PreRandom draws left over`;
    return null;
  } catch (e) {
    if (e instanceof ReplayMismatch) return e.message;
    throw e;
  } finally {
    Object.assign(s, { rng: saved.rng, pre: saved.pre });
    Object.assign(q, { random: saved.random, preRandom: saved.preRandom });
  }
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

function definition(d: MeanwhileDefinition | null): number[] {
  return d ? [d.sector.x, d.sector.y, d.trigger, d.id, d.npc] : [0, 0, 0, 0, 0];
}

function profiles(c: CampaignSim): number[][] {
  return MEANWHILE_PROFILES.map((id) => {
    const p = c.narrative.profile(id);
    return p ? [id, p.sectorX, p.sectorY, p.sectorZ, p.gridNo, p.useProfileInsertion ? 1 : 0, p.npcData] : [id];
  });
}

function ourState(c: CampaignSim): Json {
  const s = c.state;
  const m = s.meanwhile;
  return {
    flags: m.flags,
    defs: m.defs.map(definition),
    current: definition(m.current),
    trying: m.trying,
    inScene: m.inScene,
    lastScheduled: m.currentId,
    events: s.queue.events.filter((e) => e.kind === EventKind.MEANWHILE).map((e) => [e.stamp, e.param, e.offset]),
    firstBattlePending: s.queen.firstBattleMeanwhilePending,
    firstBattleSector: s.economy.firstBattleSector,
    profiles: profiles(c),
    quests: [Quest.FIND_SCIENTIST, Quest.HELD_IN_ALMA, Quest.INTERROGATION, Quest.CREATURES].map((q) => s.narrative.quests[q] ?? 0),
    mikeFact: s.narrative.facts[Fact.MIKE_AVAILABLE_TO_ARMY] ?? 0,
    highestProgress: s.status.highestProgress,
    queenAwake: s.queen.awake,
    captureFlags: s.status.flags,
    captured: s.status.numCapturedForRescue,
    paused: s.clock.paused,
    pauseLocked: s.clock.pauseLocked,
    worldSeconds: s.clock.seconds,
  };
}

function theirState(p: Json): Json {
  const m = p.meanwhile as Json;
  return { ...m };
}

function alignProcessState(c: CampaignSim, native: Json): void {
  c.state.clock.paused = native.paused === true;
  c.state.clock.pauseLocked = native.pauseLocked === true;
  c.state.meanwhile.currentId = num(native.lastScheduled);
}

function sectorArg(a: Json, key: string): { x: number; y: number; z: number } {
  const s = parseSectorString(String(a[key]));
  return { x: s.x, y: s.y, z: 0 };
}

export class MeanwhileComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;
  #statueSim: TacticalSim | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
    this.#statueSim = null;
  }

  loadSector(): void {
    this.#statueSim = null;
  }

  async #freshSector(sim: TacticalSim): Promise<TacticalSim> {
    if (this.#statueSim) return this.#statueSim;
    const fresh = new TacticalSim(await loadTacticalWorld(this.#read, sim.mapPath), sim.state.content, SEED);
    fresh.state.sector = { ...O3 };
    this.#statueSim = fresh;
    return fresh;
  }

  async #campaignSession(): Promise<CampaignSession> {
    if (this.#session) return this.#session;
    if (!this.#bytes) throw new Error('meanwhile probes need a save');
    const { session } = await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    this.#session = session;
    return session;
  }

  async compare(p: Json, sim: TacticalSim | null): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    if (p.probe === 'statue') return sim ? this.#statue(label, p, await this.#freshSector(sim)) : report(label, false, 'no sector loaded');
    const session = await this.#campaignSession();
    const c = session.campaign;
    const q = c.queen;
    if (!q) return report(label, false, 'no strategic AI');
    const a = (p.args as Json | undefined) ?? {};
    const draws = (p.draws as Draw[] | undefined) ?? [];
    let replay: string | null = null;
    let result: unknown = null;
    switch (p.probe) {
      case 'meanwhiles':
        alignProcessState(c, p.meanwhile as Json);
        break;
      case 'meanwhilepost':
        replay = replayed(c, q, draws, () => this.#post(q, a));
        break;
      case 'firstbattle':
        handleFirstBattleEndingWhileInTown(q, sectorArg(a, 'sector'), num(a.autoresolve) !== 0);
        break;
      case 'trashworld':
        handleFirstMeanwhileSetUpWithTrashWorld(q);
        break;
      case 'meanwhilerun': {
        const outcome: { value: unknown } = { value: null };
        replay = replayed(c, q, draws, () => {
          outcome.value = this.#run(c, q, num(a.enemy) !== 0);
        });
        result = outcome.value;
        break;
      }
      case 'meanwhileplayed':
        result = this.#played(c, num(a.id));
        break;
      case 'hourlyprogress':
        replay = replayed(c, q, draws, () => this.#progress(c, q, a));
        break;
      case 'capture': {
        const outcome: { value: unknown } = { value: null };
        replay = replayed(c, q, draws, () => {
          outcome.value = this.#capture(c, a);
        });
        result = outcome.value;
        break;
      }
      case 'queendead':
        executeStrategicAIAction(q, StrategicAiAction.QUEEN_DEAD, null);
        result = { evaluations: c.state.queue.events.filter((e) => e.kind === EventKind.EVALUATE_QUEEN_SITUATION).length };
        break;
      default:
        return report(label, false, 'unknown meanwhile probe');
    }
    if (replay) return report(label, false, replay);
    const theirResult = p.result ?? null;
    const diff = firstDifference({ state: ourState(c), result }, { state: theirState(p), result: theirResult });
    return report(label, diff === null, diff ?? `flags ${c.state.meanwhile.flags}`);
  }

  #post(q: QueenContext, a: Json): void {
    const param = num(a.param);
    switch (String(a.kind)) {
      case 'town':
        handleMeanwhileEventPostingForTownLiberation(q, param);
        return;
      case 'townloss':
        handleMeanwhileEventPostingForTownLoss(q);
        return;
      case 'sam':
        handleMeanwhileEventPostingForSamLiberation(q, param);
        return;
      case 'outskirts':
        handleOutskirtsOfMedunaMeanwhileScene(q);
        return;
      case 'creature':
        handleCreatureRelease(q);
        return;
      case 'flowers':
        handleFlowersMeanwhileScene(q, param);
        return;
      case 'chopper':
        handleKillChopperMeanwhileScene(q);
        return;
      case 'awol':
        handleScientistAwolMeanwhileScene(q);
        return;
      case 'interrogation':
        scheduleInterrogation(q);
        return;
      default:
        throw new Error(`unknown meanwhile kind ${String(a.kind)}`);
    }
  }

  #run(c: CampaignSim, q: QueenContext, enemy: boolean): Json {
    const events = c.state.queue.events;
    const at = events.findIndex((e) => e.kind === EventKind.MEANWHILE);
    const e = events[at];
    if (!e) throw new Error('no meanwhile event');
    events.splice(at, 1);
    const world = q.world;
    const saved = world.enemyInSector;
    Object.assign(world, { enemyInSector: () => enemy });
    let begun = false;
    try {
      handleMeanwhileEvent(q, e);
      const m = c.state.meanwhile;
      if (m.trying) {
        begun = true;
        m.trying = false;
        m.inScene = false;
        processImplicationsOfMeanwhile(q, m.current.id);
        unLockPauseState(c.state.clock);
        unPauseGame(c.state.clock);
      }
    } finally {
      Object.assign(world, { enemyInSector: saved });
    }
    return {
      begun,
      event: [e.stamp, e.param, e.offset],
      groups: c.state.forces.groups.filter((g) => !g.player).map((g) => describeGroup(q, g)),
      reinforcementPool: c.state.queen.reinforcementPool,
    };
  }

  #played(c: CampaignSim, id: number): Json {
    const flow = c.meanwhile;
    c.state.meanwhile.npcSaves.length = 0;
    const before = profiles(c);
    const sector = id === Meanwhile.INTERROGATION ? INTERROGATION_SECTOR : MEDUNA_QUEEN_SECTOR;
    flow.setNpcMeanwhile(Npc.QUEEN, sector);
    flow.setNpcMeanwhile(Npc.ELLIOT, sector);
    if (id === Meanwhile.OUTSKIRTS_MEDUNA || id === Meanwhile.INTERROGATION) flow.setNpcMeanwhile(Npc.JOE, sector);
    const during = profiles(c);
    flow.restoreNpcMeanwhile();
    return { before, during };
  }

  #progress(c: CampaignSim, q: QueenContext, a: Json): void {
    if (a.highest !== undefined) c.state.status.highestProgress = num(a.highest);
    const milestones = progressMilestones(q, num(a.current));
    applyProgressMilestones(
      {
        narrative: c.state.narrative,
        profile: (id) => c.narrative.profile(id),
        scientistAwolMeanwhile: () => handleScientistAwolMeanwhileScene(q),
      },
      milestones,
    );
  }

  #capture(c: CampaignSim, a: Json): Json {
    const battle = c.battle;
    if (!battle) throw new Error('no battle flow');
    if (a.alma !== undefined) c.state.narrative.quests[Quest.HELD_IN_ALMA] = num(a.alma);
    const ids = String(a.who)
      .split(',')
      .map((v) => Number(v));
    const before = c.state.laptop.history.length;
    beginCaptureSequence(battle);
    for (const id of ids) {
      const m = battle.roster.get(id);
      if (!m) throw new Error(`no merc ${id}`);
      enemyCapturesPlayerSoldier(battle, m, c.state.rng);
    }
    endCaptureSequence(battle);
    const captives = ids.map((id) => {
      const m = battle.roster.get(id);
      if (!m) return [id];
      const s = m.soldier;
      return [
        id,
        m.sector.x,
        m.sector.y,
        m.sector.z,
        m.insertionCode,
        s.insertionData,
        s.life,
        s.breath,
        s.breathMax,
        m.assignment,
        s.neutral ? 1 : 0,
        s.bleeding,
        s.level,
      ];
    });
    const history = c.state.laptop.history.slice(before).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]);
    return { captives, history };
  }

  #statue(label: string, p: Json, sim: TacticalSim): number {
    const t = sim.state;
    const a = (p.args as Json | undefined) ?? {};
    const describe = () => {
      const tiles = t.world.tiles ?? [];
      const bases = t.world.structures.at(STATUE_GRIDNO).filter((s) => (s.flags & StructureFlags.BASE_TILE) !== 0);
      const structs = statueTiles(tiles.findIndex((te) => te.type === EIGHTOSTRUCT)).filter((index) => {
        const def = tiles[index]?.structure;
        return def !== undefined && bases.some((s) => s.def === def);
      });
      const exit = exitGridAt(t, STATUE_EXIT_GRIDNO);
      return {
        structs,
        exit: exit ? [exit.gridNo, exit.sector.x, exit.sector.y, exit.sector.z] : null,
        revealed: ((t.fog.revealed[STATUE_EXIT_GRIDNO] ?? 0) & RevealedFlags.GROUND) !== 0,
      };
    };
    const before = describe();
    let skip = false;
    if (String(a.mode) === 'remote') changeO3SectorStatue(t, false);
    else skip = statueTakesExplosion(t, a.gridno === undefined ? STATUE_GRIDNO : num(a.gridno), num(a.dist));
    const statueOnly = (d: Json) => ({ ...d, structs: ((d.structs as number[]) ?? []).filter((i) => NATIVE_STATUE_TILES.includes(i)) });
    const diff = firstDifference(
      { before, after: describe(), skip },
      { before: statueOnly(p.before as Json), after: statueOnly(p.after as Json), skip: p.skip },
    );
    return report(label, diff === null, diff ?? 'statue');
  }
}
