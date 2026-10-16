// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Queen_Command.cc PrepareEnemyForSectorBattle, PrepareEnemyForUndergroundBattle,
// @src ProcessQueenCmdImplicationsOfDeath, AddPossiblePendingEnemiesToBattle, AddEnemiesToBattle (class roll and facing),
// @src EndTacticalBattleForEnemy. See docs/17 §10.

import { isValidSector, type Sector, sameSector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { Direction } from '../../../content/world/grid.ts';
import { i8, u8 } from '../../../core/int.ts';
import { Body, SoldierClass, Team } from '../../tactical/soldier.ts';
import { InsertionCode, SectorFlag } from '../forces/constants.ts';
import { handleArrivalOfReinforcements } from '../forces/encounters.ts';
import { type Group, getGroup, numEnemiesInSector, removeGroup, removeGroupWaypoints } from '../forces/groups.ts';
import type { RollSource } from '../forces/ports.ts';
import { findUndergroundSector, sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { factValue } from '../narrative/facts.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEventUsingSeconds, deleteAllStrategicEventsOfType } from '../time/event-queue.ts';
import { ENEMY_TEAM_SLOTS, Profile, SEC } from './constants.ts';
import type { QueenContext } from './context.ts';
import { recalculateGroupWeight, recalculateSectorWeight } from './weights.ts';

const CHECK_IF_MINE_CLEARED_DELAY_SECONDS = 15;
const J9: Sector = sectorFromId(SEC.J9);

export interface EnemyClassCounts {
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

export const BattlePlanKind = { NONE: 'none', UNDERGROUND: 'underground', REINFORCEMENTS: 'reinforcements', DEFENCE: 'defence' } as const;
export type BattlePlanKind = (typeof BattlePlanKind)[keyof typeof BattlePlanKind];

export interface SectorBattlePlan {
  readonly kind: BattlePlanKind;
  readonly defence: EnemyClassCounts;
  readonly stationary: number;
  readonly reinforcementGroups: readonly number[];
}

export interface PrepareOptions {
  readonly freeEnemySlots?: number;
  readonly mapEnemyPlacements?: EnemyClassCounts;
}

const NOTHING: EnemyClassCounts = { admins: 0, troops: 0, elites: 0 };

function plan(kind: BattlePlanKind, defence = NOTHING, stationary = 0, reinforcementGroups: readonly number[] = []): SectorBattlePlan {
  return { kind, defence, stationary, reinforcementGroups };
}

function prepareUnderground(q: QueenContext, world: Sector): SectorBattlePlan {
  const u = findUndergroundSector(q.state.map, world);
  if (!u || u8(u.numAdmins + u.numTroops + u.numElites) === 0) return plan(BattlePlanKind.NONE);
  u.adminsInBattle = u8(u.adminsInBattle + u8(u.numAdmins - u.adminsInBattle));
  u.troopsInBattle = u8(u.troopsInBattle + u8(u.numTroops - u.troopsInBattle));
  u.elitesInBattle = u8(u.elitesInBattle + u8(u.numElites - u.elitesInBattle));
  return plan(BattlePlanKind.UNDERGROUND, { admins: u.numAdmins, troops: u.numTroops, elites: u.numElites });
}

function prepareEnemyInstigated(q: QueenContext, bg: Group): SectorBattlePlan {
  const groups = [bg.id];
  handleArrivalOfReinforcements(q, bg);
  for (const g of [...q.state.forces.groups]) {
    if (g === bg || g.player || g.vehicle || !g.enemy || !sameSector(g.sector, bg.sector)) continue;
    if (g.enemy.adminsInBattle || g.enemy.troopsInBattle || g.enemy.elitesInBattle) continue;
    groups.push(g.id);
    handleArrivalOfReinforcements(q, g);
  }
  return plan(BattlePlanKind.REINFORCEMENTS, NOTHING, 0, groups);
}

interface Totals {
  admins: number;
  troops: number;
  elites: number;
}

function takeGroupMembers(g: Group, totals: Totals, slots: { n: number }, q: QueenContext): void {
  const e = g.enemy;
  if (!e) return;
  const take = (num: number, inBattle: number): number => {
    let n = u8(num - inBattle);
    slots.n -= n;
    if (slots.n < 0) {
      n = u8(n + slots.n);
      slots.n = 0;
      q.state.encounter.pendingEnemies = true;
    }
    return n;
  };
  if (slots.n > 0) {
    const n = take(e.numAdmins, e.adminsInBattle);
    e.adminsInBattle = u8(e.adminsInBattle + n);
    totals.admins += n;
  }
  if (slots.n > 0) {
    const n = take(e.numTroops, e.troopsInBattle);
    e.troopsInBattle = u8(e.troopsInBattle + n);
    totals.troops += n;
  }
  if (slots.n > 0) {
    const n = take(e.numElites, e.elitesInBattle);
    e.elitesInBattle = u8(e.elitesInBattle + n);
    totals.elites += n;
  }
}

export function prepareEnemyForSectorBattle(q: QueenContext, options: PrepareOptions = {}): SectorBattlePlan {
  const enc = q.state.encounter;
  enc.pendingEnemies = false;
  const world = q.state.worldSector;
  if (!world) return plan(BattlePlanKind.NONE);
  if (world.z > 0) return prepareUnderground(q, world);
  const bg = enc.battleGroup === null ? undefined : getGroup(q, enc.battleGroup);
  if (bg && !bg.player) return prepareEnemyInstigated(q, bg);
  if (numEnemiesInSector(q, world) > ENEMY_TEAM_SLOTS) enc.pendingEnemies = true;
  const si = sectorInfo(q.state.map, world);
  const totals: Totals = { admins: 0, troops: 0, elites: 0 };
  if (si.flags & SectorFlag.USE_MAP_SETTINGS) {
    const placed = options.mapEnemyPlacements ?? NOTHING;
    Object.assign(totals, placed);
    si.numAdmins = u8(placed.admins);
    si.numTroops = u8(placed.troops);
    si.numElites = u8(placed.elites);
    si.adminsInBattle = 0;
    si.troopsInBattle = 0;
    si.elitesInBattle = 0;
  } else {
    totals.admins = si.numAdmins - si.adminsInBattle;
    totals.troops = si.numTroops - si.troopsInBattle;
    totals.elites = si.numElites - si.elitesInBattle;
  }
  const stationary = u8(totals.admins + totals.troops + totals.elites);
  if (stationary > ENEMY_TEAM_SLOTS) {
    totals.admins = Math.min(totals.admins, ENEMY_TEAM_SLOTS);
    totals.troops = Math.min(totals.troops, ENEMY_TEAM_SLOTS - totals.admins);
    totals.elites = Math.min(totals.elites, ENEMY_TEAM_SLOTS - totals.admins + totals.troops);
  }
  si.adminsInBattle = u8(si.adminsInBattle + totals.admins);
  si.troopsInBattle = u8(si.troopsInBattle + totals.troops);
  si.elitesInBattle = u8(si.elitesInBattle + totals.elites);
  const slots = { n: (options.freeEnemySlots ?? ENEMY_TEAM_SLOTS) - (totals.admins + totals.troops + totals.elites) };
  for (const g of q.state.forces.groups) {
    if (slots.n === 0) break;
    if (g.vehicle || !sameSector(g.sector, world)) continue;
    if (!g.player) takeGroupMembers(g, totals, slots, q);
    else if (!g.betweenSectors && g.members.length > 0) removeGroupWaypoints(g);
  }
  if (totals.admins === 0 && totals.troops === 0 && totals.elites === 0) return plan(BattlePlanKind.NONE, NOTHING, stationary);
  return plan(BattlePlanKind.DEFENCE, { admins: u8(totals.admins), troops: u8(totals.troops), elites: u8(totals.elites) }, stationary);
}

export interface EnemySoldierSlot {
  readonly soldierClass: number;
  groupId: number;
}

function quotaField(soldierClass: number): 'admins' | 'troops' | 'elites' | null {
  if (soldierClass === SoldierClass.ADMINISTRATOR) return 'admins';
  if (soldierClass === SoldierClass.ARMY) return 'troops';
  if (soldierClass === SoldierClass.ELITE) return 'elites';
  return null;
}

export function assignEnemyGroupIds(q: QueenContext, battle: SectorBattlePlan, soldiers: readonly EnemySoldierSlot[]): void {
  const world = q.state.worldSector;
  if (world?.z !== 0) return;
  let slots = ENEMY_TEAM_SLOTS - battle.stationary;
  for (const g of q.state.forces.groups) {
    if (slots === 0) break;
    if (g.player || g.vehicle || !g.enemy || !sameSector(g.sector, world)) continue;
    let n = g.size;
    const quota = { admins: g.enemy.adminsInBattle, troops: g.enemy.troopsInBattle, elites: g.enemy.elitesInBattle };
    for (const s of soldiers) {
      if (n === 0 || slots === 0) break;
      if (s.groupId !== 0) continue;
      const field = quotaField(s.soldierClass);
      if (!field || quota[field] === 0) continue;
      quota[field]--;
      n--;
      slots--;
      s.groupId = g.id;
    }
  }
}

export interface DeadEnemy {
  readonly profile: number;
  readonly team: number;
  readonly neutral: boolean;
  readonly groupId: number;
  readonly soldierClass: number;
  readonly body: number;
  readonly sector: Sector;
}

type Counted = { numAdmins: number; numTroops: number; numElites: number; numCreatures: number };
type InBattle = { adminsInBattle: number; troopsInBattle: number; elitesInBattle: number; creaturesInBattle: number };

function decrementClass(record: Counted & InBattle, soldierClass: number): void {
  const dec = (count: keyof Counted, battle: keyof InBattle) => {
    if (record[count]) record[count]--;
    if (record[battle]) record[battle]--;
  };
  if (soldierClass === SoldierClass.ADMINISTRATOR) dec('numAdmins', 'adminsInBattle');
  else if (soldierClass === SoldierClass.ARMY) dec('numTroops', 'troopsInBattle');
  else if (soldierClass === SoldierClass.ELITE) dec('numElites', 'elitesInBattle');
  else if (soldierClass === SoldierClass.CREATURE) dec('numCreatures', 'creaturesInBattle');
}

function profiledEliteDied(q: QueenContext, dead: DeadEnemy): void {
  if (dead.profile !== Profile.MIKE && dead.profile !== Profile.IGGY) return;
  if (dead.profile === Profile.IGGY && factValue(q.state.narrative, Fact.IGGY_AVAILABLE_TO_ARMY) === 0) return;
  const record = dead.sector.z ? findUndergroundSector(q.state.map, dead.sector) : sectorInfo(q.state.map, dead.sector);
  if (!record) return;
  if (record.numElites) record.numElites--;
  if (record.elitesInBattle) record.elitesInBattle--;
}

function groupMemberDied(q: QueenContext, dead: DeadEnemy): void {
  const g = getGroup(q, dead.groupId);
  if (!g || g.player || !g.enemy) return;
  const e = g.enemy;
  if (dead.soldierClass === SoldierClass.ELITE) {
    if (e.numElites) {
      e.numElites--;
      if (e.elitesInBattle) e.elitesInBattle--;
    }
  } else if (dead.soldierClass === SoldierClass.ARMY) {
    if (e.numTroops) {
      e.numTroops--;
      if (e.troopsInBattle) e.troopsInBattle--;
    }
  } else if (dead.soldierClass === SoldierClass.ADMINISTRATOR) {
    if (e.numAdmins) e.numAdmins--;
    if (e.adminsInBattle) e.adminsInBattle--;
  }
  finishGroupDeath(q, g);
}

function finishGroupDeath(q: QueenContext, g: Group): void {
  if (g.size) g.size--;
  recalculateGroupWeight(q, g);
  if (!g.size) removeGroup(q, g);
}

function surfaceDefenderDied(q: QueenContext, dead: DeadEnemy, autoResolveSector: number | null): void {
  const si = sectorInfo(q.state.map, autoResolveSector === null ? dead.sector : sectorFromId(autoResolveSector));
  if (dead.soldierClass === SoldierClass.CREATURE && dead.body === Body.BLOODCAT) {
    if (si.bloodCats) si.bloodCats = i8(si.bloodCats - 1);
  } else decrementClass(si, dead.soldierClass);
  recalculateSectorWeight(q, sectorId(dead.sector));
}

function undergroundDefenderDied(q: QueenContext, dead: DeadEnemy, world: Sector): void {
  const u = findUndergroundSector(q.state.map, world);
  if (!u) return;
  decrementClass(u, dead.soldierClass);
  if (dead.soldierClass !== SoldierClass.CREATURE) return;
  if (!u.numCreatures && !sameSector(world, J9)) deleteAllStrategicEventsOfType(q.state.queue, EventKind.CREATURE_ATTACK);
  addStrategicEventUsingSeconds(
    q.state.queue,
    EventKind.CHECK_IF_MINE_CLEARED,
    q.state.clock.seconds + CHECK_IF_MINE_CLEARED_DELAY_SECONDS,
    0,
  );
  if (dead.body === Body.QUEENMONSTER) q.queenHooks.creatureQuestEnded();
}

export function processQueenCmdImplicationsOfDeath(q: QueenContext, dead: DeadEnemy, autoResolveSector: number | null = null): void {
  profiledEliteDied(q, dead);
  if (dead.neutral || (dead.team !== Team.ENEMY && dead.team !== Team.CREATURE)) return;
  if (dead.groupId) {
    groupMemberDied(q, dead);
    return;
  }
  const world = q.state.worldSector;
  if (!world?.z || autoResolveSector !== null) surfaceDefenderDied(q, dead, autoResolveSector);
  else undergroundDefenderDied(q, dead, world);
}

export interface PendingArrival {
  readonly groupId: number;
  readonly insertionCode: number;
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

function entryCode(here: Sector, from: Sector): number {
  if (here.x < from.x) return InsertionCode.EAST;
  if (here.x > from.x) return InsertionCode.WEST;
  if (here.y < from.y) return InsertionCode.SOUTH;
  if (here.y > from.y) return InsertionCode.NORTH;
  return InsertionCode.NORTH;
}

export function insertionCodeForArrivingGroup(g: Group): number {
  if (isValidSector(g.prev)) return entryCode(g.sector, g.prev);
  if (isValidSector(g.next)) return entryCode(g.sector, g.next);
  return InsertionCode.NORTH;
}

export function addPossiblePendingEnemiesToBattle(q: QueenContext, freeEnemySlots: number): PendingArrival[] {
  const enc = q.state.encounter;
  const arrivals: PendingArrival[] = [];
  if (!enc.pendingEnemies) return arrivals;
  const world = q.state.worldSector;
  let slots = u8(freeEnemySlots);
  for (const g of q.state.forces.groups) {
    if (slots === 0) break;
    if (g.player || g.vehicle || !g.enemy || !world || world.z !== 0 || !sameSector(g.sector, world)) continue;
    const e = g.enemy;
    const added = { admins: 0, troops: 0, elites: 0 };
    let available = u8(g.size - e.elitesInBattle - e.troopsInBattle - e.adminsInBattle);
    while (available !== 0 && slots !== 0) {
      if (e.troopsInBattle < e.numTroops) {
        e.troopsInBattle++;
        added.troops++;
      } else if (e.elitesInBattle < e.numElites) {
        e.elitesInBattle++;
        added.elites++;
      } else if (e.adminsInBattle < e.numAdmins) {
        e.adminsInBattle++;
        added.admins++;
      } else throw new Error('AddPossiblePendingEnemiesToBattle: group counters do not add up');
      available--;
      slots--;
    }
    if (added.admins || added.troops || added.elites)
      arrivals.push({ groupId: g.id, insertionCode: insertionCodeForArrivingGroup(g), ...added });
  }
  if (slots !== 0) enc.pendingEnemies = false;
  return arrivals;
}

export const ARRIVAL_FACING: Readonly<Record<number, number>> = {
  [InsertionCode.NORTH]: Direction.SOUTHEAST,
  [InsertionCode.EAST]: Direction.SOUTHWEST,
  [InsertionCode.SOUTH]: Direction.NORTHWEST,
  [InsertionCode.WEST]: Direction.NORTHEAST,
};

export interface ArrivingClasses {
  admins: number;
  troops: number;
  elites: number;
}

export function nextArrivingSoldierClass(rolls: RollSource, left: ArrivingClasses): number {
  const total = left.admins + left.troops + left.elites;
  const roll = rolls.int(total);
  if (roll < left.elites) {
    left.elites--;
    return SoldierClass.ELITE;
  }
  if (roll < left.elites + left.troops) {
    left.troops--;
    return SoldierClass.ARMY;
  }
  left.admins--;
  return SoldierClass.ADMINISTRATOR;
}

export interface TeamsStillFighting {
  readonly militia: boolean;
  readonly enemies: boolean;
  readonly creatures: boolean;
}

export function endTacticalBattleForEnemy(q: QueenContext, fighting: TeamsStillFighting): boolean {
  const world = q.state.worldSector;
  if (!world || world.z < 0) return false;
  if (world.z === 0) {
    const si = sectorInfo(q.state.map, world);
    si.adminsInBattle = 0;
    si.troopsInBattle = 0;
    si.elitesInBattle = 0;
    si.numCreatures = 0;
    si.creaturesInBattle = 0;
  } else {
    const u = findUndergroundSector(q.state.map, world);
    if (u) {
      u.adminsInBattle = 0;
      u.troopsInBattle = 0;
      u.elitesInBattle = 0;
    }
  }
  q.state.narrative.profiledEnemyAdded = false;
  for (const g of q.state.forces.groups) {
    if (g.player || g.vehicle || !g.enemy || !sameSector(g.sector, world)) continue;
    g.enemy.troopsInBattle = 0;
    g.enemy.elitesInBattle = 0;
    g.enemy.adminsInBattle = 0;
  }
  return fighting.militia && (fighting.enemies || fighting.creatures);
}
