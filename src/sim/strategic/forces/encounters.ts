// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc CheckConditionsForBattle, HandleOtherGroupsArrivingSimultaneously,
// @src PossibleToCoordinateSimultaneousGroupArrivals, PlanSimultaneousGroupArrivalCallback, PrepareGroupsForSimultaneousArrival,
// @src PrepareForPreBattleInterface, TriggerPrebattleInterface, NotifyPlayerOfBloodcatBattle, TestForBloodcatAmbush,
// @src HandleArrivalOfReinforcements; Map_Screen_Interface.cc NotifyPlayerOfInvasionByEnemyForces.

import { type Sector, sameSector, sectorId, sectorShortString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i8, idiv, u32 } from '../../../core/int.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { isThisSectorASamSector, townIdOfSector } from '../map/control.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { fact } from '../narrative/facts.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent, deleteStrategicEvent } from '../time/event-queue.ts';
import {
  CompressionStop,
  interruptTime,
  lockPauseState,
  pauseGame,
  stopTimeCompression,
  unLockPauseState,
  unPauseGame,
} from '../time/world-clock.ts';
import { ABOUT_TO_ARRIVE_DELAY, BLANK_SECTOR, Difficulty, EncounterCode, GroupFlag, InsertionCode, PauseLock } from './constants.ts';
import { PreBattleNotice as Notice, type PreBattleHandoff, type PreBattleNotice } from './flow-state.ts';
import {
  countAllMilitiaInSector,
  findPlayerMovementGroupInSector,
  type Group,
  getGroup,
  groupHasInTransitDeadOrPowMercs,
  groupMembers,
  isHelicopterGroup,
  isHelicopterVehicle,
  numEnemiesInSector,
  playerMercsInSector,
  vehicleGroupHasPassengers,
  vehicleOfGroup,
} from './groups.ts';
import type { InvasionKind } from './helicopter-events.ts';
import { delayEnemyGroupsIfPathsCross, groupArrivedAtSector, nowMinutes } from './movement.ts';
import type { StrategicContext } from './ports.ts';

const BLOODCAT_CHANCE_PER_DIFFICULTY = 5;
const BLOODCAT_BASE = 3;
const BLOODCAT_VARIANCE = 4;
const BLOODCAT_PROGRESS_BASE = 7;
const BLOODCAT_MIN = 3;
const BLOODCATS_PER_MERC = 2;
const BLOODCAT_RECOVERY_HOURS = 18;
const ALREADY_AMBUSHED_CHANCE = 95;
const MINUTES_PER_HOUR = 60;

interface SectorParticipants {
  combatAble: boolean;
  alive: boolean;
  dialogGroup: Group | null;
}

function surveyPlayerGroups(ctx: StrategicContext, s0: Sector): SectorParticipants {
  const result: SectorParticipants = { combatAble: false, alive: false, dialogGroup: null };
  for (const g of ctx.state.forces.groups) {
    if (!g.player || !g.size || g.betweenSectors || !sameSector(g.sector, s0)) continue;
    if (groupHasInTransitDeadOrPowMercs(ctx, g)) continue;
    if (isHelicopterGroup(ctx, g) && ctx.state.forces.helicopterAirborne) continue;
    if (g.vehicle && !vehicleGroupHasPassengers(ctx, g)) continue;
    for (const m of groupMembers(ctx, g)) {
      if (m.isVehicle) continue;
      if (!m.isRobot && !m.isEpc && m.life >= OKLIFE) result.combatAble = true;
      if (m.life > 0) result.alive = true;
    }
    if (!result.dialogGroup && result.combatAble) result.dialogGroup = g;
    if (result.combatAble) break;
  }
  return result;
}

