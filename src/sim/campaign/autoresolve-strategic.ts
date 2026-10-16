// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc CalculateAutoResolveInfo, CreateAutoResolveInterface (soldier creation and the
// @src group association against the strategic counts), RemoveAutoResolveInterface (the strategic side of each record),
// @src EliminateAllEnemies; Town_Militia.cc StrategicRemoveMilitiaFromSector (with the NATIVE_KILLED loyalty of the close).
// @src See docs/19 §2.3, §2.4, §2.18, §2.19.

import { type Sector, sameSector, sectorId } from '../../content/strategic/sector-ids.ts';
import type { QueenContext } from '../strategic/ai/context.ts';
import { getNumberOfEnemiesInSector, getNumberOfStationaryEnemiesInSector } from '../strategic/ai/counts.ts';
import { calcDifficultyModifier, difficultyModifierAt, locationModifier } from '../strategic/ai/difficulty.ts';
import { processQueenCmdImplicationsOfDeath } from '../strategic/ai/queen-command.ts';
import { EnemyKilled, trackEnemiesKilled } from '../strategic/ai/status.ts';
import { recalculateSectorWeight } from '../strategic/ai/weights.ts';
import { LoyaltyEvent, MilitiaRank } from '../strategic/economy/constants.ts';
import { handleGlobalLoyaltyEvent } from '../strategic/economy/loyalty.ts';
import { strategicPromoteMilitiaInSector, strategicRemoveMilitiaFromSector } from '../strategic/economy/militia.ts';
import { countAllMilitiaInSector, militiaInSectorOfRank } from '../strategic/economy/militia-rules.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import type { AutoresolveClosePort } from '../strategic/forces/autoresolve/close.ts';
import { associateEnemiesWithStrategicGroups, type EnemyGroupCounts, fillMilitiaRanks } from '../strategic/forces/autoresolve/setup.ts';
import {
  type AutoresolveInput,
  type AutoresolveState,
  BattleStatus,
  CellFlag,
  type EnemyCellInput,
  MAX_AR_ENEMIES,
  type MercCellInput,
} from '../strategic/forces/autoresolve/state.ts';
import { EncounterCode } from '../strategic/forces/constants.ts';
import { getGroup, numEnemiesInSector, removeGroup } from '../strategic/forces/groups.ts';
import {
  calculateNextMoveIntention,
  playerGroupArrivedSafelyInSector,
  resetMovementForEnemyGroupsInLocation,
} from '../strategic/forces/movement.ts';
import { playerGroupInvolvedInThisCombat, playerMercInvolvedInThisCombat } from '../strategic/forces/pre-battle.ts';
import { setThisSectorAsPlayerControlled, townIdOfSector } from '../strategic/map/control.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import type { RandomStream } from '../tactical/combat/context.ts';
import type { TacticalContent } from '../tactical/content.ts';
import {
  type AutoresolveCreation,
  reserveTacticalSoldierForAutoresolve,
  resetMortarsOnTeamCount,
  tacticalCreateCreatureForAutoresolve,
  tacticalCreateEnemySoldierForAutoresolve,
  tacticalCreateMilitiaForAutoresolve,
} from '../tactical/creation-basic.ts';
import { createEquipmentState, sharedWeaponsDropped } from '../tactical/equipment.ts';
import { PlacementVerdict } from '../tactical/narrative/placement.ts';
import type { Soldier } from '../tactical/soldier.ts';
import { Body, SoldierClass } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { Roster } from './roster.ts';

const TIXA: Sector = { x: 9, y: 10, z: 0 };

export interface ArStrategicContext {
  readonly economy: EconomyContext;
  readonly queen: QueenContext | null;
  readonly content: TacticalContent;
  readonly roster: Roster;
}

