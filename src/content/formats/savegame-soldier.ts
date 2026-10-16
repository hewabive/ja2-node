// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LoadSaveSoldierType.cc ExtractSoldierType, MercChecksum (Windows and Strac Linux layouts)

import type { ObjectRecord } from './object.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { ascii, field, type Layout, layoutBytes, linuxSkip, objects, pointer, readLayout, skip, wide } from './savegame-layout.ts';

export const SOLDIER_INVENTORY_SLOTS = 19;
export const SOLDIER_OPPLIST_ENTRIES = 148;
const NAME_CHARS = 10;
const PALETTE_BYTES = 30;
const PATH_ENTRIES = 30;
const PATROL_POINTS = 10;
const SPREAD_LOCATIONS = 6;
const DRUG_KINDS = 2;
const LAST_LOCATIONS = 2;
const FIRST_VERSION_WITH_STAT_DAMAGE = 103;
const STAT_CHANGE_TIMES = [
  'uiChangeLevelTime',
  'uiChangeHealthTime',
  'uiChangeStrengthTime',
  'uiChangeDexterityTime',
  'uiChangeAgilityTime',
  'uiChangeWisdomTime',
  'uiChangeLeadershipTime',
  'uiChangeMarksmanshipTime',
  'uiChangeExplosivesTime',
  'uiChangeMedicalTime',
  'uiChangeMechanicalTime',
];

