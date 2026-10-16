import { parseSectorString, sectorFromId, sectorId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import {
  type CreatureContext,
  checkConditionsForTriggeringCreatureQuest,
  creatureNightPlanning,
  endCreatureQuest,
  initCreatureQuest,
  mineClearOfMonsters,
  playerGroupIsInACreatureInfestedMine,
  spreadCreatures,
} from '../../src/sim/strategic/creatures/creatures.ts';
import { creatureAttackTown, determineCreatureTownComposition } from '../../src/sim/strategic/creatures/town-attack.ts';
import { adjustLoyaltyForCivsEatenByMonsters } from '../../src/sim/strategic/economy/loyalty.ts';
import { countAllMilitiaInSector } from '../../src/sim/strategic/economy/militia-rules.ts';
import { DrawMismatch, ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import { playerGroupsInSector } from '../../src/sim/strategic/forces/groups.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { findUndergroundSector, sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const CREATURE_PROBES: ReadonlySet<string> = new Set([
  'options',
  'setcontrol',
  'tacticalflags',
  'creatures',
  'creaturequest',
  'creaturetrigger',
  'creaturespread',
  'creatureplanning',
  'creatureattack',
  'endcreaturequest',
  'setcreatures',
  'creaturecomposition',
]);

const CREATURE_EVENTS: ReadonlySet<number> = new Set([
  EventKind.CREATURE_SPREAD,
  EventKind.CREATURE_NIGHT_PLANNING,
  EventKind.CREATURE_ATTACK,
]);
const SURFACE_SECTORS = 256;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

function streams(draws: readonly Draw[]): { readonly main: ReplayStream; readonly pre: ReplayStream } {
  const main: TracedDraw[] = [];
  const pre: TracedDraw[] = [];
  for (const [stream, n, v] of draws) {
    if (stream === 'm' || stream === 'd') main.push({ n, v });
    else if (stream === 'p') pre.push({ n, v });
  }
  return { main: new ReplayStream('main', main), pre: new ReplayStream('pre', pre) };
}

function rolls(s: ReplayStream): RollSource {
  return { int: (n) => s.int(n), chance: (p) => s.int(100) < p };
}

const args = (p: Json): Record<string, string> => (p.args ?? {}) as Record<string, string>;

function sectorArg(p: Json): { x: number; y: number; z: number } {
  const a = args(p);
  return parseSectorString(a.sector ?? a._0 ?? '');
}

