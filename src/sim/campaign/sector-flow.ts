// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc SetCurrentWorldSector, EnterSector, PrepareLoadedSector, UpdateMercsInSector,
// @src HandleDefiniteUnloadingOfWorld, CheckAndHandleUnloadingOfCurrentWorld, HandlePotentialBringUpAutoresolveToFinishBattle,
// @src CanGoToTacticalInSector; Tactical/Tactical_Save.cc LoadCurrentSectorsInformationFromTempItemsFile,
// @src SaveCurrentSectorsInformationToTempItemFile; Enemy_Soldier_Save.cc NewWayOfLoadingEnemySoldiersFromTempFile;
// @src Strategic/Queen_Command.cc PrepareEnemyForSectorBattle (tactical side), AddPossiblePendingEnemiesToBattle;
// @src Tactical/Militia_Control.cc PrepareMilitiaForTactical, ResetMilitia; Overhead.cc HandleNPCTeamMemberDeath
// @src (strategic part); Town_Militia.cc HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap; StrategicMap.cc
// @src HandleRPCDescriptionOfSector; HandleDefiniteUnloadingOfWorld (RemoveAllActiveTimedBombs, 2026-11-04);
// @src SetCurrentWorldSector (InitAI's InitPanicSystem after EnterSector, 2026-11-04);
// @src TacticalAI/Knowledge.cc CallAvailableTeamEnemiesToAmbush; TileEngine/WorldDef.cc
// @src TrashWorld (HandleFirstMeanWhileSetUpWithTrashWorld); StrategicMap.cc EnterSector (SetupProfileInsertionDataForCivilians,
// @src HandleQuestCodeOnSectorEntry), HandleDefiniteUnloadingOfWorld (HandleQuestCodeOnSectorExit,
// @src UpdateSoldierPointerDataIntoProfile), PrepareLoadedSector (AddProfilesNotUsingProfileInsertionData,
// @src AddProfilesUsingProfileInsertionData, PostSchedules); Overhead.cc HandleNPCTeamMemberDeath (the creature queen's rewards);
// @src WorldDef.cc TrashWorld (DestroyAllSchedules; the vehicles of the soldiers not on our team, 2026-11-04);
// @src Tactical/Vehicles.cc AddSoldierToVehicle (the seat at a vehicle on the loaded map; EVENT_StopMerc's pending action
// @src for a merc or a vehicle off it, 2026-11-09); Soldier_Add.cc
// @src InternalAddSoldierToSector (the helicopter's passengers with no tile, 2026-11-05);
// @src SaveLoadGame.cc LoadSavedGame (PostSchedules); Soldier_Control.cc
// @src SoldierTakeDamage (the player activity of a hit); GameScreen.cc MainGameScreenHandle (TacticalScreenLocateToSoldier
// @src with the merc it locates, and the screen entry after a load), StrategicMap.cc UpdateMercInSector (the chopper
// @src code's AddMercToHeli), Merc_Entering.cc HandleHeliDrop (a seat placed with the north code, the arrival quotes of
// @src Soldier_Ani.cc:988, the end of a run; the drop cut short by a world unload, 2026-11-08),
// @src Squads.cc RemoveCharacterFromSquads
// @src (UpdateCurrentlySelectedMerc on the game screen), Overhead.cc
// @src RemoveSoldierFromTacticalSector and Soldier_Create.cc InternalTacticalRemoveSoldier (the selection, 2026-10-31);
// @src Squads.cc AddCharacterToSquad (SetCurrentSquad on the game screen) and RebuildCurrentSquad, SaveLoadGame.cc
// @src LoadSavedGame (the forced reselect in tactical) and SaveLoadScreen.cc SetSaveLoadExitScreen (EnterTacticalScreen)
// @src for a native import (2026-11-01); SaveLoadGame.cc LoadSavedGame (HandleRottingCorpses of
// @src LoadRottingCorpsesFromTempCorpseFile) for a native import (2026-11-01); Overhead.cc ExecuteOverhead (the LU_ENDUILOCK
// @src that ends the wait for mercs on our turn before AllMercsHaveWalkedOffSector, 2026-11-03); StrategicMap.cc EnterSector
// @src (its EndMapScreen before PrepareLoadedSector on a load from the map, 2026-11-03); StrategicMap.cc
// @src SetCurrentWorldSector (its SyncStrategicTurnTimes, the loaded sector's included), the strategic merc list as our team
// @src of the turn starts (FOR_EACH_IN_TEAM(OUR_TEAM), 2026-11-05); Map_Screen_Interface_Bottom.cc
// @src AllowedToExitFromMapscreenTo (the checks shared by every exit before those of MAP_EXIT_TO_TACTICAL; a bloodcat
// @src ambush as a battle going on, 2026-11-06); Tactical/Auto_Bandage.cc AutoBandage (PauseGame at the start, UnPauseGame
// @src and WarpGameTime with WARPTIME_NO_PROCESSING_OF_EVENTS at the end) and ShouldBeginAutoBandage's
// @src IN_DEIDRANNA_ENDGAME (2026-11-06); Strategic/Strategic_Town_Loyalty.cc HandleLoyaltyImplicationsOfMercRetreat,
// @src EnemyStrength and PlayerStrength (its bInSector, a helicopter passenger over the loaded sector's included, 2026-11-08);
// @src TileEngine/Render_Fun.cc GetRoom for Map_Screen_Interface.cc CanCharacterMoveInStrategic (the rooms of the map loaded
// @src last, which TrashWorld leaves in gubWorldRoomInfo, 2026-11-08); Tactical/Tactical_Save.cc
// @src LoadCurrentSectorsInformationFromTempItemsFile and TileEngine/SaveLoadMap.cc
// @src LoadAllMapChangesFromMapTempFileAndApplyThem (a native save's map changes and revealed tiles of a sector at its
// @src first entry, the flag reset when no record is written back, 2026-11-08).