export const SOLDIER_LAYOUT: Layout = [
  field('ubID', 'u8'),
  skip(1),
  field('ubBodyType', 'u8'),
  field('bActionPoints', 'i8'),
  field('bInitialActionPoints', 'i8'),
  skip(3),
  field('uiStatusFlags', 'u32'),
  objects('inv', SOLDIER_INVENTORY_SLOTS),
  pointer('pTempObject'),
  pointer('pKeyRing'),
  field('bOldLife', 'i8'),
  field('bInSector', 'u8'),
  field('bFlashPortraitFrame', 'i8'),
  skip(1),
  field('sFractLife', 'i16'),
  field('bBleeding', 'i8'),
  field('bBreath', 'i8'),
  field('bBreathMax', 'i8'),
  field('bStealthMode', 'i8'),
  field('sBreathRed', 'i16'),
  field('fDelayedMovement', 'bool'),
  skip(1),
  field('ubWaitActionToDo', 'u8'),
  skip(1),
  field('ubInsertionDirection', 'i8'),
  skip(1),
  field('opponent', 'u8'),
  field('bLastRenderVisibleValue', 'i8'),
  skip(1),
  field('ubAttackingHand', 'u8'),
  skip(2),
  field('sWeightCarriedAtTurnStart', 'i16'),
  linuxSkip(2),
  wide('name', NAME_CHARS),
  field('bVisible', 'i8'),
  field('bActive', 'i8'),
  field('bTeam', 'i8'),
  field('ubGroupID', 'u8'),
  field('fBetweenSectors', 'bool'),
  field('ubMovementNoiseHeard', 'u8'),
  linuxSkip(2),
  field('dXPos', 'f32'),
  field('dYPos', 'f32'),
  skip(8),
  field('sInitialGridNo', 'i16'),
  field('sGridNo', 'i16'),
  field('bDirection', 'i8'),
  skip(1),
  field('sHeightAdjustment', 'i16'),
  field('sDesiredHeight', 'i16'),
  field('sTempNewGridNo', 'i16'),
  skip(2),
  field('bOverTerrainType', 'i8'),
  skip(1),
  field('bCollapsed', 'i8'),
  field('bBreathCollapsed', 'i8'),
  field('ubDesiredHeight', 'u8'),
  skip(1),
  field('usPendingAnimation', 'u16'),
  field('ubPendingStanceChange', 'u8'),
  skip(1),
  field('usAnimState', 'u16'),
  field('fNoAPToFinishMove', 'bool'),
  field('fPausedMove', 'bool'),
  field('fUIdeadMerc', 'bool'),
  skip(1),
  field('fUICloseMerc', 'bool'),
  skip(13),
  skip(4),
  field('bAgilityDamage', 'i8'),
  field('bDexterityDamage', 'i8'),
  field('bStrengthDamage', 'i8'),
  field('bWisdomDamage', 'i8'),
  skip(8),
  field('ubSkillTrait1', 'u8'),
  field('ubSkillTrait2', 'u8'),
  skip(6),
  field('bDexterity', 'i8'),
  field('bWisdom', 'i8'),
  skip(2),
  field('attacker', 'u8'),
  field('previous_attacker', 'u8'),
  field('fTurnInProgress', 'bool'),
  field('fIntendedTarget', 'bool'),
  field('fPauseAllAnimation', 'bool'),
  field('bExpLevel', 'i8'),
  field('sInsertionGridNo', 'i16'),
  field('fContinueMoveAfterStanceChange', 'bool'),
  skip(15),
  field('bLife', 'i8'),
  field('bSide', 'u8'),
  skip(1),
  field('bNewOppCnt', 'i8'),
  skip(2),
  field('usAniCode', 'u16'),
  field('usAniFrame', 'u16'),
  field('sAniDelay', 'i16'),
  field('bAgility', 'i8'),
  skip(1),
  field('sDelayedMovementCauseGridNo', 'i16'),
  field('sReservedMovementGridNo', 'i16'),
  field('bStrength', 'i8'),
  skip(1),
  field('sTargetGridNo', 'i16'),
  field('bTargetLevel', 'i8'),
  field('bTargetCubeLevel', 'i8'),
  field('sLastTarget', 'i16'),
  field('bTilesMoved', 'i8'),
  field('bLeadership', 'i8'),
  field('dNextBleed', 'f32'),
  field('fWarnedAboutBleeding', 'bool'),
  field('fDyingComment', 'bool'),
  field('ubTilesMovedPerRTBreathUpdate', 'u8'),
  skip(1),
  field('usLastMovementAnimPerRTBreathUpdate', 'u16'),
  field('fTurningToShoot', 'bool'),
  skip(1),
  field('fTurningUntilDone', 'bool'),
  field('fGettingHit', 'bool'),
  field('fInNonintAnim', 'bool'),
  field('fFlashLocator', 'bool'),
  field('sLocatorFrame', 'i16'),
  field('fShowLocator', 'bool'),
  field('fFlashPortrait', 'bool'),
  field('bMechanical', 'i8'),
  field('bLifeMax', 'i8'),
  skip(6),
  ascii('HeadPal', PALETTE_BYTES),
  ascii('PantsPal', PALETTE_BYTES),
  ascii('VestPal', PALETTE_BYTES),
  ascii('SkinPal', PALETTE_BYTES),
  skip(328),
  field('bMedical', 'i8'),
  field('fBeginFade', 'bool'),
  field('ubFadeLevel', 'u8'),
  field('ubServiceCount', 'u8'),
  field('service_partner', 'u8'),
  field('bMarksmanship', 'i8'),
  field('bExplosive', 'i8'),
  skip(1),
  pointer('pThrowParams'),
  field('fTurningFromPronePosition', 'bool'),
  field('bReverse', 'i8'),
  skip(2),
  pointer('pLevelNode'),
  skip(8),
  field('bDesiredDirection', 'i8'),
  skip(1),
  field('sDestXPos', 'i16'),
  field('sDestYPos', 'i16'),
  skip(2),
  field('sDestination', 'i16'),
  field('sFinalDestination', 'i16'),
  field('bLevel', 'i8'),
  skip(3),
  field('usPathingData', 'u16', PATH_ENTRIES),
  field('usPathDataSize', 'u16'),
  field('usPathIndex', 'u16'),
  field('sBlackList', 'i16'),
  field('bAimTime', 'i8'),
  field('bShownAimTime', 'i8'),
  field('bPathStored', 'i8'),
  field('bHasKeys', 'i8'),
  skip(18),
  field('ubStrategicInsertionCode', 'u8'),
  skip(1),
  field('usStrategicInsertionData', 'u16'),
  skip(8),
  field('bMuzFlashCount', 'i8'),
  skip(1),
  field('sX', 'i16'),
  field('sY', 'i16'),
  field('usOldAniState', 'u16'),
  field('sOldAniCode', 'i16'),
  field('bBulletsLeft', 'i8'),
  field('ubSuppressionPoints', 'u8'),
  field('uiTimeOfLastRandomAction', 'u32'),
  skip(2),
  field('bOppList', 'i8', SOLDIER_OPPLIST_ENTRIES),
  field('bLastAction', 'i8'),
  field('bAction', 'i8'),
  field('usActionData', 'u16'),
  field('bNextAction', 'i8'),
  skip(1),
  field('usNextActionData', 'u16'),
  field('bActionInProgress', 'i8'),
  field('bAlertStatus', 'i8'),
  field('bOppCnt', 'i8'),
  field('bNeutral', 'i8'),
  field('bNewSituation', 'i8'),
  field('bNextTargetLevel', 'i8'),
  field('bOrders', 'i8'),
  field('bAttitude', 'i8'),
  field('bUnderFire', 'i8'),
  field('bShock', 'i8'),
  skip(1),
  field('bBypassToGreen', 'i8'),
  skip(1),
  field('bDominantDir', 'i8'),
  field('bPatrolCnt', 'i8'),
  field('bNextPatrolPnt', 'i8'),
  field('usPatrolGrid', 'i16', PATROL_POINTS),
  field('sNoiseGridno', 'i16'),
  field('ubNoiseVolume', 'u8'),
  field('bLastAttackHit', 'i8'),
  field('xrayed_by', 'u8'),
  skip(1),
  field('dHeightAdjustment', 'f32'),
  field('bMorale', 'i8'),
  field('bTeamMoraleMod', 'i8'),
  field('bTacticalMoraleMod', 'i8'),
  field('bStrategicMoraleMod', 'i8'),
  field('bAIMorale', 'i8'),
  field('ubPendingAction', 'u8'),
  field('ubPendingActionAnimCount', 'u8'),
  skip(1),
  field('uiPendingActionData1', 'u32'),
  field('sPendingActionData2', 'i16'),
  field('bPendingActionData3', 'i8'),
  field('ubDoorHandleCode', 'i8'),
  field('uiPendingActionData4', 'u32'),
  field('bInterruptDuelPts', 'i8'),
  field('bPassedLastInterrupt', 'i8'),
  field('bIntStartAPs', 'i8'),
  field('bMoved', 'i8'),
  field('bHunting', 'i8'),
  skip(1),
  field('ubCaller', 'u8'),
  skip(1),
  field('sCallerGridNo', 'i16'),
  field('bCallPriority', 'u8'),
  field('bCallActedUpon', 'i8'),
  field('bFrenzied', 'i8'),
  field('bNormalSmell', 'i8'),
  field('bMonsterSmell', 'i8'),
  field('bMobility', 'i8'),
  skip(1),
  field('fAIFlags', 'i8'),
  field('fDontChargeReadyAPs', 'bool'),
  skip(1),
  field('usAnimSurface', 'u16'),
  field('sZLevel', 'u16'),
  field('fPrevInWater', 'bool'),
  field('fGoBackToAimAfterHit', 'bool'),
  field('sWalkToAttackGridNo', 'i16'),
  field('sWalkToAttackWalkToCost', 'i16'),
  skip(7),
  field('fForceShade', 'bool'),
  skip(2),
  pointer('pForcedShade'),
  field('bDisplayDamageCount', 'i8'),
  field('fDisplayDamage', 'i8'),
  field('sDamage', 'i16'),
  field('sDamageX', 'i16'),
  field('sDamageY', 'i16'),
  skip(1),
  field('bDoBurst', 'i8'),
  field('usUIMovementMode', 'i16'),
  skip(1),
  field('fUIMovementFast', 'bool'),
  skip(10),
  field('fDeadSoundPlayed', 'bool'),
  field('ubProfile', 'u8'),
  field('ubQuoteRecord', 'u8'),
  field('ubQuoteActionID', 'u8'),
  field('ubBattleSoundID', 'u8'),
  field('fClosePanel', 'bool'),
  field('fClosePanelToDie', 'bool'),
  field('ubClosePanelFrame', 'u8'),
  field('fDeadPanel', 'bool'),
  field('ubDeadPanelFrame', 'u8'),
  skip(2),
  field('sPanelFaceX', 'i16'),
  field('sPanelFaceY', 'i16'),
  field('bNumHitsThisTurn', 'i8'),
  skip(1),
  field('usQuoteSaidFlags', 'u16'),
  field('fCloseCall', 'i8'),
  field('bLastSkillCheck', 'i8'),
  field('ubSkillCheckAttempts', 'i8'),
  skip(1),
  field('bStartFallDir', 'i8'),
  field('fTryingToFall', 'i8'),
  field('ubPendingDirection', 'u8'),
  skip(1),
  field('uiAnimSubFlags', 'u32'),
  field('bAimShotLocation', 'u8'),
  field('ubHitLocation', 'u8'),
  skip(16),
  field('sSpreadLocations', 'i16', SPREAD_LOCATIONS),
  field('fDoSpread', 'bool'),
  skip(1),
  field('sStartGridNo', 'i16'),
  field('sEndGridNo', 'i16'),
  field('sForcastGridno', 'i16'),
  field('sZLevelOverride', 'i16'),
  field('bMovedPriorToInterrupt', 'i8'),
  skip(3),
  field('iEndofContractTime', 'i32'),
  field('iStartContractTime', 'i32'),
  field('iTotalContractLength', 'i32'),
  field('iNextActionSpecialData', 'i32'),
  field('ubWhatKindOfMercAmI', 'u8'),
  field('bAssignment', 'i8'),
  skip(1),
  field('fForcedToStayAwake', 'bool'),
  field('bTrainStat', 'i8'),
  skip(1),
  field('sSectorX', 'i16'),
  field('sSectorY', 'i16'),
  field('sSectorZ', 'i8'),
  skip(1),
  field('iVehicleId', 'i32'),
  pointer('pMercPath'),
  field('fHitByGasFlags', 'u8'),
  skip(1),
  field('usMedicalDeposit', 'u16'),
  field('usLifeInsurance', 'u16'),
  skip(26),
  field('iStartOfInsuranceContract', 'i32'),
  field('uiLastAssignmentChangeMin', 'u32'),
  field('iTotalLengthOfInsuranceContract', 'i32'),
  field('ubSoldierClass', 'u8'),
  field('ubAPsLostToSuppression', 'u8'),
  field('fChangingStanceDueToSuppression', 'bool'),
  field('suppressor', 'u8'),
  skip(4),
  field('ubCivilianGroup', 'u8'),
  skip(3),
  ...STAT_CHANGE_TIMES.map((name) => field(name, 'u32')),
  field('uiUniqueSoldierIdValue', 'u32'),
  field('bBeingAttackedCount', 'i8'),
  field('bNewItemCount', 'i8', SOLDIER_INVENTORY_SLOTS),
  field('bNewItemCycleCount', 'i8', SOLDIER_INVENTORY_SLOTS),
  field('fCheckForNewlyAddedItems', 'bool'),
  field('bEndDoorOpenCode', 'i8'),
  field('ubScheduleID', 'u8'),
  field('sEndDoorOpenCodeData', 'i16'),
  skip(4),
  field('fBlockedByAnotherMerc', 'bool'),
  field('bBlockedByAnotherMercDirection', 'i8'),
  field('usAttackingWeapon', 'u16'),
  field('bWeaponMode', 'i8'),
  field('target', 'u8'),
  field('bAIScheduleProgress', 'i8'),
  skip(1),
  field('sOffWorldGridNo', 'i16'),
  skip(2),
  pointer('pAniTile'),
  field('bCamo', 'i8'),
  skip(1),
  field('sAbsoluteFinalDestination', 'i16'),
  field('ubHiResDirection', 'u8'),
  skip(1),
  field('ubLastFootPrintSound', 'u8'),
  field('bVehicleID', 'i8'),
  field('fPastXDest', 'i8'),
  field('fPastYDest', 'i8'),
  field('bMovementDirection', 'i8'),
  skip(1),
  field('sOldGridNo', 'i16'),
  field('usDontUpdateNewGridNoOnMoveAnimChange', 'u16'),
  field('sBoundingBoxWidth', 'i16'),
  field('sBoundingBoxHeight', 'i16'),
  field('sBoundingBoxOffsetX', 'i16'),
  field('sBoundingBoxOffsetY', 'i16'),
  field('uiTimeSameBattleSndDone', 'u32'),
  field('bOldBattleSnd', 'i8'),
  skip(1),
  field('fContractPriceHasIncreased', 'bool'),
  skip(1),
  field('uiBurstSoundID', 'u32'),
  field('fFixingSAMSite', 'bool'),
  field('fFixingRobot', 'bool'),
  field('bSlotItemTakenFrom', 'i8'),
  field('fSignedAnotherContract', 'bool'),
  field('auto_bandaging_medic', 'u8'),
  field('fDontChargeTurningAPs', 'bool'),
  field('robot_remote_holder', 'u8'),
  skip(1),
  field('uiTimeOfLastContractUpdate', 'u32'),
  field('bTypeOfLastContract', 'i8'),
  field('bTurnsCollapsed', 'i8'),
  field('bSleepDrugCounter', 'i8'),
  field('ubMilitiaKills', 'u8'),
  field('bFutureDrugEffect', 'i8', DRUG_KINDS),
  field('bDrugEffectRate', 'i8', DRUG_KINDS),
  field('bDrugEffect', 'i8', DRUG_KINDS),
  field('bDrugSideEffectRate', 'i8', DRUG_KINDS),
  field('bDrugSideEffect', 'i8', DRUG_KINDS),
  skip(2),
  field('bBlindedCounter', 'i8'),
  field('fMercCollapsedFlag', 'bool'),
  field('fDoneAssignmentAndNothingToDoFlag', 'bool'),
  field('fMercAsleep', 'bool'),
  field('fDontChargeAPsForStanceChange', 'bool'),
  skip(2),
  field('ubTurnsUntilCanSayHeardNoise', 'u8'),
  field('usQuoteSaidExtFlags', 'u16'),
  field('sContPathLocation', 'u16'),
  field('bGoodContPath', 'i8'),
  skip(1),
  field('bNoiseLevel', 'i8'),
  field('bRegenerationCounter', 'i8'),
  field('bRegenBoostersUsedToday', 'i8'),
  field('bNumPelletsHitBy', 'i8'),
  field('sSkillCheckGridNo', 'i16'),
  field('ubLastEnemyCycledID', 'u8'),
  field('ubPrevSectorID', 'u8'),
  field('ubNumTilesMovesSinceLastForget', 'u8'),
  field('bTurningIncrement', 'i8'),
  field('uiBattleSoundID', 'u32'),
  field('fSoldierWasMoving', 'bool'),
  field('fSayAmmoQuotePending', 'bool'),
  field('usValueGoneUp', 'u16'),
  field('ubNumLocateCycles', 'u8'),
  field('ubDelayedMovementFlags', 'u8'),
  field('fMuzzleFlash', 'bool'),
  field('CTGTTarget', 'u8'),
  skip(4),
  field('checksum', 'u32'),
  field('bCurrentCivQuote', 'i8'),
  field('bCurrentCivQuoteDelta', 'i8'),
  field('ubMiscSoldierFlags', 'u8'),
  field('ubReasonCantFinishMove', 'u8'),
  field('sLocationOfFadeStart', 'i16'),
  field('bUseExitGridForReentryDirection', 'u8'),
  skip(1),
  field('uiTimeSinceLastSpoke', 'u32'),
  field('ubContractRenewalQuoteCode', 'u8'),
  skip(1),
  field('sPreTraversalGridNo', 'i16'),
  field('uiXRayActivatedTime', 'u32'),
  field('bTurningFromUI', 'i8'),
  field('bPendingActionData5', 'i8'),
  field('bDelayedStrategicMoraleMod', 'i8'),
  field('ubDoorOpeningNoise', 'u8'),
  skip(4),
  field('ubLeaveHistoryCode', 'u8'),
  field('fDontUnsetLastTargetFromTurn', 'bool'),
  field('bOverrideMoveSpeed', 'i8'),
  field('fUseMoverrideMoveSpeed', 'bool'),
  field('uiTimeSoldierWillArrive', 'u32'),
  skip(1),
  field('fUseLandingZoneForArrival', 'bool'),
  field('fFallClockwise', 'bool'),
  field('bVehicleUnderRepairID', 'i8'),
  field('iTimeCanSignElsewhere', 'i32'),
  field('bHospitalPriceModifier', 'i8'),
  skip(3),
  field('uiStartTimeOfInsuranceContract', 'u32'),
  field('fRTInNonintAnim', 'bool'),
  field('fDoingExternalDeath', 'bool'),
  field('bCorpseQuoteTolerance', 'i8'),
  skip(1),
  field('iPositionSndID', 'i32'),
  field('uiTuringSoundID', 'u32'),
  field('ubLastDamageReason', 'u8'),
  field('fComplainedThatTired', 'bool'),
  field('sLastTwoLocations', 'i16', LAST_LOCATIONS),
  skip(2),
  field('uiTimeSinceLastBleedGrunt', 'i32'),
  field('next_to_previous_attacker', 'u8'),
  skip(39),
];

