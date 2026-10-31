// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/LoadSaveTacticalStatusType.cc ExtractTacticalStatusTypeFromFile; Strategic/Game_Clock.cc LoadGameClock;
// @src SaveLoadGame.cc LoadGeneralInfo, LoadOppListInfoFromSavedGame, LoadWatchedLocsFromSavedGame;
// @src Tactical/TeamTurns.cc LoadTeamTurnsFromTheSavedGameFile

import { i8 } from '../../core/int.ts';
import type { SaveCursor } from './savegame-cursor.ts';
import type { SavedGameOptions, SectorPosition } from './savegame-header.ts';
import { field, type Layout, type LayoutRecord, layoutBytes, linuxPadding, linuxSkip, readLayout, skip } from './savegame-layout.ts';

export const MAX_TEAMS = 6;
export const TOTAL_SOLDIERS = 156;
export const NOBODY = TOTAL_SOLDIERS;
export const INCOMBAT = 0x00040000;
const NUM_CIV_GROUPS = 20;
const NUM_PANIC_TRIGGERS = 3;
const NUM_WATCHED_LOCS = 3;
const MAX_MERCS = 148;
const CLOCK_PADDING = 20;
const GENERAL_INFO_BYTES = 1024;
const TEAM_TURNS_PADDING = 17;
const GAME_OPTIONS_PADDING = 7;
const NUM_BOXERS = 3;
const NUMBER_OF_REFUEL_SITES = 2;
const NUMBER_OF_SQUADS = 20;
const NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD = 6;
const SAVED_SAM_SITES = 4;

const TEAM_LAYOUT: Layout = [
  field('bFirstID', 'u8'),
  field('bLastID', 'u8'),
  skip(2),
  field('RadarColor', 'u32'),
  field('bSide', 'u8'),
  field('bMenInSector', 'i8'),
  field('last_merc_to_radio', 'u8'),
  skip(1),
  field('bAwareOfOpposition', 'i8'),
  field('bHuman', 'i8'),
  skip(2),
];