function clearSimultaneousArrivalFlags(ctx: StrategicContext): void {
  const flow = ctx.state.movement;
  for (const g of ctx.state.forces.groups) {
    if (flow.numGroupsArrivedSimultaneously === 0) break;
    if (!(g.flags & GroupFlag.GROUP_ARRIVED_SIMULTANEOUSLY)) continue;
    g.flags &= ~GroupFlag.GROUP_ARRIVED_SIMULTANEOUSLY;
    flow.numGroupsArrivedSimultaneously--;
  }
}

export function checkConditionsForBattle(ctx: StrategicContext, g: Group): boolean {
  const s = g.sector;
  const s0: Sector = { x: s.x, y: s.y, z: 0 };
  const world = ctx.state.worldSector;
  const enc = ctx.state.encounter;
  if (
    world !== null &&
    sameSector(world, s0) &&
    findPlayerMovementGroupInSector(ctx, world) !== undefined &&
    playerMercsInSector(ctx, world) &&
    ctx.world.enemyInSector()
  ) {
    handleArrivalOfReinforcements(ctx, g);
    return true;
  }
  if (!ctx.state.didGameJustStart) enc.code = EncounterCode.NO_ENCOUNTER;
  handleOtherGroupsArrivingSimultaneously(ctx, s);
  const survey = surveyPlayerGroups(ctx, s0);
  let dialogGroup = survey.dialogGroup;
  let pending = false;
  let militia = false;
  let cats = false;
  if (g.player) {
    dialogGroup = g;
    if (numEnemiesInSector(ctx, s)) pending = true;
    if (g.flags & GroupFlag.HIGH_POTENTIAL_FOR_AMBUSH && pending) enc.highPotentialForAmbush = true;
    if (testForBloodcatAmbush(ctx, g)) {
      cats = true;
      pending = true;
    }
    if (pending && (!cats || enc.code === EncounterCode.ENTERING_BLOODCAT_LAIR) && possibleToCoordinateSimultaneousGroupArrivals(ctx, g)) {
      return false;
    }
  } else {
    if (countAllMilitiaInSector(ctx, s)) {
      militia = true;
      pending = true;
    }
    if (survey.alive) pending = true;
  }
  if (!survey.alive && !militia) return false;
  if (!pending) return false;
  if (ctx.state.movement.numGroupsArrivedSimultaneously) clearSimultaneousArrivalFlags(ctx);
  ctx.state.movement.initPrebattleGroup = g.id;
  const inputs = { combatAbleMerc: survey.combatAble, aliveMerc: survey.alive, militiaPresent: militia, bloodcatAmbush: cats };
  if (enc.code === EncounterCode.BLOODCAT_AMBUSH || enc.code === EncounterCode.ENTERING_BLOODCAT_LAIR) {
    enc.usePersistentPBI = true;
    triggerPrebattleInterface(ctx, g, s, Notice.BLOODCAT_BATTLE, inputs);
    return true;
  }
  if (!survey.combatAble) {
    enc.delayAutoResolveStart = true;
    enc.usePersistentPBI = true;
    if (militia) notifyPlayerOfInvasionByEnemyForces(ctx, g, s, inputs);
    else triggerPrebattleInterface(ctx, g, s, Notice.UNCONSCIOUS_MERCS_ATTACKED, inputs);
  }
  if (dialogGroup) prepareForPreBattleInterface(ctx, dialogGroup, g, inputs);
  return true;
}

type EncounterInputs = Pick<PreBattleHandoff, 'combatAbleMerc' | 'aliveMerc' | 'militiaPresent' | 'bloodcatAmbush'>;

function recordPreBattle(
  ctx: StrategicContext,
  battleGroup: Group,
  dialogGroup: Group | null,
  sector: Sector,
  notice: PreBattleNotice | null,
  inputs: EncounterInputs,
  speakers: readonly number[],
): void {
  const previous = ctx.state.encounter.preBattle;
  const tt = ctx.state.movement.tacticalTraversal;
  ctx.state.encounter.preBattle = {
    battleGroupId: battleGroup.id,
    dialogGroupId: dialogGroup?.id ?? previous?.dialogGroupId ?? null,
    sector,
    encounterCode: ctx.state.encounter.code,
    notice: notice ?? previous?.notice ?? null,
    speakerCandidates: speakers.length > 0 ? speakers : (previous?.speakerCandidates ?? []),
    tacticalTraversal: tt.active && tt.groupId === battleGroup.id,
    ...inputs,
  };
}