export const SOLDIER_RECORD_BYTES = layoutBytes(SOLDIER_LAYOUT, false);
export const SOLDIER_RECORD_BYTES_STRAC_LINUX = layoutBytes(SOLDIER_LAYOUT, true);

export interface SoldierStats {
  readonly life: number;
  readonly lifeMax: number;
  readonly breath: number;
  readonly breathMax: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly wisdom: number;
  readonly leadership: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly explosive: number;
  readonly medical: number;
  readonly expLevel: number;
}

export interface SoldierAi {
  readonly lastAction: number;
  readonly action: number;
  readonly actionData: number;
  readonly nextAction: number;
  readonly nextActionData: number;
  readonly actionInProgress: number;
  readonly alertStatus: number;
  readonly oppCount: number;
  readonly neutral: number;
  readonly newSituation: number;
  readonly nextTargetLevel: number;
  readonly orders: number;
  readonly attitude: number;
  readonly underFire: number;
  readonly shock: number;
  readonly bypassToGreen: number;
  readonly dominantDirection: number;
  readonly patrolCount: number;
  readonly nextPatrolPoint: number;
  readonly patrolGrid: readonly number[];
  readonly noiseGridNo: number;
  readonly noiseVolume: number;
  readonly lastAttackHit: number;
  readonly aiMorale: number;
  readonly caller: number;
  readonly callerGridNo: number;
  readonly callPriority: number;
  readonly callActedUpon: number;
  readonly frenzied: number;
  readonly mobility: number;
  readonly aiFlags: number;
  readonly hunting: number;
  readonly scheduleId: number;
  readonly scheduleProgress: number;
  readonly normalSmell: number;
  readonly monsterSmell: number;
  readonly regenerationCounter: number;
  readonly pendingActionData4: number;
}