export const TACTICAL_STATUS_LAYOUT: Layout = [
  field('uiFlags', 'u32'),
  ...Array.from({ length: MAX_TEAMS }, (_, t) =>
    TEAM_LAYOUT.map((e) => (e.kind === 'scalar' ? { ...e, name: `Team${t}.${e.name}` } : e)),
  ).flat(),
  field('ubCurrentTeam', 'u8'),
  skip(1),
  field('sSlideTarget', 'i16'),
  skip(4),
  field('uiTimeSinceMercAIStart', 'u32'),
  field('fPanicFlags', 'i8'),
  skip(5),
  field('ubSpottersCalledForBy', 'u8'),
  field('the_chosen_one', 'u8'),
  field('uiTimeOfLastInput', 'u32'),
  field('uiTimeSinceDemoOn', 'u32'),
  skip(7),
  field('fCivGroupHostile', 'u8', NUM_CIV_GROUPS),
  field('ubLastBattleSectorX', 'u8'),
  field('ubLastBattleSectorY', 'u8'),
  field('fLastBattleWon', 'bool'),
  skip(2),
  field('fVirginSector', 'bool'),
  field('fEnemyInSector', 'bool'),
  field('fInterruptOccurred', 'bool'),
  field('bRealtimeSpeed', 'i8'),
  skip(2),
  field('enemy_sighting_on_their_turn_enemy', 'u8'),
  skip(1),
  field('fEnemySightingOnTheirTurn', 'bool'),
  field('fAutoBandageMode', 'bool'),
  field('ubAttackBusyCount', 'u8'),
  skip(1),
  field('ubEngagedInConvFromActionMercID', 'u8'),
  skip(1),
  field('usTactialTurnLimitCounter', 'u16'),
  field('fInTopMessage', 'bool'),
  field('ubTopMessageType', 'u8'),
  linuxPadding(40, 82),
  field('usTactialTurnLimitMax', 'u16'),
  linuxSkip(2),
  field('uiTactialTurnLimitClock', 'u32'),
  field('fTactialTurnLimitStartedBeep', 'bool'),
  field('bBoxingState', 'i8'),
  field('bConsNumTurnsNotSeen', 'i8'),
  field('ubArmyGuysKilled', 'u8'),
  field('sPanicTriggerGridNo', 'i16', NUM_PANIC_TRIGGERS),
  field('bPanicTriggerIsAlarm', 'i8', NUM_PANIC_TRIGGERS),
  field('ubPanicTolerance', 'u8', NUM_PANIC_TRIGGERS),
  field('fAtLeastOneGuyOnMultiSelect', 'bool'),
  skip(2),
  field('fKilledEnemyOnAttack', 'bool'),
  field('enemy_killed_on_attack', 'u8'),
  field('bEnemyKilledOnAttackLevel', 'i8'),
  field('ubEnemyKilledOnAttackLocation', 'u16'),
  field('fItemsSeenOnAttack', 'bool'),
  field('items_seen_on_attack_soldier', 'u8'),
  skip(2),
  field('usItemsSeenOnAttackGridNo', 'u16'),
  field('fLockItemLocators', 'bool'),
  field('ubLastQuoteSaid', 'u8'),
  field('ubLastQuoteProfileNUm', 'u8'),
  field('fCantGetThrough', 'bool'),
  field('sCantGetThroughGridNo', 'i16'),
  field('sCantGetThroughSoldierGridNo', 'i16'),
  field('cant_get_through', 'u8'),
  field('fDidGameJustStart', 'bool'),
  skip(1),
  field('ubLastRequesterTargetID', 'u8'),
  skip(1),
  field('ubNumCrowsPossible', 'u8'),
  skip(4),
  field('fUnLockUIAfterHiddenInterrupt', 'bool'),
  field('bNumFoughtInBattle', 'i8', MAX_TEAMS),
  skip(1),
  field('uiDecayBloodLastUpdate', 'u32'),
  field('uiTimeSinceLastInTactical', 'u32'),
  field('fHasAGameBeenStarted', 'bool'),
  field('bConsNumTurnsWeHaventSeenButEnemyDoes', 'i8'),
  field('fSomeoneHit', 'bool'),
  skip(1),
  field('uiTimeSinceLastOpplistDecay', 'u32'),
  field('bMercArrivingQuoteBeingUsed', 'i8'),
  field('enemy_killed_on_attack_killer', 'u8'),
  field('fCountingDownForGuideDescription', 'bool'),
  field('bGuideDescriptionCountDown', 'i8'),
  field('ubGuideDescriptionToUse', 'u8'),
  field('bGuideDescriptionSectorX', 'i8'),
  field('bGuideDescriptionSectorY', 'i8'),
  field('fEnemyFlags', 'i8'),
  field('fAutoBandagePending', 'bool'),
  field('fHasEnteredCombatModeSinceEntering', 'bool'),
  field('fDontAddNewCrows', 'bool'),
  skip(1),
  field('sCreatureTenseQuoteDelay', 'u16'),
  skip(2),
  field('uiCreatureTenseQuoteLastUpdate', 'u32'),
];