export function involvedMercCells(ctx: ArStrategicContext, sector: Sector): MercCellInput[] {
  const cells: MercCellInput[] = [];
  for (const g of ctx.economy.state.forces.groups) {
    if (!playerGroupInvolvedInThisCombat(ctx.economy, g, sector)) continue;
    for (const id of g.members) {
      const m = ctx.roster.get(id);
      if (!m || !playerMercInvolvedInThisCombat(ctx.economy, m, sector)) continue;
      cells.push({ soldier: m.soldier, epc: m.isEpc, robot: m.isRobot, groupId: m.groupId });
    }
  }
  return cells;
}

function inEnemyHeldTixa(ctx: ArStrategicContext): boolean {
  const world = ctx.economy.state.worldSector;
  return world !== null && sameSector(world, TIXA) && ctx.economy.state.map.elements[TIXA.x + TIXA.y * 18]?.enemyControlled === true;
}

export interface CreationStreams {
  readonly rng: RandomStream;
  readonly pre: RandomStream;
}

export function autoresolveCreation(ctx: ArStrategicContext, sector: Sector, streams?: CreationStreams): AutoresolveCreation {
  const state = ctx.economy.state;
  const equipment = createEquipmentState(ctx.content.items, sharedWeaponsDropped(state.status, ctx.content.items));
  equipment.progress = state.status.highestProgress;
  equipment.gunNut = state.options.gunNut;
  equipment.sciFi = state.options.sciFi;
  equipment.inEnemyHeldTixa = inEnemyHeldTixa(ctx);
  equipment.autoResolveActive = true;
  const townId = townIdOfSector(ctx.economy, sector);
  const queen = ctx.queen;
  const difficultyModifier = (soldierClass: number) =>
    queen
      ? difficultyModifierAt(queen, soldierClass, sector)
      : calcDifficultyModifier(
          {
            difficulty: state.options.difficulty,
            highestProgress: state.status.highestProgress,
            predictedMineIncome: 0,
            battleSector: sector,
            battleSectorTownId: townId,
          },
          soldierClass,
        );
  return {
    create: {
      rng: streams?.rng ?? state.rng,
      content: ctx.content,
      options: { gunNut: state.options.gunNut, bloodAndGore: true },
      equipment,
      campaign: { difficultyModifier: difficultyModifier(SoldierClass.ARMY), progress: state.status.highestProgress },
    },
    population: {
      difficultyModifier,
      difficulty: state.options.difficulty,
      bloodcatLair: false,
      locationModifier: locationModifier(townId, sector),
      autoResolveActive: true,
      profileHere: () => false,
      iceCreamTruckWithheld: () => false,
      civilianPlacement: () => PlacementVerdict.CREATE,
    },
  };
}

function createMilitia(ctx: ArStrategicContext, c: AutoresolveCreation, sector: Sector, pre: RandomStream): Soldier[] {
  const civs = countAllMilitiaInSector(ctx.economy, sector);
  const ranks = fillMilitiaRanks(
    pre,
    {
      green: militiaInSectorOfRank(ctx.economy, sector, MilitiaRank.GREEN),
      regular: militiaInSectorOfRank(ctx.economy, sector, MilitiaRank.REGULAR),
      elite: militiaInSectorOfRank(ctx.economy, sector, MilitiaRank.ELITE),
    },
    civs,
  );
  const militia: Soldier[] = [];
  for (let i = 0; i < civs; i++) {
    resetMortarsOnTeamCount(c);
    const soldierClass =
      i < ranks.elite
        ? SoldierClass.ELITE_MILITIA
        : i < ranks.elite + ranks.regular
          ? SoldierClass.REG_MILITIA
          : SoldierClass.GREEN_MILITIA;
    const s = tacticalCreateMilitiaForAutoresolve(c, soldierClass);
    if (s) militia.push(s);
  }
  return militia;
}

interface EnemySource {
  readonly creation: AutoresolveCreation;
  readonly tactical: TacticalState | null;
  readonly copyTactical: boolean;
}