function triggerPrebattleInterface(ctx: StrategicContext, g: Group, s: Sector, notice: PreBattleNotice, inputs: EncounterInputs): void {
  stopTimeCompression(ctx.clock, CompressionStop.BATTLE);
  recordPreBattle(ctx, g, null, s, notice, inputs, []);
  ctx.state.movement.initPrebattleGroup = null;
}

function invasionKind(ctx: StrategicContext, s: Sector): InvasionKind {
  if (isThisSectorASamSector(ctx, s)) return 'sam';
  return townIdOfSector(ctx, s) !== BLANK_SECTOR ? 'town' : 'other';
}

function notifyPlayerOfInvasionByEnemyForces(ctx: StrategicContext, g: Group, s: Sector, inputs: EncounterInputs): void {
  if (s.z !== 0) return;
  if (ctx.state.map.elements[strategicIndex(s)]?.enemyControlled) return;
  const kind = invasionKind(ctx, s);
  ctx.helicopter.emit({ type: 'invasion', sector: sectorShortString(s), kind });
  if (kind !== 'other') triggerPrebattleInterface(ctx, g, s, Notice.INVASION, inputs);
}

export function prepareForPreBattleInterface(
  ctx: StrategicContext,
  dialogGroup: Group,
  battleGroup: Group,
  inputs?: EncounterInputs,
): void {
  const flow = ctx.state.movement;
  if (flow.disableMapInterfaceDueToBattle) return;
  const speakers = groupMembers(ctx, dialogGroup)
    .filter((m) => m.life >= OKLIFE && !m.isVehicle && !m.isRobot && !m.isEpc)
    .map((m) => m.id);
  const clock = ctx.state.clock;
  const tt = flow.tacticalTraversal;
  const world = ctx.state.worldSector;
  const traversal = tt.active && battleGroup.id === tt.groupId;
  const enemyHere = !battleGroup.player && world !== null && sameSector(battleGroup.sector, world) && !world.z;
  const summary = inputs ?? { combatAbleMerc: speakers.length > 0, aliveMerc: true, militiaPresent: false, bloodcatAmbush: false };
  if (traversal || enemyHere) {
    if (speakers.length === 0) return;
    recordPreBattle(ctx, battleGroup, dialogGroup, battleGroup.sector, null, summary, speakers);
    if (dialogGroup.flags & GroupFlag.JUST_RETREATED_FROM_BATTLE) ctx.state.encounter.cantRetreatInPBI = true;
    interruptTime(clock);
    pauseGame(clock);
    lockPauseState(clock, PauseLock.PREBATTLE_CURRENT_SQUAD);
    if (!tt.active) flow.disableMapInterfaceDueToBattle = true;
    return;
  }
  recordPreBattle(ctx, battleGroup, dialogGroup, battleGroup.sector, null, summary, speakers);
  if (speakers.length === 0) return;
  if (dialogGroup.flags & GroupFlag.JUST_RETREATED_FROM_BATTLE) ctx.state.encounter.cantRetreatInPBI = true;
  interruptTime(clock);
  pauseGame(clock);
  lockPauseState(clock, PauseLock.PREBATTLE);
  flow.disableMapInterfaceDueToBattle = true;
}