export interface SoldierInterrupt {
  readonly duelPoints: number;
  readonly passedLastInterrupt: number;
  readonly startAPs: number;
  readonly moved: number;
  readonly movedPriorToInterrupt: number;
}

export interface SoldierMotion {
  readonly uiMovementMode: number;
  readonly movementDirection: number;
  readonly reverse: number;
  readonly noAPToFinishMove: boolean;
  readonly pendingDirection: number;
  readonly pendingStanceChange: number;
  readonly desiredHeight: number;
  readonly forecastGridNo: number;
  readonly inNonInterruptibleAnimation: boolean;
  readonly rtNonInterruptible: boolean;
  readonly turningUntilDone: boolean;
  readonly continueMoveAfterStanceChange: boolean;
  readonly pathStored: number;
  readonly pathSize: number;
  readonly reservedGridNo: number;
  readonly endDoorOpenCode: number;
  readonly doorHandleCode: number;
  readonly lastSkillCheck: number;
  readonly skillCheckAttempts: number;
  readonly skillCheckGridNo: number;
  readonly delayedMovement: boolean;
  readonly weightCarriedAtTurnStart: number;
  readonly newOppCount: number;
  readonly movementNoiseHeard: number;
  readonly oldLife: number;
  readonly targetCubeLevel: number;
  readonly dontChargeReadyAPs: boolean;
  readonly dontChargeAPsForStanceChange: boolean;
  readonly dontChargeTurningAPs: boolean;
  readonly dontUnsetLastTargetFromTurn: boolean;
  readonly tilesMovedPerRTBreathUpdate: number;
  readonly lastMovementAnimPerRTBreathUpdate: number;
  readonly pendingAction: number;
  readonly pendingActionData1: number;
  readonly pendingActionData2: number;
  readonly serviceCount: number;
  readonly lastRenderVisible: number;
}