import type { MapDoor } from '../../content/formats/map.ts';
import { decodeRevealedStatusFile } from '../../content/formats/savegame-temp-files.ts';
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
import { DIRECTION_COUNT } from '../../content/world/grid.ts';
import { compileWorldMovementCosts } from '../../content/world/movement-costs.ts';
import { restrictedScrollIdOf } from '../../content/world/render-bounds.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { idiv, u16 } from '../../core/int.ts';
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
import { inHelicopter } from '../strategic/forces/vehicles.ts';
import { townIdOfSector } from '../strategic/map/control.ts';
import { loadScreenId } from '../strategic/map/loading-screen.ts';
import { damageSamIfFound } from '../strategic/map/sam.ts';
import {
  findUndergroundSector,
  getSectorFlagStatus,
  hurtingEnemiesCountsAsActivity,
  isSectorDesert,
  resetSectorFlag,
  sectorInfo,
  setSectorFlag,
  setVisibleItemCount,
  updateLastDayOfPlayerActivity,
} from '../strategic/map/sectors.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../strategic/narrative/facts.ts';
import { okayToUpgradeEliteToSpecialProfiledEnemy } from '../strategic/narrative/profiled-enemies.ts';
import { ExperienceBonus } from '../strategic/narrative/rewards.ts';
import type { SectorPosition } from '../strategic/state.ts';
import { CompressMode, Warp } from '../strategic/time/constants.ts';
import { timeOfDayAmbientLightLevel } from '../strategic/time/environment.ts';
import { pauseGame, setGameTimeCompressionLevel, unPauseGame, warpGameTime, worldDay, worldHour } from '../strategic/time/world-clock.ts';
import { initPanicSystem } from '../tactical/ai/panic-triggers.ts';
import { removeAllActiveTimedBombs } from '../tactical/bombs/bomb-queue.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { handleRottingCorpses } from '../tactical/crows.ts';
import { loadDoorStatusArray, storedDoorStatuses, updateDoorGraphicsFromStatus } from '../tactical/doors/door-status.ts';
import { callAvailableEnemiesTo } from '../tactical/doors/door-traps.ts';
import { openableStatuses } from '../tactical/doors.ts';
import { beginMapEdgepointSearch, chooseMapEdgepoint, endMapEdgepointSearch, loadMapEdgepoints } from '../tactical/edgepoints.ts';
import { sharedWeaponsDropped } from '../tactical/equipment.ts';
import { addMercToHeli } from '../tactical/helicopter-drop.ts';
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
import { CENTER_GRIDNO, type InsertionContext, type InsertionOrder, updateMercInSector } from '../tactical/insertion.ts';
import { handleAllReachableItemsInTheSector } from '../tactical/item-reachability.ts';
import { lightSpriteRenderAll } from '../tactical/lighting/lighting.ts';
import { sectorTempFileChanges } from '../tactical/map-changes.ts';
import { drawFirstCreatureTenseQuoteDelay } from '../tactical/narrative/creature-tension.ts';
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
import { loadAllMapChangesFromMapTempFile, loadRevealedStatusFromRevealedTempFile } from '../tactical/native-temp-files.ts';
import { type Refusal, refuse, refused } from '../tactical/refusal.ts';
import { initLoadedWorld, loadSavedSectorChanges, NO_SAVED_SECTOR_CHANGES, type SavedSectorChanges } from '../tactical/save-import.ts';
import { hostileBloodcatsPresent, removeSoldierFromTacticalSector } from '../tactical/sector-presence.ts';
import {
  enterTacticalScreen,
  enterTacticalScreenAfterLoad,
  locateToSoldier,
  NO_SELECTION,
  rebuildCurrentSquad,
  selectAfterRemovalFromSector,
  setCurrentSquadAfterJoin,
  setDefaultSquadOnSectorEntry,
  unselectRemovedSoldier,
  updateCurrentlySelectedMerc,
} from '../tactical/selection.ts';
import { Body, OKLIFE, Side, type Soldier, SoldierClass, Team } from '../tactical/soldier.ts';
import { type RealtimeClock, type SectorHooks, sectorMapOf, type TacticalState, teamMembers, WaitForMercs } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { syncStrategicTurnTimes } from '../tactical/turns/turns.ts';
import {
  seatAtVehicle,
  seatInTheHelicopterOnSectorEntry,
  seatWithNoVehicleOnTheMap,
  stopAsBoardedAwayFromTheVehicle,
} from '../tactical/vehicle-passengers.ts';
import { removeVehiclesNotOnOurTeam } from '../tactical/vehicle-soldiers.ts';
import { addItemToPool, loadWorldItemsFromMap, trashWorldItems, Visibility } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { handleMurderOfCivilian } from './civilian-murder.ts';
import { lastMapRooms, type SectorFlowState } from './flow-state.ts';
import { cutHelicopterDropShort, handleFirstHeliDropOfGame, landHelicopterSeatsOfANativeSave } from './helicopter-drop-flow.ts';
import { syncInterfaceLockPause } from './interface-lock-pause.ts';
import { mapScreenExitRefusalOf } from './map-screen-exits.ts';
import { MoraleEvent as CampaignMoraleEvent } from './morale.ts';
import {
  GUIDE_DESCRIPTION_COUNTDOWN_RANGE,
  guideDescriptionFor,
  handleRpcDescription,
  startGuideCountdown,
} from './narrative/guide-description.ts';
import { onTacticalMap, type Roster, type RosterMerc, registeredInTactical } from './roster.ts';
import { endMapScreenForSectorLoad, returnToLoadedSector } from './screens.ts';
import {
  addDiffWorldItems,
  applyPreservedEnemyRecord,
  captureBloodAndSmell,
  captureLights,
  captureRevealed,
  captureSmoke,
  captureWorldItems,
  dropSavedTempFileRecords,
  emptySectorDiff,
  loadPreservedCivilians,
  preserveSoldiers,
  restoreBloodAndSmell,
  restoreCorpses,
  restoreLights,
  restoreMapChanges,
  restoreOpenables,
  restoreRevealed,
  restoreSmoke,
  type SectorDiff,
  sectorKey,
  visibleItemCount,
} from './sector-diff.ts';
import {
  type AdjacentJump,
  allMercsHaveWalkedOffSector,
  allMercsWalkedToExitGrid,
  exitSectorCommand,
  mercFellIntoPit,
} from './sector-exits.ts';
import { addCorpsesToBloodcatLair } from './sector-loot.ts';
import { lookForSomeoneElseInSectorLater } from './someone-else-in-sector.ts';
import { campaignTurnHooks, installCampaignPorts } from './turn-world.ts';
import { loadedSectorVehicles } from './vehicle-boarding.ts';

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
      readonly located?: number;
    };