const GENERAL_INFO_HEAD: Layout = [
  field('screen_after_loading', 'u32'),
  field('guiCurrentUniqueSoldierId', 'u32'),
  field('ubMusicModeToPlay', 'u8'),
  skip(1),
  field('sel', 'u16'),
  field('gsRenderCenterX', 'i16'),
  field('gsRenderCenterY', 'i16'),
  field('gfAtLeastOneMercWasHired', 'bool'),
  field('fShowItemsFlag', 'bool'),
  field('fShowTownFlag', 'bool'),
  field('fShowTeamFlag', 'bool'),
  field('fShowMineFlag', 'bool'),
  field('fShowAircraftFlag', 'bool'),
  skip(2),
  field('iHelicopterVehicleId', 'i32'),
  skip(4),
  field('iTotalAccumulatedCostByPlayer', 'i32'),
  skip(10),
  field('fHelicopterIsAirBorne', 'bool'),
  field('fHeliReturnStraightToBase', 'bool'),
  field('fHoveringHelicopter', 'bool'),
  skip(3),
  field('uiStartHoverTime', 'u32'),
  field('guiHelicopterSkyriderTalkState', 'u32'),
  field('fShowEstoniRefuelHighLight', 'bool'),
  field('fShowOtherSAMHighLight', 'bool'),
  field('fShowDrassenSAMHighLight', 'bool'),
  skip(1),
  field('guiEnvWeather', 'u32'),
  field('gubDefaultButton', 'u8'),
  field('gfSkyriderEmptyHelpGiven', 'bool'),
  field('fEnterMapDueToContract', 'bool'),
  field('gubHelicopterHitsTaken', 'u8'),
  skip(1),
  field('gfSkyriderSaidCongratsOnTakingSAM', 'bool'),
  field('contract_rehire_soldier', 'i16'),
  field('fGunNut', 'bool'),
  field('fSciFi', 'bool'),
  field('ubDifficultyLevel', 'u8'),
  field('fTurnTimeLimit', 'bool'),
  field('ubGameSaveMode', 'u8'),
  skip(GAME_OPTIONS_PADDING),
  skip(4),
  field('guiBaseJA2Clock', 'u32'),
  field('cur_interface_panel', 'i16'),
  field('sm_current_merc', 'u8'),
  skip(1),
  field('fDisableDueToBattleRoster', 'bool'),
  field('fDisableMapInterfaceDueToBattle', 'bool'),
  field('gsBoxerGridNo', 'i16', NUM_BOXERS),
  field('gBoxer', 'u8', NUM_BOXERS),
  field('gfBoxerFought', 'bool', NUM_BOXERS),
  field('fHelicopterDestroyed', 'bool'),
  skip(1),
  field('giSortStateForMapScreenList', 'i32'),
  field('fFoundTixa', 'bool'),
  skip(3),
  field('guiTimeOfLastSkyriderMonologue', 'u32'),
  field('fShowCambriaHospitalHighLight', 'bool'),
  field('fSkyRiderSetUp', 'bool'),
  field('fRefuelingSiteAvailable', 'bool', NUMBER_OF_REFUEL_SITES),
  field('meanwhile_sector_x', 'i16'),
  field('meanwhile_sector_y', 'i16'),
  field('meanwhile_trigger', 'u16'),
  field('meanwhile_id', 'u8'),
  field('meanwhile_npc', 'u8'),
  field('gubPlayerProgressSkyriderLastCommentedOn', 'u8'),
  field('gfMeanwhileTryingToStart', 'bool'),
  field('gfInMeanwhile', 'bool'),
  skip(1),
  field('sDeadMercs', 'i16', NUMBER_OF_SQUADS * NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD),
  field('gbPublicNoiseLevel', 'i8', MAX_TEAMS),
  field('gubScreenCount', 'u8'),
  skip(1),
  field('old_meanwhile_flags', 'u16'),
  skip(2),
  field('iPortraitNumber', 'i32'),
  field('sWorldSectorLocationOfFirstBattle', 'i16'),
  field('fUnReadMailFlag', 'bool'),
  field('fNewMailFlag', 'bool'),
  skip(1),
  field('fOldNewMailFlag', 'bool'),
  field('fShowMilitia', 'bool'),
  field('fNewFilesInFileViewer', 'bool'),
  field('gfLastBoxingMatchWonByPlayer', 'bool'),
  skip(7),
  field('fSamSiteFound', 'bool', SAVED_SAM_SITES),
  field('gubNumTerrorists', 'u8'),
  field('gubCambriaMedicalObjects', 'u8'),
  field('gfDisableTacticalPanelButtons', 'bool'),
  skip(1),
  field('sSelMapX', 'i16'),
  field('sSelMapY', 'i16'),
  field('sSelMapZ', 'i32'),
  field('usHasPlayerSeenHelpScreenInCurrentScreen', 'u16'),
  skip(1),
  field('gubBoxingMatchesWon', 'u8'),
  field('gubBoxersRests', 'u8'),
  field('gfBoxersResting', 'bool'),
  field('gubDesertTemperature', 'u8'),
  field('gubGlobalTemperature', 'u8'),
  field('g_merc_arrive_sector_x', 'i16'),
  field('g_merc_arrive_sector_y', 'i16'),
  field('gfCreatureMeanwhileScenePlayed', 'bool'),
  skip(1),
  field('gfPersistantPBI', 'bool'),
  field('gubEnemyEncounterCode', 'u8'),
  field('gubExplicitEnemyEncounterCode', 'bool'),
  field('gfBlitBattleSectorLocator', 'bool'),
  field('gubPBSectorX', 'u8'),
  field('gubPBSectorY', 'u8'),
  field('gubPBSectorZ', 'u8'),
  field('gfCantRetreatInPBI', 'bool'),
  field('gfExplosionQueueActive', 'bool'),
  skip(1),
  field('uiMeanWhileFlags', 'u32'),
  field('bSelectedInfoChar', 'i8'),
  field('gbHospitalPriceModifier', 'i8'),
  skip(2),
  field('giHospitalTempBalance', 'i32'),
  field('giHospitalRefund', 'i32'),
  field('gfPlayerTeamSawJoey', 'i8'),
  field('gfMikeShouldSayHi', 'i8'),
];

