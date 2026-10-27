// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc SetCurrentWorldSector, EnterSector, PrepareLoadedSector, UpdateMercsInSector,
// @src HandleDefiniteUnloadingOfWorld, CheckAndHandleUnloadingOfCurrentWorld, HandlePotentialBringUpAutoresolveToFinishBattle,
// @src CanGoToTacticalInSector; Tactical/Tactical_Save.cc LoadCurrentSectorsInformationFromTempItemsFile,
// @src SaveCurrentSectorsInformationToTempItemFile; Enemy_Soldier_Save.cc NewWayOfLoadingEnemySoldiersFromTempFile;
// @src Strategic/Queen_Command.cc PrepareEnemyForSectorBattle (tactical side), AddPossiblePendingEnemiesToBattle;
// @src Tactical/Militia_Control.cc PrepareMilitiaForTactical, ResetMilitia; Overhead.cc HandleNPCTeamMemberDeath
// @src (strategic part); Town_Militia.cc HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap; StrategicMap.cc
// @src HandleRPCDescriptionOfSector; TacticalAI/Knowledge.cc CallAvailableTeamEnemiesToAmbush; TileEngine/WorldDef.cc
// @src TrashWorld (HandleFirstMeanWhileSetUpWithTrashWorld); StrategicMap.cc EnterSector (SetupProfileInsertionDataForCivilians,
// @src HandleQuestCodeOnSectorEntry), HandleDefiniteUnloadingOfWorld (HandleQuestCodeOnSectorExit,
// @src UpdateSoldierPointerDataIntoProfile), PrepareLoadedSector (AddProfilesNotUsingProfileInsertionData,
// @src AddProfilesUsingProfileInsertionData, PostSchedules); Overhead.cc HandleNPCTeamMemberDeath (the creature queen's rewards);
// @src WorldDef.cc TrashWorld (DestroyAllSchedules); SaveLoadGame.cc LoadSavedGame (PostSchedules). See docs/16 §5,
// @src docs/25 §4.5–§4.6, §5.2, §5.6.

import type { MapDoor } from '../../content/formats/map.ts';
import { LoadingScreen } from '../../content/strategic/loading-screens.ts';
import {
  parseSectorString,
  type Sector,
  sameSector,
  sectorFromId,
  sectorId,
  sectorShortString,
} from '../../content/strategic/sector-ids.ts';
import { sectorMapPath } from '../../content/strategic/sector-maps.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import type { CommandResult } from '../command.ts';
import type { LoadScreenView, SimEvent } from '../events.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import type { QueenContext } from '../strategic/ai/context.ts';
import { getNumberOfEnemiesInSector } from '../strategic/ai/counts.ts';
import { calcDifficultyModifier, difficultyModifierAt, locationModifier, queenProgress } from '../strategic/ai/difficulty.ts';
import { handleFirstMeanwhileSetUpWithTrashWorld, INTERROGATION_SECTOR, meanwhileScheduledIn } from '../strategic/ai/meanwhile.ts';
import {
  ARRIVAL_FACING,
  addPossiblePendingEnemiesToBattle,
  assignEnemyGroupIds,
  BattlePlanKind,
  endTacticalBattleForEnemy,
  prepareEnemyForSectorBattle as planEnemies,
  processQueenCmdImplicationsOfDeath,
} from '../strategic/ai/queen-command.ts';
import { EnemyKilled, recordPlayerKill, trackEnemiesKilled } from '../strategic/ai/status.ts';
import { CreatureBattleCode } from '../strategic/creatures/creatures.ts';
import { Assignment as EconomyAssignment, LoyaltyEvent, MoraleEvent } from '../strategic/economy/constants.ts';
import { handleGlobalLoyaltyEvent, incrementTownLoyaltyEverywhere } from '../strategic/economy/loyalty.ts';
import { addDeadArmsDealerItemsToWorld } from '../strategic/economy/merchants/death.ts';
import {
  handleMilitiaStatusBeforeLoadingNewMap,
  soldierClassToMilitiaRank,
  strategicRemoveMilitiaFromSector,
} from '../strategic/economy/militia.ts';
import { mineIdForSector } from '../strategic/economy/mine-status.ts';
import { areThereMinersInsideThisMine } from '../strategic/economy/mines.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { EncounterCode, InsertionCode, SectorFlag } from '../strategic/forces/constants.ts';
import { countAllMilitiaInSector, numHostilesInSector } from '../strategic/forces/groups.ts';
import { handleHelicopterOnGround } from '../strategic/forces/helicopter.ts';
import type { StrategicContext, TacticalWorldPort } from '../strategic/forces/ports.ts';
import { calculateNonPersistentPbiInfo } from '../strategic/forces/pre-battle.ts';
import { townIdOfSector } from '../strategic/map/control.ts';
import { loadScreenId } from '../strategic/map/loading-screen.ts';
import {
  findUndergroundSector,
  getSectorFlagStatus,
  isSectorDesert,
  resetSectorFlag,
  sectorInfo,
  setSectorFlag,
  setVisibleItemCount,
} from '../strategic/map/sectors.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../strategic/narrative/facts.ts';
import { okayToUpgradeEliteToSpecialProfiledEnemy } from '../strategic/narrative/profiled-enemies.ts';
import { ExperienceBonus } from '../strategic/narrative/rewards.ts';
import type { SectorPosition } from '../strategic/state.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { timeOfDayAmbientLightLevel } from '../strategic/time/environment.ts';
import { setGameTimeCompressionLevel, unPauseGame, worldDay, worldHour } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { openableStatuses } from '../tactical/doors.ts';
import { beginMapEdgepointSearch, chooseMapEdgepoint, endMapEdgepointSearch, loadMapEdgepoints } from '../tactical/edgepoints.ts';
import { sharedWeaponsDropped } from '../tactical/equipment.ts';
import {
  addCreaturesToBattle,
  addEnemiesToBattle,
  addSoldierInitListBloodcats,
  addSoldierInitListCreatures,
  addSoldierInitListEnemyDefenceSoldiers,
  addSoldierInitListMilitia,
  addSoldierInitListTeamToWorld,
  buildSoldierInitList,
  evaluateDeathEffectsToSoldierInitList,
  freeSoldierSlots,
  type PopulationEnv,
  stripEnemyDetailedPlacements,
} from '../tactical/init-list.ts';
import { CENTER_GRIDNO, Insertion, type InsertionContext, type InsertionOrder, updateMercInSector } from '../tactical/insertion.ts';
import { handleAllReachableItemsInTheSector } from '../tactical/item-reachability.ts';
import { lightSpriteRenderAll } from '../tactical/lighting/lighting.ts';
import {
  civilianPlacementOverride,
  iceCreamTruckWithheld,
  type PlacementNarrative,
  PlacementVerdict,
  profilePlacementAllowed,
} from '../tactical/narrative/placement.ts';
import {
  addProfilesNotUsingProfileInsertionData,
  addProfilesUsingProfileInsertionData,
  type ProfileInsertionHooks,
  setupProfileInsertionDataForCivilians,
  updateSoldierPointerDataIntoProfile,
} from '../tactical/narrative/profile-insertion.ts';
import { destroyAllSchedules, postSchedules } from '../tactical/narrative/schedules.ts';
import { type Refusal, refuse, refused } from '../tactical/refusal.ts';
import { hostileBloodcatsPresent, removeSoldierFromTacticalSector } from '../tactical/sector-presence.ts';
import { Body, OKLIFE, Side, type Soldier, SoldierClass, Team } from '../tactical/soldier.ts';
import { type RealtimeClock, type TacticalState, teamMembers, WaitForMercs } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { addItemToPool, loadWorldItemsFromMap, Visibility } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { SectorFlowState } from './flow-state.ts';
import { MoraleEvent as CampaignMoraleEvent } from './morale.ts';
import {
  GUIDE_DESCRIPTION_COUNTDOWN_RANGE,
  guideDescriptionFor,
  handleRpcDescription,
  startGuideCountdown,
} from './narrative/guide-description.ts';
import { campaignNarrativePort, campaignScheduleClock } from './narrative-port.ts';
import { type Roster, type RosterMerc, registeredInTactical } from './roster.ts';
import {
  applyPreservedEnemyRecord,
  captureDoorStatus,
  captureLights,
  captureRevealed,
  captureSmoke,
  captureWorldItems,
  emptySectorDiff,
  loadPreservedCivilians,
  preserveSoldiers,
  restoreCorpses,
  restoreDoorStatus,
  restoreLights,
  restoreMapChanges,
  restoreOpenables,
  restoreRevealed,
  restoreSmoke,
  restoreWorldItems,
  type SectorDiff,
  sectorKey,
  visibleItemCount,
} from './sector-diff.ts';
import { type AdjacentJump, allMercsHaveWalkedOffSector, allMercsWalkedToExitGrid, exitSectorCommand } from './sector-exits.ts';

