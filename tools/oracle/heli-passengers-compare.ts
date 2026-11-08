import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import { Direction } from '../../src/content/world/grid.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import type { EconomyContext } from '../../src/sim/strategic/economy/ports.ts';
import { addSoldierToVehicle, Boarding, isVehicleAccessibleToSoldier } from '../../src/sim/strategic/economy/vehicle-assignment.ts';
import { VehicleSeat } from '../../src/sim/strategic/forces/constants.ts';
import { helicopterVehicle, setUpHelicopterForPlayer } from '../../src/sim/strategic/forces/helicopter.ts';
import { isEnoughSpaceInVehicle } from '../../src/sim/strategic/forces/vehicles.ts';
import { endHeight, height } from '../../src/sim/tactical/animation.ts';
import { soldierTakeDamage } from '../../src/sim/tactical/combat/hit.ts';
import { DamageReason } from '../../src/sim/tactical/combat/types.ts';
import { newSoldierCreate, randomizeNewSoldierStats, tacticalCreateSoldier } from '../../src/sim/tactical/creation.ts';
import { drawStandingFrame, NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { sayQuoteFromAnyBodyInSector } from '../../src/sim/tactical/narrative/merc-quotes.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import {
  Body,
  firstFreeSoldierId,
  inSector,
  NOWHERE,
  Personality,
  type Soldier,
  SoldierStatusFlags,
  Team,
  withOriginalNowhere,
} from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import {
  beginTeamTurn,
  checkForEndOfBattle,
  checkForLosingEndOfBattle,
  handleForcedRealtimeTurn,
  isTeamActive,
  setEnemyPresence,
} from '../../src/sim/tactical/turns/turns.ts';
import { withoutDroppedDraws } from './absent-compare.ts';
import { type Draw, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { differences, inOrder } from './auto-bandage-compare.ts';
import { heliFacts } from './heli-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const HELI_PASSENGER_PROBES: ReadonlySet<string> = new Set([
  'hpset',
  'hpsetup',
  'hpboard',
  'hpenemy',
  'hpturn',
  'hpdamage',
  'hpend',
  'hpquote',
  'hpsave',
  'hpstate',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const TEAMS = 6;
const SEATED_FLAGS: Readonly<Record<number, number>> = {
  [VehicleSeat.DRIVER]: SoldierStatusFlags.DRIVER,
  [VehicleSeat.PASSENGER]: SoldierStatusFlags.PASSENGER,
};
const PERSONALITIES: Readonly<Record<string, number>> = {
  none: Personality.NONE,
  claustrophobic: Personality.CLAUSTROPHOBIC,
  nervous: Personality.NERVOUS,
};
const DAMAGE_REASONS: Readonly<Record<string, number>> = {
  bloodloss: DamageReason.BLOODLOSS,
  gas: DamageReason.GAS,
  gunfire: DamageReason.GUNFIRE,
};
const TEAM_NAMES: Readonly<Record<string, number>> = { player: Team.OUR, enemy: Team.ENEMY, militia: Team.MILITIA, civ: Team.CIV };
const OFF_THE_MAP = 'a soldier with no tile: ja2-node keeps no position for him';
const OTHERS_AFTER_FRAMES =
  'the other soldiers once frames ran: their AI and animations take the drawn values in order, not replayed, as in the drop blocks';
const SAVE_HEADER_DRAW = 0x7fffffff;

const num = (v: unknown) => Number(v ?? 0);
const bit = (b: boolean) => (b ? 1 : 0);
const has = (a: Json, key: string) => a[key] !== undefined;
const args = (p: Json): Json => (p.args as Json | undefined) ?? {};

function queuedLines(c: CampaignSim, act: () => unknown): { readonly lines: number[][]; readonly result: unknown } {
  const queue = c.talk?.talk.queue;
  const lines: number[][] = [];
  if (!queue) return { lines, result: act() };
  const push = queue.push;
  queue.push = (...events: DialogueEvent[]) => {
    for (const e of events) if (e.kind === 'quote') lines.push([e.speaker, e.quote]);
    return push.apply(queue, events);
  };
  try {
    return { lines, result: act() };
  } finally {
    queue.push = push;
  }
}

function statusFlags(s: Soldier): number {
  let flags = SEATED_FLAGS[s.vehicleSeat] ?? 0;
  if (s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP) flags |= SoldierStatusFlags.VEHICLE;
  if (s.dead) flags |= SoldierStatusFlags.DEAD;
  if (s.away) flags |= SoldierStatusFlags.OFF_MAP;
  if (s.gassed) flags |= SoldierStatusFlags.GASSED;
  if (s.pauseAnimMove) flags |= SoldierStatusFlags.PAUSEANIMOVE;
  return flags;
}

export class HeliPassengerComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #save: (name: string) => Uint8Array;
  #session: CampaignSession | null = null;
  #mapScreen = false;
  #frames: Json[] = [];
  #framesRan = false;

  constructor(read: ReadFile, exists: FileExists, save: (name: string) => Uint8Array) {
    this.#read = read;
    this.#exists = exists;
    this.#save = save;
  }

  async loadSave(p: Json): Promise<number> {
    const label = `save ${String(p.name)}`;
    try {
      this.#session = (await createTacticalSaveSession(this.#read, this.#save(String(p.name)), SEED, this.#exists)).session;
      this.#mapScreen = this.#session.campaign.state.flow === 'strategic';
      this.#frames = [];
      this.#framesRan = false;
      return report(label, true, 'imported');
    } catch (e) {
      this.#session = null;
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  frame(p: Json): void {
    this.#frames.push(p);
  }

  compare(p: Json): number {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      if (p.probe === 'hdframes') return this.#runFrames(label, p);
      const c = this.#campaign();
      const a = args(p);
      const problems: string[] = [];
      const { lines, result } = queuedLines(c, () => this.#replay(c, p, problems, () => this.#run(c, p, a)));
      const ours = { result, lines, state: this.#state(c) };
      const theirs = { result: p.result ?? null, lines: p.lines, state: this.#nativeState(p.state as Json) };
      differences(ours, theirs, '', problems);
      return report(label, problems.length === 0, problems.join('; ') || this.#notCompared(p));
    } catch (e) {
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #notCompared(p: Json): string {
    const labels = ['bMenInSector', 'the music mode', 'the position of a soldier with no tile'];
    if (this.#framesRan) labels.push('the other soldiers after frames');
    if (p.probe === 'hpsave') labels.push('the save header draw');
    return `not compared: ${labels.join(', ')}`;
  }

  #campaign(): CampaignSim {
    const session = this.#session;
    if (!session) throw new Error('the passenger probes need a save');
    return session.campaign;
  }

  #tactical(c: CampaignSim): TacticalState {
    const t = c.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #economy(c: CampaignSim): EconomyContext {
    const economy = c.economy;
    if (!economy) throw new Error('no economy');
    return economy;
  }

  #merc(c: CampaignSim, who: unknown): RosterMerc {
    const m = c.battle?.roster.get(num(who));
    if (!m) throw new Error(`no merc ${String(who)}`);
    return m;
  }

  #replay(c: CampaignSim, p: Json, problems: string[], action: () => unknown): unknown {
    const draws = withoutDroppedDraws((p.draws as Draw[] | undefined) ?? []).filter(
      (d) => p.probe !== 'hpsave' || d[1] !== SAVE_HEADER_DRAW,
    );
    const main = new StrictReplay(
      draws.filter((d) => d[0] === MAIN_STREAM),
      'Random',
    );
    const pre = new StrictReplay(
      draws.filter((d) => d[0] === PRE_STREAM),
      'PreRandom',
    );
    const rng = c.state.rng as unknown as Record<string, unknown>;
    const preRng = c.state.pre as unknown as Record<string, unknown>;
    Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
    Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
    try {
      const result = action();
      if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
      return result;
    } catch (e) {
      if (!(e instanceof ReplayMismatch)) throw e;
      problems.push(e.message);
      return null;
    } finally {
      delete rng.int;
      delete rng.chance;
      delete preRng.int;
      delete preRng.chance;
    }
  }

  #run(c: CampaignSim, p: Json, a: Json): unknown {
    switch (p.probe) {
      case 'hpstate':
        return null;
      case 'hpset':
        this.#set(c, a);
        return null;
      case 'hpsetup':
        setUpHelicopterForPlayer(this.#economy(c), parseSectorString(String(a.sector ?? 'B13')));
        return null;
      case 'hpboard':
        return this.#board(c, a);
      case 'hpenemy':
        return this.#enemy(c, a);
      case 'hpturn': {
        const t = this.#tactical(c);
        this.#withTheCombatExitTurnInPlace(t, () => beginTeamTurn(t, TEAM_NAMES[String(a.team ?? 'player')] ?? Team.OUR));
        return null;
      }
      case 'hpdamage': {
        const s = this.#merc(c, a.who).soldier;
        const damage = num(a.damage);
        const breath = has(a, 'breath') ? num(a.breath) : damage;
        const reason = DAMAGE_REASONS[String(a.reason ?? 'bloodloss')] ?? DamageReason.BLOODLOSS;
        return { combined: soldierTakeDamage(this.#tactical(c), s, damage, breath, reason, null) };
      }
      case 'hpend': {
        const t = this.#tactical(c);
        if (a.mode === 'losing') return { lost: checkForLosingEndOfBattle(t) };
        return { ended: checkForEndOfBattle(t) };
      }
      case 'hpquote':
        sayQuoteFromAnyBodyInSector(this.#tactical(c), num(a.quote));
        return null;
      case 'hpsave':
        return { name: String(a._0 ?? a.name), saved: true };
      default:
        throw new Error(`no comparer for ${String(p.probe)}`);
    }
  }

  #withTheCombatExitTurnInPlace(t: TacticalState, action: () => void): void {
    const turn = t.turn;
    let forced = turn.forceRealtimeTurn;
    Object.defineProperty(turn, 'forceRealtimeTurn', {
      configurable: true,
      enumerable: true,
      get: () => forced,
      set: (value: boolean) => {
        forced = value;
        if (value && !t.inCombat) handleForcedRealtimeTurn(t, t.realtimeClock, t.clockMs);
      },
    });
    try {
      action();
    } finally {
      Reflect.deleteProperty(turn, 'forceRealtimeTurn');
      turn.forceRealtimeTurn = forced;
    }
  }

  #set(c: CampaignSim, a: Json): void {
    if (has(a, 'screen')) {
      this.#mapScreen = a.screen === 'map';
      c.state.flow = this.#mapScreen ? 'strategic' : 'tactical';
    }
    const t = this.#tactical(c);
    if (has(a, 'combat')) t.inCombat = num(a.combat) !== 0;
    if (has(a, 'enemyInSector')) t.turn.enemyInSector = num(a.enemyInSector) !== 0;
    if (!has(a, 'who')) return;
    const m = this.#merc(c, a.who);
    const s = m.soldier;
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'bleeding')) s.bleeding = num(a.bleeding);
    if (has(a, 'breath')) s.breath = num(a.breath);
    if (has(a, 'morale')) s.morale = num(a.morale);
    if (has(a, 'collapsed')) s.collapsed = num(a.collapsed) !== 0;
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    if (has(a, 'asleep')) m.asleep = num(a.asleep) !== 0;
    if (has(a, 'gassed')) s.gassed = num(a.gassed) !== 0;
    if (has(a, 'personality')) s.personalityTrait = PERSONALITIES[String(a.personality)] ?? Personality.NONE;
  }

  #board(c: CampaignSim, a: Json): Json {
    const ctx = this.#economy(c);
    const m = ctx.crew.get(num(a.who));
    const v = helicopterVehicle(ctx);
    if (!m || !v) throw new Error(`cannot board ${String(a.who)}`);
    const accessible = isVehicleAccessibleToSoldier(ctx, m, v);
    const boarded = accessible && isEnoughSpaceInVehicle(ctx, v) && addSoldierToVehicle(ctx, m, v) === Boarding.BOARDED;
    return { accessible, boarded };
  }

  #enemy(c: CampaignSim, a: Json): Json {
    const t = this.#tactical(c);
    const gridNo = num(a.grid);
    const direction = has(a, 'dir') ? num(a.dir) : Direction.SOUTH;
    const create = newSoldierCreate(Team.ENEMY, Body.REGMALE, direction, gridNo);
    randomizeNewSoldierStats(t, create);
    const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), Team.ENEMY, Body.REGMALE);
    const s = tacticalCreateSoldier(t, create, id, c.sectors?.populationEnv() ?? NEUTRAL_POPULATION);
    if (!s) throw new Error('no soldier created');
    drawStandingFrame(t);
    if (!addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: gridNo, direction }, {}, false)) {
      setSoldierPosition(t, s, gridNo);
      setEnemyPresence(t);
    }
    return { who: s.id };
  }

  #runFrames(label: string, p: Json): number {
    const native = this.#frames.splice(0);
    const c = this.#campaign();
    const byFrame = new Map(native.map((f) => [num(f.frame), f]));
    const count = num(p.frames);
    const problems: string[] = [];
    this.#framesRan = true;
    for (let frame = 1; frame <= count && problems.length === 0; frame++) {
      const f = byFrame.get(frame);
      const { lines } = queuedLines(c, () => inOrder(c.state, (f?.draws as Draw[] | undefined) ?? [], () => c.step()));
      differences(lines, f?.lines ?? [], `frame ${frame} lines`, problems);
    }
    const team = (c.battle?.roster.all() ?? []).map((m) => this.#frameMerc(m));
    const nativeTeam = ((p.state as Json).team as Json[]).map((m) => this.#nativeFrameMerc(m));
    differences(
      { team, deaths: c.state.status.mercDeaths },
      { team: nativeTeam, deaths: ((p.state as Json).tactical as Json | undefined)?.deaths ?? c.state.status.mercDeaths },
      'state',
      problems,
    );
    return report(label, problems.length === 0, problems.join('; ') || `${count} frames`);
  }

  #frameMerc(m: RosterMerc): Json {
    const s = m.soldier;
    return {
      id: m.id,
      assignment: m.assignment,
      inSector: inSector(s),
      gridNo: withOriginalNowhere(s.gridNo),
      life: [s.life, s.lifeMax, s.bleeding],
      flags: statusFlags(s),
    };
  }

  #nativeFrameMerc(m: Json): Json {
    return {
      id: m.id,
      assignment: m.assignment,
      inSector: m.inSector,
      gridNo: m.gridNo,
      life: m.life,
      flags: m.flags,
    };
  }

  #state(c: CampaignSim): Json {
    const t = this.#tactical(c);
    const forces = c.state.forces;
    return {
      screen: this.#mapScreen ? 'map' : 'game',
      inCombat: t.inCombat,
      currentTeam: t.turn.currentTeam,
      enemyInSector: t.turn.enemyInSector,
      teamActive: Array.from({ length: TEAMS }, (_, team) => bit(isTeamActive(t, team))),
      lastBattleWon: c.state.battle.lastBattleWon,
      deaths: c.state.status.mercDeaths,
      heli: heliFacts(this.#economy(c)),
      mercSlots: t.mercSlots.map((s) => s.id),
      awaySlots: t.awaySlots.map((s) => s.id),
      selected: t.turn.selected,
      currentSquad: forces.currentSquad,
      squads: forces.squads.map((q) => [...q]),
      team: [...(c.battle?.roster.all() ?? [])].sort((x, y) => x.id - y.id).map((m) => this.#mercRow(t, m)),
      others: this.#framesRan
        ? OTHERS_AFTER_FRAMES
        : t.soldiers
            .filter((s): s is Soldier => s !== undefined && s !== null && s.team !== Team.OUR && inSector(s))
            .map((s) => [s.id, s.team, s.life, s.breath, s.bleeding, bit(s.dead), s.state]),
    };
  }

  #nativeState(s: Json): Json {
    const { menInSector: _men, music: _music, team, others, ...rest } = s;
    return {
      ...rest,
      team: ((team as Json[] | undefined) ?? []).map((m) => this.#nativeMercRow(m)),
      others: this.#framesRan ? OTHERS_AFTER_FRAMES : others,
    };
  }

  #mercRow(t: TacticalState, m: RosterMerc): Json {
    const s = m.soldier;
    const content = t.content;
    const here = inSector(s);
    return {
      id: m.id,
      profile: m.profile,
      inSector: here,
      mercSlot: t.mercSlots.includes(s),
      awaySlot: t.awaySlots.includes(s),
      gridNo: withOriginalNowhere(s.gridNo),
      level: s.level,
      position: s.gridNo === NOWHERE ? OFF_THE_MAP : [Math.fround(s.x), Math.fround(s.y)],
      sector: [m.sector.x, m.sector.y, m.sector.z],
      assignment: m.assignment,
      vehicleId: m.vehicleId,
      group: m.groupId,
      flags: statusFlags(s),
      life: [s.life, s.lifeMax, s.bleeding],
      breath: [s.breath, s.breathMax, s.breathRed],
      ap: [s.actionPoints, s.initialActionPoints, calcActionPoints(t, s)],
      shock: s.shock,
      collapsed: s.collapsed,
      anim: [s.state, height(content, s.state), endHeight(content, s.state)],
      morale: s.morale,
      underFire: s.ai.underFire,
      tilesMoved: s.tilesMoved,
      weightAtTurnStart: s.weightCarriedAtTurnStart,
      noise: [withOriginalNowhere(s.ai.noiseGridNo), s.ai.noiseVolume],
      quoteFlags: [m.quoteSaidFlags, m.quoteSaidExtFlags],
      oppCnt: s.ai.oppCount,
      personality: s.personalityTrait,
      asleep: m.asleep,
      insertionCode: m.insertionCode,
    };
  }

  #nativeMercRow(m: Json): Json {
    const anim = (m.anim as number[] | undefined) ?? [];
    const { x, y, anim: _anim, ...rest } = m;
    return {
      ...rest,
      position: m.gridNo === withOriginalNowhere(NOWHERE) ? OFF_THE_MAP : [Math.fround(num(x)), Math.fround(num(y))],
      anim: [anim[0], anim[3], anim[4]],
    };
  }
}