export const GENERAL_INFO_LAYOUT: Layout = [...GENERAL_INFO_HEAD, skip(GENERAL_INFO_BYTES - layoutBytes(GENERAL_INFO_HEAD, false))];

export const TEAM_TURNS_LAYOUT: Layout = [
  skip(1),
  field('gOutOfTurnOrder', 'u8', MAX_MERCS - 1),
  field('gubOutOfTurnPersons', 'u8'),
  skip(3),
  field('gWhoThrewRock', 'u8'),
  skip(2),
  field('gfHiddenInterrupt', 'bool'),
  field('gLastInterruptedGuy', 'u8'),
  skip(TEAM_TURNS_PADDING),
];

export interface TacticalTeam {
  readonly firstId: number;
  readonly lastId: number;
  readonly radarColor: number;
  readonly side: number;
  readonly menInSector: number;
  readonly lastMercToRadio: number;
  readonly awareOfOpposition: number;
  readonly human: number;
}

export interface TacticalStatus {
  readonly flags: number;
  readonly inCombat: boolean;
  readonly teams: readonly TacticalTeam[];
  readonly currentTeam: number;
  readonly panicFlags: number;
  readonly spottersCalledForBy: number;
  readonly theChosenOne: number;
  readonly civGroupHostile: readonly number[];
  readonly lastBattleSector: { readonly x: number; readonly y: number };
  readonly lastBattleWon: boolean;
  readonly virginSector: boolean;
  readonly enemyInSector: boolean;
  readonly interruptOccurred: boolean;
  readonly realtimeSpeed: number;
  readonly enemySightingOnTheirTurn: boolean;
  readonly enemySightingOnTheirTurnEnemy: number;
  readonly autoBandageMode: boolean;
  readonly attackBusyCount: number;
  readonly turnLimitCounter: number;
  readonly turnLimitMax: number;
  readonly turnLimitClock: number;
  readonly boxingState: number;
  readonly consecutiveTurnsNotSeen: number;
  readonly armyGuysKilled: number;
  readonly panicTriggers: readonly { readonly gridNo: number; readonly isAlarm: number; readonly tolerance: number }[];
  readonly unlockUiAfterHiddenInterrupt: boolean;
  readonly numFoughtInBattle: readonly number[];
  readonly timeSinceLastInTactical: number;
  readonly didGameJustStart: boolean;
  readonly hasAGameBeenStarted: boolean;
  readonly consecutiveTurnsWeHaventSeenButEnemyDoes: number;
  readonly someoneHit: boolean;
  readonly timeSinceLastOpplistDecay: number;
  readonly decayBloodLastUpdate: number;
  readonly enemyFlags: number;
  readonly itemsSeenOnAttack: boolean;
  readonly itemsSeenOnAttackSoldier: number;
  readonly lockItemLocators: boolean;
  readonly guideDescription: {
    readonly counting: boolean;
    readonly countdown: number;
    readonly quote: number;
    readonly sectorX: number;
    readonly sectorY: number;
  };
  readonly hasEnteredCombatModeSinceEntering: boolean;
  readonly worldSector: SectorPosition;
}