export interface SectorWorlds {
  exists(path: string): boolean;
  world(mapPath: string): TacticalWorld | null;
}

export interface SectorSetup {
  readonly worlds: SectorWorlds;
  readonly content: TacticalContent;
  readonly roster: Roster;
}

type SectorEvent =
  | { readonly type: 'sectorUnloaded' | 'enemyPresence'; readonly sector: string }
  | {
      readonly type: 'sectorLoaded';
      readonly sector: string;
      readonly hostiles: number;
      readonly loadScreen: LoadScreenView;
      readonly enemyPresence?: true;
      readonly firstArrival?: true;
    };

export const UnloadCode = { ABOUT_TO_LOAD_NEW_MAP: 0, ABOUT_TO_TRASH_WORLD: 1 } as const;

export interface LoadOptions {
  readonly autoPlacement?: boolean;
  readonly battleLocatorShown?: boolean;
}

const PALACE: Sector = { x: 3, y: 16, z: 0 };
const STATUE_SECTOR: Sector = { x: 3, y: 15, z: 0 };
const PRESERVED_ENEMY_MAX_AGE_MINUTES = 300;
const CREATURE_TENSE_QUOTE_RANGE = 20;
const CROWS_POSSIBLE_RANGE = 5;
const NO_DIFFICULTY_TOWN = 0;
const SECONDS_PER_MINUTE = 60;
const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const SKIMMING_AMBUSH_FLAG = 0x10;
const MAX_MISC_NOISE_DURATION = 12;
const COMPUTER_TEAMS = [Team.ENEMY, Team.CREATURE, Team.MILITIA] as const;

const TIXA_CAVE: Sector = { x: 9, y: 10, z: 2 };
const MILITIA_LEVEL_GREEN = 0;
const MILITIA_LEVEL_REGULAR = 1;
const MILITIA_LEVEL_ELITE = 2;

export class SectorFlow {
  readonly campaign: CampaignSim;
  readonly setup: SectorSetup;
  readonly events: SimEvent[] = [];
  #loadingSector = false;
  #presenceWhileLoading = false;
  #loadScreen: number = LoadingScreen.NOTHING;

  constructor(campaign: CampaignSim, setup: SectorSetup) {
    this.campaign = campaign;
    this.setup = setup;
    const roster = setup.roster;
    roster.hooks = {
      ...roster.hooks,
      removeFromTacticalSector: (merc) => this.removeMercFromTacticalSector(merc),
      updateMercInSector: (merc) => this.updateMercInSector(merc),
    };
  }