export function handleOtherGroupsArrivingSimultaneously(ctx: StrategicContext, s: Sector): void {
  const flow = ctx.state.movement;
  const now = ctx.state.clock.seconds;
  flow.numGroupsArrivedSimultaneously = 0;
  for (let restart = true; restart; ) {
    restart = false;
    for (const e of ctx.state.queue.events) {
      if (e.stamp > now) break;
      if (e.kind !== EventKind.GROUP_ARRIVAL) continue;
      const g = getGroup(ctx, e.param);
      if (!g || !sameSector(g.next, s) || !g.betweenSectors) continue;
      groupArrivedAtSector(ctx, g, false, false);
      g.flags |= GroupFlag.GROUP_ARRIVED_SIMULTANEOUSLY;
      flow.numGroupsArrivedSimultaneously++;
      deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
      restart = true;
      break;
    }
  }
}

export function possibleToCoordinateSimultaneousGroupArrivals(ctx: StrategicContext, first: Group): boolean {
  if (first.flags & (GroupFlag.SIMULTANEOUSARRIVAL_APPROVED | GroupFlag.SIMULTANEOUSARRIVAL_CHECKED)) return false;
  if (isHelicopterGroup(ctx, first)) return false;
  let nearby = 0;
  for (const g of ctx.state.forces.groups) {
    if (!g.player || g === first || !g.betweenSectors || !sameSector(g.next, first.sector)) continue;
    if (g.flags & GroupFlag.SIMULTANEOUSARRIVAL_CHECKED || isHelicopterGroup(ctx, g)) continue;
    g.flags |= GroupFlag.SIMULTANEOUSARRIVAL_CHECKED;
    nearby++;
  }
  if (nearby === 0) return false;
  const clock = ctx.state.clock;
  interruptTime(clock);
  pauseGame(clock);
  lockPauseState(clock, PauseLock.SIMULTANEOUS_ARRIVAL);
  ctx.state.movement.pendingSimultaneousGroup = first.id;
  ctx.state.encounter.simultaneousArrival = {
    groupId: first.id,
    sector: first.sector,
    nearbyGroups: nearby,
    bloodcats: ctx.state.encounter.code === EncounterCode.ENTERING_BLOODCAT_LAIR,
  };
  ctx.state.movement.waitingForInput = true;
  return true;
}

export function answerSimultaneousArrival(ctx: StrategicContext, coordinate: boolean): void {
  const first = getGroup(ctx, ctx.state.movement.pendingSimultaneousGroup ?? -1);
  ctx.state.encounter.simultaneousArrival = null;
  if (first) {
    if (coordinate) prepareGroupsForSimultaneousArrival(ctx, first);
    else prepareForPreBattleInterface(ctx, first, first);
  }
  unLockPauseState(ctx.state.clock);
  unPauseGame(ctx.state.clock);
}

function repostArrival(ctx: StrategicContext, g: Group): void {
  addStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
  if (g.player && u32(g.arrivalTime - ABOUT_TO_ARRIVE_DELAY) > nowMinutes(ctx)) {
    addStrategicEvent(ctx.state.queue, EventKind.GROUP_ABOUT_TO_ARRIVE, u32(g.arrivalTime - ABOUT_TO_ARRIVE_DELAY), g.id);
  }
}

export function prepareGroupsForSimultaneousArrival(ctx: StrategicContext, first: Group): void {
  let latest = 0;
  for (const g of ctx.state.forces.groups) {
    if (!g.player || g === first || !g.betweenSectors || !sameSector(g.next, first.sector) || isHelicopterGroup(ctx, g)) continue;
    latest = Math.max(g.arrivalTime, latest);
    g.flags |= GroupFlag.SIMULTANEOUSARRIVAL_APPROVED | GroupFlag.MARKER;
  }
  for (const g of ctx.state.forces.groups) {
    if (!(g.flags & GroupFlag.MARKER)) continue;
    deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, g.id);
    g.arrivalTime = latest;
    repostArrival(ctx, g);
    delayEnemyGroupsIfPathsCross(ctx, g);
    g.flags &= ~GroupFlag.MARKER;
  }
  first.next = first.sector;
  first.sector = first.prev;
  first.arrivalTime = latest;
  first.betweenSectors = true;
  if (first.vehicle) {
    const v = vehicleOfGroup(ctx, first);
    v.betweenSectors = true;
    if (!isHelicopterVehicle(ctx, v)) {
      const vs = ctx.mercs.get(v.soldierId);
      if (vs) vs.betweenSectors = true;
    }
  }
  repostArrival(ctx, first);
  delayEnemyGroupsIfPathsCross(ctx, first);
}