export interface GameClock {
  readonly timeCompressMode: number;
  readonly clockResolution: number;
  readonly gamePaused: boolean;
  readonly timeInterrupt: boolean;
  readonly superCompression: boolean;
  readonly gameClock: number;
  readonly gameSecondsPerRealSecond: number;
  readonly ambientLightLevel: number;
  readonly envTime: number;
  readonly envDay: number;
  readonly envLightValue: number;
  readonly timeOfLastEventQuery: number;
  readonly lockPauseState: boolean;
  readonly pauseDueToPlayerGamePause: boolean;
  readonly resetAllPlayerKnowsEnemiesFlags: boolean;
  readonly timeCompressionOn: boolean;
  readonly previousGameClock: number;
  readonly lockPauseStateLastReasonId: number;
}

export interface SavedNarrativeGeneralInfo {
  readonly boxingMatchesWon: number;
  readonly boxersRests: number;
  readonly boxersResting: boolean;
  readonly lastBoxingMatchWonByPlayer: boolean;
  readonly boxerFought: readonly boolean[];
  readonly boxers: readonly number[];
  readonly cambriaMedicalObjects: number;
  readonly numTerrorists: number;
  readonly hospitalPriceModifier: number;
  readonly hospitalTempBalance: number;
  readonly hospitalRefund: number;
  readonly playerTeamSawJoey: boolean;
  readonly mikeShouldSayHi: number;
}

export interface GeneralInfo {
  readonly screenAfterLoading: number;
  readonly currentUniqueSoldierId: number;
  readonly musicMode: number;
  readonly selectedSoldier: number;
  readonly renderCenterX: number;
  readonly renderCenterY: number;
  readonly atLeastOneMercWasHired: boolean;
  readonly newMailFlag: boolean;
  readonly environmentWeather: number;
  readonly contractRehireSoldier: number;
  readonly gameOptions: SavedGameOptions;
  readonly baseJA2Clock: number;
  readonly currentInterfacePanel: number;
  readonly smCurrentMerc: number;
  readonly helicopterVehicleId: number;
  readonly helicopterAirborne: boolean;
  readonly helicopter: SavedHelicopter;
  readonly disableMapInterfaceDueToBattle: boolean;
  readonly foundTixa: boolean;
  readonly samSitesFound: readonly boolean[];
  readonly deadSquadMembers: readonly (readonly number[])[];
  readonly selectedSector: { readonly x: number; readonly y: number; readonly z: number };
  readonly narrative: SavedNarrativeGeneralInfo;
  readonly meanwhile: SavedMeanwhileGeneralInfo;
}

export interface SavedMeanwhileDefinition {
  readonly sector: { readonly x: number; readonly y: number };
  readonly trigger: number;
  readonly id: number;
  readonly npc: number;
}

export interface SavedMeanwhileGeneralInfo {
  readonly current: SavedMeanwhileDefinition;
  readonly trying: boolean;
  readonly inScene: boolean;
}

export interface SavedHelicopter {
  readonly setUp: boolean;
  readonly returningToBase: boolean;
  readonly hovering: boolean;
  readonly startHoverMinute: number;
  readonly totalCost: number;
  readonly destroyed: boolean;
  readonly talkState: number;
  readonly lastMonologueMinute: number;
  readonly emptyHelpGiven: boolean;
  readonly hitsTaken: number;
  readonly saidCongratsOnTakingSam: boolean;
  readonly progressLastCommentedOn: number;
  readonly refuelSiteAvailable: readonly boolean[];
}

export interface TeamTurns {
  readonly outOfTurnOrder: readonly number[];
  readonly whoThrewRock: number;
  readonly hiddenInterrupt: boolean;
  readonly lastInterruptedGuy: number;
}

export interface OppListInfo {
  readonly publicOpplist: readonly (readonly number[])[];
  readonly seenOpponents: readonly (readonly number[])[];
  readonly lastKnownOppLocBytes: Uint8Array;
  readonly lastKnownOppLevel: readonly (readonly number[])[];
  readonly publicLastKnownOppLocBytes: Uint8Array;
  readonly publicLastKnownOppLevel: readonly (readonly number[])[];
  readonly publicNoiseVolume: readonly number[];
  readonly publicNoiseGridNoBytes: Uint8Array;
}

