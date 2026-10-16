import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveGame, type SaveGame } from '../../src/content/formats/savegame.ts';
import { readSavedEconomy, readSoldierAssignments, type SavedSoldierAssignment } from '../../src/content/formats/savegame-economy.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH, type SaveEncryptionTable } from '../../src/content/formats/savegame-header.ts';
import type { SavedSoldier } from '../../src/content/formats/savegame-soldier.ts';
import { readStrategicAiSections } from '../../src/content/formats/savegame-strategic-ai.ts';
import { type ItemTable, loadItemTable } from '../../src/content/items/items.ts';
import { type EconomyContent, loadEconomyContent } from '../../src/content/strategic/economy-content.ts';
import { parseSectorString, sectorFromId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import { loadStrategicContent, type StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { objectFromRecord } from '../../src/sim/items/object.ts';
import { changeSoldiersAssignment, setTimeOfAssignmentChange } from '../../src/sim/strategic/economy/assignment-done.ts';
import { GUN_RANGE_SECTOR, LoyaltyEvent, NUM_TOWNS } from '../../src/sim/strategic/economy/constants.ts';
import { createEconomyContext } from '../../src/sim/strategic/economy/context.ts';
import { kitItems } from '../../src/sim/strategic/economy/kits.ts';
import { handleGlobalLoyaltyEvent } from '../../src/sim/strategic/economy/loyalty.ts';
import { isAreaFullOfMilitia, militiaTrainingAllowedInSector } from '../../src/sim/strategic/economy/militia-rules.ts';
import { maxDailyRemovalFromMine } from '../../src/sim/strategic/economy/mine-status.ts';
import {
  calcMaxPlayerIncomeFromMines,
  predictDailyIncomeFromAMine,
  predictIncomeFromPlayerMines,
} from '../../src/sim/strategic/economy/mines.ts';
import {
  calculateHealingPointsForDoctor,
  calculateRepairPointsForRepairman,
  getBonusTrainingPtsDueToInstructor,
  getSoldierStudentPts,
  getSoldierTrainingPts,
  getTownTrainPtsForCharacter,
  type Points,
} from '../../src/sim/strategic/economy/points.ts';
import type { CrewMember, CrewPort, EconomyContext, MercStats } from '../../src/sim/strategic/economy/ports.ts';
import { applySavedAssignment, importEconomy } from '../../src/sim/strategic/economy/save-import.ts';
import { sectorOursAndPeaceful, sectorsUnderControl } from '../../src/sim/strategic/economy/towns.ts';
import { registerEconomyEvents } from '../../src/sim/strategic/economy/update.ts';
import { createStrategicContext, emptyMercPort, standaloneClockContext } from '../../src/sim/strategic/forces/context.ts';
import { defaultTacticalWorldPort } from '../../src/sim/strategic/forces/ports.ts';
import { removeCharacterFromSquads } from '../../src/sim/strategic/forces/squads.ts';
import { importStrategicMap } from '../../src/sim/strategic/map/save-import.ts';
import { createStrategicState } from '../../src/sim/strategic/state.ts';
import { Warp } from '../../src/sim/strategic/time/constants.ts';
import { EventDispatch } from '../../src/sim/strategic/time/dispatch.ts';
import { importStrategicTime } from '../../src/sim/strategic/time/save-import.ts';
import { type ClockContext, warpGameTime, worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';

type Json = Record<string, unknown>;

export const ECONOMY_PROBES: ReadonlySet<string> = new Set(['strategic', 'mercs', 'loyalty', 'warp', 'assign']);

const PLAYER_TEAM = 0;
const STATUS_VEHICLE = 0x00008000;
const STATUS_ROBOT = 0x00001000;
const STATUS_PASSENGER_OR_DRIVER = 0x18000000;
const MERC_TYPE_EPC = 4;
const TRAINABLE_STATS = 9;
const MIN_EFFECTIVE_STRENGTH = 2;
const NORMAL_WEIGHT = 100;
const MAX_REPORTED = 8;
const REBEL_CIV_GROUP = 1;
const CIV_GROUP_NEUTRAL = 0;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function naturalStats(s: SavedSoldier): MercStats {
  const t = s.stats;
  return {
    strength: t.strength,
    dexterity: t.dexterity,
    agility: t.agility,
    wisdom: t.wisdom,
    leadership: t.leadership,
    marksmanship: t.marksmanship,
    mechanical: t.mechanical,
    medical: t.medical,
    explosives: t.explosive,
    expLevel: t.expLevel,
  };
}

function effectiveStats(s: SavedSoldier): MercStats {
  const n = naturalStats(s);
  const half = Math.trunc(n.strength / 2);
  const effectiveLife = s.stats.life + Math.trunc((s.stats.lifeMax - s.stats.life - s.bleeding) / 2);
  const weight = s.motion.weightCarriedAtTurnStart;
  return {
    ...n,
    strength: Math.max(half + Math.trunc((half * effectiveLife) / s.stats.lifeMax), MIN_EFFECTIVE_STRENGTH),
    agility: weight > NORMAL_WEIGHT ? Math.trunc((n.agility * 100) / weight) : n.agility,
    expLevel: Math.max(n.expLevel, 1),
  };
}

function crewMember(save: SaveGame, s: SavedSoldier, path: readonly number[], saved: SavedSoldierAssignment | undefined): CrewMember {
  const profile = save.profiles[s.profile];
  const m: CrewMember = {
    id: s.id,
    profile: s.profile,
    life: s.stats.life,
    lifeMax: s.stats.lifeMax,
    strength: s.stats.strength,
    isVehicle: (s.statusFlags & STATUS_VEHICLE) !== 0,
    isRobot: (s.statusFlags & STATUS_ROBOT) !== 0,
    isEpc: s.whatKindOfMercAmI === MERC_TYPE_EPC,
    isPassengerOrDriver: (s.statusFlags & STATUS_PASSENGER_OR_DRIVER) !== 0,
    asleep: s.mercAsleep,
    sector: { ...s.sector },
    betweenSectors: s.betweenSectors,
    groupId: s.groupId,
    prevSectorId: 0,
    insertionCode: s.strategicInsertionCode,
    insertionDirection: 0,
    path: [...path],
    assignment: s.assignment,
    vehicleId: s.vehicleId,
    fractLife: s.fractLife,
    bleeding: s.bleeding,
    breath: s.stats.breath,
    breathMax: s.stats.breathMax,
    collapsed: false,
    forcedToStayAwake: false,
    complainedThatTired: false,
    nothingToDo: false,
    doneQuoteSaid: false,
    trainStat: 0,
    lastAssignmentChangeMin: 0,
    hospitalPriceModifier: 0,
    fixingRobot: false,
    vehicleUnderRepair: -1,
    inSector: s.inSector,
    stats: naturalStats(s),
    effective: effectiveStats(s),
    statDamage: { ...s.statDamage },
    skillTraits: [...s.skillTraits],
    profileTraits: profile ? [profile.skillTrait, profile.skillTrait2] : [0, 0],
    needForSleep: profile?.needForSleep ?? 0,
    inv: s.inventory.map(objectFromRecord),
  };
  if (saved) applySavedAssignment(m, saved);
  return m;
}

function savedCrew(save: SaveGame, assignments: readonly SavedSoldierAssignment[]): CrewPort {
  const mercs = new Map<number, CrewMember>();
  for (const e of save.soldiers) {
    if (e.soldier.team !== PLAYER_TEAM) continue;
    mercs.set(
      e.soldier.id,
      crewMember(
        save,
        e.soldier,
        e.mercPath,
        assignments.find((a) => a.id === e.soldier.id),
      ),
    );
  }
  const all = () => [...mercs.values()].sort((a, b) => a.id - b.id);
  return {
    ...emptyMercPort,
    get: (id) => mercs.get(id),
    byProfile: (p) => all().find((m) => m.profile === p),
    all,
    statChange: () => {},
    healStat: () => {},
    opinion: (profile, about) => save.profiles[profile]?.mercOpinion[about] ?? 0,
    dressWound: () => 0,
  };
}

export class EconomyComparer {
  readonly #read: ReadFile;
  #strategic: StrategicContent | null = null;
  #economy: EconomyContent | null = null;
  #items: ItemTable | null = null;
  #encryption: SaveEncryptionTable | null = null;
  #ctx: EconomyContext | null = null;
  #warped = false;

  constructor(read: ReadFile) {
    this.#read = read;
  }

  async #content(): Promise<{ strategic: StrategicContent; economy: EconomyContent; items: ItemTable; encryption: SaveEncryptionTable }> {
    this.#strategic ??= await loadStrategicContent(this.#read);
    this.#economy ??= await loadEconomyContent(this.#read, this.#strategic.towns);
    this.#items ??= await loadItemTable(async (path) => {
      const bytes = await this.#read(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    });
    if (!this.#encryption) {
      const table = await this.#read(SAVE_ENCRYPTION_PATH);
      if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
      this.#encryption = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table)));
    }
    return { strategic: this.#strategic, economy: this.#economy, items: this.#items, encryption: this.#encryption };
  }

  async loadSave(savesDir: string, name: string): Promise<void> {
    const content = await this.#content();
    const bytes = new Uint8Array(readFileSync(join(savesDir, `${name}.sav`)));
    const save = parseSaveGame(bytes, content.encryption);
    const state = createStrategicState();
    importStrategicTime(state, save);
    const crew = savedCrew(save, readSoldierAssignments(bytes, save, content.encryption));
    const dispatch = new EventDispatch<null>();
    const clock: ClockContext = {
      ...standaloneClockContext(state),
      inCombat: () => save.tactical.inCombat,
      execute: (e) => dispatch.execute(null, e),
    };
    state.flow = 'tactical';
    const world = {
      ...defaultTacticalWorldPort,
      enemyInSector: () => save.tactical.enemyInSector,
      fact: (id: number) => save.facts[id] ?? 0,
    };
    state.worldSector = { ...save.currentSector.sector };
    const strategic = createStrategicContext({ state, content: content.strategic, mercs: crew, clock, world });
    importStrategicMap(strategic, save);
    importEconomy(state, readSavedEconomy(bytes, save.sections), save.laptop.currentBalance);
    const status = readStrategicAiSections(bytes, save).status;
    state.status.enricoEmailFlags = status.enricoEmailFlags;
    state.status.highestProgress = status.highestProgress;
    Object.assign(state.map.activity, {
      lastDayOfPlayerActivity: status.lastDayOfPlayerActivity,
      newSectorsVisitedToday: status.newSectorsVisitedToday,
      daysOfInactivity: status.daysOfInactivity,
    });
    this.#ctx = createEconomyContext(strategic, {
      economy: content.economy,
      items: content.items,
      crew,
      hooks: { rebelsHostile: () => (save.tactical.civGroupHostile[REBEL_CIV_GROUP] ?? 0) !== CIV_GROUP_NEUTRAL },
    });
    registerEconomyEvents(dispatch, this.#ctx);
    this.#warped = false;
  }

  compare(p: Json): number {
    const ctx = this.#ctx;
    if (!ctx) return report(`${p.probe} line ${p.line}`, false, 'no save loaded');
    if (p.probe === 'strategic') return compareStrategic(ctx, p);
    if (p.probe === 'mercs') return compareMercs(ctx, p, this.#warped);
    if (p.probe === 'loyalty') return compareLoyaltyEvent(ctx, p);
    if (p.probe === 'assign') return compareAssign(ctx, p);
    this.#warped = true;
    return compareWarp(ctx, p);
  }
}

function compareAssign(ctx: EconomyContext, p: Json): number {
  const m = ctx.crew.get(Number(p.who));
  if (!m) return report(`assign line ${p.line}`, false, `no soldier ${p.who}`);
  removeCharacterFromSquads(ctx, m.id);
  if (m.assignment !== Number(p.kind)) setTimeOfAssignmentChange(ctx, m);
  changeSoldiersAssignment(ctx, m, Number(p.kind));
  m.trainStat = Number(p.stat);
  return report(
    `assign line ${p.line} soldier ${m.id}`,
    m.lastAssignmentChangeMin === Number(p.changeMinute),
    `kind ${p.kind} stat ${p.stat}`,
  );
}

function compareWarp(ctx: EconomyContext, p: Json): number {
  const from = ctx.state.clock.seconds;
  warpGameTime(ctx.clock, Number(p.seconds), Warp.NORMAL);
  return report(
    `warp line ${p.line}`,
    from === Number(p.from) && ctx.state.clock.seconds === Number(p.worldSeconds),
    `${from}→${ctx.state.clock.seconds} / ${p.from}→${p.worldSeconds}`,
  );
}

function townsJson(ctx: EconomyContext): Json[] {
  return ctx.state.economy.towns.slice(0, NUM_TOWNS).map((t, town) => ({
    rating: t.rating,
    change: t.change,
    started: t.started,
    liberated: t.liberatedAlready,
    underControl: town ? sectorsUnderControl(ctx, town) : 0,
  }));
}

function sectorsJson(ctx: EconomyContext, ids: readonly number[]): Json[] {
  return ids.map((id) => {
    const s = sectorFromId(id);
    const info = ctx.state.map.sectors[id];
    const element = ctx.state.map.elements[strategicIndex(s)];
    return {
      sector: id,
      militia: info?.militia,
      paid: info?.militiaTrainingPaid,
      percent: info?.militiaTrainingPercentDone,
      hundredths: info?.militiaTrainingHundredths,
      everControlled: info?.surfaceWasEverPlayerControlled,
      enemyControlled: element?.enemyControlled,
      oursAndPeaceful: sectorOursAndPeaceful(ctx, s),
      trainingAllowed: militiaTrainingAllowedInSector(ctx, s),
      areaFull: isAreaFullOfMilitia(ctx, s),
      samCondition: element?.samCondition,
    };
  });
}

function minesJson(ctx: EconomyContext): Json[] {
  return ctx.state.economy.mines.map((m, mine) => ({
    type: m.mineType,
    maxRemovalRate: m.maxRemovalRate,
    remaining: m.remainingOreSupply,
    runningOutPoint: m.oreRunningOutPoint,
    empty: m.empty,
    runningOut: m.runningOut,
    warned: m.warnedOfRunningOut,
    permanentShutDown: m.shutDownIsPermanent,
    shutDown: m.shutDown,
    prevInvaded: m.prevInvadedByMonsters,
    spokeToHeadMiner: m.spokeToHeadMiner,
    produced: m.mineHasProducedForPlayer,
    queenRetook: m.queenRetookProducingMine,
    attackedHeadMiner: m.attackedHeadMiner,
    productionStarted: m.timePlayerProductionStarted,
    predictedDaily: predictDailyIncomeFromAMine(ctx, mine),
    maxDaily: maxDailyRemovalFromMine(ctx, mine),
  }));
}

function differences(ours: Json, theirs: Json, prefix = ''): string[] {
  return Object.keys(theirs).flatMap((k) => {
    const a = ours[k];
    const b = theirs[k];
    if (sameJson(a, b)) return [];
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && typeof b[0] === 'object')
      return b.flatMap((item, i) => differences(a[i] as Json, item as Json, `${prefix}${k}[${i}].`));
    return [`${prefix}${k} ${JSON.stringify(a)}/${JSON.stringify(b)}`];
  });
}

function compareStrategic(ctx: EconomyContext, p: Json): number {
  const theirSectors = p.sectors as Json[];
  const ours: Json = {
    worldMinutes: worldTotalMinutes(ctx.state.clock),
    balance: ctx.state.finances.balance,
    towns: townsJson(ctx),
    sectors: sectorsJson(
      ctx,
      theirSectors.map((s) => Number(s.sector)),
    ),
    mines: minesJson(ctx),
    enemyAir: ctx.state.map.sectors.map((_, id) => (ctx.state.map.elements[strategicIndex(sectorFromId(id))]?.enemyAirControlled ? 1 : 0)),
    predictedIncome: predictIncomeFromPlayerMines(ctx),
    maxIncome: calcMaxPlayerIncomeFromMines(ctx),
    enricoEmailFlags: ctx.state.status.enricoEmailFlags,
    lastDayOfPlayerActivity: ctx.state.map.activity.lastDayOfPlayerActivity,
    newSectorsVisitedToday: ctx.state.map.activity.newSectorsVisitedToday,
    daysOfInactivity: ctx.state.map.activity.daysOfInactivity,
  };
  const theirs: Json = Object.fromEntries(Object.keys(ours).map((k) => [k, p[k]]));
  const diff = differences(ours, theirs);
  return report(
    `strategic line ${p.line}`,
    diff.length === 0,
    `${(p.sectors as unknown[]).length} sectors, ${(p.mines as unknown[]).length} mines, income ${ours.predictedIncome}/${p.predictedIncome}` +
      diff
        .slice(0, MAX_REPORTED)
        .map((d) => ` ${d}`)
        .join(''),
  );
}

function pair(points: Points): number[] {
  return [points.points, points.max];
}

function mercJson(ctx: EconomyContext, m: CrewMember): Json {
  const kits = kitItems(ctx.items);
  const gunRange = m.sector.x === GUN_RANGE_SECTOR.x && m.sector.y === GUN_RANGE_SECTOR.y && m.sector.z === GUN_RANGE_SECTOR.z;
  const stats = Array.from({ length: TRAINABLE_STATS }, (_, k) => k);
  return {
    id: m.id,
    profile: m.profile,
    sector: [m.sector.x, m.sector.y, m.sector.z],
    betweenSectors: m.betweenSectors,
    assignment: m.assignment,
    trainStat: m.trainStat,
    asleep: m.asleep,
    collapsed: m.collapsed,
    forcedAwake: m.forcedToStayAwake,
    complainedThatTired: m.complainedThatTired,
    nothingToDo: m.nothingToDo,
    breath: m.breath,
    breathMax: m.breathMax,
    life: m.life,
    lifeMax: m.lifeMax,
    fractLife: m.fractLife,
    bleeding: m.bleeding,
    lastAssignmentChange: m.lastAssignmentChangeMin,
    needForSleep: m.needForSleep,
    estimates: {
      doctor: pair(calculateHealingPointsForDoctor(m, kits, false)),
      repair: pair(calculateRepairPointsForRepairman(m, kits, false)),
      townTraining: pair(getTownTrainPtsForCharacter(ctx, m)),
      selfTraining: stats.map((s) => pair(getSoldierTrainingPts(m, s, gunRange))),
      studentTraining: stats.map((s) => pair(getSoldierStudentPts(ctx, m, s, gunRange))),
      instructor: stats.map((s) => pair(getBonusTrainingPtsDueToInstructor(ctx, m, null, s, gunRange))),
    },
  };
}

const STAT_DEPENDENT_FIELDS: readonly string[] = ['estimates'];

function compareMercs(ctx: EconomyContext, p: Json, warped: boolean): number {
  const theirs = p.mercs as Json[];
  let failures = 0;
  for (const t of theirs) {
    const m = ctx.crew.get(Number(t.id));
    if (!m) {
      failures += report(`mercs line ${p.line} soldier ${t.id}`, false, 'missing in ja2-node');
      continue;
    }
    const theirsCompared = warped ? Object.fromEntries(Object.entries(t).filter(([k]) => !STAT_DEPENDENT_FIELDS.includes(k))) : t;
    const diff = differences(mercJson(ctx, m), theirsCompared);
    failures += report(
      `mercs line ${p.line} soldier ${t.id}`,
      diff.length === 0,
      `assignment ${m.assignment} breathMax ${m.breathMax}${warped ? ' (stat estimates skipped after a warp)' : ''}${diff.map((d) => ` ${d}`).join('')}`,
    );
  }
  return failures;
}

function compareLoyaltyEvent(ctx: EconomyContext, p: Json): number {
  const before = townsJson(ctx);
  const event = LoyaltyEvent[String(p.event) as keyof typeof LoyaltyEvent];
  const s = p.sector as number[];
  const sector = { ...parseSectorString(`${String.fromCharCode(64 + (s[1] ?? 1))}${s[0]}`), z: s[2] ?? 0 };
  handleGlobalLoyaltyEvent(ctx, event, sector);
  const after = townsJson(ctx);
  const same = sameJson(before, p.before) && sameJson(after, p.towns);
  const show = (towns: Json[]) =>
    towns
      .map((t, i) => (t.started ? `${i}:${t.rating}/${t.change}` : ''))
      .filter(Boolean)
      .join(' ');
  return report(
    `loyalty line ${p.line} ${p.event} ${JSON.stringify(s)}`,
    same,
    `ours ${show(after)} theirs ${show(p.towns as Json[])}${sameJson(before, p.before) ? '' : ` (before ${show(before)} vs ${show(p.before as Json[])})`}`,
  );
}