export function testForBloodcatAmbush(ctx: StrategicContext, g: Group): boolean {
  const s = g.sector;
  if (s.z) return false;
  const info = sectorInfo(ctx.state.map, s);
  const difficulty = ctx.state.options.difficulty;
  const chance = BLOODCAT_CHANCE_PER_DIFFICULTY * difficulty;
  const spawn = ctx.content.bloodCatSpawns.find((b) => b.sector === sectorId(s));
  const lair = spawn?.isLair === true;
  const arena = spawn?.isArena === true;
  const hours = idiv(u32(nowMinutes(ctx) - info.timeLastLoaded), MINUTES_PER_HOUR);
  const enc = ctx.state.encounter;
  let alreadyAmbushed = false;
  if (lair || arena) {
    if (info.bloodCats === -1) info.bloodCats = info.bloodCatPlacements;
    else if (info.bloodCats > 0 && info.bloodCats < info.bloodCatPlacements) {
      const recovered = Math.min(idiv(hours, BLOODCAT_RECOVERY_HOURS), info.bloodCatPlacements - info.bloodCats);
      info.bloodCats = i8(info.bloodCats + recovered);
    }
  } else if (info.bloodCats === -1) {
    if (enc.autoAmbush || ctx.preRandom.chance(chance)) {
      const byDifficulty = ctx.random.int(BLOODCAT_VARIANCE) + difficulty * 2 + BLOODCAT_BASE;
      const byProgress = Math.max(idiv(ctx.ai.progressPercentage(), BLOODCAT_PROGRESS_BASE - difficulty), BLOODCAT_MIN);
      const byMercs = i8(playerMercsInSector(ctx, s) * BLOODCATS_PER_MERC);
      let cats = i8(Math.min(byDifficulty, byProgress));
      if (difficulty !== Difficulty.HARD) {
        cats = Math.min(cats, byMercs);
        cats = Math.max(cats, BLOODCAT_MIN);
      }
      info.bloodCats = i8(Math.min(cats, info.bloodCatPlacements));
    }
  } else if (!lair) {
    if (!enc.autoAmbush && ctx.preRandom.chance(ALREADY_AMBUSHED_CHANCE)) alreadyAmbushed = true;
  }
  if (!alreadyAmbushed && !arena && info.bloodCats > 0 && !g.vehicle && !numEnemiesInSector(ctx, s)) {
    enc.code =
      !lair || !fact(ctx.state.narrative, Fact.PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR)
        ? EncounterCode.BLOODCAT_AMBUSH
        : EncounterCode.ENTERING_BLOODCAT_LAIR;
    return true;
  }
  enc.code = EncounterCode.NO_ENCOUNTER;
  return false;
}

function insertionCodeFromTravel(g: Group): number {
  if (g.sector.x < g.prev.x) return InsertionCode.EAST;
  if (g.sector.x > g.prev.x) return InsertionCode.WEST;
  if (g.sector.y < g.prev.y) return InsertionCode.SOUTH;
  if (g.sector.y > g.prev.y) return InsertionCode.NORTH;
  throw new RangeError('reinforcements come from same sector');
}

export function handleArrivalOfReinforcements(ctx: StrategicContext, g: Group): void {
  if (!g.player) {
    ctx.state.encounter.pendingEnemies = true;
    ctx.world.enemyReinforcementsArrived(g);
    return;
  }
  const code = insertionCodeFromTravel(g);
  const insertion: Sector = { x: g.sector.x, y: g.sector.y, z: 0 };
  for (const m of groupMembers(ctx, g)) {
    m.insertionCode = code;
    ctx.mercs.updateMercInSector(m.id, insertion);
  }
}