  get #flow(): SectorFlowState {
    return this.campaign.state.sectorFlow;
  }

  get realtimeClock(): RealtimeClock {
    return this.#flow.realtimeClock;
  }

  get jump(): AdjacentJump | null {
    return this.#flow.jump;
  }

  set jump(jump: AdjacentJump | null) {
    this.#flow.jump = jump;
  }

  get usingEdgepointsForEntry(): boolean {
    return this.#flow.usingEdgepointsForEntry;
  }

  set usingEdgepointsForEntry(using: boolean) {
    this.#flow.usingEdgepointsForEntry = using;
  }

  get overrideInsertionWithExitGrid(): number | null {
    return this.#flow.overrideInsertionWithExitGrid;
  }

  set overrideInsertionWithExitGrid(gridNo: number | null) {
    this.#flow.overrideInsertionWithExitGrid = gridNo;
  }

  get hasEnteredCombatModeSinceEntering(): boolean {
    return this.#flow.hasEnteredCombatModeSinceEntering;
  }

  set hasEnteredCombatModeSinceEntering(entered: boolean) {
    this.#flow.hasEnteredCombatModeSinceEntering = entered;
  }

  get #pendingWait(): number | null {
    return this.#flow.pendingWait;
  }

  set #pendingWait(code: number | null) {
    this.#flow.pendingWait = code;
  }

  get ctx(): StrategicContext {
    const ctx = this.campaign.strategic;
    if (!ctx) throw new Error('sector flow needs the strategic layer');
    return ctx;
  }

  get queen(): QueenContext | null {
    return this.campaign.queen;
  }

  get economy(): EconomyContext | null {
    return this.campaign.economy;
  }

  get world(): SectorPosition | null {
    return this.campaign.state.worldSector;
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  #event(e: SectorEvent): void {
    this.events.push({ ...e, tick: this.campaign.tick });
  }

  nowMinutes(): number {
    return Math.trunc(this.campaign.state.clock.seconds / SECONDS_PER_MINUTE);
  }

  mapsNeededSoon(target?: unknown): string[] {
    const sectors: Sector[] = [];
    const start = this.ctx.content.policy.startSector;
    sectors.push(sectorFromId(start));
    const world = this.world;
    if (world) {
      sectors.push(world);
      for (const [dx, dy] of NEIGHBOURS) {
        const x = world.x + dx;
        const y = world.y + dy;
        if (x >= 1 && x <= 16 && y >= 1 && y <= 16) sectors.push({ x, y, z: world.z });
      }
      for (const e of this.campaign.tactical?.state.world.map?.exitGrids ?? []) sectors.push({ ...e.sector });
      for (const e of this.campaign.tactical?.state.addedExitGrids ?? []) sectors.push({ ...e.sector });
    }
    const wanted = parseSector(target);
    if (wanted) sectors.push(wanted);
    sectors.push(...this.#battleSectors(), ...this.#storySectors());
    return sectors.map((s) => this.mapPathOf(s));
  }

  #interrogationMayLoad(): boolean {
    const s = this.campaign.state;
    if (meanwhileScheduledIn(s.meanwhile, Meanwhile.INTERROGATION)) return !s.meanwhile.log.some((e) => e.id === Meanwhile.INTERROGATION);
    if (questStatus(s.narrative, Quest.INTERROGATION) !== QuestStatus.NOT_STARTED) return false;
    const battle = this.campaign.tactical?.state.turn.enemyInSector === true || s.battle.sector !== null || s.battle.autoresolve !== null;
    return battle;
  }

  #storySectors(): Sector[] {
    const found: Sector[] = [];
    if (this.#interrogationMayLoad()) found.push({ x: INTERROGATION_SECTOR.x, y: INTERROGATION_SECTOR.y, z: 0 });
    const world = this.world;
    if (world && world.x === PALACE.x && world.y === PALACE.y) found.push({ ...PALACE }, { ...PALACE, z: 1 });
    if (world && world.x === STATUE_SECTOR.x && world.y === STATUE_SECTOR.y) found.push({ ...STATUE_SECTOR, z: 1 });
    return found;
  }

  #inMeanwhile(): boolean {
    return this.campaign.strategic?.world.inMeanwhile() ?? false;
  }

  #interrogationScene(): boolean {
    return this.campaign.state.meanwhile.current.id === Meanwhile.INTERROGATION;
  }

  #battleSectors(): Sector[] {
    const s = this.campaign.state;
    const found: Sector[] = [];
    const pbi = s.battle.sector;
    if (pbi) found.push({ x: pbi.x, y: pbi.y, z: 0 });
    const handoff = s.encounter.preBattle?.sector;
    if (handoff) found.push({ x: handoff.x, y: handoff.y, z: 0 });
    return found;
  }

  mapPathOf(sector: Sector): string {
    const alternate = getSectorFlagStatus(this.campaign.state.map, sector, SectorFlag.USE_ALTERNATE_MAP);
    return sectorMapPath((p) => this.setup.worlds.exists(p), sector, alternate);
  }

  canGoToTacticalInSector(sector: Sector): boolean {
    return canGoToTacticalInSector(this.setup.roster.all(), sector);
  }

  enterSectorRefusal(sector: Sector): string | null {
    return this.enterSectorRefusalOf(sector)?.reason ?? null;
  }

  enterSectorRefusalOf(sector: Sector): Refusal | null {
    const s = this.campaign.state;
    if (s.encounter.preBattle || s.encounter.simultaneousArrival || s.movement.groupPrompting !== null)
      return { token: 'decisionPending', reason: 'a strategic decision is pending' };
    const t = this.campaign.tactical?.state;
    const world = this.world;
    if (t && (t.inCombat || t.turn.enemyInSector) && world && !sameSector(world, sector))
      return { token: 'battleElsewhere', reason: 'enemies are present in the loaded sector' };
    if (!this.canGoToTacticalInSector(sector)) return { token: 'noMercThere', reason: 'no merc of yours can go there' };
    if (!this.setup.worlds.world(this.mapPathOf(sector))) return { token: 'mapNotLoaded', reason: 'sector map is not loaded' };
    return null;
  }

  setCurrentWorldSector(sector: Sector, options: LoadOptions = {}): boolean {
    const s = this.campaign.state;
    const world = this.world;
    if (world && this.campaign.tactical && sameSector(world, sector)) {
      this.#reenterLoadedSector();
      s.flow = 'tactical';
      setGameTimeCompressionLevel(this.campaign.clockContext, CompressMode.X1);
      return true;
    }
    const baseWorld = this.setup.worlds.world(this.mapPathOf(sector));
    if (!baseWorld) return false;
    const previous = world ? this.campaign.tactical : null;
    if (world && this.campaign.tactical) {
      this.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_LOAD_NEW_MAP);
      this.#worldTrashed();
    }
    s.worldSector = { x: sector.x, y: sector.y, z: sector.z };
    s.map.selectedSector = { ...sector };
    if (sameSector(sector, TIXA_CAVE)) this.campaign.creatures?.initQuest();
    handleHelicopterOnGround(this.ctx);
    const enemyPresence = this.#whileLoading(() => this.#enterSector(sector, baseWorld, options, previous));
    const day = worldDay(s.clock);
    setSectorFlag(s.map, sector, SectorFlag.ALREADY_LOADED, day);
    handleHelicopterOnGround(this.ctx);
    this.#handleRpcDescriptionOfSector(sector, day);
    setSectorFlag(s.map, sector, SectorFlag.HAS_ENTERED_TACTICAL, day);
    this.hasEnteredCombatModeSinceEntering = false;
    s.rng.int(CREATURE_TENSE_QUOTE_RANGE);
    s.rng.int(CROWS_POSSIBLE_RANGE);
    s.flow = 'tactical';
    setGameTimeCompressionLevel(this.campaign.clockContext, CompressMode.X1);
    this.#event({
      type: 'sectorLoaded',
      sector: sectorShortString(sector),
      hostiles: numHostilesInSector(this.ctx, sector),
      loadScreen: this.#loadScreenView(),
      ...(enemyPresence ? { enemyPresence: true as const } : {}),
      ...(s.didGameJustStart ? { firstArrival: true as const } : {}),
    });
    return true;
  }

  #loadScreenView(): LoadScreenView {
    const screen = this.ctx.content.loadingScreens.screens[this.#loadScreen];
    return { id: this.#loadScreen, path: screen?.path ?? '' };
  }

  #whileLoading(load: () => void): boolean {
    this.#loadingSector = true;
    this.#presenceWhileLoading = false;
    try {
      load();
      return this.#presenceWhileLoading;
    } finally {
      this.#loadingSector = false;
      this.#presenceWhileLoading = false;
    }
  }

  #enemyPresence(): void {
    const s = this.campaign.state;
    const world = this.world;
    if (s.didGameJustStart || this.#inMeanwhile() || !world) return;
    if (this.#loadingSector) this.#presenceWhileLoading = true;
    else this.#event({ type: 'enemyPresence', sector: sectorShortString(world) });
  }

  #handleRpcDescriptionOfSector(sector: Sector, day: number): void {
    const s = this.campaign.state;
    s.narrative.guide.counting = false;
    if (getSectorFlagStatus(s.map, sector, SectorFlag.HAVE_USED_GUIDE_QUOTE) || sector.z !== 0) return;
    const quote = guideDescriptionFor(sector, s.options.sciFi);
    if (quote === null) return;
    setSectorFlag(s.map, sector, SectorFlag.HAVE_USED_GUIDE_QUOTE, day);
    startGuideCountdown(s.narrative.guide, sector, quote, s.rng.int(GUIDE_DESCRIPTION_COUNTDOWN_RANGE));
    handleRpcDescription(this.campaign);
  }

  #reenterLoadedSector(): void {
    const t = this.campaign.tactical?.state;
    if (!t) return;
    const enemiesHere = teamMembers(t, Team.ENEMY).some((x) => x.life > 0);
    if (!enemiesHere) this.prepareEnemyForSectorBattle();
    const world = this.world;
    if (world && this.campaign.creatures?.attackPendingFor(world)) this.prepareCreaturesForBattle();
    handleHelicopterOnGround(this.ctx);
    this.resetMilitia();
    this.campaign.tactical?.lookAround();
  }

  #worldWithDoorTable(world: TacticalWorld, doors: readonly MapDoor[] | null): TacticalWorld {
    if (!doors) return world;
    return { ...world, map: { ...world.map, doors: [...doors] } };
  }

  #createTactical(sector: Sector, world: TacticalWorld): TacticalSim {
    const s = this.campaign.state;
    const dayAmbient = timeOfDayAmbientLightLevel(s.env, sector.z, sector.z === 0 && isSectorDesert(s.map, sector));
    const sim = new TacticalSim(world, this.setup.content, 0, {
      options: s.options,
      streams: { rng: s.rng, pre: s.pre },
      profiles: s.profiles,
      keyTable: s.keyTable,
      civGroups: s.civGroups,
      boxing: s.narrative.boxing,
      startMs: s.realMs,
      realtimeClock: this.realtimeClock,
      hour: worldHour(s.clock),
      dayAmbient,
    });
    const t = sim.state;
    t.equipment.progress = s.status.highestProgress;
    t.equipment.weaponsAlreadyDropped = sharedWeaponsDropped(s.status, this.setup.content.items);
    t.campaign = this.#tacticalCampaign();
    t.sector = { x: sector.x, y: sector.y, z: sector.z };
    t.edgepoints = loadMapEdgepoints(t, sector);
    t.initList = buildSoldierInitList(world.map);
    loadWorldItemsFromMap(t, world.map.items);
    lightSpriteRenderAll(t);
    sim.attachWorldClock(s.clock);
    this.#installHooks(sim);
    return sim;
  }

  #installHooks(sim: TacticalSim): void {
    sim.state.experienceHooks = this.campaign.experienceHooks;
    sim.state.narrative = campaignNarrativePort(this.campaign);
    sim.state.scheduleClock = campaignScheduleClock(this.campaign);
    sim.state.sectorHooks = {
      soldierDied: (_t, dead) => this.#soldierDied(dead),
      addPendingEnemies: () => this.addPossiblePendingEnemiesToBattle(),
      soldierLeftMap: (_t, gone) => this.#soldierLeftMap(gone),
      mercsWaitOver: (_t, code) => {
        this.#pendingWait = code;
      },
      mercDied: (_t, dead) => this.campaign.battle?.mercDiedInTactical(dead),
      pendingEnemies: () => this.campaign.battle?.pendingEnemies() ?? false,
      militiaFinishBattle: (t) => this.campaign.battle?.militiaFinishBattle(t) ?? false,
      battleLost: (t) => this.campaign.battle?.battleLost(t),
      battleEnded: (t, result) => this.campaign.battle?.tacticalBattleEnded(t, result === 'won'),
      tacticalTurnEnded: () => handleRpcDescription(this.campaign),
      combatEntered: () => this.#combatEntered(),
      enemyPresence: () => this.#enemyPresence(),
    };
  }

  adoptLoadedSector(links: readonly { readonly nodeId: number; readonly soldierId: number }[]): void {
    const sim = this.campaign.tactical;
    const world = this.world;
    if (!sim || !world) return;
    const t = sim.state;
    t.campaign = this.#tacticalCampaign();
    t.edgepoints = loadMapEdgepoints(t, world);
    t.initList = buildSoldierInitList(sim.world.map);
    for (const link of links) {
      const node = t.initList[link.nodeId];
      const soldier = t.soldiers[link.soldierId];
      if (!node || !(soldier?.placed || soldier?.away)) continue;
      node.soldierId = soldier.id;
      node.hasSoldier = true;
    }
    this.#installHooks(sim);
    this.postSchedulesOfLoadedSector(t, true);
  }

  reattachLoadedSector(): void {
    const sim = this.campaign.tactical;
    if (sim) this.#installHooks(sim);
  }

  postSchedulesOfLoadedSector(t: TacticalState, loadingSave: boolean): void {
    postSchedules(t, { loadingSave });
  }

  #enterSector(sector: Sector, baseWorld: TacticalWorld, options: LoadOptions, previous: TacticalSim | null): void {
    const s = this.campaign.state;
    const narrative = this.campaign.narrative;
    if (previous) setupProfileInsertionDataForCivilians(previous.state, this.#profileInsertionHooks());
    narrative.handleQuestCodeOnSectorEntry(sector);
    this.#loadScreen = loadScreenId(this.ctx, sector, s.rng);
    for (const m of this.setup.roster.all()) m.soldier.placed = false;
    if (!this.#inMeanwhile()) setSectorFlag(s.map, sector, SectorFlag.ALREADY_VISITED, worldDay(s.clock));
    const diff = s.sectorDiffs.get(sectorKey(sector)) ?? null;
    const doorTable = diff && getSectorFlagStatus(s.map, sector, SectorFlag.DOOR_TABLE_TEMP_FILES_EXISTS) ? diff.doorTable : null;
    const sim = this.#createTactical(sector, this.#worldWithDoorTable(baseWorld, doorTable));
    this.campaign.tactical = sim;
    this.#loadCurrentSectorsInformation(sector, diff);
    if (options.autoPlacement) this.#chooseRandomEdgepoints(sector);
    this.prepareLoadedSector(options);
  }

  #flagged(sector: Sector, flag: number): boolean {
    return getSectorFlagStatus(this.campaign.state.map, sector, flag);
  }

  #loadCurrentSectorsInformation(sector: Sector, diff: SectorDiff | null): void {
    const t = this.campaign.tactical?.state;
    if (!t) return;
    const s = this.campaign.state;
    const now = this.nowMinutes();
    if (this.#inMeanwhile()) {
      if (diff && this.#interrogationScene()) this.#loadItemDiff(sector, diff);
      t.world.costs.values.set(compileWorldMovementCosts(t.world).values);
      return;
    }
    if (diff) {
      this.#loadItemDiff(sector, diff);
      if (diff.corpses && this.#flagged(sector, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS)) {
        const inTown = sector.z === 0 && townIdOfSector(this.ctx, sector) !== NO_DIFFICULTY_TOWN;
        restoreCorpses(t, diff.corpses, { nowMinute: now, inTown, loadingSave: false });
      }
      if (diff.mapChanges && this.#flagged(sector, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)) restoreMapChanges(t, diff.mapChanges);
      if (diff.openables) restoreOpenables(t, diff.openables);
      if (diff.revealed && this.#flagged(sector, SectorFlag.REVEALED_STATUS_TEMP_FILE_EXISTS)) restoreRevealed(t, diff.revealed);
      if (diff.doorStatus && this.#flagged(sector, SectorFlag.DOOR_STATUS_TEMP_FILE_EXISTS)) restoreDoorStatus(t, diff.doorStatus);
      if (diff.enemies && this.#flagged(sector, SectorFlag.ENEMY_PRESERVED_TEMP_FILE_EXISTS)) this.#loadPreservedEnemies(sector, diff);
      if (diff.civilians && this.#flagged(sector, SectorFlag.CIV_PRESERVED_TEMP_FILE_EXISTS))
        loadPreservedCivilians(t, diff.civilians, now);
      if (diff.smoke && this.#flagged(sector, SectorFlag.SMOKE_EFFECTS_TEMP_FILE_EXISTS)) restoreSmoke(t, diff.smoke);
      if (diff.lights && this.#flagged(sector, SectorFlag.LIGHTING_EFFECTS_TEMP_FILE_EXISTS)) restoreLights(t, diff.lights);
    }
    t.world.costs.values.set(compileWorldMovementCosts(t.world).values);
    if (sector.z === 0 && sectorInfo(s.map, sector).timeLastPlayerLiberated !== 0) stripEnemyDetailedPlacements(t, this.populationEnv());
  }

  #loadItemDiff(sector: Sector, diff: SectorDiff): void {
    const t = this.campaign.tactical?.state;
    if (!t || !diff.items || !this.#flagged(sector, SectorFlag.ITEM_TEMP_FILE_EXISTS)) return;
    if (this.#flagged(sector, SectorFlag.ALREADY_LOADED)) t.worldItems.length = 0;
    const kept = [...t.worldItems];
    restoreWorldItems(t, diff.items, t.world.map?.info.centerGridNo ?? CENTER_GRIDNO);
    if (!this.#flagged(sector, SectorFlag.ALREADY_LOADED)) t.worldItems.unshift(...kept);
  }

  #fileClassCounts(records: SectorDiff['enemies']): { elites: number; troops: number; admins: number; creatures: number } {
    const counts = { elites: 0, troops: 0, admins: 0, creatures: 0 };
    for (const r of records?.records ?? []) {
      if (r.soldierClass === SoldierClass.ELITE) counts.elites++;
      else if (r.soldierClass === SoldierClass.ARMY) counts.troops++;
      else if (r.soldierClass === SoldierClass.ADMINISTRATOR) counts.admins++;
      else if (r.soldierClass === SoldierClass.CREATURE) counts.creatures++;
    }
    return counts;
  }

  #dropPreservedEnemies(sector: Sector, diff: SectorDiff): void {
    diff.enemies = null;
    resetSectorFlag(this.campaign.state.map, sector, SectorFlag.ENEMY_PRESERVED_TEMP_FILE_EXISTS);
  }

  #loadPreservedEnemies(sector: Sector, diff: SectorDiff): void {
    const t = this.campaign.tactical?.state;
    const preserved = diff.enemies;
    if (!t || !preserved) return;
    const s = this.campaign.state;
    const stationary = { elites: 0, troops: 0, admins: 0, creatures: 0 };
    if (sector.z === 0) {
      const si = sectorInfo(s.map, sector);
      Object.assign(stationary, { elites: si.numElites, troops: si.numTroops, admins: si.numAdmins, creatures: si.numCreatures });
    }
    const inFile = this.#fileClassCounts(preserved);
    if (
      inFile.elites !== stationary.elites ||
      inFile.troops !== stationary.troops ||
      inFile.admins !== stationary.admins ||
      inFile.creatures !== stationary.creatures
    ) {
      this.#dropPreservedEnemies(sector, diff);
      return;
    }
    if (this.nowMinutes() > preserved.savedMinute + PRESERVED_ENEMY_MAX_AGE_MINUTES) {
      this.#dropPreservedEnemies(sector, diff);
      return;
    }
    if (preserved.records.length === 0) {
      return;
    }
    for (const n of t.initList) if (n.priorityExistence && (n.team === Team.ENEMY || n.team === Team.CREATURE)) n.priorityExistence = false;
    const strategic = this.#strategicEnemyTotals(sector);
    const restored = { elites: 0, troops: 0, admins: 0 };
    for (const record of preserved.records) {
      const node = t.initList.find((n) => !n.priorityExistence && n.team === record.team);
      if (!node) continue;
      applyPreservedEnemyRecord(node, record);
      if (node.soldierClass === SoldierClass.ELITE) restored.elites++;
      else if (node.soldierClass === SoldierClass.ARMY) restored.troops++;
      else if (node.soldierClass === SoldierClass.ADMINISTRATOR) restored.admins++;
    }
    if (strategic.troops > restored.troops || strategic.elites > restored.elites || strategic.admins > restored.admins) {
      addSoldierInitListEnemyDefenceSoldiers(
        t,
        {
          admins: Math.max(0, strategic.admins - restored.admins),
          troops: Math.max(0, strategic.troops - restored.troops),
          elites: Math.max(0, strategic.elites - restored.elites),
        },
        this.populationEnv(),
      );
    }
  }

  #strategicEnemyTotals(sector: Sector): { admins: number; troops: number; elites: number } {
    if (sector.z !== 0) {
      const u = findUndergroundSector(this.campaign.state.map, sector);
      return { admins: u?.numAdmins ?? 0, troops: u?.numTroops ?? 0, elites: u?.numElites ?? 0 };
    }
    return getNumberOfEnemiesInSector(this.ctx, sector);
  }

  #chooseRandomEdgepoints(sector: Sector): void {
    const t = this.campaign.tactical?.state;
    if (!t) return;
    for (const m of this.setup.roster.all()) {
      if (m.isVehicle || m.betweenSectors || !sameSector(m.sector, sector)) continue;
      const g = chooseMapEdgepoint(t, m.insertionCode, t.rng);
      if (g === -1) continue;
      m.insertionCode = InsertionCode.GRIDNO;
      m.soldier.insertionData = g;
    }
  }

  prepareLoadedSector(options: LoadOptions = {}): void {
    const sim = this.campaign.tactical;
    const world = this.world;
    if (!sim || !world) return;
    const t = sim.state;
    const env = this.populationEnv();
    this.updateMercsInSector(options);
    if (this.#civiliansInSector(world)) addSoldierInitListTeamToWorld(t, Team.CIV, env);
    addSoldierInitListTeamToWorld(t, Team.MILITIA, env);
    this.#addBloodcats(world);
    this.prepareCreaturesForBattle();
    this.prepareMilitiaForTactical();
    t.turn.virginSector = true;
    addProfilesNotUsingProfileInsertionData(t, env, this.#profileInsertionHooks());
    this.prepareEnemyForSectorBattle();
    addProfilesUsingProfileInsertionData(t, world, env, this.#profileInsertionHooks());
    this.postSchedulesOfLoadedSector(t, false);
    this.#callAvailableTeamEnemiesToAmbush(t);
    unPauseGame(this.campaign.state.clock);
    this.campaign.state.encounter.battleGroup = null;
    if (this.campaign.state.movement.tacticalTraversal.active && this.economy) calculateNonPersistentPbiInfo(this.economy);
    sim.lookAround();
  }

  #civiliansInSector(world: SectorPosition): boolean {
    const economy = this.economy;
    if (!world.z || !economy) return true;
    const mine = mineIdForSector(economy, world);
    return mine === -1 || areThereMinersInsideThisMine(economy, mine);
  }

  #addBloodcats(world: SectorPosition): void {
    const t = this.campaign.tactical?.state;
    if (!t || world.z) return;
    const info = sectorInfo(this.campaign.state.map, world);
    const spawns = this.ctx.content.bloodCatSpawns.some((b) => b.sector === sectorId(world));
    addSoldierInitListBloodcats(t, info, spawns, this.populationEnv());
  }

  #blueLight(): boolean {
    const color = this.campaign.tactical?.world.map.lights?.colors[0];
    return (color?.[2] ?? 0) !== 0;
  }

  prepareCreaturesForBattle(): boolean {
    const t = this.campaign.tactical?.state;
    const world = this.world;
    const creatures = this.campaign.creatures;
    if (!t || !world || !creatures) return false;
    const setup = creatures.battleSetup(world, this.#blueLight());
    if (!setup) return false;
    const attack = this.campaign.state.creatures.attack;
    const env = this.populationEnv();
    switch (attack.battleCode) {
      case CreatureBattleCode.NONE:
        addSoldierInitListCreatures(t, setup.queen, setup.counts, env);
        return true;
      case CreatureBattleCode.AUTORESOLVE:
        return false;
      default: {
        const insertion = { code: attack.insertionCode, gridNo: attack.insertionGridNo };
        addCreaturesToBattle(t, setup.counts, insertion, this.#insertionContext(null), env);
        creatures.clearAttack();
        this.campaign.tactical?.lookAround();
        return true;
      }
    }
  }

  #callAvailableTeamEnemiesToAmbush(t: TacticalState): void {
    const code = this.campaign.state.encounter.code;
    if (code !== EncounterCode.ENEMY_AMBUSH && code !== EncounterCode.BLOODCAT_AMBUSH) return;
    const center = t.world.map?.info.centerGridNo ?? -1;
    if (center === -1) return;
    for (const team of COMPUTER_TEAMS) {
      const members = teamMembers(t, team);
      if (members.length === 0) continue;
      t.perception.publicNoiseGridNo[team] = center;
      t.perception.publicNoiseVolume[team] = MAX_MISC_NOISE_DURATION;
      for (const s of members) if (s.life >= OKLIFE) t.perceptionHooks.setNewSituation(s);
    }
  }

  #insertionContext(m: RosterMerc | null): InsertionContext {
    const world = this.world ?? { x: 0, y: 0, z: 0 };
    const start = this.ctx.content.policy.startSector;
    return {
      worldSector: world,
      mercSector: m?.sector ?? world,
      startSector: { x: (start % 16) + 1, y: Math.trunc(start / 16) + 1, z: 0 },
      usingEdgepoints: this.usingEdgepointsForEntry,
      assignment: m?.assignment ?? 0,
      asleep: m?.asleep ?? false,
      isEpc: m?.isEpc ?? false,
      heliDrop: (s, order) => this.#heliDrop(s, order),
    };
  }

  #heliDrop(s: Soldier, order: InsertionOrder): void {
    const t = this.campaign.tactical?.state;
    if (!t) return;
    order.code = Insertion.NORTH;
    const merc = this.setup.roster.get(s.id);
    updateMercInSector(t, s, order, this.#insertionContext(merc ?? null));
  }

  #mercInLoadedSector(m: RosterMerc): boolean {
    const world = this.world;
    return world !== null && !m.betweenSectors && sameSector(m.sector, world) && m.life > 0;
  }

  updateMercsInSector(options: LoadOptions = {}): void {
    if (this.usingEdgepointsForEntry) beginMapEdgepointSearch(this.campaign.tactical?.state ?? fail());
    const s = this.campaign.state;
    this.campaign.pows.beginSectorLoad();
    for (const m of this.setup.roster.all()) {
      if (!this.#mercInLoadedSector(m)) continue;
      const center = this.campaign.tactical?.state.world.map?.info.centerGridNo ?? -1;
      const ambush = s.encounter.code === EncounterCode.ENEMY_AMBUSH || s.encounter.code === EncounterCode.BLOODCAT_AMBUSH;
      if (center !== -1 && options.battleLocatorShown && ambush) {
        m.insertionCode = InsertionCode.GRIDNO;
        m.soldier.insertionData = center;
      } else if (this.overrideInsertionWithExitGrid !== null) {
        m.insertionCode = InsertionCode.GRIDNO;
        m.soldier.insertionData = this.overrideInsertionWithExitGrid;
      }
      this.#placeMerc(m);
      this.campaign.pows.powPlaced(m);
    }
    this.campaign.pows.endSectorLoad();
    if (this.usingEdgepointsForEntry) {
      const t = this.campaign.tactical?.state;
      if (t) endMapEdgepointSearch(t);
      this.usingEdgepointsForEntry = false;
    }
  }

  #placeMerc(m: RosterMerc): void {
    const t = this.campaign.tactical?.state;
    if (!t || m.assignment === EconomyAssignment.IN_TRANSIT) return;
    const order: InsertionOrder = { code: m.insertionCode, data: m.soldier.insertionData, direction: m.insertionDirection };
    updateMercInSector(t, m.soldier, order, this.#insertionContext(m));
    m.insertionCode = order.code;
    m.insertionDirection = order.direction;
  }

  updateMercInSector(m: RosterMerc): void {
    if (!this.campaign.tactical || !this.#mercInLoadedSector(m)) return;
    this.#placeMerc(m);
  }

  removeMercFromTacticalSector(m: RosterMerc): void {
    const t = this.campaign.tactical?.state;
    if (t && registeredInTactical(t, m)) removeSoldierFromTacticalSector(t, m.soldier);
  }

  #tacticalCampaign(): { difficultyModifier: number; progress: number } {
    const q = this.queen;
    const progress = q ? queenProgress(q) : this.campaign.state.status.highestProgress;
    return { difficultyModifier: this.difficultyModifier(SoldierClass.ARMY), progress };
  }

  difficultyModifier(soldierClass: number): number {
    const world = this.world ?? { x: 1, y: 1, z: 0 };
    const q = this.queen;
    if (q) return difficultyModifierAt(q, soldierClass, world);
    const s = this.campaign.state;
    return calcDifficultyModifier(
      {
        difficulty: s.options.difficulty,
        highestProgress: s.status.highestProgress,
        predictedMineIncome: 0,
        battleSector: world,
        battleSectorTownId: townIdOfSector(this.ctx, world),
      },
      soldierClass,
    );
  }

  #placementNarrative(): PlacementNarrative | null {
    const world = this.world;
    return world ? this.campaign.narrative.placementNarrative(world) : null;
  }

  #profileInsertionHooks(): ProfileInsertionHooks {
    return this.campaign.narrative.profileInsertionHooks(() => this.#insertionContext(null));
  }

  populationEnv(): PopulationEnv {
    const world = this.world ?? { x: 1, y: 1, z: 0 };
    return {
      difficultyModifier: (cls) => this.difficultyModifier(cls),
      difficulty: this.campaign.state.options.difficulty,
      bloodcatLair: this.ctx.content.bloodCatSpawns.find((b) => b.sector === sectorId(world))?.isLair === true,
      locationModifier: locationModifier(townIdOfSector(this.ctx, world), world),
      autoResolveActive: false,
      profileHere: (p) => {
        const n = this.#placementNarrative();
        return n !== null && profilePlacementAllowed(n, p);
      },
      iceCreamTruckWithheld: () => {
        const n = this.#placementNarrative();
        return n !== null && iceCreamTruckWithheld(n);
      },
      civilianPlacement: (pp) => {
        const n = this.#placementNarrative();
        return n ? civilianPlacementOverride(n, pp) : PlacementVerdict.CREATE;
      },
      upgradeEliteToProfiledEnemy: (pp) =>
        okayToUpgradeEliteToSpecialProfiledEnemy(this.campaign.state.narrative, this.campaign.state.encounter.code, pp),
      resetProfiledEnemyAdded: () => {
        this.campaign.state.narrative.profiledEnemyAdded = false;
      },
    };
  }

  prepareMilitiaForTactical(): void {
    const t = this.campaign.tactical?.state;
    const world = this.world;
    if (!t || !world || world.z > 0) return;
    const si = sectorInfo(this.campaign.state.map, world);
    addSoldierInitListMilitia(
      t,
      si.militia[MILITIA_LEVEL_GREEN] ?? 0,
      si.militia[MILITIA_LEVEL_REGULAR] ?? 0,
      si.militia[MILITIA_LEVEL_ELITE] ?? 0,
      this.populationEnv(),
    );
  }

  resetMilitia(): void {
    const t = this.campaign.tactical?.state;
    const economy = this.campaign.state.economy;
    if (!t || !economy.strategicMilitiaChangesMade) return;
    economy.strategicMilitiaChangesMade = false;
    for (const s of teamMembers(t, Team.MILITIA)) removeSoldierFromTacticalSector(t, s);
    for (const n of t.initList)
      if (n.team === Team.MILITIA) {
        n.hasSoldier = false;
        n.soldierId = -1;
      }
    this.prepareMilitiaForTactical();
  }

  #mapEnemyPlacements(): { admins: number; troops: number; elites: number } {
    const counts = { admins: 0, troops: 0, elites: 0 };
    for (const n of this.campaign.tactical?.state.initList ?? []) {
      if (n.team !== Team.ENEMY) continue;
      if (n.soldierClass === SoldierClass.ADMINISTRATOR) counts.admins++;
      else if (n.soldierClass === SoldierClass.ARMY) counts.troops++;
      else if (n.soldierClass === SoldierClass.ELITE) counts.elites++;
    }
    return counts;
  }

  prepareEnemyForSectorBattle(): void {
    const t = this.campaign.tactical?.state;
    const q = this.queen;
    if (!t || !q) return;
    const plan = planEnemies(q, { freeEnemySlots: freeSoldierSlots(t, Team.ENEMY), mapEnemyPlacements: this.#mapEnemyPlacements() });
    if (plan.kind !== BattlePlanKind.DEFENCE && plan.kind !== BattlePlanKind.UNDERGROUND) return;
    addSoldierInitListEnemyDefenceSoldiers(t, plan.defence, this.populationEnv());
    if (plan.kind === BattlePlanKind.DEFENCE) {
      const enemies = teamMembers(t, Team.ENEMY).sort((a, b) => a.id - b.id);
      assignEnemyGroupIds(q, plan, enemies);
    }
  }

  addPossiblePendingEnemiesToBattle(): void {
    const t = this.campaign.tactical?.state;
    const q = this.queen;
    if (!t || !q?.state.encounter.pendingEnemies) return;
    const arrivals = addPossiblePendingEnemiesToBattle(q, freeSoldierSlots(t, Team.ENEMY));
    const env = this.populationEnv();
    for (const a of arrivals) {
      const facing = ARRIVAL_FACING[a.insertionCode] ?? 0;
      addEnemiesToBattle(t, { ...a, facing }, this.#insertionContext(null), env);
    }
  }

  deadEnemyRecord(s: Soldier) {
    const world = this.world ?? { x: 0, y: 0, z: 0 };
    return {
      profile: s.profile,
      team: s.team,
      neutral: s.neutral,
      groupId: s.groupId,
      soldierClass: s.soldierClass,
      body: s.bodyType,
      sector: { x: world.x, y: world.y, z: world.z },
    };
  }

  #soldierDied(dead: Soldier): void {
    const world = this.world;
    const t = this.campaign.tactical?.state;
    if (!world || !t) return;
    const economy = this.economy;
    if (dead.team === Team.MILITIA) {
      const rank = soldierClassToMilitiaRank(dead.soldierClass);
      if (economy && rank !== null) strategicRemoveMilitiaFromSector(economy, world, rank, 1);
      if (economy) handleGlobalLoyaltyEvent(economy, LoyaltyEvent.NATIVE_KILLED, world);
    } else if (dead.team !== Team.CIV) {
      if (dead.team === Team.ENEMY) trackEnemiesKilled(this.campaign.state.status, EnemyKilled.IN_TACTICAL, dead.soldierClass);
      if (economy) handleGlobalLoyaltyEvent(economy, LoyaltyEvent.ENEMY_KILLED, world);
      if (dead.bodyType === Body.QUEENMONSTER) this.#creatureQueenKilled(world);
    }
    if (dead.attacker?.team === Team.OUR && dead.team !== Team.OUR) recordPlayerKill(this.campaign.state.status);
    evaluateDeathEffectsToSoldierInitList(t, dead);
    const merchants = this.campaign.merchants;
    if (merchants)
      addDeadArmsDealerItemsToWorld(merchants, dead.profile, (o) => addItemToPool(t, dead.initialGridNo, o, Visibility.INVISIBLE, 0, 0, 0));
    const q = this.queen;
    if (q) processQueenCmdImplicationsOfDeath(q, this.deadEnemyRecord(dead));
  }

  #creatureQueenKilled(world: Sector): void {
    this.campaign.battle?.moraleEvent(null, CampaignMoraleEvent.MONSTER_QUEEN_KILLED, world);
    const economy = this.economy;
    if (economy) incrementTownLoyaltyEverywhere(economy, economy.economy.loyalty.amounts.BONUS_KILL_QUEEN_MONSTER ?? 0);
    this.campaign.narrative.awardExperience(ExperienceBonus.MAXIMUM);
  }

  #combatEntered(): void {
    const world = this.world;
    const battle = this.campaign.state.battle;
    battle.lastBattleSector = world ? { x: world.x, y: world.y } : null;
    battle.lastBattleWon = false;
  }

  #soldierLeftMap(gone: Soldier): void {
    const t = this.campaign.tactical?.state;
    if (!t) return;
    evaluateDeathEffectsToSoldierInitList(t, gone);
    const q = this.queen;
    if (q) processQueenCmdImplicationsOfDeath(q, this.deadEnemyRecord(gone));
  }

  afterTacticalStep(): void {
    const t = this.campaign.tactical?.state;
    if (t?.inCombat) this.hasEnteredCombatModeSinceEntering = true;
    const code = this.#pendingWait;
    if (code === null) return;
    this.#pendingWait = null;
    if (code === WaitForMercs.WALKOFF_SCREEN) allMercsHaveWalkedOffSector(this);
    else if (code === WaitForMercs.WALK_TO_GRIDNO) allMercsWalkedToExitGrid(this);
  }

  militiaFriendly(): boolean {
    const t = this.campaign.tactical?.state;
    if (!t) return true;
    return teamMembers(t, Team.MILITIA).every((s) => s.side === Side.FRIENDLY);
  }

  saveCurrentSectorsInformation(): void {
    const t = this.campaign.tactical?.state;
    const world = this.world;
    if (!t || !world) return;
    const s = this.campaign.state;
    const map = s.map;
    const day = worldDay(s.clock);
    const key = sectorKey(world);
    const diff = s.sectorDiffs.get(key) ?? emptySectorDiff();
    const now = this.nowMinutes();
    const mark = (flag: number, present: boolean) => {
      if (present) setSectorFlag(map, world, flag, day);
      else resetSectorFlag(map, world, flag);
    };
    handleAllReachableItemsInTheSector(t, teamMembers(t, Team.OUR));
    diff.items = captureWorldItems(t);
    mark(SectorFlag.ITEM_TEMP_FILE_EXISTS, true);
    setVisibleItemCount(map, world, visibleItemCount(diff.items));
    diff.corpses = [...t.corpses];
    mark(SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS, true);
    diff.mapChanges = t.mapChanges.length > 0 ? [...t.mapChanges] : null;
    mark(SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS, diff.mapChanges !== null);
    diff.doorTable = [...t.world.mapDoors.values()];
    mark(SectorFlag.DOOR_TABLE_TEMP_FILES_EXISTS, true);
    diff.revealed = captureRevealed(t);
    mark(SectorFlag.REVEALED_STATUS_TEMP_FILE_EXISTS, true);
    diff.doorStatus = captureDoorStatus(t);
    diff.openables = openableStatuses(t);
    mark(SectorFlag.DOOR_STATUS_TEMP_FILE_EXISTS, true);
    diff.enemies = preserveSoldiers(t, true, now);
    mark(SectorFlag.ENEMY_PRESERVED_TEMP_FILE_EXISTS, diff.enemies !== null);
    diff.civilians = preserveSoldiers(t, false, now);
    mark(SectorFlag.CIV_PRESERVED_TEMP_FILE_EXISTS, diff.civilians !== null);
    const smoke = captureSmoke(t);
    diff.smoke = smoke.length > 0 ? smoke : null;
    mark(SectorFlag.SMOKE_EFFECTS_TEMP_FILE_EXISTS, diff.smoke !== null);
    const lights = captureLights(t);
    diff.lights = lights.length > 0 ? lights : null;
    mark(SectorFlag.LIGHTING_EFFECTS_TEMP_FILE_EXISTS, diff.lights !== null);
    s.sectorDiffs.set(key, diff);
    if (world.z === 0) sectorInfo(map, world).timeLastLoaded = now;
    else {
      const u = findUndergroundSector(map, world);
      if (u) u.timeLastLoaded = now;
    }
  }

  handleDefiniteUnloadingOfWorld(code: number): void {
    const t = this.campaign.tactical?.state;
    const world = this.world;
    if (!t || !world) return;
    this.campaign.narrative.handleQuestCodeOnSectorExit(world);
    t.turn.enemyInSector = false;
    this.saveCurrentSectorsInformation();
    if (code === UnloadCode.ABOUT_TO_LOAD_NEW_MAP) updateSoldierPointerDataIntoProfile(t, this.#profileInsertionHooks());
    else setupProfileInsertionDataForCivilians(t, this.#profileInsertionHooks());
    const economy = this.economy;
    if (economy) {
      const militia = teamMembers(t, Team.MILITIA).map((s) => ({
        soldierClass: s.soldierClass,
        inSector: s.placed,
        life: s.life,
        get militiaKills() {
          return s.militiaKills;
        },
        set militiaKills(v: number) {
          s.militiaKills = v;
        },
      }));
      handleMilitiaStatusBeforeLoadingNewMap(economy, world, {
        militiaFriendly: this.militiaFriendly(),
        automaticallyStartAutoResolve: this.campaign.state.battle.autoStart,
        militia,
      });
    }
    for (const m of this.setup.roster.all()) if (registeredInTactical(t, m)) removeSoldierFromTacticalSector(t, m.soldier);
  }

  #mercsStillHere(): boolean {
    const world = this.world;
    if (!world) return false;
    return this.setup.roster
      .all()
      .some((m) => m.life !== 0 && !m.betweenSectors && !m.isVehicle && !m.isRobot && !m.isEpc && sameSector(m.sector, world));
  }

  #bringUpAutoresolveToFinishBattle(): boolean {
    const t = this.campaign.tactical?.state;
    const battle = this.campaign.battle;
    if (!t || !battle) return false;
    return battle.militiaFinishBattle(t);
  }

  checkAndHandleUnloadingOfCurrentWorld(): boolean {
    const sim = this.campaign.tactical;
    const world = this.world;
    const s = this.campaign.state;
    if (!sim || !world) return false;
    const start = this.ctx.content.policy.startSector;
    if (s.didGameJustStart && world.z === 0 && world.x === (start % 16) + 1 && world.y === Math.trunc(start / 16) + 1) return false;
    if (this.#mercsStillHere()) return false;
    if (this.#bringUpAutoresolveToFinishBattle()) return false;
    this.#endTacticalBattleForEnemy();
    if (s.flow === 'tactical' && s.movement.tacticalTraversal.active) return false;
    this.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
    this.trashWorld();
    return true;
  }

  #endTacticalBattleForEnemy(): void {
    const t = this.campaign.tactical?.state;
    const world = this.world;
    const q = this.queen;
    if (!t || !world || !q) return;
    const ok = (team: number) => teamMembers(t, team).some((x) => x.life >= OKLIFE);
    const fighting = { militia: ok(Team.MILITIA), enemies: ok(Team.ENEMY), creatures: ok(Team.CREATURE) };
    if (endTacticalBattleForEnemy(q, fighting) && this.economy) handleGlobalLoyaltyEvent(this.economy, LoyaltyEvent.ABANDON_MILITIA, world);
  }

  unloadForAutoresolve(): void {
    const sim = this.campaign.tactical;
    const world = this.world;
    if (!sim || !world) return;
    const t = sim.state;
    for (const m of this.setup.roster.all()) {
      if (m.life === 0 || m.betweenSectors || m.isVehicle || m.isRobot || m.isEpc || !sameSector(m.sector, world)) continue;
      if (registeredInTactical(t, m)) removeSoldierFromTacticalSector(t, m.soldier);
    }
    this.#endTacticalBattleForEnemy();
    this.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
    this.trashWorld();
  }

  #worldTrashed(): void {
    const t = this.campaign.tactical?.state;
    if (t) destroyAllSchedules(t);
    const q = this.queen;
    if (q) handleFirstMeanwhileSetUpWithTrashWorld(q);
  }

  trashWorld(): void {
    const world = this.world;
    if (this.campaign.tactical) this.#worldTrashed();
    this.campaign.tactical = null;
    for (const m of this.setup.roster.all()) m.soldier.placed = false;
    const s = this.campaign.state;
    s.worldSector = null;
    s.flow = 'strategic';
    if (world) this.#event({ type: 'sectorUnloaded', sector: sectorShortString(world) });
  }

  handleLoyaltyImplicationsOfMercRetreat(traversal: boolean, sector: Sector): void {
    const economy = this.economy;
    if (!economy) return;
    if (countAllMilitiaInSector(this.ctx, sector)) handleGlobalLoyaltyEvent(economy, LoyaltyEvent.ABANDON_MILITIA, sector);
    const t = this.campaign.tactical?.state;
    if (traversal) {
      if (t?.turn.enemyInSector && this.#playerStrength() * 2 >= this.#enemyStrength())
        economy.hooks.moraleEvent(MoraleEvent.RAN_AWAY, sector);
    } else economy.hooks.moraleEvent(MoraleEvent.RAN_AWAY, sector);
  }

  #playerStrength(): number {
    const world = this.world;
    let total = 0;
    for (const m of this.setup.roster.all()) {
      const s = m.soldier;
      const leftThisSector =
        m.betweenSectors &&
        world &&
        (m.prevSectorId % 16) + 1 === world.x &&
        Math.trunc(m.prevSectorId / 16) + 1 === world.y &&
        m.sector.z === world.z;
      if (s.placed || leftThisSector) total += Math.trunc((s.life * (s.breathMax + 100)) / 200);
    }
    return total;
  }

  #enemyStrength(): number {
    const t = this.campaign.tactical?.state;
    let total = 0;
    for (const s of t?.soldiers ?? []) {
      if (!s?.placed || s.team === Team.OUR || s.neutral) continue;
      total += Math.trunc((s.life * (s.breathMax + 100)) / 200);
    }
    return total;
  }

  handlePotentialMoraleHitForSkimmingSectors(groupId: number): void {
    const t = this.campaign.tactical?.state;
    if (this.hasEnteredCombatModeSinceEntering || !t?.turn.enemyInSector) return;
    const g = this.ctx.state.forces.groups.find((x) => x.id === groupId);
    if (g) g.flags |= SKIMMING_AMBUSH_FLAG;
  }

  exitSector(cmd: { readonly [key: string]: unknown }) {
    return exitSectorCommand(this, cmd);
  }
}

