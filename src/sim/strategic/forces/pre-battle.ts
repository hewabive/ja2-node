// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc InitPreBattleInterface (logic), CalculateNonPersistantPBIInfo,
// @src PutNonSquadMercsInBattleSectorOnSquads, PutNonSquadMercsInPlayerGroupOnSquads, WakeUpAllMercsInSectorUnderAttack,
// @src ClearMovementForAllInvolvedPlayerGroups, RetreatAllInvolvedPlayerGroups, PlayerMercInvolvedInThisCombat,
// @src PlayerGroupInvolvedInThisCombat, LogBattleResults (codes), CheckForRobotAndIfItsControlled (through the crew port);
// @src Tactical/Soldier_Control.cc ControllingRobot.
// @src See docs/19 §1.

import { type Sector, sameSector } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import { wearsHeadGear } from '../../tactical/inventory.ts';
import { numMobileEnemiesInSector } from '../ai/counts.ts';
import type { CrewMember, EconomyContext } from '../economy/ports.ts';
import { setMercAwake } from '../economy/rest.ts';
import { isThisSectorASamSector, townIdOfSector } from '../map/control.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../map/knowledge.ts';
import { getSectorFlagStatus, sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { fact, setFactTrue } from '../narrative/facts.ts';
import { CompressionStop, stopTimeCompression } from '../time/world-clock.ts';
import { PbiChoice as Choice, type PbiOption, PbiReason as Reason } from './battle-state.ts';
import { Assignment, BLANK_SECTOR, EncounterCode as Code, SectorFlag } from './constants.ts';
import {
  type Group,
  getGroup,
  groupHasInTransitDeadOrPowMercs,
  isHelicopterGroup,
  playerMercsInSector,
  vehicleGroupHasPassengers,
} from './groups.ts';
import { moveAllInHelicopterToFootMovementGroup, soldierAboardAirborneHeli } from './helicopter.ts';
import { calculateGroupRetreatSector, clearMercPathsAndWaypointsForAllInGroup, retreatGroupToPreviousSector } from './movement.ts';
import { addCharacterToAnySquad, addCharacterToSquad, getFirstEmptySquad } from './squads.ts';
import { takeSoldierOutOfVehicle } from './vehicles.ts';

const NO_PREVIOUS_SECTOR = 255;
const HIGH_POTENTIAL_AMBUSH_CHANCE = 90;
const AMBUSH_PROGRESS_BASE = 30;
const AMBUSH_PROGRESS_PER_DIFFICULTY = 5;
const AMBUSH_BASE_CHANCE = 4;
const AMBUSH_CHANCE_PER_DIFFICULTY = 2;
const AMBUSH_PROGRESS_DIVISOR = 10;
const AMBUSH_LOCATION_BONUS = 20;
const CANT_RETREAT_AMBUSH_BONUS = 20;
const BEST_EXP_LEVEL = 0;
const OKLIFE = 15;

const BLOODCAT_CODES: ReadonlySet<number> = new Set([Code.BLOODCAT_AMBUSH, Code.ENTERING_BLOODCAT_LAIR]);
const PERSISTENT_PBI_CODES: ReadonlySet<number> = new Set([
  Code.ENTERING_ENEMY_SECTOR,
  Code.ENEMY_ENCOUNTER,
  Code.ENEMY_AMBUSH,
  Code.ENEMY_INVASION,
  Code.BLOODCAT_AMBUSH,
  Code.ENTERING_BLOODCAT_LAIR,
  Code.CREATURE_ATTACK,
]);

export function robotController(ctx: EconomyContext, robot: CrewMember): CrewMember | null {
  const remote = ctx.items.byName.get('ROBOT_REMOTE_CONTROL')?.index ?? -1;
  for (const s of ctx.crew.all()) {
    if (s.isEpc || s.life < OKLIFE) continue;
    if (s.assignment >= Assignment.ON_DUTY && s.assignment !== Assignment.VEHICLE) continue;
    if (!wearsHeadGear(s.inv, remote)) continue;
    if (!sameSector(robot.sector, s.sector) || robot.betweenSectors !== s.betweenSectors) continue;
    if (robot.betweenSectors && robot.assignment !== s.assignment) continue;
    if (robot.betweenSectors && robot.assignment === Assignment.VEHICLE && robot.vehicleId !== s.vehicleId) continue;
    return s;
  }
  return null;
}

export function playerMercInvolvedInThisCombat(ctx: EconomyContext, m: CrewMember, battle: Sector): boolean {
  const a = m.assignment;
  return (
    !m.betweenSectors &&
    a !== Assignment.IN_TRANSIT &&
    a !== Assignment.ASSIGNMENT_POW &&
    a !== Assignment.ASSIGNMENT_DEAD &&
    !m.isVehicle &&
    (!m.isRobot || robotController(ctx, m) !== null) &&
    !soldierAboardAirborneHeli(ctx, m) &&
    sameSector(m.sector, battle)
  );
}

export function playerGroupInvolvedInThisCombat(ctx: EconomyContext, g: Group, battle: Sector): boolean {
  return (
    g.player &&
    g.size !== 0 &&
    !g.betweenSectors &&
    !groupHasInTransitDeadOrPowMercs(ctx, g) &&
    (!isHelicopterGroup(ctx, g) || !ctx.state.forces.helicopterAirborne) &&
    sameSector(g.sector, battle)
  );
}

export function involvedMercs(ctx: EconomyContext, battle: Sector): CrewMember[] {
  return ctx.crew.all().filter((m) => m.life !== 0 && !m.isVehicle && playerMercInvolvedInThisCombat(ctx, m, battle));
}

export function uninvolvedMercs(ctx: EconomyContext, battle: Sector): CrewMember[] {
  return ctx.crew.all().filter((m) => m.life !== 0 && !m.isVehicle && !playerMercInvolvedInThisCombat(ctx, m, battle));
}

export function wakeUpAllMercsInSectorUnderAttack(ctx: EconomyContext, battle: Sector): void {
  for (const m of ctx.crew.all()) {
    if (m.life === 0 || m.isVehicle || !m.asleep) continue;
    if (!playerMercInvolvedInThisCombat(ctx, m, battle)) continue;
    setMercAwake(m, true);
  }
}

function noteFirstInvolvedGroup(ctx: EconomyContext, battle: Sector): void {
  const enc = ctx.state.encounter;
  const first = involvedMercs(ctx, battle)[0];
  if (!first) return;
  if (enc.battleGroup === null && getGroup(ctx, first.groupId)) enc.battleGroup = first.groupId;
  if (first.prevSectorId !== NO_PREVIOUS_SECTOR) return;
  const g = getGroup(ctx, first.groupId);
  if (g) calculateGroupRetreatSector(ctx, g);
}

function randomAmbushChance(ctx: EconomyContext, s: Sector, progress: number): number {
  const difficulty = ctx.state.options.difficulty;
  let chance = u8(
    AMBUSH_BASE_CHANCE - BEST_EXP_LEVEL + AMBUSH_CHANCE_PER_DIFFICULTY * difficulty + Math.trunc(progress / AMBUSH_PROGRESS_DIVISOR),
  );
  if (sectorInfo(ctx.state.map, s).flags & SectorFlag.ENEMY_AMBUSH_LOCATION) chance += AMBUSH_LOCATION_BONUS;
  if (ctx.state.encounter.cantRetreatInPBI) chance += CANT_RETREAT_AMBUSH_BONUS;
  return chance;
}

function playerInitiatedCode(ctx: EconomyContext, s: Sector): number {
  const enc = ctx.state.encounter;
  if (ctx.ai.numStationaryEnemiesInSector(s) !== 0) return Code.ENTERING_ENEMY_SECTOR;
  if (enc.highPotentialForAmbush) return ctx.random.chance(HIGH_POTENTIAL_AMBUSH_CHANCE) ? Code.ENEMY_AMBUSH : Code.ENEMY_ENCOUNTER;
  const mobile = numMobileEnemiesInSector(ctx, s);
  const mercs = playerMercsInSector(ctx, s);
  if (enc.autoAmbush && mobile > mercs) return Code.ENEMY_AMBUSH;
  const progress = ctx.ai.progressPercentage();
  const difficulty = ctx.state.options.difficulty;
  if (whatPlayerKnowsAboutEnemiesInSector(ctx, s) !== EnemyKnowledge.NOTHING) return Code.ENEMY_ENCOUNTER;
  if (progress < AMBUSH_PROGRESS_BASE - difficulty * AMBUSH_PROGRESS_PER_DIFFICULTY) return Code.ENEMY_ENCOUNTER;
  if (mobile <= mercs || getSectorFlagStatus(ctx.state.map, s, SectorFlag.ALREADY_VISITED)) return Code.ENEMY_ENCOUNTER;
  return ctx.preRandom.int(100) < randomAmbushChance(ctx, s, progress) ? Code.ENEMY_AMBUSH : Code.ENEMY_ENCOUNTER;
}

export function determineEncounterCode(ctx: EconomyContext, group: Group | null, s: Sector): void {
  const enc = ctx.state.encounter;
  if (!group) enc.code = Code.CREATURE_ATTACK;
  else if (group.player) {
    if (!BLOODCAT_CODES.has(enc.code)) enc.code = playerInitiatedCode(ctx, s);
  } else enc.code = townIdOfSector(ctx, s) !== BLANK_SECTOR || isThisSectorASamSector(ctx, s) ? Code.ENEMY_INVASION : Code.ENEMY_ENCOUNTER;
}

function explicitEncounterCode(ctx: EconomyContext, pbSector: Sector | null): number | null {
  if (ctx.world.hostileCiviliansPresent()) return Code.HOSTILE_CIVILIANS;
  if (ctx.world.hostileBloodcatsPresent()) return Code.HOSTILE_BLOODCATS;
  const ws = ctx.state.worldSector;
  if (ws && ws.z !== 0) {
    const info = sectorInfo(ctx.state.map, pbSector ?? ws);
    if (info.creaturesInBattle) return Code.FIGHTING_CREATURES;
    if (info.adminsInBattle || info.troopsInBattle || info.elitesInBattle) return Code.ENTERING_ENEMY_SECTOR;
    return ctx.state.encounter.explicitCode;
  }
  const code = ctx.state.encounter.code;
  return PERSISTENT_PBI_CODES.has(code) ? code : null;
}

export function persistentOptions(ctx: EconomyContext): PbiOption[] {
  const enc = ctx.state.encounter;
  const auto = ctx.state.battle.autoStart;
  const code = enc.code;
  let autoresolve: PbiOption = { choice: Choice.AUTORESOLVE, enabled: true };
  if (code === Code.ENTERING_ENEMY_SECTOR || code === Code.ENTERING_BLOODCAT_LAIR)
    autoresolve = { choice: Choice.AUTORESOLVE, enabled: false, reason: Reason.PLAYER_INITIATED_ATTACK };
  else if (code === Code.ENEMY_AMBUSH || code === Code.BLOODCAT_AMBUSH)
    autoresolve = { choice: Choice.AUTORESOLVE, enabled: false, reason: Reason.AMBUSH };
  const enter: PbiOption = auto
    ? { choice: Choice.ENTER_SECTOR, enabled: false, reason: Reason.AUTO_START }
    : { choice: Choice.ENTER_SECTOR, enabled: true };
  const blocked =
    auto || enc.cantRetreatInPBI || code === Code.ENEMY_AMBUSH || code === Code.BLOODCAT_AMBUSH || code === Code.CREATURE_ATTACK;
  let retreat: PbiOption = { choice: Choice.RETREAT, enabled: true };
  if (blocked) {
    const reason = auto
      ? Reason.AUTO_START
      : code === Code.ENEMY_AMBUSH || code === Code.BLOODCAT_AMBUSH
        ? Reason.AMBUSH
        : Reason.CANNOT_RETREAT;
    enc.cantRetreatInPBI = false;
    retreat = { choice: Choice.RETREAT, enabled: false, reason };
  }
  return [autoresolve, enter, retreat];
}

const NON_PERSISTENT_AUTORESOLVE_REASON: Readonly<Record<number, (typeof Reason)[keyof typeof Reason]>> = {
  [Code.ENTERING_ENEMY_SECTOR]: Reason.ENTERING_ENEMY_SECTOR,
  [Code.ENEMY_AMBUSH]: Reason.AMBUSH,
  [Code.FIGHTING_CREATURES]: Reason.FIGHTING_CREATURES,
  [Code.HOSTILE_CIVILIANS]: Reason.HOSTILE_CIVILIANS,
  [Code.HOSTILE_BLOODCATS]: Reason.BLOODCATS,
  [Code.BLOODCAT_AMBUSH]: Reason.BLOODCATS,
  [Code.ENTERING_BLOODCAT_LAIR]: Reason.BLOODCATS,
};

export function nonPersistentAutoresolveRefusal(explicitCode: number): string | null {
  return NON_PERSISTENT_AUTORESOLVE_REASON[explicitCode] ?? null;
}

export function nonPersistentOptions(ctx: EconomyContext): PbiOption[] {
  const reason = NON_PERSISTENT_AUTORESOLVE_REASON[ctx.state.encounter.explicitCode];
  return [
    reason ? { choice: Choice.AUTORESOLVE, enabled: false, reason } : { choice: Choice.AUTORESOLVE, enabled: true },
    { choice: Choice.ENTER_SECTOR, enabled: true },
    { choice: Choice.RETREAT, enabled: false, reason: Reason.BATTLE_IN_PROGRESS },
    { choice: Choice.CLOSE, enabled: true },
  ];
}

export interface PreBattleOpening {
  readonly sector: Sector;
  readonly options: readonly PbiOption[];
}

function openPersistent(ctx: EconomyContext, group: Group | null): Sector | null {
  const enc = ctx.state.encounter;
  const battle = ctx.state.battle;
  battle.locator = true;
  if (!BLOODCAT_CODES.has(enc.code) && !fact(ctx.state.narrative, Fact.FIRST_BATTLE_FOUGHT))
    setFactTrue(ctx.state.narrative, Fact.FIRST_BATTLE_BEING_FOUGHT);
  const tt = ctx.state.movement.tacticalTraversal;
  const world = ctx.state.worldSector;
  if (tt.active && (group?.id === tt.groupId || (world?.z ?? 0) > 0)) return null;
  enc.battleGroup = group?.id ?? null;
  if (group) battle.sector = { ...group.sector };
  return battle.sector;
}

function openNonPersistent(ctx: EconomyContext): Sector | null {
  const battle = ctx.state.battle;
  const code = explicitEncounterCode(ctx, battle.sector);
  if (code === null) {
    battle.locator = false;
    return null;
  }
  ctx.state.encounter.explicitCode = code;
  return battle.sector;
}

export function initPreBattleInterface(ctx: EconomyContext, group: Group | null, persistent: boolean): PreBattleOpening | null {
  const battle = ctx.state.battle;
  battle.persistent = persistent;
  const sector = persistent ? openPersistent(ctx, group) : openNonPersistent(ctx);
  if (!sector) return null;
  ctx.crew.checkForRobotAndIfItsControlled?.();
  wakeUpAllMercsInSectorUnderAttack(ctx, sector);
  noteFirstInvolvedGroup(ctx, sector);
  const enc = ctx.state.encounter;
  if (persistent) determineEncounterCode(ctx, group, sector);
  enc.highPotentialForAmbush = false;
  stopTimeCompression(ctx.clock, CompressionStop.BATTLE);
  if (enc.code === Code.ENEMY_ENCOUNTER) {
    const info = sectorInfo(ctx.state.map, sector);
    info.flags |= SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE;
    battle.resetAllPlayerKnowsEnemiesFlags = true;
  }
  return { sector, options: persistent ? persistentOptions(ctx) : nonPersistentOptions(ctx) };
}

export function calculateNonPersistentPbiInfo(ctx: EconomyContext): void {
  const battle = ctx.state.battle;
  const ws = ctx.state.worldSector;
  if (!ws) return;
  if (battle.locator && battle.sector && sameSector(battle.sector, ws)) return;
  const enc = ctx.state.encounter;
  enc.code = Code.NO_ENCOUNTER;
  enc.explicitCode = Code.NO_ENCOUNTER;
  if (ctx.world.hostileCiviliansPresent()) enc.explicitCode = Code.HOSTILE_CIVILIANS;
  else if (ctx.world.hostileBloodcatsPresent()) enc.explicitCode = Code.HOSTILE_BLOODCATS;
  else {
    const info = ws.z ? null : sectorInfo(ctx.state.map, ws);
    const u = ws.z ? ctx.state.map.underground.find((x) => sameSector(x.sector, ws)) : null;
    const counts = info ?? u;
    if (counts?.creaturesInBattle) enc.explicitCode = Code.FIGHTING_CREATURES;
    else if (counts && (counts.adminsInBattle || counts.troopsInBattle || counts.elitesInBattle)) {
      enc.explicitCode = Code.ENTERING_ENEMY_SECTOR;
      enc.code = Code.ENTERING_ENEMY_SECTOR;
    }
  }
  if (enc.explicitCode === Code.NO_ENCOUNTER) return;
  battle.sector = { ...ws };
  battle.locator = true;
}

function putNonSquadMercsInPlayerGroupOnSquads(ctx: EconomyContext, g: Group, exitVehicles: boolean, battle: Sector): void {
  const vehicleSquad = g.vehicle ? getFirstEmptySquad(ctx) : null;
  for (const id of [...g.members]) {
    const m = ctx.crew.get(id);
    if (!m || m.life === 0 || m.isVehicle) continue;
    if (!playerMercInvolvedInThisCombat(ctx, m, battle) || m.assignment < Assignment.ON_DUTY) continue;
    if (vehicleSquad === null) addCharacterToAnySquad(ctx, m.id);
    else if (exitVehicles) {
      takeSoldierOutOfVehicle(ctx, m.id);
      addCharacterToSquad(ctx, m.id, vehicleSquad);
    }
  }
}

export function putNonSquadMercsInBattleSectorOnSquads(ctx: EconomyContext, exitVehicles: boolean, battle: Sector): void {
  for (const g of [...ctx.state.forces.groups]) {
    if (!ctx.state.forces.groups.includes(g) || !playerGroupInvolvedInThisCombat(ctx, g, battle)) continue;
    if (isHelicopterGroup(ctx, g)) moveAllInHelicopterToFootMovementGroup(ctx);
    else putNonSquadMercsInPlayerGroupOnSquads(ctx, g, exitVehicles, battle);
  }
}

export function clearMovementForAllInvolvedPlayerGroups(ctx: EconomyContext, battle: Sector): void {
  for (const g of ctx.state.forces.groups)
    if (playerGroupInvolvedInThisCombat(ctx, g, battle)) clearMercPathsAndWaypointsForAllInGroup(ctx, g);
}

export function retreatAllInvolvedPlayerGroups(ctx: EconomyContext, battle: Sector): number[] {
  putNonSquadMercsInBattleSectorOnSquads(ctx, false, battle);
  const retreated: number[] = [];
  for (const g of [...ctx.state.forces.groups]) {
    if (!playerGroupInvolvedInThisCombat(ctx, g, battle)) continue;
    if (g.vehicle && !vehicleGroupHasPassengers(ctx, g)) continue;
    clearMercPathsAndWaypointsForAllInGroup(ctx, g);
    retreatGroupToPreviousSector(ctx, g);
    retreated.push(g.id);
  }
  return retreated;
}

export function battleSectorOf(ctx: EconomyContext): Sector | null {
  const battle = ctx.state.battle;
  if (battle.autoresolve) return battle.autoresolve.sector;
  if (battle.prompt?.kind === 'preBattle' && battle.sector) return battle.sector;
  return ctx.state.worldSector;
}