export const UnloadCode = { ABOUT_TO_LOAD_NEW_MAP: 0, ABOUT_TO_TRASH_WORLD: 1 } as const;

export interface LoadOptions {
  readonly autoPlacement?: boolean;
  readonly battleLocatorShown?: boolean;
}

const PALACE: Sector = { x: 3, y: 16, z: 0 };
const STATUE_SECTOR: Sector = { x: 3, y: 15, z: 0 };
const REBEL_HIDEOUT: Sector = { x: 10, y: 1, z: 0 };
const PRESERVED_ENEMY_MAX_AGE_MINUTES = 300;
const CROWS_POSSIBLE_BASE = 5;
const CROWS_POSSIBLE_RANGE = 5;
const NO_DIFFICULTY_TOWN = 0;
const NO_ROOM = 0;
const SECONDS_PER_MINUTE = 60;
const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const SKIMMING_AMBUSH_FLAG = 0x10;

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
      removeFromGridNo: (merc) => this.#seatWithNoTile(merc),
      selectAfterRemoval: (merc) => this.#withTactical((t) => selectAfterRemovalFromSector(t, merc.soldier)),
      unselect: (merc) => this.#withTactical((t) => unselectRemovedSoldier(t, merc.soldier)),
      updateMercInSector: (merc) => this.updateMercInSector(merc),
      roomOf: (merc) => this.#lastMapRoom(merc.soldier.gridNo),
      seatAtVehicle: (merc, vehicle) => this.#seatAtVehicle(merc, vehicle),
    };
  }

  #mercsOutOfTheSector(): void {
    for (const m of this.setup.roster.all()) {
      m.soldier.placed = false;
      m.soldier.offMap = false;
    }
  }

  #seatWithNoTile(merc: RosterMerc): void {
    const t = this.campaign.tactical?.state;
    if (t && registeredInTactical(t, merc)) seatWithNoVehicleOnTheMap(t, merc.soldier);
  }

  #seatAtVehicle(merc: RosterMerc, vehicle: RosterMerc): void {
    const t = this.campaign.tactical?.state ?? null;
    const onTheMap = t !== null && onTacticalMap(t, merc);
    if (t && onTheMap && onTacticalMap(t, vehicle)) {
      seatAtVehicle(t, merc.soldier, vehicle.soldier);
      return;
    }
    stopAsBoardedAwayFromTheVehicle(t, merc.soldier);
    if (onTheMap) this.setup.roster.removeFromGridNo(merc.id);
  }

  #lastMapRoom(gridNo: number): number {
    return lastMapRooms(this.campaign.state, this.campaign.tactical?.state ?? null)?.[gridNo] ?? NO_ROOM;
  }

  get #flow(): SectorFlowState {
    return this.campaign.state.sectorFlow;
  }

  #withTactical(act: (t: TacticalState) => void): void {
    const t = this.campaign.tactical?.state;
    if (t) act(t);
  }

  set preferredSelection(id: number) {
    this.#flow.preferredSelection = id;
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
    return idiv(this.campaign.state.clock.seconds, SECONDS_PER_MINUTE);
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
    if (world && world.x === REBEL_HIDEOUT.x && world.y === REBEL_HIDEOUT.y) found.push({ ...REBEL_HIDEOUT, z: 1 });
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
    const exit = mapScreenExitRefusalOf(this.campaign);
    if (exit) return exit;
    const world = this.world;
    if (this.#battleGoingOn() && world && !sameSector(world, sector))
      return { token: 'battleElsewhere', reason: 'enemies are present in the loaded sector' };
    if (!this.canGoToTacticalInSector(sector)) return { token: 'noMercThere', reason: 'no merc of yours can go there' };
    if (!this.setup.worlds.world(this.mapPathOf(sector))) return { token: 'mapNotLoaded', reason: 'sector map is not loaded' };
    return null;
  }

  #battleGoingOn(): boolean {
    const t = this.campaign.tactical?.state;
    if (!t) return false;
    if (t.inCombat || t.turn.enemyInSector) return true;
    return this.campaign.state.encounter.code === EncounterCode.BLOODCAT_AMBUSH && hostileBloodcatsPresent(t);
  }

  setCurrentWorldSector(sector: Sector, options: LoadOptions = {}): boolean {
    const s = this.campaign.state;
    syncStrategicTurnTimes(this.realtimeClock, s.realMs);
    const world = this.world;
    if (world && this.campaign.tactical && sameSector(world, sector)) {
      this.#reenterLoadedSector();
      returnToLoadedSector(this.campaign);
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
    this.#flow.trashedMapRooms = null;
    s.map.selectedSector = { ...sector };
    if (sameSector(sector, TIXA_CAVE)) this.campaign.creatures?.initQuest();
    handleHelicopterOnGround(this.ctx, false);
    const enemyPresence = this.#whileLoading(() => this.#enterSector(sector, baseWorld, options, previous));
    const day = worldDay(s.clock);
    setSectorFlag(s.map, sector, SectorFlag.ALREADY_LOADED, day);
    handleHelicopterOnGround(this.ctx, true);
    this.#handleRpcDescriptionOfSector(sector, day);
    setSectorFlag(s.map, sector, SectorFlag.HAS_ENTERED_TACTICAL, day);
    this.hasEnteredCombatModeSinceEntering = false;
    this.#flow.crows.dontAddNew = false;
    drawFirstCreatureTenseQuoteDelay(this.#flow.realtimeClock, s.rng);
    this.#flow.crows.possible = CROWS_POSSIBLE_BASE + s.rng.int(CROWS_POSSIBLE_RANGE);
    s.flow = 'tactical';
    setGameTimeCompressionLevel(this.campaign.clockContext, CompressMode.X1);
    const located = this.#selectOnArrival();
    this.#event({
      type: 'sectorLoaded',
      sector: sectorShortString(sector),
      hostiles: numHostilesInSector(this.ctx, sector),
      loadScreen: this.#loadScreenView(),
      ...(enemyPresence ? { enemyPresence: true as const } : {}),
      ...(located !== null ? { located } : {}),
    });
    return true;
  }

  #selectOnArrival(): number | null {
    const t = this.campaign.tactical?.state;
    if (!t) return null;
    const preferred = this.#flow.preferredSelection;
    this.#flow.preferredSelection = NO_SELECTION;
    const located = locateToSoldier(t, t.soldiers[preferred] ?? null);
    enterTacticalScreen(t);
    return located?.id ?? null;
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

  #structureDamaged(gridNo: number, damage: number): void {
    const world = this.world;
    if (world) damageSamIfFound(this.ctx, world, gridNo, damage);
  }

  #inCreatureLair(): boolean {
    const world = this.world;
    return world !== null && (this.campaign.creatures?.inCreatureLair(world) ?? false);
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
    handleHelicopterOnGround(this.ctx, true);
    this.resetMilitia();
    this.campaign.tactical?.lookAround();
  }

  #worldWithDoorTable(world: TacticalWorld, doors: readonly MapDoor[] | null): TacticalWorld {
    if (!doors) return world;
    return { ...world, map: { ...world.map, doors: [...doors] } };
  }

  #timeOfDayAmbientLightLevel(sector: SectorPosition): number {
    const s = this.campaign.state;
    return timeOfDayAmbientLightLevel(s.env, sector.z, sector.z === 0 && isSectorDesert(s.map, sector));
  }

  #createTactical(sector: Sector, world: TacticalWorld): TacticalSim {
    const s = this.campaign.state;
    const dayAmbient = this.#timeOfDayAmbientLightLevel(sector);
    const sim = new TacticalSim(world, this.setup.content, 0, {
      options: s.options,
      streams: { rng: s.rng, pre: s.pre },
      profiles: s.profiles,
      vehicles: s.forces.vehicles,
      keyTable: s.keyTable,
      civGroups: s.civGroups,
      boxing: s.narrative.boxing,
      startMs: s.realMs,
      realtimeClock: this.realtimeClock,
      crows: this.#flow.crows,
      autoBandage: this.#flow.autoBandage,
      helicopterDrop: this.#flow.helicopterDrop,
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
    installCampaignPorts(this.campaign, sim.state);
    sim.state.timeOfDayLight = {
      ambientLevel: () => {
        const world = this.world;
        return world ? this.#timeOfDayAmbientLightLevel(world) : null;
      },
    };
    sim.state.sectorHooks = this.#loadedSectorHooks();
  }

  #loadedSectorHooks(): SectorHooks {
    return {
      ...campaignTurnHooks(this.campaign),
      soldierDied: (_t, dead) => this.#soldierDied(dead),
      murderOfCivilian: (t, dead) => this.#murderOfCivilian(t, dead),
      soldierTakingDamage: (_t, hurt) => this.#soldierTakingDamage(hurt),
      addPendingEnemies: () => this.addPossiblePendingEnemiesToBattle(),
      soldierLeftMap: (_t, gone) => this.#soldierLeftMap(gone),
      soldierFellIntoPit: (_t, fallen, below) => mercFellIntoPit(this, fallen, below),
      mercsWaitOver: (_t, code) => {
        this.#pendingWait = code;
      },
      mercDied: (_t, dead) => this.campaign.battle?.mercDiedInTactical(dead),
      pendingEnemies: () => this.campaign.battle?.pendingEnemies() ?? false,
      militiaFinishBattle: (t) => this.campaign.battle?.militiaFinishBattle(t) ?? false,
      battleLost: (t) => this.campaign.battle?.battleLost(t),
      battleEnded: (t, result) => this.campaign.battle?.tacticalBattleEnded(t, result === 'won'),
      battleWon: (t) => lookForSomeoneElseInSectorLater(this.campaign, t),
      combatEntered: () => this.#combatEntered(),
      enemyPresence: () => this.#enemyPresence(),
      structureDamaged: (_t, gridNo, damage) => this.#structureDamaged(gridNo, damage),
      inCreatureLair: () => this.#inCreatureLair(),
      worldLoaded: () => true,
      autoBandageStarted: () => pauseGame(this.campaign.state.clock),
      autoBandageEnded: (_t, warpSeconds) => this.#autoBandageEnded(warpSeconds),
      inDeidrannaEndgame: () => this.campaign.state.ending.inDeidrannaEndgame,
      helicopterSeat: (_t, id) => this.setup.roster.get(id)?.soldier ?? null,
      placeHelicopterSeat: (_t, s) => this.#placeHelicopterSeat(s),
      mercArrivesQuotes: (_t, s) => this.campaign.contracts?.droppedFromHelicopter(s.id),
      helicopterRunEnded: (t) => handleFirstHeliDropOfGame(this.campaign, t),
    };
  }

  #autoBandageEnded(warpSeconds: number): void {
    unPauseGame(this.campaign.state.clock);
    warpGameTime(this.campaign.clockContext, warpSeconds, Warp.NO_PROCESSING);
  }

  adoptLoadedSector(
    links: readonly { readonly nodeId: number; readonly soldierId: number }[],
    saved: SavedSectorChanges = NO_SAVED_SECTOR_CHANGES,
  ): boolean {
    const sim = this.campaign.tactical;
    const world = this.world;
    if (!sim || !world) return true;
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
    const mapModificationsKept = loadSavedSectorChanges(sim, saved, () => handleHelicopterOnGround(this.ctx, true));
    handleRottingCorpses(t);
    this.postSchedulesOfLoadedSector(t, true);
    if (this.campaign.state.flow === 'tactical') enterTacticalScreenAfterLoad(t);
    landHelicopterSeatsOfANativeSave(this.campaign);
    return mapModificationsKept;
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
    this.#mercsOutOfTheSector();
    if (!this.#inMeanwhile()) setSectorFlag(s.map, sector, SectorFlag.ALREADY_VISITED, worldDay(s.clock));
    const diff = s.sectorDiffs.get(sectorKey(sector)) ?? null;
    const doorTable = diff && getSectorFlagStatus(s.map, sector, SectorFlag.DOOR_TABLE_TEMP_FILES_EXISTS) ? diff.doorTable : null;
    const sim = this.#createTactical(sector, this.#worldWithDoorTable(baseWorld, doorTable));
    this.campaign.tactical = sim;
    handleHelicopterOnGround(this.ctx, true);
    this.#loadCurrentSectorsInformation(sector, diff);
    if (options.autoPlacement) this.#chooseRandomEdgepoints(sector);
    if (s.flow === 'strategic') endMapScreenForSectorLoad(this.campaign);
    this.prepareLoadedSector(options);
    initPanicSystem(sim.state);
    updateDoorGraphicsFromStatus(sim.state);
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
      t.world.costs.replaceWith(compileWorldMovementCosts(t.world).values);
      return;
    }
    if (diff) {
      this.#loadItemDiff(sector, diff);
      if (diff.corpses && this.#flagged(sector, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS)) {
        const inTown = sector.z === 0 && townIdOfSector(this.ctx, sector) !== NO_DIFFICULTY_TOWN;
        restoreCorpses(t, diff.corpses, { nowMinute: now, inTown, loadingSave: false });
      }
      if (this.#flagged(sector, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)) {
        this.#loadSavedMapModifications(sector, diff);
        if (diff.mapChanges) restoreMapChanges(t, diff.mapChanges);
        if (diff.bloodSmell) restoreBloodAndSmell(t, diff.bloodSmell);
      }
      if (diff.openables) restoreOpenables(t, diff.openables);
      if (this.#flagged(sector, SectorFlag.REVEALED_STATUS_TEMP_FILE_EXISTS)) {
        if (diff.savedRevealed) loadRevealedStatusFromRevealedTempFile(t, decodeRevealedStatusFile(diff.savedRevealed));
        else if (diff.revealed) restoreRevealed(t, diff.revealed);
      }
      if (diff.doorStatus && this.#flagged(sector, SectorFlag.DOOR_STATUS_TEMP_FILE_EXISTS)) loadDoorStatusArray(t, diff.doorStatus);
      if (diff.enemies && this.#flagged(sector, SectorFlag.ENEMY_PRESERVED_TEMP_FILE_EXISTS)) this.#loadPreservedEnemies(sector, diff);
      if (diff.civilians && this.#flagged(sector, SectorFlag.CIV_PRESERVED_TEMP_FILE_EXISTS))
        loadPreservedCivilians(t, diff.civilians, now);
      if (diff.smoke && this.#flagged(sector, SectorFlag.SMOKE_EFFECTS_TEMP_FILE_EXISTS)) restoreSmoke(t, diff.smoke);
      if (diff.lights && this.#flagged(sector, SectorFlag.LIGHTING_EFFECTS_TEMP_FILE_EXISTS)) restoreLights(t, diff.lights);
      dropSavedTempFileRecords(diff);
    }
    initLoadedWorld(t);
    if (sector.z === 0 && sectorInfo(s.map, sector).timeLastPlayerLiberated !== 0) stripEnemyDetailedPlacements(t, this.populationEnv());
  }

  #loadSavedMapModifications(sector: Sector, diff: SectorDiff): void {
    const t = this.campaign.tactical?.state;
    const saved = diff.savedMapModifications;
    if (!t || !saved) return;
    const writtenBack = loadAllMapChangesFromMapTempFile(t, saved) || diff.mapChanges !== null;
    if (!writtenBack) resetSectorFlag(this.campaign.state.map, sector, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS);
  }

  #loadItemDiff(sector: Sector, diff: SectorDiff): void {
    const t = this.campaign.tactical?.state;
    if (!t || !diff.items || !this.#flagged(sector, SectorFlag.ITEM_TEMP_FILE_EXISTS)) return;
    if (this.#flagged(sector, SectorFlag.ALREADY_LOADED)) trashWorldItems(t);
    addDiffWorldItems(t, diff.items, t.world.map?.info.centerGridNo ?? CENTER_GRIDNO);
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
    callAvailableEnemiesTo(t, center);
  }

  #insertionContext(m: RosterMerc | null): InsertionContext {
    const world = this.world ?? { x: 0, y: 0, z: 0 };
    const start = this.ctx.content.policy.startSector;
    return {
      worldSector: world,
      mercSector: m?.sector ?? world,
      startSector: { x: (start % 16) + 1, y: idiv(start, 16) + 1, z: 0 },
      usingEdgepoints: this.usingEdgepointsForEntry,
      assignment: m?.assignment ?? 0,
      asleep: m?.asleep ?? false,
      isEpc: m?.isEpc ?? false,
      heliDrop: (s) => addMercToHeli(this.#flow.helicopterDrop, s.id),
    };
  }

  #placeHelicopterSeat(s: Soldier): void {
    const m = this.setup.roster.get(s.id);
    if (!m) return;
    m.insertionCode = InsertionCode.NORTH;
    this.#placeMerc(m);
  }

  removedFromSquad(id: number, squad: number): void {
    const c = this.campaign;
    const merc = this.setup.roster.get(id);
    if (!merc || c.state.flow !== 'tactical' || squad !== c.state.forces.currentSquad) return;
    this.#withTactical((t) => updateCurrentlySelectedMerc(t, merc.soldier));
  }

  addedToSquad(id: number, squad: number): void {
    const merc = this.setup.roster.get(id);
    if (merc) this.#withTactical((t) => setCurrentSquadAfterJoin(t, merc.soldier, squad));
  }

  setDefaultSquadOnSectorEntry(force: boolean): void {
    this.#withTactical((t) => setDefaultSquadOnSectorEntry(t, force));
  }

  rebuildCurrentSquad(): void {
    this.#withTactical((t) => rebuildCurrentSquad(t));
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
    if (m.isPassengerOrDriver && inHelicopter(this.ctx, m)) {
      seatInTheHelicopterOnSectorEntry(t, m.soldier);
      return;
    }
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

  addCorpsesToBloodcatLair(sector: Sector): void {
    const state = this.campaign.state;
    addCorpsesToBloodcatLair(state, this.setup.content.corpses.table, sector, state.cosmetic.movement.int(DIRECTION_COUNT));
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

  #murderOfCivilian(t: TacticalState, dead: Soldier): void {
    const world = this.world;
    const economy = this.economy;
    if (world && economy) handleMurderOfCivilian(economy, t, dead, world);
  }

  #soldierTakingDamage(hurt: Soldier): void {
    const world = this.world;
    if (!world) return;
    const map = this.campaign.state.map;
    if (hurt.team === Team.CREATURE || (hurt.team === Team.ENEMY && hurtingEnemiesCountsAsActivity(map, world)))
      updateLastDayOfPlayerActivity(map, u16(worldDay(this.campaign.state.clock)));
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
    syncInterfaceLockPause(this.campaign);
    const code = this.#pendingWait;
    if (code === null) return;
    this.#pendingWait = null;
    if (code === WaitForMercs.WALKOFF_SCREEN) allMercsHaveWalkedOffSector(this);
    else if (code === WaitForMercs.WALK_TO_GRIDNO) allMercsWalkedToExitGrid(this);
    syncInterfaceLockPause(this.campaign);
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
    const mapChanges = sectorTempFileChanges(t.mapChanges);
    diff.mapChanges = mapChanges.length > 0 ? mapChanges : null;
    diff.bloodSmell = captureBloodAndSmell(t);
    mark(SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS, diff.mapChanges !== null || diff.bloodSmell.length > 0);
    diff.doorTable = [...t.world.mapDoors.values()];
    mark(SectorFlag.DOOR_TABLE_TEMP_FILES_EXISTS, true);
    diff.revealed = captureRevealed(t);
    mark(SectorFlag.REVEALED_STATUS_TEMP_FILE_EXISTS, true);
    diff.doorStatus = storedDoorStatuses(t);
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
    removeAllActiveTimedBombs(t);
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
    if (s.didGameJustStart && world.z === 0 && world.x === (start % 16) + 1 && world.y === idiv(start, 16) + 1) return false;
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
    cutHelicopterDropShort(this.campaign, (id) => this.#giveNorthCode(id));
    const t = this.campaign.tactical?.state;
    if (t) {
      destroyAllSchedules(t);
      removeVehiclesNotOnOurTeam(t);
    }
    const q = this.queen;
    if (q) handleFirstMeanwhileSetUpWithTrashWorld(q);
  }

  #giveNorthCode(id: number): void {
    const m = this.setup.roster.get(id);
    if (m) m.insertionCode = InsertionCode.NORTH;
  }

  trashWorld(): void {
    const world = this.world;
    const sim = this.campaign.tactical;
    if (sim) {
      this.campaign.state.sectorFlow.trashedMapRestrictedScroll = restrictedScrollIdOf(sim.world);
      this.campaign.state.sectorFlow.trashedMapRooms = sectorMapOf(sim.state).rooms.slice();
      this.#worldTrashed();
    }
    this.campaign.tactical = null;
    this.#mercsOutOfTheSector();
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
        idiv(m.prevSectorId, 16) + 1 === world.y &&
        m.sector.z === world.z;
      if (m.inSector || leftThisSector) total += idiv(s.life * (s.breathMax + 100), 200);
    }
    return total;
  }

  #enemyStrength(): number {
    const t = this.campaign.tactical?.state;
    let total = 0;
    for (const s of t?.soldiers ?? []) {
      if (!s?.placed || s.team === Team.OUR || s.neutral) continue;
      total += idiv(s.life * (s.breathMax + 100), 200);
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
    addCorpsesToBloodcatLair: (sector) => {
      const flow = flowOf();
      if (flow) flow.addCorpsesToBloodcatLair(sector);
      else base.addCorpsesToBloodcatLair(sector);
    },
    enemyReinforcementsArrived: (group) => {
      const flow = flowOf();
      const t = flow?.campaign.tactical?.state;
      if (t) t.equipment.mortarsRolledByTeam = 0;
      flow?.addPossiblePendingEnemiesToBattle();
      base.enemyReinforcementsArrived(group);
    },
    removedFromSquad: (id, squad) => {
      flowOf()?.removedFromSquad(id, squad);
      base.removedFromSquad?.(id, squad);
    },
    addedToSquad: (id, squad) => {
      flowOf()?.addedToSquad(id, squad);
      base.addedToSquad?.(id, squad);
    },
    rebuildCurrentSquad: () => {
      flowOf()?.rebuildCurrentSquad();
      base.rebuildCurrentSquad?.();
    },
    loadedVehicles: loadedSectorVehicles(() => flowOf()?.campaign ?? null),
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