function createEnemy(source: EnemySource, soldierClass: number): Soldier | null {
  const copy = source.copyTactical && source.tactical ? reserveTacticalSoldierForAutoresolve(source.tactical, soldierClass) : null;
  return copy ?? tacticalCreateEnemySoldierForAutoresolve(source.creation, soldierClass);
}

export interface CreatureComposition {
  readonly youngMales: number;
  readonly youngFemales: number;
  readonly adultMales: number;
  readonly adultFemales: number;
}

const NO_CREATURES: CreatureComposition = { youngMales: 0, youngFemales: 0, adultMales: 0, adultFemales: 0 };

function createCreature(source: EnemySource, bodyType: number): Soldier | null {
  const copy = source.copyTactical && source.tactical ? reserveTacticalSoldierForAutoresolve(source.tactical, SoldierClass.CREATURE) : null;
  return copy ?? tacticalCreateCreatureForAutoresolve(source.creation, bodyType);
}

function createCreatures(source: EnemySource, c: CreatureComposition): EnemyCellInput[] {
  const order = [
    [Body.ADULTFEMALEMONSTER, c.adultFemales, CellFlag.AF_CREATURE],
    [Body.AM_MONSTER, c.adultMales, CellFlag.AM_CREATURE],
    [Body.YAF_MONSTER, c.youngFemales, CellFlag.YF_CREATURE],
    [Body.YAM_MONSTER, c.youngMales, CellFlag.YM_CREATURE],
  ] as const;
  const creatures: EnemyCellInput[] = [];
  for (const [body, count, cellFlags] of order)
    for (let i = 0; i < count && creatures.length < MAX_AR_ENEMIES; i++) {
      const s = createCreature(source, body);
      if (s) creatures.push({ soldier: s, cellFlags });
    }
  return creatures;
}

function createEnemies(ctx: ArStrategicContext, source: EnemySource, sector: Sector): EnemyCellInput[] {
  const totals = getNumberOfEnemiesInSector(ctx.economy, sector);
  const order = [
    [SoldierClass.ELITE, totals.elites],
    [SoldierClass.ARMY, totals.troops],
    [SoldierClass.ADMINISTRATOR, totals.admins],
  ] as const;
  const enemies: EnemyCellInput[] = [];
  for (const [soldierClass, count] of order)
    for (let i = 0; i < count && enemies.length < MAX_AR_ENEMIES; i++) {
      const s = createEnemy(source, soldierClass);
      if (s) enemies.push({ soldier: s });
    }
  return enemies;
}

export function enemyGroupCounts(ctx: ArStrategicContext, sector: Sector): EnemyGroupCounts[] {
  return ctx.economy.state.forces.groups
    .filter((g) => !g.player && !g.vehicle && g.enemy && sameSector(g.sector, sector))
    .map((g) => ({ id: g.id, admins: g.enemy?.numAdmins ?? 0, troops: g.enemy?.numTroops ?? 0, elites: g.enemy?.numElites ?? 0 }));
}

export interface AutoresolveSetupOptions {
  readonly sector: Sector;
  readonly encounter: number;
  readonly persistent: boolean;
  readonly tactical: TacticalState | null;
  readonly creatures?: CreatureComposition;
  readonly streams?: CreationStreams;
}

export function buildAutoresolveInput(ctx: ArStrategicContext, o: AutoresolveSetupOptions): AutoresolveInput {
  const mercs = involvedMercCells(ctx, o.sector);
  const creation = autoresolveCreation(ctx, o.sector, o.streams);
  const militia = createMilitia(ctx, creation, o.sector, o.streams?.pre ?? ctx.economy.state.pre);
  const source = { creation, tactical: o.tactical, copyTactical: !o.persistent };
  const enemies =
    o.encounter === EncounterCode.CREATURE_ATTACK
      ? createCreatures(source, o.creatures ?? NO_CREATURES)
      : createEnemies(ctx, source, o.sector);
  return { sector: sectorId(o.sector), encounter: o.encounter, mercs, militia, enemies };
}