export class CreatureComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;
  #enemyInSector = false;
  #gameScreen = false;
  #attack: readonly number[] = [0, 0, 0, 0, 0];

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#campaign = null;
  }

  async arsetup(p: Json): Promise<void> {
    if (!this.#bytes) return;
    const c = await this.#session();
    const counts = (p.counts ?? {}) as Json;
    const info = sectorInfo(c.state.map, parseSectorString(String(p.sector)));
    const militia = ((counts.militia ?? []) as unknown[]).map(Number);
    info.militia.splice(0, militia.length, ...militia);
  }

  async #session(): Promise<CampaignSim> {
    if (this.#campaign) return this.#campaign;
    if (!this.#bytes) throw new Error('creature probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, 1, this.#exists);
    const c = session.campaign;
    const a = c.state.creatures.attack;
    [a.insertionCode, a.insertionGridNo, a.numAttacking, a.battleCode, a.sectorId] = this.#attack.map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    this.#enemyInSector = c.tactical?.state.turn.enemyInSector === true;
    this.#campaign = c;
    return c;
  }

  #context(c: CampaignSim, draws: readonly Draw[]): { ctx: CreatureContext; main: ReplayStream; pre: ReplayStream } {
    const flow = c.creatures;
    if (!flow) throw new Error('the campaign has no creature flow');
    const s = streams(draws);
    return { ctx: { ...flow.context(), random: rolls(s.main), preRandom: rolls(s.pre) }, ...s };
  }

  #dump(c: CampaignSim): Json {
    const s = c.state;
    const cr = s.creatures;
    const a = cr.attack;
    const economy = c.economy;
    const flow = c.creatures;
    const ctx = flow?.context();
    const surface: number[][] = [];
    for (let id = 0; id < SURFACE_SECTORS; id++) {
      const info = s.map.sectors[id];
      if (!info || (!info.numCreatures && !info.creaturesInBattle && !info.dayOfLastCreatureAttack)) continue;
      surface.push([id, info.numCreatures, info.creaturesInBattle, info.dayOfLastCreatureAttack]);
    }
    return {
      lairId: cr.lairId,
      habitatedDistance: cr.habitatedDistance,
      populationModifier: cr.populationModifier,
      destroyedLairId: cr.destroyedLairId,
      meanwhilePlayed: cr.meanwhileScenePlayed,
      underground: s.map.underground.map((u) => [
        sectorId(u.sector),
        u.sector.z,
        u.numCreatures,
        u.creatureHabitat,
        u.flags,
        u.creaturesInBattle,
      ]),
      surface,
      events: s.queue.events.filter((e) => CREATURE_EVENTS.has(e.kind)).map((e) => [e.kind, e.stamp, e.param]),
      attack: [a.insertionCode, a.insertionGridNo, a.numAttacking, a.battleCode, a.sectorId],
      mineClear: economy && ctx ? economy.economy.mines.map((m) => (mineClearOfMonsters(ctx, m.mineId) ? 1 : 0)) : [],
      infested: ctx && c.battle ? playerGroupIsInACreatureInfestedMine(ctx, c.battle.roster.all()) : false,
      meanwhileFlags: s.meanwhile.flags,
      worldMinutes: worldTotalMinutes(s.clock),
    };
  }

  #theirs(p: Json): Json {
    const t = (p.creatures ?? {}) as Json;
    return {
      lairId: t.lairId,
      habitatedDistance: t.habitatedDistance,
      populationModifier: t.populationModifier,
      destroyedLairId: t.destroyedLairId,
      meanwhilePlayed: t.meanwhilePlayed,
      underground: t.underground,
      surface: t.surface,
      events: ((t.events ?? []) as Json[]).map((e) => [e.kind, e.stamp, e.param]),
      attack: t.attack,
      mineClear: t.mineClear,
      infested: t.infested,
      meanwhileFlags: t.meanwhileFlags,
      worldMinutes: t.worldMinutes,
    };
  }

  #compareDump(label: string, c: CampaignSim, p: Json, left: readonly ReplayStream[]): number {
    const ours = this.#dump(c);
    const theirs = this.#theirs(p);
    const differing = Object.keys(theirs).filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]));
    const leftover = left.map((s) => s.remaining);
    const same = differing.length === 0 && leftover.every((n) => n === 0);
    const t = (p.creatures ?? {}) as Json;
    this.#attack = (t.attack as number[] | undefined) ?? this.#attack;
    this.#gameScreen = t.gameScreen === true;
    const detail = `lair ${String(ours.lairId)} distance ${String(ours.habitatedDistance)} attack ${JSON.stringify(ours.attack)}`;
    if (same) return report(label, true, detail);
    const diffs = differing.map((k) => `${k}: ours ${JSON.stringify(ours[k])} oracle ${JSON.stringify(theirs[k])}`);
    return report(label, false, `${detail}; draws left ${leftover.join('/')}\n  ${diffs.join('\n  ')}`);
  }

  #townAttack(c: CampaignSim, ctx: CreatureContext): Parameters<typeof creatureAttackTown>[0] {
    const economy = c.economy;
    if (!economy) throw new Error('creature attacks need the economy');
    return {
      ...ctx,
      ports: {
        enemyInLoadedSector: () => this.#enemyInSector,
        playerGroupsInSector: (s) => playerGroupsInSector(economy, s) > 0,
        loadedSector: () => c.state.worldSector,
        inTacticalScreen: () => this.#gameScreen,
        militiaInSector: (s) => countAllMilitiaInSector(economy, s),
        creaturesEatCivilians: (s, n) => adjustLoyaltyForCivsEatenByMonsters(economy, s, n),
        beginCreatureBattle: () => {},
      },
    };
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line)}`;
    try {
      const c = await this.#session();
      const s = c.state;
      const draws = (p.draws ?? []) as Draw[];
      switch (p.probe) {
        case 'options':
          s.options.sciFi = p.sciFi === true;
          s.options.difficulty = Number(p.difficulty);
          return report(label, true, `sci-fi ${String(p.sciFi)} difficulty ${String(p.difficulty)}`);
        case 'setcontrol': {
          const element = s.map.elements[strategicIndex(sectorFromId(Number(p.sector), 0))];
          if (element) element.enemyControlled = p.enemy === true;
          return report(label, true, `sector ${String(p.sector)} enemy ${String(p.enemy)}`);
        }
        case 'tacticalflags':
          this.#enemyInSector = p.enemyInSector === true;
          return report(label, true, `enemy in sector ${String(p.enemyInSector)}`);
        case 'setcreatures': {
          const a = args(p);
          const target = { ...sectorArg(p), z: Number(a.z ?? 0) };
          const count = Number(a.count);
          if (target.z === 0) sectorInfo(s.map, target).numCreatures = count;
          else {
            const u = findUndergroundSector(s.map, target);
            if (u) u.numCreatures = count;
          }
          return this.#compareDump(label, c, p, []);
        }
        case 'creaturecomposition': {
          const { main } = streams(draws);
          const d = determineCreatureTownComposition(rolls(main), Number(p.count));
          const ours = [d.youngMales, d.youngFemales, d.adultMales, d.adultFemales];
          const same = JSON.stringify(ours) === JSON.stringify(p.composition) && main.remaining === 0;
          return report(label, same, `${String(p.count)} creatures: ${JSON.stringify(ours)} vs ${JSON.stringify(p.composition)}`);
        }
        default:
          return this.#run(label, c, p, draws);
      }
    } catch (e) {
      const why = e instanceof DrawMismatch ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
      return report(label, false, why);
    }
  }

  #run(label: string, c: CampaignSim, p: Json, draws: readonly Draw[]): number {
    const { ctx, main, pre } = this.#context(c, draws);
    switch (p.probe) {
      case 'creaturequest':
        initCreatureQuest(ctx);
        break;
      case 'creaturetrigger':
        checkConditionsForTriggeringCreatureQuest(ctx);
        break;
      case 'creaturespread': {
        const count = Number(args(p).count ?? 1);
        for (let i = 0; i < count; i++) spreadCreatures(ctx);
        break;
      }
      case 'creatureplanning':
        creatureNightPlanning(ctx);
        break;
      case 'creatureattack':
        creatureAttackTown(this.#townAttack(c, ctx), sectorId(sectorArg(p)), Number(args(p).specific ?? 0) !== 0);
        break;
      case 'endcreaturequest':
        endCreatureQuest(ctx);
        break;
    }
    return this.#compareDump(label, c, p, [main, pre]);
  }
}
