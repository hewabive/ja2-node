import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveGame, type SaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import { readStrategicAiSections } from '../../src/content/formats/savegame-strategic-ai.ts';
import { type ArmyContent, loadArmyContent } from '../../src/content/strategic/army.ts';
import { sectorFromId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import { loadStrategicContent, type StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { gameOptions, importNativeGameOptions } from '../../src/sim/options.ts';
import type { MineIncomePort, QueenContext } from '../../src/sim/strategic/ai/context.ts';
import { checkEnemyControlledSector } from '../../src/sim/strategic/ai/detection.ts';
import { calcDifficultyModifier, currentPlayerProgressPercentage, pythDistanceFromPalace } from '../../src/sim/strategic/ai/difficulty.ts';
import { evaluateQueenSituation } from '../../src/sim/strategic/ai/evaluate.ts';
import { wakeUpQueen } from '../../src/sim/strategic/ai/reactions.ts';
import { importStrategicAi, runStrategicAiLoadHooks } from '../../src/sim/strategic/ai/save-import.ts';
import { initStrategicAiForNewCampaign, StrategicAi } from '../../src/sim/strategic/ai/strategic-ai.ts';
import { createStrategicContext, emptyMercPort } from '../../src/sim/strategic/forces/context.ts';
import { type Group, getGroup, groupAtFinalDestination } from '../../src/sim/strategic/forces/groups.ts';
import { groupArrivedAtSector } from '../../src/sim/strategic/forces/movement.ts';
import { defaultTacticalWorldPort, type MercPort, type RollSource, type StrategicMerc } from '../../src/sim/strategic/forces/ports.ts';
import { townIdOfSector } from '../../src/sim/strategic/map/control.ts';
import { initializeMapStructure, initNewCampaignMap, setupNewStrategicMap } from '../../src/sim/strategic/map/init.ts';
import { importStrategicMap } from '../../src/sim/strategic/map/save-import.ts';
import { calculateTravelTimeOfGroup } from '../../src/sim/strategic/map/travel.ts';
import { importNarrative } from '../../src/sim/strategic/narrative/facts.ts';
import { createStrategicState, type StrategicState } from '../../src/sim/strategic/state.ts';
import { EventKind, Warp } from '../../src/sim/strategic/time/constants.ts';
import { deleteStrategicEvent } from '../../src/sim/strategic/time/event-queue.ts';
import { importStrategicTime } from '../../src/sim/strategic/time/save-import.ts';
import { warpGameTime } from '../../src/sim/strategic/time/world-clock.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

const PLAYER_TEAM = 0;
const STATUS_VEHICLE = 0x00008000;
const STATUS_ROBOT = 0x00001000;
const STATUS_PASSENGER_OR_DRIVER = 0x18000000;
const SECTORS = 256;
const MAX_REPORTED = 8;
const MAIN_STREAM = 'm';
const MARK_STREAM = 'k';
const MARK_LOAD_HOOKS_BEGIN = 101;
const MARK_LOAD_HOOKS_END = 102;
const SAI_EVENT_KINDS: ReadonlySet<number> = new Set([
  EventKind.EVALUATE_QUEEN_SITUATION,
  EventKind.CHECK_ENEMY_CONTROLLED_SECTOR,
  EventKind.GROUP_ARRIVAL,
  EventKind.MEANWHILE,
]);

export const SAI_PROBES: ReadonlySet<string> = new Set([
  'newgame',
  'sai',
  'saievaluate',
  'saicheck',
  'saiwake',
  'saiarrive',
  'diffmod',
  'draws',
]);

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

class ReplayMismatch extends Error {}

class ReplayRolls implements RollSource {
  readonly #draws: readonly Draw[];
  #at = 0;

  constructor(draws: readonly Draw[]) {
    this.#draws = draws.filter((d) => d[0] === MAIN_STREAM);
  }

  get used(): number {
    return this.#at;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n) throw new ReplayMismatch(`draw #${this.#at}: ja2-node wants range ${n}, native drew range ${d[1]} (value ${d[2]})`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

class Rolls implements RollSource {
  target: RollSource = new ReplayRolls([]);

  int(n: number): number {
    return this.target.int(n);
  }

  chance(percent: number): boolean {
    return this.target.chance(percent);
  }
}

function savedMercPort(save: SaveGame): MercPort {
  const mercs = new Map<number, StrategicMerc>();
  for (const e of save.soldiers) {
    const s = e.soldier;
    if (s.team !== PLAYER_TEAM) continue;
    mercs.set(s.id, {
      id: s.id,
      profile: s.profile,
      life: s.stats.life,
      lifeMax: s.stats.lifeMax,
      strength: s.stats.strength,
      isVehicle: (s.statusFlags & STATUS_VEHICLE) !== 0,
      isRobot: (s.statusFlags & STATUS_ROBOT) !== 0,
      isEpc: false,
      isPassengerOrDriver: (s.statusFlags & STATUS_PASSENGER_OR_DRIVER) !== 0,
      asleep: false,
      sector: { ...s.sector },
      betweenSectors: s.betweenSectors,
      groupId: s.groupId,
      prevSectorId: 0,
      insertionCode: s.strategicInsertionCode,
      insertionDirection: 0,
      path: [...e.mercPath],
      assignment: s.assignment,
      vehicleId: s.vehicleId,
    });
  }
  return {
    ...emptyMercPort,
    get: (id) => mercs.get(id),
    all: () => [...mercs.values()],
    byProfile: (p) => [...mercs.values()].find((m) => m.profile === p),
  };
}

interface Session {
  readonly q: QueenContext;
  readonly rolls: Rolls;
  readonly mines: { income: number; max: number };
  loadHooksPending: boolean;
  loadDraws: readonly Draw[] | null;
}

export function describeGroup(q: QueenContext, g: Group): Json {
  const e = g.enemy;
  return {
    id: g.id,
    player: g.player,
    vehicle: g.vehicle,
    persistent: g.persistent,
    debug: g.debug,
    size: g.size,
    sector: [g.sector.x, g.sector.y, g.sector.z],
    next: [g.next.x, g.next.y, g.next.z],
    prev: [g.prev.x, g.prev.y, g.prev.z],
    originalSector: g.originalSector,
    betweenSectors: g.betweenSectors,
    moveType: g.moveType,
    nextWaypointId: g.nextWaypointId,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    transportMask: g.transportMask,
    flags: g.flags,
    createdSectorId: g.createdSectorId,
    sectorIdOfLastReassignment: g.sectorIdOfLastReassignment,
    atFinalDestination: groupAtFinalDestination(g),
    eta: calculateTravelTimeOfGroup(q, g),
    waypoints: g.waypoints.map((w) => [w.x, w.y, w.z]),
    enemy: e
      ? [e.numTroops, e.numElites, e.numAdmins, e.pendingReinforcements, e.adminsInBattle, e.intention, e.troopsInBattle, e.elitesInBattle]
      : null,
  };
}

function ourDump(q: QueenContext, mines: MineIncomePort): Json {
  const s = q.state;
  const queen = s.queen;
  return {
    worldSeconds: s.clock.seconds,
    difficulty: s.options.difficulty,
    globals: {
      extraElites: queen.extraElites,
      forcePercentage: queen.forcePercentage,
      alertness: queen.alertness,
      alertnessDecay: queen.alertnessDecay,
      awareBattles: queen.awareBattles,
      awake: queen.awake,
      reinforcementPool: queen.reinforcementPool,
      reinforcementPoints: queen.reinforcementPoints,
      requestPoints: queen.requestPoints,
      saiVersion: queen.saiVersion,
      priorityPhase: queen.priorityPhase,
      firstBattleMeanwhilePending: queen.firstBattleMeanwhilePending,
      massFortificationOrdered: queen.massFortificationOrdered,
      minGroupSize: queen.minGroupSize,
      graceHours: queen.graceHours,
      playerBattleVictories: queen.playerBattleVictories,
      useAlternateQueenPosition: queen.useAlternateQueenPosition,
    },
    compositions: queen.compositions.map((c) => [c.id, c.priority, c.elitePct, c.troopPct, c.adminPct, c.desired, c.start]),
    garrisons: queen.garrisons.map((g) => [g.sector, g.composition, g.weight, g.pendingGroup]),
    denied: queen.garrisonDenied,
    patrols: queen.patrols.map((p) => [p.size, p.priority, ...p.points, p.fillDayMod100, p.group, p.weight, p.pendingGroup]),
    sectors: s.map.sectors.map((i) => [
      i.garrisonId,
      i.flags,
      i.numAdmins,
      i.numTroops,
      i.numElites,
      i.numCreatures,
      i.adminsInBattle,
      i.troopsInBattle,
      i.elitesInBattle,
      i.creaturesInBattle,
      i.timeLastPlayerLiberated,
      i.militia[0] ?? 0,
      i.militia[1] ?? 0,
      i.militia[2] ?? 0,
      i.bloodCats,
      i.bloodCatPlacements,
    ]),
    enemyControlled: Array.from({ length: SECTORS }, (_, id) =>
      s.map.elements[strategicIndex(sectorFromId(id))]?.enemyControlled ? 1 : 0,
    ),
    underground: s.map.underground.map((u) => [
      u.sector.x,
      u.sector.y,
      u.sector.z,
      u.numAdmins,
      u.numTroops,
      u.numElites,
      u.numCreatures,
      u.adminsInBattle,
      u.troopsInBattle,
      u.elitesInBattle,
      u.creaturesInBattle,
    ]),
    groups: s.forces.groups.filter((g) => !g.player).map((g) => describeGroup(q, g)),
    events: s.queue.events.filter((e) => SAI_EVENT_KINDS.has(e.kind)).map((e) => [e.stamp, e.kind, e.param, e.offset, e.frequency]),
    status: { flags: s.status.flags, highestProgress: s.status.highestProgress, playerKills: s.status.playerKills },
    meanwhileFlags: s.meanwhile.flags,
    progress: currentPlayerProgressPercentage(q, q.army.progress, mines),
  };
}

function diffList(label: string, ours: readonly unknown[], theirs: readonly unknown[], out: string[]): void {
  if (ours.length !== theirs.length) out.push(`${label} count ${ours.length}/${theirs.length}`);
  for (let k = 0; k < Math.max(ours.length, theirs.length); k++) {
    if (!sameJson(ours[k], theirs[k])) out.push(`${label}[${k}] ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
  }
}

function diffObject(label: string, ours: Json, theirs: Json, out: string[]): void {
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    if (!sameJson(ours[k], theirs[k])) out.push(`${label}.${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
  }
}

function arriveInOrder(q: QueenContext, ids: readonly number[]): void {
  for (const id of ids) {
    const g = getGroup(q, id);
    if (!g) throw new ReplayMismatch(`group ${id} does not exist in ja2-node`);
    const arrival = g.arrivalTime * 60;
    if (arrival > q.state.clock.seconds) warpGameTime(q.clock, arrival - q.state.clock.seconds, Warp.NO_PROCESSING);
    deleteStrategicEvent(q.state.queue, EventKind.GROUP_ARRIVAL, id);
    groupArrivedAtSector(q, g, true, false);
  }
}

export class SaiComparer {
  readonly #read: ReadFile;
  #content: StrategicContent | null = null;
  #army: ArmyContent | null = null;
  #session: Session | null = null;

  constructor(read: ReadFile) {
    this.#read = read;
  }

  async #contents(): Promise<{ content: StrategicContent; army: ArmyContent }> {
    this.#content ??= await loadStrategicContent(this.#read);
    this.#army ??= await loadArmyContent(this.#read);
    return { content: this.#content, army: this.#army };
  }

  async #newSession(state: StrategicState, mercs: MercPort, facts: readonly number[], enemyInSector: boolean): Promise<Session> {
    const { content, army } = await this.#contents();
    const rolls = new Rolls();
    const mines = { income: 0, max: 0 };
    const port: MineIncomePort = { predictIncomeFromPlayerMines: () => mines.income, maxPlayerIncomeFromMines: () => mines.max };
    const ai = new StrategicAi({ army, mines: port });
    const ctx = createStrategicContext({
      state,
      content,
      ai,
      mercs,
      random: rolls,
      preRandom: rolls,
      world: { ...defaultTacticalWorldPort, enemyInSector: () => enemyInSector },
    });
    importNarrative(state.narrative, facts, []);
    return { q: ai.bind(ctx), rolls, mines, loadHooksPending: false, loadDraws: null };
  }

  async loadSave(savesDir: string, name: string): Promise<void> {
    const table = await this.#read(SAVE_ENCRYPTION_PATH);
    if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
    const bytes = new Uint8Array(readFileSync(join(savesDir, `${name}.sav`)));
    const save = parseSaveGame(bytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
    const state = createStrategicState({ options: importNativeGameOptions(save.generalInfo.gameOptions).options });
    importStrategicTime(state, save);
    const session = await this.#newSession(state, savedMercPort(save), save.facts, save.tactical.enemyInSector);
    importStrategicMap(session.q, save);
    importStrategicAi(session.q, readStrategicAiSections(bytes, save), { runLoadHooks: false });
    session.loadHooksPending = true;
    this.#session = session;
  }

  #replay(session: Session, label: string, draws: readonly Draw[], run: () => void): number {
    const replay = new ReplayRolls(draws);
    session.rolls.target = replay;
    try {
      run();
    } catch (e) {
      if (!(e instanceof ReplayMismatch)) throw e;
      return report(label, false, e.message);
    } finally {
      session.rolls.target = new ReplayRolls([]);
    }
    const others = draws.filter((d) => d[0] !== MAIN_STREAM && d[0] !== MARK_STREAM).length;
    return report(
      label,
      replay.left === 0 && others === 0,
      `${replay.used} draws replayed${replay.left ? `, ${replay.left} native draws left over` : ''}${others ? `, ${others} PreRandom draws` : ''}`,
    );
  }

  async #newGame(p: Json): Promise<number> {
    const difficulty = Number(p.difficulty);
    const state = createStrategicState({
      worldSeconds: Number(p.worldSeconds),
      options: gameOptions({ difficulty, sciFi: p.sciFi === true }),
    });
    const session = await this.#newSession(state, emptyMercPort, [], false);
    this.#session = session;
    const q = session.q;
    return this.#replay(session, `newgame line ${p.line} difficulty ${difficulty}`, p.draws as Draw[], () => {
      initializeMapStructure(q);
      setupNewStrategicMap(q);
      initNewCampaignMap(q, { initStrategicAI: () => initStrategicAiForNewCampaign(q) });
    });
  }

  #runLoadHooks(session: Session, p: Json): number {
    session.loadHooksPending = false;
    session.mines.income = Number(p.mineIncome);
    session.mines.max = Number(p.maxMineIncome);
    const draws = session.loadDraws ?? [];
    const begin = draws.findIndex((d) => d[0] === MARK_STREAM && d[1] === MARK_LOAD_HOOKS_BEGIN);
    const end = draws.findIndex((d) => d[0] === MARK_STREAM && d[1] === MARK_LOAD_HOOKS_END);
    if (begin < 0 || end < begin)
      return report(`load hooks before line ${p.line}`, false, 'no load-hook marks in the draw log (patch 0003)');
    return this.#replay(session, `load hooks before line ${p.line}`, draws.slice(begin + 1, end), () => runStrategicAiLoadHooks(session.q));
  }

  #compareDump(session: Session, p: Json): number {
    let failures = 0;
    if (session.loadHooksPending) failures += this.#runLoadHooks(session, p);
    session.mines.income = Number(p.mineIncome);
    session.mines.max = Number(p.maxMineIncome);
    const ours = ourDump(session.q, {
      predictIncomeFromPlayerMines: () => session.mines.income,
      maxPlayerIncomeFromMines: () => session.mines.max,
    });
    const out: string[] = [];
    for (const key of ['compositions', 'garrisons', 'denied', 'patrols', 'sectors', 'enemyControlled', 'underground', 'groups', 'events'])
      diffList(key, ours[key] as unknown[], p[key] as unknown[], out);
    diffObject('globals', ours.globals as Json, p.globals as Json, out);
    diffObject('status', ours.status as Json, p.status as Json, out);
    for (const key of ['worldSeconds', 'difficulty', 'meanwhileFlags', 'progress'])
      if (!sameJson(ours[key], p[key])) out.push(`${key} ${JSON.stringify(ours[key])}/${JSON.stringify(p[key])}`);
    const groups = (ours.groups as unknown[]).length;
    return (
      failures +
      report(
        `sai line ${p.line}`,
        out.length === 0,
        `${groups} enemy groups, ${out.length} differences ${out.slice(0, MAX_REPORTED).join('; ')}`,
      )
    );
  }

  #compareDifficulty(session: Session, p: Json): number {
    const q = session.q;
    const battle = p.battleSector as number[];
    const sector = { x: battle[0] ?? 0, y: battle[1] ?? 0, z: battle[2] ?? 0 };
    const mines: MineIncomePort = {
      predictIncomeFromPlayerMines: () => Number(p.mineIncome),
      maxPlayerIncomeFromMines: () => Number(p.maxMineIncome),
    };
    const ours = {
      modifier: calcDifficultyModifier(
        {
          difficulty: q.state.options.difficulty,
          highestProgress: q.state.status.highestProgress,
          predictedMineIncome: Number(p.mineIncome),
          battleSector: sector,
          battleSectorTownId: townIdOfSector(q, sector),
        },
        Number(p.class),
      ),
      highestProgress: q.state.status.highestProgress,
      progress: currentPlayerProgressPercentage(q, q.army.progress, mines),
      townId: townIdOfSector(q, sector),
      palaceDistance: pythDistanceFromPalace(sector),
    };
    const theirs = {
      modifier: p.modifier,
      highestProgress: p.highestProgress,
      progress: p.progress,
      townId: p.townId,
      palaceDistance: p.palaceDistance,
    };
    const out: string[] = [];
    diffObject('diffmod', ours, theirs, out);
    return report(`diffmod line ${p.line} class ${p.class}`, out.length === 0, `modifier ${ours.modifier}/${p.modifier} ${out.join('; ')}`);
  }

  async compare(p: Json): Promise<number> {
    if (p.probe === 'newgame') return this.#newGame(p);
    const session = this.#session;
    if (p.probe === 'draws' && !session) return 0;
    if (!session) return report(`${p.probe} line ${p.line}`, false, 'no newgame or save before this probe');
    const q = session.q;
    const draws = (p.draws as Draw[] | undefined) ?? [];
    switch (p.probe) {
      case 'draws':
        if (p.mode === 'dump' && session.loadHooksPending) session.loadDraws = draws;
        return 0;
      case 'sai':
        return this.#compareDump(session, p);
      case 'saievaluate':
        return this.#replay(session, `saievaluate line ${p.line}`, draws, () => {
          if (p.forceAwake === true) q.state.queen.awake = true;
          evaluateQueenSituation(q);
        });
      case 'saicheck':
        return this.#replay(session, `saicheck line ${p.line}`, draws, () => checkEnemyControlledSector(q, Number(p.sector)));
      case 'saiwake':
        return this.#replay(session, `saiwake line ${p.line}`, draws, () => wakeUpQueen(q));
      case 'diffmod':
        return this.#compareDifficulty(session, p);
      case 'saiarrive':
        return this.#replay(session, `saiarrive line ${p.line} groups ${JSON.stringify(p.groups)}`, draws, () =>
          arriveInOrder(q, p.groups as number[]),
        );
      default:
        return 0;
    }
  }
}