export interface WatchedLocations {
  readonly gridNo: readonly (readonly number[])[];
  readonly level: readonly (readonly number[])[];
  readonly points: readonly (readonly number[])[];
  readonly reset: readonly (readonly boolean[])[];
}

function team(r: LayoutRecord, t: number): TacticalTeam {
  const n = (name: string) => r.num(`Team${t}.${name}`);
  return {
    firstId: n('bFirstID'),
    lastId: n('bLastID'),
    radarColor: n('RadarColor'),
    side: n('bSide'),
    menInSector: n('bMenInSector'),
    lastMercToRadio: n('last_merc_to_radio'),
    awareOfOpposition: n('bAwareOfOpposition'),
    human: n('bHuman'),
  };
}

export function readTacticalStatus(c: SaveCursor, stracLinuxFormat: boolean): TacticalStatus {
  const r = readLayout(c, TACTICAL_STATUS_LAYOUT, stracLinuxFormat, 'TacticalStatusType');
  const n = (name: string) => r.num(name);
  const b = (name: string) => r.bool(name);
  const worldSector = { x: c.i16(), y: c.i16(), z: c.i8() };
  const gridNos = r.nums('sPanicTriggerGridNo');
  const alarms = r.nums('bPanicTriggerIsAlarm');
  const tolerances = r.nums('ubPanicTolerance');
  return {
    flags: n('uiFlags'),
    inCombat: (n('uiFlags') & INCOMBAT) !== 0,
    teams: Array.from({ length: MAX_TEAMS }, (_, t) => team(r, t)),
    currentTeam: n('ubCurrentTeam'),
    decayBloodLastUpdate: n('uiDecayBloodLastUpdate'),
    panicFlags: n('fPanicFlags'),
    spottersCalledForBy: n('ubSpottersCalledForBy'),
    theChosenOne: n('the_chosen_one'),
    civGroupHostile: r.nums('fCivGroupHostile'),
    lastBattleSector: { x: n('ubLastBattleSectorX'), y: n('ubLastBattleSectorY') },
    lastBattleWon: b('fLastBattleWon'),
    virginSector: b('fVirginSector'),
    enemyInSector: b('fEnemyInSector'),
    interruptOccurred: b('fInterruptOccurred'),
    realtimeSpeed: n('bRealtimeSpeed'),
    enemySightingOnTheirTurn: b('fEnemySightingOnTheirTurn'),
    enemySightingOnTheirTurnEnemy: n('enemy_sighting_on_their_turn_enemy'),
    autoBandageMode: b('fAutoBandageMode'),
    attackBusyCount: n('ubAttackBusyCount'),
    turnLimitCounter: n('usTactialTurnLimitCounter'),
    turnLimitMax: n('usTactialTurnLimitMax'),
    turnLimitClock: n('uiTactialTurnLimitClock'),
    boxingState: n('bBoxingState'),
    consecutiveTurnsNotSeen: n('bConsNumTurnsNotSeen'),
    armyGuysKilled: n('ubArmyGuysKilled'),
    panicTriggers: gridNos.map((gridNo, i) => ({ gridNo, isAlarm: alarms[i] ?? 0, tolerance: tolerances[i] ?? 0 })),
    unlockUiAfterHiddenInterrupt: b('fUnLockUIAfterHiddenInterrupt'),
    numFoughtInBattle: r.nums('bNumFoughtInBattle'),
    timeSinceLastInTactical: n('uiTimeSinceLastInTactical'),
    didGameJustStart: b('fDidGameJustStart'),
    hasAGameBeenStarted: b('fHasAGameBeenStarted'),
    consecutiveTurnsWeHaventSeenButEnemyDoes: n('bConsNumTurnsWeHaventSeenButEnemyDoes'),
    someoneHit: b('fSomeoneHit'),
    timeSinceLastOpplistDecay: n('uiTimeSinceLastOpplistDecay'),
    enemyFlags: n('fEnemyFlags'),
    itemsSeenOnAttack: b('fItemsSeenOnAttack'),
    itemsSeenOnAttackSoldier: n('items_seen_on_attack_soldier'),
    lockItemLocators: b('fLockItemLocators'),
    guideDescription: {
      counting: b('fCountingDownForGuideDescription'),
      countdown: n('bGuideDescriptionCountDown'),
      quote: n('ubGuideDescriptionToUse'),
      sectorX: n('bGuideDescriptionSectorX'),
      sectorY: n('bGuideDescriptionSectorY'),
    },
    hasEnteredCombatModeSinceEntering: b('fHasEnteredCombatModeSinceEntering'),
    worldSector,
  };
}