export interface SavedContract {
  readonly totalContractLength: number;
  readonly contractEnd: number;
  readonly contractStartDay: number;
  readonly typeOfLastContract: number;
  readonly timeCanSignElsewhere: number;
  readonly signedAnotherContract: boolean;
  readonly lastContractUpdate: number;
  readonly timeWillArrive: number;
  readonly useLandingZone: boolean;
  readonly renewalQuoteCode: number;
  readonly leaveHistoryCode: number;
  readonly medicalDeposit: number;
  readonly contractPriceIncreased: boolean;
  readonly lifeInsurance: number;
  readonly startOfInsuranceContract: number;
  readonly totalLengthOfInsuranceContract: number;
  readonly startTimeOfInsuranceContract: number;
}

export interface SavedSoldier {
  readonly id: number;
  readonly name: string;
  readonly team: number;
  readonly side: number;
  readonly profile: number;
  readonly bodyType: number;
  readonly soldierClass: number;
  readonly whatKindOfMercAmI: number;
  readonly civilianGroup: number;
  readonly active: number;
  readonly inSector: boolean;
  readonly visible: number;
  readonly statusFlags: number;
  readonly miscSoldierFlags: number;
  readonly uniqueSoldierId: number;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
  readonly groupId: number;
  readonly betweenSectors: boolean;
  readonly assignment: number;
  readonly vehicleId: number;
  readonly vehicleSlot: number;
  readonly gridNo: number;
  readonly initialGridNo: number;
  readonly insertionGridNo: number;
  readonly level: number;
  readonly xPos: number;
  readonly yPos: number;
  readonly direction: number;
  readonly desiredDirection: number;
  readonly hiResDirection: number;
  readonly heightAdjustment: number;
  readonly animState: number;
  readonly pendingAnimation: number;
  readonly aniCode: number;
  readonly aniFrame: number;
  readonly overTerrainType: number;
  readonly destination: number;
  readonly finalDestination: number;
  readonly absoluteFinalDestination: number;
  readonly path: readonly number[];
  readonly pathIndex: number;
  readonly oldGridNo: number;
  readonly lastTwoLocations: readonly number[];
  readonly offWorldGridNo: number;
  readonly strategicInsertionCode: number;
  readonly prevSectorId: number;
  readonly insertionDirection: number;
  readonly strategicInsertionData: number;
  readonly actionPoints: number;
  readonly initialActionPoints: number;
  readonly apsLostToSuppression: number;
  readonly suppressionPoints: number;
  readonly stats: SoldierStats;
  readonly statDamage: { readonly agility: number; readonly dexterity: number; readonly strength: number; readonly wisdom: number };
  readonly fractLife: number;
  readonly bleeding: number;
  readonly breathRed: number;
  readonly collapsed: number;
  readonly breathCollapsed: number;
  readonly turnsCollapsed: number;
  readonly morale: number;
  readonly moraleMods: { readonly team: number; readonly tactical: number; readonly strategic: number; readonly delayedStrategic: number };
  readonly skillTraits: readonly [number, number];
  readonly camo: number;
  readonly stealthMode: number;
  readonly mercAsleep: boolean;
  readonly blindedCounter: number;
  readonly sleepDrugCounter: number;
  readonly drugEffect: readonly number[];
  readonly drugSideEffect: readonly number[];
  readonly inventory: readonly ObjectRecord[];
  readonly hasKeys: number;
  readonly quoteRecord: number;
  readonly quoteActionId: number;
  readonly attackingWeapon: number;
  readonly weaponMode: number;
  readonly doBurst: number;
  readonly bulletsLeft: number;
  readonly aimTime: number;
  readonly aimShotLocation: number;
  readonly hitLocation: number;
  readonly target: number;
  readonly targetGridNo: number;
  readonly targetLevel: number;
  readonly lastTarget: number;
  readonly opponent: number;
  readonly attacker: number;
  readonly previousAttacker: number;
  readonly nextToPreviousAttacker: number;
  readonly numHitsThisTurn: number;
  readonly militiaKills: number;
  readonly tilesMoved: number;
  readonly noiseLevel: number;
  readonly oppList: readonly number[];
  readonly ai: SoldierAi;
  readonly interrupt: SoldierInterrupt;
  readonly motion: SoldierMotion;
  readonly palettes: { readonly head: string; readonly pants: string; readonly vest: string; readonly skin: string };
  readonly contract: SavedContract;
  readonly quoteSaidFlags: number;
  readonly corpseQuoteTolerance: number;
  readonly checksum: number;
}