function fail(): never {
  throw new Error('no loaded sector');
}

export function sectorWorldPort(base: TacticalWorldPort, flowOf: () => SectorFlow | null): TacticalWorldPort {
  return {
    ...base,
    enemyInSector: () => flowOf()?.campaign.tactical?.state.turn.enemyInSector ?? base.enemyInSector(),
    hostileBloodcatsPresent: () => {
      const t = flowOf()?.campaign.tactical?.state;
      return t ? hostileBloodcatsPresent(t) : base.hostileBloodcatsPresent();
    },
    checkAndHandleUnloadingOfCurrentWorld: () => {
      flowOf()?.checkAndHandleUnloadingOfCurrentWorld();
      base.checkAndHandleUnloadingOfCurrentWorld();
    },
    enemyReinforcementsArrived: (group) => {
      const flow = flowOf();
      const t = flow?.campaign.tactical?.state;
      if (t) t.equipment.mortarsRolledByTeam = 0;
      flow?.addPossiblePendingEnemiesToBattle();
      base.enemyReinforcementsArrived(group);
    },
  };
}

function parseSector(value: unknown): Sector | null {
  if (typeof value === 'string') {
    try {
      return parseSectorString(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    const v = value as { x?: unknown; y?: unknown; z?: unknown };
    if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y, z: typeof v.z === 'number' ? v.z : 0 };
  }
  return null;
}

export interface TacticalEntrant {
  readonly life: number;
  readonly isVehicle: boolean;
  readonly betweenSectors: boolean;
  readonly assignment: number;
  readonly sector: Sector;
}

export function canGoToTacticalInSector(mercs: readonly TacticalEntrant[], sector: Sector): boolean {
  for (const m of mercs) {
    if (m.life === 0 || m.isVehicle || m.betweenSectors) continue;
    if (m.assignment === EconomyAssignment.IN_TRANSIT || m.assignment === EconomyAssignment.ASSIGNMENT_POW) continue;
    if (m.assignment === EconomyAssignment.ASSIGNMENT_DEAD) continue;
    if (sameSector(m.sector, sector)) return true;
  }
  return false;
}

function enterSectorCommand(flow: SectorFlow, cmd: { readonly [key: string]: unknown }): CommandResult {
  const sector = parseSector(cmd.sector);
  if (!sector) return refuse('badSector', "sector must be like 'B9' or {x, y, z}");
  const refusal = flow.enterSectorRefusalOf(sector);
  if (refusal) return refused(refusal);
  if (!flow.setCurrentWorldSector(sector)) return refuse('mapNotLoaded', 'sector map is not loaded');
  return { ok: true, data: { sector: sectorShortString(sector) } };
}

export function dispatchSectorCommand(
  campaign: CampaignSim,
  cmd: { readonly type: string; readonly [key: string]: unknown },
): CommandResult | null {
  const flow = campaign.sectors;
  if (!flow) return null;
  switch (cmd.type) {
    case 'enterSector':
      return enterSectorCommand(flow, cmd);
    case 'exitSector':
      return flow.exitSector(cmd);
    default:
      return null;
  }
}

export function loadStartSector(campaign: CampaignSim): void {
  const flow = campaign.sectors;
  const strategic = campaign.strategic;
  if (!flow || !strategic) return;
  flow.setCurrentWorldSector(sectorFromId(strategic.content.policy.startSector));
}