export function associateWithStrategicGroups(ctx: ArStrategicContext, ar: AutoresolveState, sector: Sector): void {
  associateEnemiesWithStrategicGroups(
    ar.enemies,
    getNumberOfEnemiesInSector(ctx.economy, sector),
    getNumberOfStationaryEnemiesInSector(ctx.economy, sector),
    enemyGroupCounts(ctx, sector),
  );
}

export function eliminateAllEnemies(ctx: ArStrategicContext, sector: Sector, ar: AutoresolveState | null): void {
  const economy = ctx.economy;
  const battle = economy.state.battle;
  battle.locator = false;
  if (!ar || ar.status !== BattleStatus.IN_PROGRESS) {
    const info = sectorInfo(economy.state.map, sector);
    info.numTroops = 0;
    info.numElites = 0;
    info.numAdmins = 0;
    info.numCreatures = 0;
    for (const g of [...economy.state.forces.groups]) {
      if (g.player || !sameSector(g.sector, sector) || !economy.state.forces.groups.includes(g)) continue;
      economy.ai.removeGroupFromLists(g);
      removeGroup(economy, g);
    }
    const battleGroup = getGroup(economy, economy.state.encounter.battleGroup ?? -1);
    if (battleGroup) calculateNextMoveIntention(economy, battleGroup);
    setThisSectorAsPlayerControlled(economy, sector, true);
    recalculateSectorWeight(economy, sectorId(sector));
  }
  if (ar) {
    for (const c of ar.enemies) c.soldier.life = 0;
    ar.aliveEnemies = 0;
  }
  economy.state.encounter.battleGroup = null;
}

export interface CloseHooks {
  mercDied(soldier: Soldier): void;
  mercCaptured(soldier: Soldier): void;
  endCaptureSequence(): void;
}

export function strategicClosePort(ctx: ArStrategicContext, ar: AutoresolveState, sector: Sector, hooks: CloseHooks): AutoresolveClosePort {
  const economy = ctx.economy;
  const queen = ctx.queen;
  return {
    militia: {
      count: (rank) => militiaInSectorOfRank(economy, sector, rank),
      remove: (rank) => {
        strategicRemoveMilitiaFromSector(economy, sector, rank, 1);
        handleGlobalLoyaltyEvent(economy, LoyaltyEvent.NATIVE_KILLED, sector);
      },
      promote: (rank) => strategicPromoteMilitiaInSector(economy, sector, rank, 1),
    },
    enemiesLeftInSector: () => numEnemiesInSector(economy, sector),
    mercDied: (s) => hooks.mercDied(s),
    mercCaptured: (s) => hooks.mercCaptured(s),
    playerGroupArrivedSafely: (groupId, checkNpcs) => {
      const g = getGroup(economy, groupId);
      if (g) playerGroupArrivedSafelyInSector(economy, g, checkNpcs);
    },
    endCaptureSequence: () => hooks.endCaptureSequence(),
    enemyKilled: (enemy, groupId) => {
      trackEnemiesKilled(economy.state.status, EnemyKilled.IN_AUTO_RESOLVE, enemy.soldierClass);
      handleGlobalLoyaltyEvent(economy, LoyaltyEvent.ENEMY_KILLED, sector);
      if (!queen) return;
      const dead = {
        profile: enemy.profile,
        team: enemy.team,
        neutral: enemy.neutral,
        groupId,
        soldierClass: enemy.soldierClass,
        body: enemy.bodyType,
        sector,
      };
      processQueenCmdImplicationsOfDeath(queen, dead, sectorId(sector));
    },
    eliminateAllEnemies: () => eliminateAllEnemies(ctx, sector, ar),
    resetEnemyMovement: () => resetMovementForEnemyGroupsInLocation(economy, sector),
  };
}