export function soldierRecordBytes(stracLinuxFormat: boolean): number {
  return stracLinuxFormat ? SOLDIER_RECORD_BYTES_STRAC_LINUX : SOLDIER_RECORD_BYTES;
}

export function decodeSoldierRecord(plain: Uint8Array, version: number, stracLinuxFormat: boolean): SavedSoldier {
  const r = readLayout(new SaveCursor(plain), SOLDIER_LAYOUT, stracLinuxFormat, 'SOLDIERTYPE');
  const n = (name: string) => r.num(name);
  const statDamage = (name: string) => (version >= FIRST_VERSION_WITH_STAT_DAMAGE ? n(name) : 0);
  const pathSize = Math.min(n('usPathDataSize') & 0xff, PATH_ENTRIES);
  return {
    id: n('ubID'),
    name: r.str('name'),
    team: n('bTeam'),
    side: n('bSide'),
    profile: n('ubProfile'),
    bodyType: n('ubBodyType'),
    soldierClass: n('ubSoldierClass'),
    whatKindOfMercAmI: n('ubWhatKindOfMercAmI'),
    civilianGroup: n('ubCivilianGroup'),
    active: n('bActive'),
    inSector: n('bInSector') !== 0,
    visible: n('bVisible'),
    statusFlags: n('uiStatusFlags'),
    miscSoldierFlags: n('ubMiscSoldierFlags'),
    uniqueSoldierId: n('uiUniqueSoldierIdValue'),
    sector: { x: n('sSectorX'), y: n('sSectorY'), z: n('sSectorZ') },
    groupId: n('ubGroupID'),
    betweenSectors: r.bool('fBetweenSectors'),
    assignment: n('bAssignment'),
    vehicleId: n('iVehicleId'),
    vehicleSlot: n('bVehicleID'),
    gridNo: n('sGridNo'),
    initialGridNo: n('sInitialGridNo'),
    insertionGridNo: n('sInsertionGridNo'),
    level: n('bLevel'),
    xPos: n('dXPos'),
    yPos: n('dYPos'),
    direction: n('bDirection'),
    desiredDirection: n('bDesiredDirection'),
    hiResDirection: n('ubHiResDirection'),
    heightAdjustment: n('sHeightAdjustment'),
    animState: n('usAnimState'),
    pendingAnimation: n('usPendingAnimation'),
    aniCode: n('usAniCode'),
    aniFrame: n('usAniFrame'),
    overTerrainType: n('bOverTerrainType'),
    destination: n('sDestination'),
    finalDestination: n('sFinalDestination'),
    absoluteFinalDestination: n('sAbsoluteFinalDestination'),
    path: r
      .nums('usPathingData')
      .slice(0, pathSize)
      .map((d) => d & 0xff),
    pathIndex: n('usPathIndex') & 0xff,
    oldGridNo: n('sOldGridNo'),
    lastTwoLocations: r.nums('sLastTwoLocations'),
    offWorldGridNo: n('sOffWorldGridNo'),
    strategicInsertionCode: n('ubStrategicInsertionCode'),
    prevSectorId: n('ubPrevSectorID'),
    insertionDirection: n('ubInsertionDirection'),
    strategicInsertionData: n('usStrategicInsertionData'),
    actionPoints: n('bActionPoints'),
    initialActionPoints: n('bInitialActionPoints'),
    apsLostToSuppression: n('ubAPsLostToSuppression'),
    suppressionPoints: n('ubSuppressionPoints'),
    stats: {
      life: n('bLife'),
      lifeMax: n('bLifeMax'),
      breath: n('bBreath'),
      breathMax: n('bBreathMax'),
      agility: n('bAgility'),
      dexterity: n('bDexterity'),
      strength: n('bStrength'),
      wisdom: n('bWisdom'),
      leadership: n('bLeadership'),
      marksmanship: n('bMarksmanship'),
      mechanical: n('bMechanical'),
      explosive: n('bExplosive'),
      medical: n('bMedical'),
      expLevel: n('bExpLevel'),
    },
    statDamage: {
      agility: statDamage('bAgilityDamage'),
      dexterity: statDamage('bDexterityDamage'),
      strength: statDamage('bStrengthDamage'),
      wisdom: statDamage('bWisdomDamage'),
    },
    fractLife: n('sFractLife'),
    bleeding: n('bBleeding'),
    breathRed: n('sBreathRed'),
    collapsed: n('bCollapsed'),
    breathCollapsed: n('bBreathCollapsed'),
    turnsCollapsed: n('bTurnsCollapsed'),
    morale: n('bMorale'),
    moraleMods: {
      team: n('bTeamMoraleMod'),
      tactical: n('bTacticalMoraleMod'),
      strategic: n('bStrategicMoraleMod'),
      delayedStrategic: n('bDelayedStrategicMoraleMod'),
    },
    skillTraits: [n('ubSkillTrait1'), n('ubSkillTrait2')],
    camo: n('bCamo'),
    stealthMode: n('bStealthMode'),
    mercAsleep: r.bool('fMercAsleep'),
    blindedCounter: n('bBlindedCounter'),
    sleepDrugCounter: n('bSleepDrugCounter'),
    drugEffect: r.nums('bDrugEffect'),
    drugSideEffect: r.nums('bDrugSideEffect'),
    inventory: r.objects('inv'),
    hasKeys: n('bHasKeys'),
    quoteRecord: n('ubQuoteRecord'),
    quoteActionId: n('ubQuoteActionID'),
    attackingWeapon: n('usAttackingWeapon'),
    weaponMode: n('bWeaponMode'),
    doBurst: n('bDoBurst'),
    bulletsLeft: n('bBulletsLeft'),
    aimTime: n('bAimTime'),
    aimShotLocation: n('bAimShotLocation'),
    hitLocation: n('ubHitLocation'),
    target: n('target'),
    targetGridNo: n('sTargetGridNo'),
    targetLevel: n('bTargetLevel'),
    lastTarget: n('sLastTarget'),
    opponent: n('opponent'),
    attacker: n('attacker'),
    previousAttacker: n('previous_attacker'),
    nextToPreviousAttacker: n('next_to_previous_attacker'),
    numHitsThisTurn: n('bNumHitsThisTurn'),
    militiaKills: n('ubMilitiaKills'),
    tilesMoved: n('bTilesMoved'),
    noiseLevel: n('bNoiseLevel'),
    oppList: r.nums('bOppList'),
    ai: {
      lastAction: n('bLastAction'),
      action: n('bAction'),
      actionData: n('usActionData'),
      nextAction: n('bNextAction'),
      nextActionData: n('usNextActionData'),
      actionInProgress: n('bActionInProgress'),
      alertStatus: n('bAlertStatus'),
      oppCount: n('bOppCnt'),
      neutral: n('bNeutral'),
      newSituation: n('bNewSituation'),
      nextTargetLevel: n('bNextTargetLevel'),
      orders: n('bOrders'),
      attitude: n('bAttitude'),
      underFire: n('bUnderFire'),
      shock: n('bShock'),
      bypassToGreen: n('bBypassToGreen'),
      dominantDirection: n('bDominantDir'),
      patrolCount: n('bPatrolCnt'),
      nextPatrolPoint: n('bNextPatrolPnt'),
      patrolGrid: r.nums('usPatrolGrid'),
      noiseGridNo: n('sNoiseGridno'),
      noiseVolume: n('ubNoiseVolume'),
      lastAttackHit: n('bLastAttackHit'),
      aiMorale: n('bAIMorale'),
      caller: n('ubCaller'),
      callerGridNo: n('sCallerGridNo'),
      callPriority: n('bCallPriority'),
      callActedUpon: n('bCallActedUpon'),
      frenzied: n('bFrenzied'),
      mobility: n('bMobility'),
      aiFlags: n('fAIFlags'),
      hunting: n('bHunting'),
      scheduleId: n('ubScheduleID'),
      scheduleProgress: n('bAIScheduleProgress'),
      normalSmell: n('bNormalSmell'),
      monsterSmell: n('bMonsterSmell'),
      regenerationCounter: n('bRegenerationCounter'),
      pendingActionData4: n('uiPendingActionData4'),
    },
    interrupt: {
      duelPoints: n('bInterruptDuelPts'),
      passedLastInterrupt: n('bPassedLastInterrupt'),
      startAPs: n('bIntStartAPs'),
      moved: n('bMoved'),
      movedPriorToInterrupt: n('bMovedPriorToInterrupt'),
    },
    motion: {
      uiMovementMode: n('usUIMovementMode'),
      movementDirection: n('bMovementDirection'),
      reverse: n('bReverse'),
      noAPToFinishMove: r.bool('fNoAPToFinishMove'),
      pendingDirection: n('ubPendingDirection'),
      pendingStanceChange: n('ubPendingStanceChange'),
      desiredHeight: n('ubDesiredHeight'),
      forecastGridNo: n('sForcastGridno'),
      inNonInterruptibleAnimation: r.bool('fInNonintAnim'),
      rtNonInterruptible: r.bool('fRTInNonintAnim'),
      turningUntilDone: r.bool('fTurningUntilDone'),
      continueMoveAfterStanceChange: r.bool('fContinueMoveAfterStanceChange'),
      pathStored: n('bPathStored'),
      pathSize: pathSize,
      reservedGridNo: n('sReservedMovementGridNo'),
      endDoorOpenCode: n('bEndDoorOpenCode'),
      doorHandleCode: n('ubDoorHandleCode'),
      lastSkillCheck: n('bLastSkillCheck'),
      skillCheckAttempts: n('ubSkillCheckAttempts'),
      skillCheckGridNo: n('sSkillCheckGridNo'),
      delayedMovement: r.bool('fDelayedMovement'),
      weightCarriedAtTurnStart: n('sWeightCarriedAtTurnStart'),
      newOppCount: n('bNewOppCnt'),
      movementNoiseHeard: n('ubMovementNoiseHeard'),
      oldLife: n('bOldLife'),
      targetCubeLevel: n('bTargetCubeLevel'),
      dontChargeReadyAPs: r.bool('fDontChargeReadyAPs'),
      dontChargeAPsForStanceChange: r.bool('fDontChargeAPsForStanceChange'),
      dontChargeTurningAPs: r.bool('fDontChargeTurningAPs'),
      dontUnsetLastTargetFromTurn: r.bool('fDontUnsetLastTargetFromTurn'),
      tilesMovedPerRTBreathUpdate: n('ubTilesMovedPerRTBreathUpdate'),
      lastMovementAnimPerRTBreathUpdate: n('usLastMovementAnimPerRTBreathUpdate'),
      pendingAction: n('ubPendingAction'),
      pendingActionData1: n('uiPendingActionData1'),
      pendingActionData2: n('sPendingActionData2'),
      serviceCount: n('ubServiceCount'),
      lastRenderVisible: n('bLastRenderVisibleValue'),
    },
    palettes: { head: r.str('HeadPal'), pants: r.str('PantsPal'), vest: r.str('VestPal'), skin: r.str('SkinPal') },
    contract: {
      totalContractLength: n('iTotalContractLength'),
      contractEnd: n('iEndofContractTime'),
      contractStartDay: n('iStartContractTime'),
      typeOfLastContract: n('bTypeOfLastContract'),
      timeCanSignElsewhere: n('iTimeCanSignElsewhere'),
      signedAnotherContract: r.bool('fSignedAnotherContract'),
      lastContractUpdate: n('uiTimeOfLastContractUpdate'),
      timeWillArrive: n('uiTimeSoldierWillArrive'),
      useLandingZone: r.bool('fUseLandingZoneForArrival'),
      renewalQuoteCode: n('ubContractRenewalQuoteCode'),
      leaveHistoryCode: n('ubLeaveHistoryCode'),
      medicalDeposit: n('usMedicalDeposit'),
      contractPriceIncreased: r.bool('fContractPriceHasIncreased'),
      lifeInsurance: n('usLifeInsurance'),
      startOfInsuranceContract: n('iStartOfInsuranceContract'),
      totalLengthOfInsuranceContract: n('iTotalLengthOfInsuranceContract'),
      startTimeOfInsuranceContract: n('uiStartTimeOfInsuranceContract'),
    },
    quoteSaidFlags: n('usQuoteSaidFlags'),
    corpseQuoteTolerance: n('bCorpseQuoteTolerance'),
    checksum: n('checksum'),
  };
}

export function soldierChecksum(s: SavedSoldier): number {
  const t = s.stats;
  let sum = 1;
  sum = (sum + 1 + t.life) >>> 0;
  sum = Math.imul(sum, 1 + t.lifeMax) >>> 0;
  sum = (sum + 1 + t.agility) >>> 0;
  sum = Math.imul(sum, 1 + t.dexterity) >>> 0;
  sum = (sum + 1 + t.strength) >>> 0;
  sum = Math.imul(sum, 1 + t.marksmanship) >>> 0;
  sum = (sum + 1 + t.medical) >>> 0;
  sum = Math.imul(sum, 1 + t.mechanical) >>> 0;
  sum = (sum + 1 + t.explosive) >>> 0;
  sum = Math.imul(sum, 1 + t.expLevel) >>> 0;
  sum = (sum + 1 + s.profile) >>> 0;
  for (const o of s.inventory) sum = (sum + o.item + o.count) >>> 0;
  return sum;
}