export function readGameClock(c: SaveCursor): GameClock {
  const clock = {
    timeCompressMode: c.i32(),
    clockResolution: c.u8(),
    gamePaused: c.bool(),
    timeInterrupt: c.bool(),
    superCompression: c.bool(),
    gameClock: c.u32(),
    gameSecondsPerRealSecond: c.u32(),
    ambientLightLevel: c.u8(),
    envTime: c.u32(),
    envDay: c.u32(),
    envLightValue: c.u8(),
    timeOfLastEventQuery: c.u32(),
    lockPauseState: c.bool(),
    pauseDueToPlayerGamePause: c.bool(),
    resetAllPlayerKnowsEnemiesFlags: c.bool(),
    timeCompressionOn: c.bool(),
    previousGameClock: c.u32(),
    lockPauseStateLastReasonId: c.u32(),
  };
  c.skip(CLOCK_PADDING);
  return clock;
}

export function readGeneralInfo(c: SaveCursor): GeneralInfo {
  const r = readLayout(c, GENERAL_INFO_LAYOUT, false, 'general info');
  const n = (name: string) => r.num(name);
  return {
    screenAfterLoading: n('screen_after_loading'),
    currentUniqueSoldierId: n('guiCurrentUniqueSoldierId'),
    musicMode: n('ubMusicModeToPlay'),
    selectedSoldier: n('sel'),
    renderCenterX: n('gsRenderCenterX'),
    renderCenterY: n('gsRenderCenterY'),
    atLeastOneMercWasHired: r.bool('gfAtLeastOneMercWasHired'),
    newMailFlag: r.bool('fNewMailFlag'),
    environmentWeather: n('guiEnvWeather'),
    contractRehireSoldier: n('contract_rehire_soldier'),
    gameOptions: {
      gunNut: r.bool('fGunNut'),
      sciFi: r.bool('fSciFi'),
      difficulty: n('ubDifficultyLevel'),
      turnTimeLimit: r.bool('fTurnTimeLimit'),
      saveMode: n('ubGameSaveMode'),
    },
    baseJA2Clock: n('guiBaseJA2Clock'),
    currentInterfacePanel: n('cur_interface_panel'),
    smCurrentMerc: n('sm_current_merc'),
    helicopterVehicleId: n('iHelicopterVehicleId'),
    helicopterAirborne: r.bool('fHelicopterIsAirBorne'),
    helicopter: {
      setUp: r.bool('fSkyRiderSetUp'),
      returningToBase: r.bool('fHeliReturnStraightToBase'),
      hovering: r.bool('fHoveringHelicopter'),
      startHoverMinute: n('uiStartHoverTime'),
      totalCost: n('iTotalAccumulatedCostByPlayer'),
      destroyed: r.bool('fHelicopterDestroyed'),
      talkState: n('guiHelicopterSkyriderTalkState'),
      lastMonologueMinute: n('guiTimeOfLastSkyriderMonologue'),
      emptyHelpGiven: r.bool('gfSkyriderEmptyHelpGiven'),
      hitsTaken: n('gubHelicopterHitsTaken'),
      saidCongratsOnTakingSam: r.bool('gfSkyriderSaidCongratsOnTakingSAM'),
      progressLastCommentedOn: n('gubPlayerProgressSkyriderLastCommentedOn'),
      refuelSiteAvailable: r.bools('fRefuelingSiteAvailable'),
    },
    disableMapInterfaceDueToBattle: r.bool('fDisableMapInterfaceDueToBattle'),
    foundTixa: r.bool('fFoundTixa'),
    samSitesFound: r.bools('fSamSiteFound'),
    deadSquadMembers: Array.from({ length: NUMBER_OF_SQUADS }, (_, q) =>
      r.nums('sDeadMercs').slice(q * NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD, (q + 1) * NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD),
    ),
    selectedSector: { x: n('sSelMapX'), y: n('sSelMapY'), z: i8(n('sSelMapZ')) },
    narrative: {
      boxingMatchesWon: n('gubBoxingMatchesWon'),
      boxersRests: n('gubBoxersRests'),
      boxersResting: r.bool('gfBoxersResting'),
      lastBoxingMatchWonByPlayer: r.bool('gfLastBoxingMatchWonByPlayer'),
      boxerFought: r.bools('gfBoxerFought'),
      boxers: r.nums('gBoxer'),
      cambriaMedicalObjects: n('gubCambriaMedicalObjects'),
      numTerrorists: n('gubNumTerrorists'),
      hospitalPriceModifier: n('gbHospitalPriceModifier'),
      hospitalTempBalance: n('giHospitalTempBalance'),
      hospitalRefund: n('giHospitalRefund'),
      playerTeamSawJoey: n('gfPlayerTeamSawJoey') !== 0,
      mikeShouldSayHi: n('gfMikeShouldSayHi'),
    },
    meanwhile: {
      current: {
        sector: { x: n('meanwhile_sector_x'), y: n('meanwhile_sector_y') },
        trigger: n('meanwhile_trigger'),
        id: n('meanwhile_id'),
        npc: n('meanwhile_npc'),
      },
      trying: r.bool('gfMeanwhileTryingToStart'),
      inScene: r.bool('gfInMeanwhile'),
    },
  };
}

export function readTeamTurns(c: SaveCursor): TeamTurns {
  const r = readLayout(c, TEAM_TURNS_LAYOUT, false, 'team turns');
  return {
    outOfTurnOrder: r.nums('gOutOfTurnOrder').slice(0, r.num('gubOutOfTurnPersons')),
    whoThrewRock: r.num('gWhoThrewRock'),
    hiddenInterrupt: r.bool('gfHiddenInterrupt'),
    lastInterruptedGuy: r.num('gLastInterruptedGuy'),
  };
}

function rows(c: SaveCursor, count: number, width: number, read: (c: SaveCursor, n: number) => number[]): number[][] {
  return Array.from({ length: count }, () => read(c, width));
}

const signedBytes = (c: SaveCursor, n: number) => c.i8s(n);
const unsignedBytes = (c: SaveCursor, n: number) => c.u8s(n);

export function readOppList(c: SaveCursor): OppListInfo {
  return {
    publicOpplist: rows(c, MAX_TEAMS, TOTAL_SOLDIERS, signedBytes),
    seenOpponents: rows(c, TOTAL_SOLDIERS, TOTAL_SOLDIERS, signedBytes),
    lastKnownOppLocBytes: c.view(TOTAL_SOLDIERS * TOTAL_SOLDIERS).slice(),
    lastKnownOppLevel: rows(c, TOTAL_SOLDIERS, TOTAL_SOLDIERS, signedBytes),
    publicLastKnownOppLocBytes: c.view(MAX_TEAMS * TOTAL_SOLDIERS).slice(),
    publicLastKnownOppLevel: rows(c, MAX_TEAMS, TOTAL_SOLDIERS, signedBytes),
    publicNoiseVolume: c.u8s(MAX_TEAMS),
    publicNoiseGridNoBytes: c.view(MAX_TEAMS).slice(),
  };
}

export function readWatchedLocations(c: SaveCursor): WatchedLocations {
  return {
    gridNo: rows(c, TOTAL_SOLDIERS, NUM_WATCHED_LOCS, (cc, n) => cc.i16s(n)),
    level: rows(c, TOTAL_SOLDIERS, NUM_WATCHED_LOCS, signedBytes),
    points: rows(c, TOTAL_SOLDIERS, NUM_WATCHED_LOCS, unsignedBytes),
    reset: rows(c, TOTAL_SOLDIERS, NUM_WATCHED_LOCS, unsignedBytes).map((row) => row.map((v) => v !== 0)),
  };
}
