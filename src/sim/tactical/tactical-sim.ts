// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleMovementMenu (the run), UIHandleSoldierStanceChange (the stance change,
// @src a moving merc's gait in real time), UIHandleCMoveMerc and SelectedMercCanAffordMove (the move: its mode, the
// @src first step's APs and the continue location), MakeSoldierTurn (the turn), UIHandlePADJAdjustStance (the climb),
// @src UIOkForItemPickup (the pick-up), UIHandleEndTurn (CheckForEndOfCombatMode before the turn passes);
// @src Interface.cc PopupMovementMenu (who cannot run); Handle_Items.cc HandleItem (the attack, the remote's APs);
// @src Soldier_Control.cc EVENT_InitNewSoldierAnim (USE_REMOTE; the plantBomb command and the remote bomb trigger go through
// @src HandleItem, 2026-11-04), SetSoldierAsUnderAiControl (the AI turn in the
// @src combat view); Interface_Items.cc HandleItemPointerClick (the drop at the feet); Handle_UI.cc
// @src UIHandleRubberBandOnTerrain (who may be multi-selected) and EndMultiSoldierSelection for the select command
// @src (2026-10-31); Turn_Based_Input.cc ChangeCurrentSquad and Radar_Screen.cc TacticalSquadListBtnCallBack
// @src (IsSquadOnCurrentTacticalMap, then SetCurrentSquad) for the selectSquad command (2026-11-01); Handle_UI.cc
// @src SetUIBusy (only orders lock our turn: the random idle animations of Soldier_Ani.cc code 491 do not, 2026-11-02);
// @src Turn_Based_Input.cc HandleHandCursorClick and HandleMoveModeInteractiveClick (EPC_CANNOT_DO_THAT for a pickup or
// @src search by an escort), Interface_Items.cc HandleItemPointerClick (no drop by an escort, the unconscious or a
// @src swimmer in deep water, 2026-11-03); MessageBoxScreen.cc (the game stands while a box is up; its answer runs the
// @src box's callback) and GameScreen.cc EndModalTactical (the stop-time quote's callback, 2026-11-04); Handle_UI.cc
// @src UIMouseOnValidAttackLocation (WIRECUTCURS: a cuttable fence at ground level) and Turn_Based_Input.cc's click with the
// @src wire cutters, jar and tin can (cutFence, fillJar, attachCan through HandleItem; the x-ray device takes useRemote,
// @src 2026-11-04); Turn_Based_Input.cc HandleMoveModeInteractiveClick (no move for a vehicle), HandleHandCursorClick
// @src (the vehicle click, enterVehicle) and Interface_Panels.cc TMClickSecondHandInvCallbackPrimary (ExitVehicle, the
// @src exitVehicle command, 2026-11-05); Handle_UI.cc UIMouseOnValidAttackLocation (REPAIRCURS and REFUELCURS: a
// @src vehicle at ground level) for the repair and refuel commands (2026-11-05); GameScreen.cc MainGameScreenHandle in
// @src auto-bandage (HandleAutoBandage instead of the frame; its mask takes every order) and Turn_Based_Input.cc's 'a' key
// @src (the autoBandage command), the Done and Cancel buttons of Auto_Bandage.cc (endAutoBandage, 2026-11-06).

import { AnimFlags } from '../../content/anim/tables.ts';
import { type PresentationTimeline, spriteFrameAt, timelineLoops } from '../../content/anim/timelines.ts';
import { MapFlags } from '../../content/formats/map.ts';
import { handClass, ItemClass, ItemCursor, NOTHING } from '../../content/items/items.ts';
import { isVisibleTile, pythSpacesAway, WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { type PreRandom, Rng } from '../../core/rng.ts';
import { TICK_MS } from '../clock.ts';
import type { CommandResult } from '../command.ts';
import type { GunImprintEvent, SimEvent } from '../events.ts';
import type { ItemObject } from '../items/object.ts';
import type { KnowledgeLight } from '../knowledge/view.ts';
import { applyOptionChange, type GameOptions, parseOptionChange } from '../options.ts';
import { NUMBER_OF_SQUADS } from '../strategic/forces/constants.ts';
import type { CivGroupState } from '../strategic/narrative/civ-groups.ts';
import type { BoxingRecord } from '../strategic/narrative/facts.ts';
import type { VehicleRecord } from '../vehicles/vehicle-list.ts';
import { actionModeCursor } from './action-cursor.ts';
import { AiAction } from './ai/actions.ts';
import {
  type AiControl,
  actionDone,
  aiForSlot,
  awayAiForPass,
  beginAiPass,
  cancelAIAction,
  createAiControl,
  freeUpFromPendingAction,
  freeUpFromRoofClimb,
  freeUpFromStanceChange,
  freeUpFromTurning,
  freeUpNpcFromPendingAction,
} from './ai/control.ts';
import { checkForChangingOrders, decideAlertStatus, setNewSituation } from './ai/decide.ts';
import { makeClosestEnemyChosenOne } from './ai/panic.ts';
import { pullTriggerOpcode } from './ai/panic-actions.ts';
import { endTimedAiPause } from './ai/pause.ts';
import { handleSystemNewAISituation } from './ai/system-situation.ts';
import { endAIGuysTurn, startNPCAI } from './ai/turn-based.ts';
import {
  AnimHeight,
  changeSoldierStance,
  changeSoldierState,
  endHeight,
  hasAnimFlag,
  height,
  LOCKED_NO_NEWGRIDNO,
  nextFrameTick,
  setDesiredDirection,
  soldierGotoStationaryStance,
  states,
} from './animation.ts';
import { autoBandageFrame, beginAutoBandage, checkAutoBandageComplete, requestEndAutoBandage, startAutoBandage } from './auto-bandage.ts';
import { handleExplosionQueue } from './bombs/bomb-queue.ts';
import { answerPlaceBlueFlag, mineSpottedDialogueCallBack } from './bombs/mine-detection.ts';
import {
  answerBombMessageBox,
  bombOpcode,
  handlePendingDropBombOnArrival,
  type PlantBombRefusal,
  plantBombRefusal,
} from './bombs/planting.ts';
import { answerDisarmTrap, answerRemoveBlueFlag, boobyTrapDialogueCallBack } from './booby-traps.ts';
import { generateBuildings } from './buildings.ts';
import { enoughAmmo, minAPsToAttack } from './combat/ap.ts';
import { attackOpcode, handleItem, ItemHandle } from './combat/attack.ts';
import { updateBullets, updateMissAnimations } from './combat/bullets.ts';
import { deathOpcode, updateSkullReleases } from './combat/death.ts';
import { soldierCollapse } from './combat/hit.ts';
import { handlePendingMeleeOnArrival } from './combat/melee.ts';
import { type MeleeOrderRefusal, meleeOrderRefusal } from './combat/melee-order.ts';
import { parseSpread, pickBurstLocations } from './combat/spread-burst.ts';
import { apsToStealItem, canBeStolenFrom, mercStealFromMerc, stealActionGridNo, stealOpcode } from './combat/steal.ts';
import { AimShot, WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { crowOpcode, crowsFlyAway, crowsSeeingAttackerFlyAway, handleRottingCorpses } from './crows.ts';
import { hiResDirectionOf } from './directions.ts';
import { DOOR_ACTIONS, type DoorActionName } from './doors/door-actions.ts';
import { doorCommand, handlePendingDoorOnArrival } from './doors/door-command.ts';
import { type DoorView, doorViews, type KeyView, keyRingView } from './doors/door-view.ts';
import type { KeyTable } from './doors/keys.ts';
import { openContainerGridNos, openDoorGridNos } from './doors.ts';
import { stepExplosions } from './explosions/explosion.ts';
import { stepThrownObjects } from './explosions/physics.ts';
import { checkForRunningIntoGas, updateGassedOnNewGridNo } from './explosions/smoke.ts';
import type { WorldClockSource } from './explosions/state.ts';
import { explosivesBusy } from './explosions/state.ts';
import { throwOpcode } from './explosions/throwing.ts';
import { cancelAllServices, firstAidOpcode, givingSoldierCancelServices, handlePendingAidOnArrival } from './first-aid.ts';
import { dequeueAllGameEvents } from './game-events.ts';
import { clearPendingGive, handlePendingGiveOnArrival } from './give.ts';
import { ensureConsistentWeaponMode, handleTacticalEffectsOfEquipmentChange } from './hand-item.ts';
import { playerInterfaceLocked } from './interface-lock.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { dispatchInventoryCommand, INVENTORY_COMMANDS } from './inventory-commands.ts';
import { type InventoryItemView, inventoryView } from './inventory-view.ts';
import {
  answerActivateSwitch,
  apsToPickupItem,
  dropsBeside,
  handlePendingPickupOnArrival,
  itemOpcode,
  pickupCandidates,
  requestedZLevel,
  searchTile,
  showsItems,
  soldierDropItem,
  soldierDropObject,
  soldierDropObjectBeside,
  soldierPickupItem,
} from './item-actions.ts';
import { DROPPING_DISTANCE, itemPointerHolderBlocked, PASS_REFUSALS, passItem } from './item-pointer.ts';
import { ITEM_SOURCE_REFUSALS, type ItemSource, isRingSource, parseItemSource, takeSourceObject } from './item-source.ts';
import {
  initLighting,
  LightSpriteFlags,
  lightSetBaseLevel,
  NORMAL_LIGHTLEVEL_DAY,
  turnOffNightLights,
  turnOffPrimeLights,
  turnOnNightLights,
  turnOnPrimeLights,
} from './lighting/lighting.ts';
import { directionToward, getNewSoldierPath, stopMerc } from './movement.ts';
import { movementForStanceChange, movementModeState, moveStateBasedOnStance, pathMoveMode, stanceHeight } from './movement-mode.ts';
import { shownAnimSurface } from './multi-tile.ts';
import { checkHostileOrSayQuoteList } from './narrative/civ-hostility.ts';
import { handleCreatureTenseQuote } from './narrative/creature-tension.ts';
import { npcDrawsFirstOnAttack } from './narrative/first-draw.ts';
import { okControllableMerc } from './narrative/merc-quotes.ts';
import { handlePickedOwnershipCheck } from './narrative/minor-offenses.ts';
import { StopTimeCallback } from './narrative/port.ts';
import { isRobot, uncontrolledRobot } from './narrative/robot.ts';
import { createScheduleList, loadMapSchedules } from './narrative/schedule-state.ts';
import { pressStatueRemote } from './narrative/statue.ts';
import { handlePendingTalkOnArrival } from './narrative/talk-arrival.ts';
import { wheelchairOpcode } from './narrative/wheelchair.ts';
import { clearTacticalStuffDueToTimeCompression, executeOverhead, type OverheadHooks } from './overhead.ts';
import { findBestPath, PathCopy } from './pathfinding.ts';
import { removePendingAction } from './pending-action.ts';
import { mostImportantNoiseHeard } from './perception/knowledge.ts';
import { allTeamsLookForAll } from './perception/sight.ts';
import { perceptionHooks, sightHooks } from './perception/wiring.ts';
import { invalidStanceRefusal } from './person-structure.ts';
import { dispatchPlayerOrder, type OrderContext, PLAYER_ORDERS } from './player-orders.ts';
import { AP, apsToChangeStance, apsToLook, deductPoints, enoughPoints, ptsToMoveDirection } from './points.ts';
import type { ProfileProgress } from './profiles.ts';
import { promptOpenRefusal, TacticalPromptKind, takeAnswer } from './prompts.ts';
import { randomAnimOpcode } from './random-anims.ts';
import { type Refusal, refuse, refused } from './refusal.ts';
import { cancelPendingRobotReload, handlePendingRobotReloadOnArrival, robotReloadOpcode } from './robot-reload.ts';
import {
  apsToClimbRoof,
  beginSoldierClimbDownRoof,
  beginSoldierClimbUpRoof,
  findHigherLevel,
  findLowerLevel,
  roofOpcode,
} from './roofs.ts';
import { checkMercsWaiting } from './sector-exit.ts';
import { endMultiSoldierSelection, selectionRefusal, selectOrderedMerc, selectSoldier, setCurrentSquad } from './selection.ts';
import { Body, inVehicle, isTank, NO_PROFILE, OKBREATH, OKLIFE, onTheGrid, type Soldier, shownToPlayer, Team, Visible } from './soldier.ts';
import { type OtherSoldierFields, type OwnSoldierFields, otherSoldierFields, ownSoldierFields } from './soldier-view.ts';
import {
  type AutoBandageState,
  type CrowStatus,
  createTacticalState,
  type RealtimeClock,
  type TacticalState,
  teamMembers,
  whoIsThere,
} from './state.ts';
import {
  fenceCuttableBy,
  handlePendingTileToolOnArrival,
  interactiveTileAt,
  tileToolOpcode,
  VEHICLE_TOOLS_NOT_IN_CAMPAIGN,
  vehicleServiceableBy,
} from './tile-tools.ts';
import { TOSS_REFUSALS, tossItem } from './toss.ts';
import { showsAiProgress, type TopMessageName, topMessageName } from './turns/top-message.ts';
import { checkForEndOfCombatMode, endTurn, handleEnemySightingPause, handleRealtimeTurns } from './turns/turns.ts';
import {
  BoardingCursor,
  type BoardingRules,
  enterVehicle,
  enterVehicleCheck,
  isBoardingRefusal,
  NOT_IN_CAMPAIGN,
  NOT_IN_VEHICLE,
  VEHICLE_CANT_MOVE,
} from './vehicle-boarding.ts';
import { apsToDisplay, crewRefusal, passengersAboard } from './vehicle-presence.ts';
import type { VehicleBoarding } from './vehicle-soldiers.ts';
import { type ItemSnapshot, Visibility, WorldItemFlags } from './world-items.ts';
import { dynamicLightSprites } from './world-view.ts';

export interface SoldierSnapshot {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly heightAdjustment?: number;
  readonly direction: number;
  readonly hiResDirection?: number;
  readonly turning?: boolean;
  readonly animation: number;
  readonly frame: number;
  readonly palettes: readonly [string, string, string, string];
  readonly camouflaged?: boolean;
  readonly hand: string;
  readonly surface: number;
  readonly frameSlot: number;
  readonly stateTick: number;
  readonly frameDelay: number;
  readonly nextFrameTick: number;
  readonly muzzleFlash?: boolean;
  readonly fadingOut?: boolean;
  readonly ap?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breath?: number;
  readonly inventory?: readonly InventoryItemView[];
  readonly keys?: readonly KeyView[];
  readonly profile?: number;
}

export type OwnSoldierSnapshot = SoldierSnapshot & Partial<OwnSoldierFields> & Partial<OtherSoldierFields>;

export interface TopMessageView {
  readonly kind: TopMessageName;
  readonly team: number;
  readonly bloodcats: boolean;
}

export interface CombatSnapshot {
  readonly team: number;
  readonly round: number;
  readonly interrupt: boolean;
  readonly uiLocked: boolean;
  readonly topMessage: TopMessageView | null;
  readonly ai: { readonly current: number; readonly total: number } | null;
  readonly aiTurn: number | null;
}

const UNCONTROLLED_ROBOT = 'the robot has no controller: a merc in its squad must wear the robot remote control';
const ESCORT_CANNOT_PICK_UP = 'an escort can neither pick up nor search';
const REMOTE_TRIGGER = 'REMOTETRIGGER';
const REMOTE_BOMB_TRIGGER = 'REMOTEBOMBTRIGGER';
const XRAY_DEVICE = 'XRAY_DEVICE';
const QUEUED_ORDER = 'the last order has not started yet: advance first';
const NPC_DREW_FIRST = 'the neutral NPC drew first: no attack was made, and he turns on us';
const BAD_GROUP: Refusal = {
  token: 'badGroup',
  reason: 'group must list controllable mercs of yours in the sector, neither vehicles nor the mercs aboard them',
};
const AP_USE_REMOTE = 2;
const AUTO_BANDAGING: Refusal = { token: 'autoBandaging', reason: 'auto-bandage is running: endAutoBandage ends it' };

const AIM_PARTS: Readonly<Record<string, number>> = {
  random: AimShot.RANDOM,
  head: AimShot.HEAD,
  torso: AimShot.TORSO,
  legs: AimShot.LEGS,
};

const ATTACK_REFUSALS: Readonly<Record<number, string>> = {
  [ItemHandle.UNCONSCIOUS]: 'soldier cannot act',
  [ItemHandle.NOAPS]: 'not enough APs for this attack',
  [ItemHandle.NOAMMO]: 'out of ammo',
  [ItemHandle.BROKEN]: 'the weapon does not work',
  [ItemHandle.CANNOT_GETTO_LOCATION]: 'cannot reach the target',
  [ItemHandle.NOROOM]: 'no room to fire here',
  [ItemHandle.REFUSAL]: 'the soldier refuses',
};

const ATTACK_REFUSAL_TOKENS: Readonly<Record<number, string>> = {
  [ItemHandle.UNCONSCIOUS]: 'cannotAct',
  [ItemHandle.NOAPS]: 'notEnoughAP',
  [ItemHandle.NOAMMO]: 'noAmmo',
  [ItemHandle.BROKEN]: 'weaponBroken',
  [ItemHandle.CANNOT_GETTO_LOCATION]: 'cannotReach',
  [ItemHandle.NOROOM]: 'noRoomToFire',
  [ItemHandle.REFUSAL]: 'refusesOrder',
};

function launcherWithoutRound(t: TacticalState, s: Soldier): boolean {
  return t.content.items.byIndex.get(s.attackingWeapon)?.cursor === ItemCursor.TRAJECTORY && !enoughAmmo(t, s, InvSlot.HAND);
}

const DOOR_REFUSALS: Readonly<Record<string, string>> = {
  noDoor: 'there is no door on that tile',
  alreadyOpen: 'the door is already open',
  alreadyClosed: 'the door is already closed',
  doorOpen: 'close the door first',
  notLocked: 'the door is not locked (open it instead)',
  noLock: 'the door has no lock',
  alreadyLocked: 'the door is already locked',
  noKey: 'the soldier carries no key',
  noCrowbar: 'the soldier has no usable crowbar',
  noLockpickKit: 'the soldier has no lockpick kit',
  noShapedCharge: 'the soldier has no shaped charge',
  escortCannot: 'an escorted civilian cannot do that',
  alreadyKnown: 'the trap is already known',
  diagonal: 'not possible from a diagonal position',
  notEnoughAp: 'not enough APs',
  noPath: 'cannot get next to the door',
};

const PLANT_BOMB_REFUSALS: Readonly<Record<PlantBombRefusal, string>> = {
  notABomb: 'the soldier holds no mine, trip flare, trip klaxon or explosive with a detonator',
  noPath: 'no path',
  badTile: 'the bomb cannot go on that tile: nobody could stand there',
  notEnoughAP: 'not enough APs to walk there and plant it',
};

interface TileToolOrder {
  readonly cursor: number;
  readonly refusal: readonly [token: string, reason: string];
  readonly target?: {
    readonly valid: (t: TacticalState, s: Soldier, g: number) => boolean;
    readonly refusal: readonly [token: string, reason: string];
  };
}

const SERVICEABLE_VEHICLE: TileToolOrder['target'] = {
  valid: vehicleServiceableBy,
  refusal: ['noVehicle', 'no vehicle on that tile at ground level, or the soldier is on a roof'],
};

const TILE_TOOL_ORDERS: Readonly<Record<string, TileToolOrder>> = {
  cutFence: {
    cursor: ItemCursor.WIRECUT,
    refusal: ['noWireCutters', 'the soldier holds no wire cutters he can use'],
    target: { valid: fenceCuttableBy, refusal: ['noFence', 'no wire fence to cut on that tile at his level'] },
  },
  fillJar: { cursor: ItemCursor.JAR, refusal: ['noJar', 'the soldier holds no empty jar he can use'] },
  attachCan: {
    cursor: ItemCursor.TINCAN,
    refusal: ['noCan', 'the soldier holds no tin can on a string he can use'],
    target: {
      valid: (t, _s, g) => interactiveTileAt(t, g) !== null,
      refusal: ['noInteractiveTile', 'nothing on that tile to tie the can to: give the gridNo of a door'],
    },
  },
  repair: { cursor: ItemCursor.REPAIR, refusal: ['noToolKit', 'the soldier holds no toolkit he can use'], target: SERVICEABLE_VEHICLE },
  refuel: { cursor: ItemCursor.REFUEL, refusal: ['noGasCan', 'the soldier holds no gas can he can use'], target: SERVICEABLE_VEHICLE },
};

const MELEE_ORDER_REFUSALS: Readonly<Record<MeleeOrderRefusal, string>> = {
  noPath: 'no path to the target',
  notEnoughAP: ATTACK_REFUSALS[ItemHandle.NOAPS] ?? 'not enough APs',
};
const IMPRINT_REFUSALS: Readonly<Record<GunImprintEvent['result'], readonly [token: string, reason: string]>> = {
  imprinted: ['gunImprinted', 'the rocket rifle took his fingerprints instead of firing; attack again to fire it'],
  denied: ['wrongFingerprint', 'the rocket rifle is imprinted on another soldier'],
};

const _MELEE_CHANCE_TO_GET_THROUGH = 100;
const UNDER_GLAUNCHER = 'UNDER_GLAUNCHER';
const SANDBOX_WORLD_HOUR = 12;

const isMeleeItemClass = (cls: number) => cls === ItemClass.BLADE || (cls & (ItemClass.NONE | ItemClass.PUNCH)) !== 0;
const isThrowItemClass = (cls: number) => cls === ItemClass.GRENADE || cls === ItemClass.THROWN || cls === ItemClass.LAUNCHER;
const RANGED_ITEM_CLASSES: ReadonlySet<number> = new Set([ItemClass.GUN, ItemClass.THROWING_KNIFE]);
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const neverMultiSelected = (s: Soldier) => isVehicle(s) || inVehicle(s);
const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;

function walksOrRuns(t: TacticalState, s: Soldier): boolean {
  const st = states(t.content.animations);
  return s.uiMovementMode === st.WALKING || s.uiMovementMode === st.RUNNING;
}

export interface TacticalCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface TacticalSimOptions {
  readonly options?: GameOptions;
  readonly streams?: { readonly rng: Rng; readonly pre: PreRandom };
  readonly profiles?: Map<number, ProfileProgress>;
  readonly vehicles?: VehicleRecord[];
  readonly keyTable?: KeyTable;
  readonly civGroups?: CivGroupState;
  readonly boxing?: BoxingRecord;
  readonly startMs?: number;
  readonly realtimeClock?: RealtimeClock;
  readonly crows?: CrowStatus;
  readonly autoBandage?: AutoBandageState;
  readonly hour?: number;
  readonly dayAmbient?: number;
}

function createSimState(world: TacticalWorld, content: TacticalContent, seed: number, options: TacticalSimOptions): TacticalState {
  const t = createTacticalState(
    { ...world, mapDoors: new Map(world.map.doors.map((d) => [d.gridNo, d])) },
    content,
    options.streams?.rng ?? Rng.fromSeed(seed),
    {
      ...(options.options ? { options: options.options } : {}),
      ...(options.streams ? { pre: options.streams.pre } : {}),
      ...(options.profiles ? { profiles: options.profiles } : {}),
      ...(options.vehicles ? { vehicles: options.vehicles } : {}),
      ...(options.keyTable ? { keyTable: options.keyTable } : {}),
      ...(options.civGroups ? { civGroups: options.civGroups } : {}),
      ...(options.boxing ? { boxing: options.boxing } : {}),
      ...(options.realtimeClock ? { realtimeClock: options.realtimeClock } : {}),
      ...(options.crows ? { crows: options.crows } : {}),
      ...(options.autoBandage ? { autoBandage: options.autoBandage } : {}),
    },
  );
  t.clockMs = options.startMs ?? 0;
  t.schedules = world.map.flags & MapFlags.NPC_SCHEDULES ? loadMapSchedules(world.map.schedules) : createScheduleList();
  return t;
}

function installTacticalHooks(t: TacticalState, ai: AiControl): void {
  t.hooks = sightHooks({
    ...t.hooks,
    collapse: soldierCollapse,
    newAiSituation: handleSystemNewAISituation,
    opcode: (state, s, code) =>
      attackOpcode(state, s, code) ??
      deathOpcode(state, s, code) ??
      itemOpcode(state, s, code) ??
      roofOpcode(state, s, code) ??
      throwOpcode(state, s, code) ??
      firstAidOpcode(state, s, code) ??
      wheelchairOpcode(state, s, code) ??
      stealOpcode(state, s, code) ??
      robotReloadOpcode(state, s, code) ??
      bombOpcode(state, s, code) ??
      tileToolOpcode(state, s, code) ??
      pullTriggerOpcode(state, s, code) ??
      crowOpcode(state, s, code) ??
      randomAnimOpcode(state, s, code),
    rottingCorpses: handleRottingCorpses,
    crowsFlyAway,
    crowsSeeingAttackerFlyAway,
    turnFinished: freeUpFromTurning,
    stanceFreeUp: freeUpFromStanceChange,
    pendingAction: (state, s) =>
      handlePendingMeleeOnArrival(state, s) ||
      handlePendingPickupOnArrival(state, s) ||
      handlePendingDoorOnArrival(state, s) ||
      handlePendingTalkOnArrival(state, s) ||
      handlePendingGiveOnArrival(state, s) ||
      handlePendingAidOnArrival(state, s) ||
      handlePendingRobotReloadOnArrival(state, s) ||
      handlePendingDropBombOnArrival(state, s) ||
      handlePendingTileToolOnArrival(state, s),
    runningIntoGas: checkForRunningIntoGas,
    enteredGridNo: updateGassedOnNewGridNo,
    endAiGuysTurn: (state, s) => endAIGuysTurn(state, s, ai),
  });
  t.perceptionHooks = perceptionHooks(t, {
    checkForChangingOrders: (s) => checkForChangingOrders(t, s),
    setNewSituation: (s) => setNewSituation(t, s),
  });
  t.turnHooks = {
    startNPCAI: (state, s) => startNPCAI(state, s, ai),
    cancelAIAction,
    decideAlertStatus: (state, s) => decideAlertStatus(state, s, ai.hooks),
    setNewSituation,
    checkForChangingOrders,
    minAPsToAttack,
    suppressedStanceChange: (state, s, stance) => {
      cancelAIAction(state, s);
      s.ai.action = AiAction.CHANGE_STANCE;
      s.ai.actionData = stance;
      s.ai.actionInProgress = true;
    },
    freeUpFromAttacking: actionDone,
    aiHandleItem: (state, s, target, level) => handleItem(state, s, target, level, itemIn(s.inv, InvSlot.HAND)),
    freeUpFromPendingAction,
    freeUpNpcFromPendingAction,
    actionDone,
    freeUpFromRoofClimb,
    aiPickup: (state, s, g, item) => soldierPickupItem(state, s, g, 0, item ? [item] : null),
    aiDropHandItem: (state, s) => soldierDropItem(state, s, InvSlot.HAND),
    makeClosestEnemyChosenOne,
  };
}

function overheadTimers(state: TacticalState): void {
  stepExplosions(state);
  handleExplosionQueue(state);
  handleCreatureTenseQuote(state);
  checkHostileOrSayQuoteList(state);
  endTimedAiPause(state);
  updateMissAnimations(state);
  updateSkullReleases(state);
}

function overheadHooks(ai: AiControl): OverheadHooks {
  return {
    beforePass: (state) => {
      handlePickedOwnershipCheck(state);
      stepThrownObjects(state);
      updateBullets(state);
      overheadTimers(state);
      handleRealtimeTurns(state, state.realtimeClock);
      handleEnemySightingPause(state);
      beginAiPass(state);
    },
    ai: (state, s, slot) => aiForSlot(state, s, slot, ai),
    afterPass: (state) => {
      awayAiForPass(state, ai);
      dequeueAllGameEvents(state);
      checkMercsWaiting(state);
    },
  };
}

function autoBandageOverheadHooks(ai: AiControl): OverheadHooks {
  return {
    beforePass: (state) => {
      overheadTimers(state);
      beginAiPass(state);
    },
    ai: (state, s, slot) => aiForSlot(state, s, slot, ai),
    afterPass: (state) => {
      awayAiForPass(state, ai);
      checkAutoBandageComplete(state);
      dequeueAllGameEvents(state);
      checkMercsWaiting(state);
    },
  };
}

export class TacticalSim {
  readonly state: TacticalState;
  readonly world: TacticalWorld;
  readonly mapPath: string;
  readonly ai: AiControl;
  readonly hooks: OverheadHooks;
  readonly autoBandageHooks: OverheadHooks;

  constructor(world: TacticalWorld, content: TacticalContent, seed: number, options: TacticalSimOptions = {}, existing?: TacticalState) {
    this.world = world;
    this.mapPath = world.mapPath;
    this.state = existing ?? createSimState(world, content, seed, options);
    this.ai = createAiControl({
      awareOfOpposition: (state, team) => state.perception.awareOfOpposition[team] === true,
      mostImportantNoiseHeard: (state, s) => mostImportantNoiseHeard(state, s),
    });
    installTacticalHooks(this.state, this.ai);
    this.hooks = overheadHooks(this.ai);
    this.autoBandageHooks = autoBandageOverheadHooks(this.ai);
    if (existing) return;
    generateBuildings(this.state);
    initLighting(this.state, world.map, options.hour ?? SANDBOX_WORLD_HOUR, options.dayAmbient ?? NORMAL_LIGHTLEVEL_DAY);
  }

  static restore(world: TacticalWorld, state: TacticalState): TacticalSim {
    return new TacticalSim(world, state.content, 0, {}, state);
  }

  attachWorldClock(clock: WorldClockSource): void {
    this.state.worldClock = clock;
  }

  setAmbientLight(level: number): void {
    lightSetBaseLevel(this.state, level);
  }

  powerNightLights(on: boolean): void {
    if (on) turnOnNightLights(this.state);
    else turnOffNightLights(this.state);
  }

  powerPrimeLights(on: boolean): void {
    if (on) turnOnPrimeLights(this.state);
    else turnOffPrimeLights(this.state);
  }

  get tick(): number {
    return this.state.tick;
  }

  isBusy(s: Soldier): boolean {
    const content = this.state.content;
    const frozen = s.noAPToFinishMove && hasAnimFlag(content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
    if (frozen) return false;
    return (
      !hasAnimFlag(content, s.state, AnimFlags.STATIONARY) ||
      (!timelineLoops(content.timeline, s.state) && !hasAnimFlag(content, s.state, AnimFlags.MERCIDLE)) ||
      hasAnimFlag(content, s.state, AnimFlags.STANCECHANGEANIM) ||
      s.desiredDirection !== s.direction ||
      s.inNonInterruptibleAnimation ||
      s.delayedMovement !== 0 ||
      s.pendingAnimation !== -1 ||
      s.pendingPickup !== null ||
      s.tempObject !== null ||
      s.breathCollapsed
    );
  }

  isIdle(): boolean {
    const t = this.state;
    if (t.pathEnv.autoBandage) return t.autoBandage.complete;
    if (t.turn.attackBusyCount > 0 || t.bullets.length > 0 || t.gameEvents.length > 0 || explosivesBusy(t.explosives)) return false;
    if (t.explosionQueue.active) return false;
    if (t.mercsWaiting || t.boxing.uiLocked || t.turn.enemySightingOnTheirTurn) return false;
    if (t.inCombat && t.turn.currentTeam !== Team.OUR) return false;
    return !teamMembers(t, Team.OUR).some((s) => this.isBusy(s));
  }

  interruptOpen(): boolean {
    const t = this.state;
    return t.inCombat && t.turn.currentTeam === Team.OUR && t.turn.intList.length > 0;
  }

  hasPendingDecision(): boolean {
    return this.state.prompt !== null || (this.interruptOpen() && this.isIdle());
  }

  actRefusal(s: Soldier): Refusal | null {
    const t = this.state;
    if (t.pathEnv.autoBandage) return AUTO_BANDAGING;
    if (!s.placed || s.team !== Team.OUR) return { token: 'noSuchSoldier', reason: 'no such soldier of yours' };
    const crew = crewRefusal(t, s);
    if (crew) return crew;
    if (s.life < OKLIFE) return { token: 'cannotAct', reason: 'soldier cannot act' };
    if (s.breath < OKBREATH && (s.collapsed || s.breathCollapsed)) return { token: 'outOfBreath', reason: 'soldier is out of breath' };
    if (uncontrolledRobot(t, s)) return { token: 'uncontrolledRobot', reason: UNCONTROLLED_ROBOT };
    if (!t.inCombat) return null;
    const locked = this.#combatLock();
    if (locked) return locked;
    if (s.moved) return { token: 'mercUnavailable', reason: 'soldier has no move this turn' };
    return this.#otherMercActing(s);
  }

  #combatLock(): Refusal | null {
    const t = this.state;
    if (t.turn.hiddenInterrupt) return { token: 'uiLocked', reason: 'the interface is locked' };
    if (t.turn.currentTeam !== Team.OUR) return { token: 'notYourTurn', reason: 'it is not your turn' };
    if (t.turn.attackBusyCount > 0) return { token: 'attackResolving', reason: 'an attack is still resolving' };
    if (t.gameEvents.length > 0) return { token: 'orderQueued', reason: QUEUED_ORDER };
    return null;
  }

  #otherMercActing(s: Soldier): Refusal | null {
    const other = teamMembers(this.state, Team.OUR).find((x) => x !== s && this.isBusy(x));
    return other ? { token: 'mercActing', reason: `soldier ${other.id} is still acting` } : null;
  }

  #selectionLock(s: Soldier): Refusal | null {
    if (!this.state.inCombat) return null;
    return this.#combatLock() ?? this.#otherMercActing(s);
  }

  #multiSelection(ids: unknown, chosen: Soldier): Soldier[] | Refusal | null {
    const t = this.state;
    if (ids === undefined) return null;
    if (!Array.isArray(ids) || neverMultiSelected(chosen)) return BAD_GROUP;
    if (t.inCombat) return { token: 'inCombat', reason: 'there is no multi-selection in turn-based combat' };
    const members: Soldier[] = [];
    for (const id of ids) {
      const m = this.soldier(id);
      if (!m?.placed || m.team !== Team.OUR || !okControllableMerc(t, m) || neverMultiSelected(m)) return BAD_GROUP;
      if (m !== chosen && !members.includes(m)) members.push(m);
    }
    return members;
  }

  #select(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return refuse('noSuchSoldier', 'no such soldier of yours');
    const crew = crewRefusal(t, s);
    if (crew) return refused(crew);
    const members = this.#multiSelection(cmd.group, s);
    if (members && !Array.isArray(members)) return refused(members);
    const refusal = this.#selectionLock(s) ?? selectionRefusal(t, s);
    if (refusal) return refused(refusal);
    if (!members && s.id === t.turn.selected) return refuse('alreadySelected', 'that soldier is already selected');
    const sleepers = teamMembers(t, Team.OUR).filter((x) => (x === s || members?.includes(x)) && t.narrative.mercAsleep(x));
    if (members) endMultiSoldierSelection(t, s, members);
    else selectSoldier(t, s);
    return { ok: true, data: { woke: sleepers.filter((x) => !t.narrative.mercAsleep(x)).map((x) => x.id) } };
  }

  #selectSquad(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const squad = cmd.squad;
    if (typeof squad !== 'number' || !Number.isInteger(squad) || squad < 0 || squad >= NUMBER_OF_SQUADS)
      return refuse('badSquad', 'squad must be 0..19');
    if (!t.narrative.squadOnCurrentTacticalMap(squad)) return refuse('squadNotHere', 'no merc of that squad is in the loaded sector');
    const first = t.narrative.squadMembers(squad)[0];
    const locked = first ? this.#selectionLock(first) : null;
    if (locked) return refused(locked);
    setCurrentSquad(t, squad, false);
    return { ok: true };
  }

  canAct(s: Soldier): string | null {
    return this.actRefusal(s)?.reason ?? null;
  }

  lookAround(): void {
    allTeamsLookForAll(this.state);
  }

  clearTacticalStuffDueToTimeCompression(): void {
    clearTacticalStuffDueToTimeCompression(this.state);
  }

  step(): void {
    const t = this.state;
    if (t.prompt) return;
    if (t.pathEnv.autoBandage) autoBandageFrame(t, this.autoBandageHooks);
    else executeOverhead(t, this.hooks);
    t.tick++;
  }

  runClockAlone(): void {
    this.state.clockMs += TICK_MS;
  }

  runStopTimeCallback(name: string): void {
    if (name === StopTimeCallback.BOOBY_TRAP) boobyTrapDialogueCallBack(this.state);
    else if (name === StopTimeCallback.MINE_SPOTTED) mineSpottedDialogueCallBack(this.state);
  }

  #answer(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const answer = takeAnswer(t, cmd);
    if ('ok' in answer) return answer;
    const { prompt, choice } = answer;
    const yes = choice === 'yes';
    switch (prompt.kind) {
      case TacticalPromptKind.DISARM_TRAP:
        answerDisarmTrap(t, yes);
        break;
      case TacticalPromptKind.ACTIVATE_SWITCH:
        answerActivateSwitch(t, prompt, yes);
        break;
      case TacticalPromptKind.PLACE_BLUE_FLAG:
        answerPlaceBlueFlag(t, yes);
        break;
      case TacticalPromptKind.REMOVE_BLUE_FLAG:
        answerRemoveBlueFlag(t, yes);
        break;
      case TacticalPromptKind.BOMB_SETTING:
      case TacticalPromptKind.REMOTE_FREQUENCY:
        answerBombMessageBox(t, prompt, Number(choice));
        break;
      case TacticalPromptKind.BEGIN_AUTO_BANDAGE:
        if (yes) startAutoBandage(t);
        break;
    }
    return { ok: true };
  }

  drainEvents(): SimEvent[] {
    const events = this.state.events.splice(0).map((e) => ({ ...e, tick: this.state.tick }) as SimEvent);
    return events;
  }

  soldier(id: unknown): Soldier | null {
    return typeof id === 'number' ? (this.state.soldiers[id] ?? null) : null;
  }

  #orderContext(): OrderContext {
    return { t: this.state, soldier: (id) => this.soldier(id), actRefusal: (s) => this.actRefusal(s) };
  }

  #setOption(cmd: TacticalCommand): CommandResult {
    const change = parseOptionChange(cmd);
    if (typeof change === 'string') return refuse('badOption', change);
    applyOptionChange(this.state.options, change);
    this.state.events.push({ type: 'optionChanged', bloodAndGore: this.state.options.bloodAndGore });
    return { ok: true, data: { options: { ...this.state.options } } };
  }

  #dispatchInAutoBandage(cmd: TacticalCommand): CommandResult {
    if (cmd.type === 'setOption') return this.#setOption(cmd);
    if (cmd.type !== 'endAutoBandage') return refused(AUTO_BANDAGING);
    requestEndAutoBandage(this.state);
    return { ok: true, data: { ending: true } };
  }

  #autoBandage(): CommandResult {
    if (playerInterfaceLocked(this.state)) return refuse('uiLocked', 'the interface is locked');
    return beginAutoBandage(this.state);
  }

  dispatch(cmd: TacticalCommand): CommandResult {
    if (this.state.pathEnv.autoBandage) return this.#dispatchInAutoBandage(cmd);
    if (cmd.type === 'answer') return this.#answer(cmd);
    const prompt = promptOpenRefusal(this.state);
    if (prompt) return prompt;
    if (cmd.type === 'setOption') return this.#setOption(cmd);
    if (this.state.mercsWaiting) return refuse('uiLocked', 'the interface is locked while mercs leave the sector');
    if (this.state.boxing.uiLocked) return refuse('boxingUiLock', 'the interface is locked while the boxers leave the ring');
    if (INVENTORY_COMMANDS.has(cmd.type)) return this.#inventory(cmd);
    if (PLAYER_ORDERS.has(cmd.type)) return dispatchPlayerOrder(this.#orderContext(), cmd);
    switch (cmd.type) {
      case 'move':
        return this.#move(cmd);
      case 'turn':
        return this.#turn(cmd);
      case 'stance':
        return this.#stance(cmd);
      case 'endTurn':
        return this.#endTurn();
      case 'attack':
        return this.#attack(cmd);
      case 'pickUp':
        return this.#pickUp(cmd);
      case 'steal':
        return this.#steal(cmd);
      case 'drop':
        return this.#drop(cmd);
      case 'toss':
        return this.#toss(cmd);
      case 'pass':
        return this.#pass(cmd);
      case 'climb':
        return this.#climb(cmd);
      case 'useRemote':
        return this.#useRemote(cmd);
      case 'plantBomb':
        return this.#plantBomb(cmd);
      case 'cutFence':
      case 'fillJar':
      case 'attachCan':
        return this.#useTileTool(cmd);
      case 'repair':
      case 'refuel':
        return this.state.vehicleHooks.boarding ? this.#useTileTool(cmd) : refused(VEHICLE_TOOLS_NOT_IN_CAMPAIGN);
      case 'enterVehicle':
        return this.#enterVehicle(cmd);
      case 'exitVehicle':
        return this.#exitVehicle(cmd);
      case 'door':
        return this.#door(cmd);
      case 'select':
        return this.#select(cmd);
      case 'selectSquad':
        return this.#selectSquad(cmd);
      case 'autoBandage':
        return this.#autoBandage();
      case 'endAutoBandage':
        return refuse('notAutoBandaging', 'auto-bandage is not running');
      case 'stop': {
        const s = this.soldier(cmd.soldier);
        if (!s || s.team !== Team.OUR) return refuse('noSuchSoldier', 'no such soldier of yours');
        const crew = crewRefusal(this.state, s);
        if (crew) return refused(crew);
        cancelAllServices(this.state, s);
        s.pendingAid = null;
        s.pendingDoorAction = null;
        s.pendingTalk = null;
        clearPendingGive(this.state, s);
        cancelPendingRobotReload(this.state, s);
        stopMerc(this.state, s);
        s.finalDestination = s.gridNo;
        return { ok: true };
      }
      default:
        return refuse('unknownCommand', `unknown command ${cmd.type}`);
    }
  }

  visibleItems(): ItemSnapshot[] {
    const items = this.state.content.items;
    const nameOf = (item: number) => items.byIndex.get(item)?.name ?? String(item);
    return this.state.worldItems
      .filter((wi) => wi.visible === Visibility.VISIBLE)
      .map((wi) => {
        const o = wi.object;
        const attachments = o.attachments.filter((a) => a.item !== NOTHING).map((a) => ({ item: nameOf(a.item), status: a.status }));
        return {
          gridNo: wi.gridNo,
          level: wi.level,
          item: nameOf(o.item),
          count: o.count,
          status: o.status[0] ?? 0,
          ...(items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY ? { money: o.money } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(wi.zHeight > 0 ? { height: wi.zHeight } : {}),
          ...(wi.flags & WorldItemFlags.DONTRENDER ? { notRendered: true } : {}),
        };
      })
      .sort((a, b) => a.gridNo - b.gridNo || a.level - b.level);
  }

  #pickUp(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const g = cmd.gridNo === undefined ? s.gridNo : cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    if (t.narrative.isEpc(s)) return refuse('escortCannotDoThat', ESCORT_CANNOT_PICK_UP);
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    if (cmd.items === undefined && !showsItems(t, s, g)) return this.#search(s, g);
    const zLevel = requestedZLevel(t, s, g, cmd.zLevel);
    const candidates = pickupCandidates(t, s, g, zLevel);
    if (candidates.length === 0) return refuse('nothingThere', 'nothing to pick up there');
    let selection = null;
    if (cmd.items !== undefined) {
      if (!Array.isArray(cmd.items) || cmd.items.length === 0) return refuse('badItems', 'items must be a non-empty list of indices');
      const picked = cmd.items.map((k: unknown) => (typeof k === 'number' ? candidates[k] : undefined));
      if (picked.some((wi) => wi === undefined)) return refuse('badItems', `item indices must be 0..${candidates.length - 1}`);
      selection = picked as typeof candidates;
    }
    const apCost = apsToPickupItem(t, s, g);
    if (apCost === 0) return refuse('noPath', 'no path');
    if (!enoughPoints(t.inCombat, s, apCost)) return refuse('notEnoughAP', `not enough APs: ${apCost} needed`);
    if (!soldierPickupItem(t, s, g, zLevel, selection)) return refuse('noPath', 'no path');
    return { ok: true };
  }

  #search(s: Soldier, g: number): CommandResult {
    const refusal = searchTile(this.state, s, g);
    if (refusal === 'refusesOrder') return refuse(refusal, 'his morale is too low to search');
    if (refusal === 'noPath') return refuse(refusal, 'no path');
    return { ok: true };
  }

  #steal(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const target = this.soldier(cmd.target);
    if (!target || !onTheGrid(target) || !shownToPlayer(target)) return refuse('noSuchTarget', 'target must be a soldier the squad sees');
    if (!canBeStolenFrom(target)) return refuse('notStealable', 'only a conscious hostile soldier can be robbed');
    const apCost = apsToStealItem(t, s, stealActionGridNo(t, s, target));
    if (!enoughPoints(t.inCombat, s, apCost)) return refuse('notEnoughAP', `not enough APs: ${apCost} needed`);
    if (!mercStealFromMerc(t, s, target)) return refuse('noPath', 'no path');
    return { ok: true };
  }

  #door(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const g = cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    const action = cmd.action ?? 'open';
    if (typeof action !== 'string' || !(DOOR_ACTIONS as readonly string[]).includes(action))
      return refuse('badAction', `action must be one of ${DOOR_ACTIONS.join(', ')}`);
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    if (s.noAPToFinishMove) soldierGotoStationaryStance(t, s);
    const outcome = doorCommand(t, s, g, action as DoorActionName);
    if (!outcome.ok) return refuse(outcome.refusal, `${outcome.refusal}: ${DOOR_REFUSALS[outcome.refusal] ?? 'refused'}`);
    return { ok: true, data: outcome.data };
  }

  #inventory(cmd: TacticalCommand): CommandResult {
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    if (cmd.type === 'moveItem' && cmd.to === 'ground') return this.#drop({ ...cmd, type: 'drop', slot: cmd.from });
    selectOrderedMerc(this.state, s);
    return dispatchInventoryCommand(this.state, s, cmd);
  }

  #itemSource(s: Soldier, cmd: TacticalCommand): ItemSource | CommandResult {
    const source = parseItemSource(s, { slot: cmd.slot, count: cmd.count, index: cmd.index });
    return typeof source === 'string' ? refuse(source, ITEM_SOURCE_REFUSALS[source]) : source;
  }

  #drop(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const source = this.#itemSource(s, cmd);
    if ('ok' in source) return source;
    const g = cmd.gridNo ?? s.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    if (pythSpacesAway(s.gridNo, g) > DROPPING_DISTANCE) return refuse('tooFar', 'drop takes his tile or one next to it: toss farther');
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    if (itemPointerHolderBlocked(t, s))
      return refuse('cannotDrop', 'escorts, the unconscious and swimmers in deep water cannot drop items');
    if (!enoughPoints(t.inCombat, s, AP.PICKUP_ITEM)) return refuse('notEnoughAP', `not enough APs: ${AP.PICKUP_ITEM} needed`);
    const beside = dropsBeside(t, s, g);
    const item = isRingSource(source) ? NOTHING : itemIn(s.inv, source.slot);
    const dropped = takeSourceObject(t.content, s, source) as ItemObject;
    if (!isRingSource(source)) handleTacticalEffectsOfEquipmentChange(t, s, source.slot, item, NOTHING);
    deductPoints(t, s, AP.PICKUP_ITEM, 0);
    if (beside) soldierDropObjectBeside(t, s, dropped, g);
    else soldierDropObject(t, s, dropped);
    return { ok: true };
  }

  #pass(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const source = this.#itemSource(s, cmd);
    if ('ok' in source) return source;
    const target = this.soldier(cmd.target);
    if (!target || !onTheGrid(target) || target === s || !shownToPlayer(target))
      return refuse('noSuchTarget', 'target must be another soldier the squad sees');
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    const outcome = passItem(t, s, target, source);
    if (typeof outcome === 'string') return refuse(outcome, PASS_REFUSALS[outcome]);
    return { ok: true, data: { passed: outcome.passed } };
  }

  #toss(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const source = this.#itemSource(s, cmd);
    if ('ok' in source) return source;
    const g = cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    const level = cmd.level ?? 0;
    if (level !== 0 && level !== 1) return refuse('badLevel', 'level must be 0 or 1');
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    const tossRefusal = tossItem(t, s, { source, gridNo: g, level });
    if (tossRefusal) return refuse(tossRefusal, TOSS_REFUSALS[tossRefusal]);
    return { ok: true };
  }

  #climb(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return refuse('mustStopFirst', 'stop the soldier first');
    const down = s.level > 0;
    if ((down ? findLowerLevel(t, s) : findHigherLevel(t, s)) < 0)
      return refuse('noRoofEdge', down ? 'no free ground next to the roof edge' : 'no roof edge next to the soldier');
    const ap = apsToClimbRoof(t, s, down);
    if (!enoughPoints(t.inCombat, s, ap)) return refuse('notEnoughAP', `not enough APs: ${ap} needed`);
    if (!(down ? beginSoldierClimbDownRoof(t, s) : beginSoldierClimbUpRoof(t, s))) return refuse('cannotClimb', 'cannot climb here');
    return { ok: true };
  }

  #useRemote(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const hand = itemIn(s.inv, InvSlot.HAND);
    if (hand === t.content.items.byName.get(REMOTE_TRIGGER)?.index) return this.#pressStatueRemote(s);
    const remotes = [REMOTE_BOMB_TRIGGER, XRAY_DEVICE].map((name) => t.content.items.byName.get(name)?.index);
    if (!remotes.includes(hand)) return refuse('noRemote', 'the soldier holds no remote trigger or x-ray detector');
    return this.#handItemResult(handleItem(t, s, s.gridNo, s.level, hand));
  }

  #pressStatueRemote(s: Soldier): CommandResult {
    const t = this.state;
    if (!enoughPoints(t.inCombat, s, AP_USE_REMOTE)) return refuse('notEnoughAP', `not enough APs: ${AP_USE_REMOTE} needed`);
    deductPoints(t, s, AP_USE_REMOTE, 0);
    if (height(t.content, s.state) === AnimHeight.STAND) deductPoints(t, s, AP_USE_REMOTE, 0);
    const result = pressStatueRemote(t, s);
    return { ok: true, data: { result } };
  }

  #plantBomb(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const g = cmd.gridNo === undefined ? s.gridNo : cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    const planting = plantBombRefusal(t, s, g, t.narrative.isEpc(s));
    if (planting) return refuse(planting, PLANT_BOMB_REFUSALS[planting]);
    return this.#handItemResult(handleItem(t, s, g, s.level, itemIn(s.inv, InvSlot.HAND)));
  }

  #useTileTool(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    const g = cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return refuse('badGridNo', 'gridNo must be a visible tile');
    const order = TILE_TOOL_ORDERS[cmd.type] as TileToolOrder;
    if (actionModeCursor(t, s, t.narrative.isEpc(s)) !== order.cursor) return refuse(...order.refusal);
    if (order.target && !order.target.valid(t, s, g)) return refuse(...order.target.refusal);
    return this.#handItemResult(handleItem(t, s, g, s.level, itemIn(s.inv, InvSlot.HAND)));
  }

  #boardingRules(boarding: VehicleBoarding): BoardingRules {
    const t = this.state;
    return { usable: (v) => boarding.okUseVehicle(v), aboard: (v) => passengersAboard(t, v).length };
  }

  #enterVehicle(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const boarding = t.vehicleHooks.boarding;
    if (!boarding) return refused(NOT_IN_CAMPAIGN);
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    if (isVehicle(s)) return refused(VEHICLE_CANT_MOVE);
    const cursor = cmd.cursor ?? BoardingCursor.HAND;
    if (cursor !== BoardingCursor.HAND && cursor !== BoardingCursor.MOVE) return refuse('badCursor', 'cursor must be hand or move');
    const target = this.soldier(cmd.vehicle);
    const vehicle = target && onTheGrid(target) && shownToPlayer(target) ? target : null;
    const walk = enterVehicleCheck(t, s, vehicle, cursor, this.#boardingRules(boarding));
    if (isBoardingRefusal(walk)) return refused(walk);
    const entered = enterVehicle(t, s, walk);
    return entered ? refused(entered) : { ok: true, data: { actionGridNo: walk.actionGridNo, boarded: inVehicle(s) } };
  }

  #exitVehicleRefusal(s: Soldier): Refusal | null {
    if (!s.placed || s.team !== Team.OUR) return { token: 'noSuchSoldier', reason: 'no such soldier of yours' };
    if (!inVehicle(s)) return NOT_IN_VEHICLE;
    return this.#selectionLock(s);
  }

  #exitVehicle(cmd: TacticalCommand): CommandResult {
    const boarding = this.state.vehicleHooks.boarding;
    if (!boarding) return refused(NOT_IN_CAMPAIGN);
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.#exitVehicleRefusal(s);
    if (refusal) return refused(refusal);
    boarding.exitVehicle(s);
    return { ok: true, data: { gridNo: s.gridNo } };
  }

  #handItemResult(result: number): CommandResult {
    if (result === ItemHandle.OK) return { ok: true };
    if (result === ItemHandle.BROKEN) return refuse('itemBroken', 'the item in hand does not work');
    if (result === ItemHandle.CANNOT_GETTO_LOCATION) return refuse('noPath', 'no path');
    return refuse(ATTACK_REFUSAL_TOKENS[result] ?? 'refused', ATTACK_REFUSALS[result] ?? `refused (${result})`);
  }

  #move(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s);
    if (isVehicle(s)) return refused(VEHICLE_CANT_MOVE);
    const to = cmd.to;
    if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to))
      return refuse('badDestination', 'destination must be a visible gridNo');
    const mode = movementModeState(t, s, cmd.mode);
    s.reverse = cmd.reverse === true;
    s.pathStored = false;
    if (t.inCombat) {
      const route = findBestPath(t.pathEnv, s, to, s.level, { copy: PathCopy.ROUTE, mode: pathMoveMode(t.content, mode) });
      if (route.length === 0) return refuse('noPath', 'no path');
      const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
      const first = ptsToMoveDirection(ctx, s, route.steps[0] ?? 0, mode) + apsToChangeStance(t.content, s, height(t.content, mode));
      if (!enoughPoints(t.inCombat, s, first)) {
        s.contPathLocation = to;
        s.goodContPath = true;
        return refuse('notEnoughAP', `not enough APs: the first step costs ${first}, ${s.actionPoints} left`);
      }
    }
    if (s.noAPToFinishMove) s.noAPToFinishMove = false;
    const kept = { mode: s.uiMovementMode, fast: s.uiMovementFast };
    this.#takeMoveMode(s, mode);
    if (!getNewSoldierPath(t, s, to, mode, 1, s.noAPToFinishMove)) {
      s.uiMovementMode = kept.mode;
      s.uiMovementFast = kept.fast;
      return refuse('noPath', 'no path');
    }
    removePendingAction(t, s);
    return { ok: true };
  }

  #takeMoveMode(s: Soldier, mode: number): void {
    const t = this.state;
    s.uiMovementMode = mode;
    if (!t.inCombat) s.uiMovementFast = false;
    else if (mode === states(t.content.animations).RUNNING) s.uiMovementFast = true;
  }

  #turn(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(t, s, cmd.multiSelected === true);
    const direction =
      typeof cmd.toward === 'number' && isVisibleTile(cmd.toward) ? directionToward(s.gridNo, cmd.toward) : (cmd.direction as number);
    if (typeof direction !== 'number' || !Number.isInteger(direction) || direction < 0 || direction > 7)
      return refuse('badDirection', 'give direction 0..7 or toward: gridNo');
    if (direction === s.direction) return refuse('alreadyFacing', 'already facing that way');
    if (!enoughPoints(t.inCombat, s, apsToLook(t.content, s))) return refuse('notEnoughAP', 'not enough APs to turn');
    if (s.noAPToFinishMove) soldierGotoStationaryStance(t, s);
    setDesiredDirection(t, s, direction);
    return { ok: true };
  }

  #stance(cmd: TacticalCommand): CommandResult {
    const s = this.soldier(cmd.soldier);
    if (!s) return refuse('noSuchSoldier', 'no such soldier of yours');
    const refusal = this.actRefusal(s);
    if (refusal) return refused(refusal);
    selectOrderedMerc(this.state, s, cmd.multiSelected === true);
    const wanted = stanceHeight(cmd.stance);
    if (wanted === null) return refuse('badStance', 'stance must be run, stand, crouch or prone');
    return cmd.stance === 'run' ? this.#run(s) : this.#changeStance(s, wanted);
  }

  #run(s: Soldier): CommandResult {
    const t = this.state;
    if (isRobot(s) || isVehicle(s) || inWater(s)) return refuse('cannotRun', 'the soldier cannot run here');
    if (walksOrRuns(t, s)) s.uiMovementMode = states(t.content.animations).RUNNING;
    else {
      const stood = this.#changeStance(s, AnimHeight.STAND);
      if (!stood.ok) return stood;
    }
    s.uiMovementFast = true;
    return { ok: true };
  }

  #changeStance(s: Soldier, wanted: number): CommandResult {
    const t = this.state;
    const invalid = invalidStanceRefusal(t, s, wanted);
    if (invalid) return refused(invalid);
    if (t.inCombat) {
      const ap = apsToChangeStance(t.content, s, wanted);
      if (!enoughPoints(t.inCombat, s, ap)) return refuse('notEnoughAP', `not enough APs: ${ap} needed`);
      changeSoldierStance(t, s, wanted);
      s.finalDestination = s.gridNo;
      s.goodContPath = false;
    } else if (hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) changeSoldierStance(t, s, wanted);
    else this.#changeMovingStance(s, wanted);
    s.uiMovementMode = movementForStanceChange(t.content, wanted);
    s.uiMovementFast = false;
    givingSoldierCancelServices(t, s, false);
    return { ok: true };
  }

  #changeMovingStance(s: Soldier, wanted: number): void {
    const t = this.state;
    s.uiMovementMode = moveStateBasedOnStance(t.content, s, wanted);
    const downToCrawl = s.uiMovementMode === states(t.content.animations).CRAWLING && endHeight(t.content, s.state) !== AnimHeight.PRONE;
    s.dontUpdateNewGridNoOnMoveAnimChange = downToCrawl ? LOCKED_NO_NEWGRIDNO : 1;
    if (downToCrawl) s.pathStored = false;
    changeSoldierState(t, s, s.uiMovementMode, 0, false);
  }

  #attackSetup(
    cmd: TacticalCommand,
  ): { s: Soldier; target: number; level: number; aimTime: number; melee: boolean; thrown: boolean } | { error: string; token: string } {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return { error: 'no such soldier of yours', token: 'noSuchSoldier' };
    const target = cmd.target;
    if (typeof target !== 'number' || !Number.isInteger(target) || !isVisibleTile(target))
      return { error: 'target must be a visible gridNo', token: 'badTarget' };
    const level = cmd.level ?? 0;
    if (level !== 0 && level !== 1) return { error: 'level must be 0 or 1', token: 'badLevel' };
    const aimTime = cmd.aimTime ?? 0;
    if (typeof aimTime !== 'number' || !Number.isInteger(aimTime) || aimTime < 0 || aimTime > 4)
      return { error: 'aimTime must be 0..4', token: 'badAim' };
    const mode = this.#attackWeaponMode(s, cmd.burst);
    const hand =
      mode === WeaponMode.ATTACHED ? (t.content.items.byName.get(UNDER_GLAUNCHER)?.index ?? NOTHING) : itemIn(s.inv, InvSlot.HAND);
    const def = t.content.items.byIndex.get(hand);
    const melee = def !== undefined && isMeleeItemClass(def.itemClass);
    const thrown = def !== undefined && isThrowItemClass(def.itemClass);
    if (!def || (!RANGED_ITEM_CLASSES.has(def.itemClass) && !melee && !thrown))
      return { error: 'soldier has no gun, knife, grenade, launcher or free hand', token: 'noWeapon' };
    if (mode === WeaponMode.BURST && (melee || thrown || !(def.weapon?.shotsPerBurst ?? 0)))
      return { error: 'this weapon cannot fire bursts', token: 'noBurst' };
    const spread = parseSpread(cmd.spread);
    if (typeof spread === 'string') return { error: spread, token: 'badSpread' };
    if (spread && mode !== WeaponMode.BURST) return { error: 'a spread needs the burst mode', token: 'noBurst' };
    if (thrown && def.cursor === ItemCursor.TOSS && aimTime !== 0) return { error: 'throws cannot be aimed', token: 'throwNoAim' };
    const victim = whoIsThere(t, target, level);
    if (melee && (level !== s.level || (!victim && def.itemClass !== ItemClass.BLADE)))
      return { error: 'a punch needs a soldier on the target tile, and a melee attack the same level', token: 'needMeleeTarget' };
    const part = AIM_PARTS[String(cmd.bodyPart ?? 'random')];
    if (part === undefined) return { error: 'bodyPart must be head, torso, legs or random', token: 'badBodyPart' };
    s.aimShotLocation = victim && endHeight(t.content, victim.state) !== AnimHeight.PRONE ? part : AimShot.RANDOM;
    s.weaponMode = mode;
    s.doBurst = mode === WeaponMode.BURST ? 1 : 0;
    if (spread) pickBurstLocations(s, spread, def.weapon?.shotsPerBurst ?? 0);
    s.attackingHand = InvSlot.HAND;
    s.attackingWeapon = hand;
    s.targetLevel = level;
    s.targetCubeLevel = 0;
    return { s, target, level, aimTime, melee, thrown };
  }

  #attackWeaponMode(s: Soldier, burst: unknown): number {
    if (burst === true) return WeaponMode.BURST;
    if (burst === false) return WeaponMode.NORMAL;
    ensureConsistentWeaponMode(this.state.content.items, s);
    return s.weaponMode;
  }

  #attack(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s0 = this.soldier(cmd.soldier);
    if (s0) {
      const refusal = this.actRefusal(s0);
      if (refusal) return refused(refusal);
      selectOrderedMerc(t, s0);
    }
    const setup = this.#attackSetup(cmd);
    if ('error' in setup) return refuse(setup.token, setup.error);
    const { s, target, level, aimTime, melee } = setup;
    if (target === s.gridNo) return refuse('ownTile', 'cannot attack own tile');
    if (launcherWithoutRound(t, s))
      return refuse(ATTACK_REFUSAL_TOKENS[ItemHandle.NOAMMO] ?? 'noAmmo', ATTACK_REFUSALS[ItemHandle.NOAMMO] ?? 'out of ammo');
    const meleeRefusal = melee ? meleeOrderRefusal(t, s, target, aimTime) : null;
    if (meleeRefusal) return refuse(meleeRefusal, MELEE_ORDER_REFUSALS[meleeRefusal]);
    if (npcDrawsFirstOnAttack(t, s, target, level)) return refuse('npcDrewFirst', NPC_DREW_FIRST);
    s.aimTime = aimTime;
    const eventsBefore = t.events.length;
    const result = handleItem(t, s, target, level, s.attackingWeapon);
    if (result !== ItemHandle.OK) {
      s.doSpread = 0;
      const imprint = t.events.slice(eventsBefore).find((e): e is GunImprintEvent => e.type === 'gunImprint');
      if (imprint) return refuse(...IMPRINT_REFUSALS[imprint.result]);
      return refuse(ATTACK_REFUSAL_TOKENS[result] ?? 'attackRefused', ATTACK_REFUSALS[result] ?? `attack refused (${result})`);
    }
    return { ok: true };
  }

  #endTurn(): CommandResult {
    const t = this.state;
    if (!t.inCombat) return refuse('notInCombat', 'not in turn-based combat');
    if (t.turn.currentTeam !== Team.OUR) return refuse('notYourTurn', 'it is not your turn');
    if (t.turn.attackBusyCount > 0) return refuse('attackResolving', 'an attack is still resolving');
    if (t.gameEvents.length > 0) return refuse('orderQueued', QUEUED_ORDER);
    const busy = teamMembers(t, Team.OUR).find((x) => this.isBusy(x));
    if (busy) return refuse('mercActing', `soldier ${busy.id} is still acting`);
    if (checkForEndOfCombatMode(t, false)) return { ok: true, data: { combatEnded: true } };
    endTurn(t, Team.OUR + 1);
    return { ok: true };
  }

  doors(): DoorView[] {
    return doorViews(this.state);
  }

  openDoors(): number[] {
    return openDoorGridNos(this.state);
  }

  openContainers(): number[] {
    return openContainerGridNos(this.state);
  }

  snapshot(presentation: PresentationTimeline, filter: (s: Soldier) => boolean = () => true): OwnSoldierSnapshot[] {
    const shown = this.state.soldiers.filter((s): s is Soldier => !!s && s.placed && filter(s));
    const others = new Set(shown.filter((s) => s.team !== Team.OUR).map((s) => s.id));
    return shown.map((s) => ({
      id: s.id,
      team: s.team,
      name: s.name,
      bodyType: s.bodyType,
      gridNo: s.gridNo,
      x: s.x,
      y: s.y,
      level: s.level,
      ...(s.heightAdjustment !== 0 ? { heightAdjustment: s.heightAdjustment } : {}),
      direction: s.direction,
      ...(s.hiResDirection !== hiResDirectionOf(s.direction) ? { hiResDirection: s.hiResDirection } : {}),
      ...(isTank(s) && s.direction !== s.desiredDirection ? { turning: true } : {}),
      animation: s.state,
      frame: spriteFrameAt(presentation, s.frameSlot),
      palettes: [s.palettes.hair, s.palettes.skin, s.palettes.vest, s.palettes.pants] as const,
      ...(s.camo !== 0 ? { camouflaged: true } : {}),
      hand: handClass(this.state.content.items, itemIn(s.inv, InvSlot.HAND)),
      surface: shownAnimSurface(this.state.content, s),
      frameSlot: s.frameSlot,
      stateTick: s.stateTick,
      frameDelay: s.aniDelay,
      nextFrameTick: nextFrameTick(this.state, s),
      ...(s.muzzleFlash ? { muzzleFlash: true } : {}),
      ...(s.visible === Visible.FADING_OUT ? { fadingOut: true } : {}),
      ...(s.team === Team.OUR
        ? {
            ap: apsToDisplay(this.state, s),
            life: s.life,
            lifeMax: s.lifeMax,
            breath: s.breath,
            inventory: inventoryView(this.state.content.items, s.inv),
            ...(s.keyRing?.some((k) => k.count > 0) ? { keys: keyRingView(this.state, s) } : {}),
            ...(s.profile !== NO_PROFILE ? { profile: s.profile } : {}),
            ...ownSoldierFields(this.state, s, others),
          }
        : otherSoldierFields(s)),
    }));
  }

  lightView(): KnowledgeLight {
    const l = this.state.lighting;
    const dynamic = new Set(dynamicLightSprites(this.state));
    const sprites = l.sprites.flatMap((sprite) => {
      if (!sprite || !(sprite.flags & LightSpriteFlags.ACTIVE) || !(sprite.flags & LightSpriteFlags.ON)) return [];
      if (sprite.x >= WORLD_COLS || sprite.y >= WORLD_ROWS) return [];
      const roof = sprite.flags & LightSpriteFlags.ONROOF ? { roof: true as const } : {};
      const moving = dynamic.has(sprite) ? { dynamic: true as const } : {};
      return [{ template: sprite.template.name, x: sprite.x, y: sprite.y, ...roof, ...moving }];
    });
    return { ambient: l.ambient, sprites };
  }

  visibleTeam(): number {
    const turn = this.state.turn;
    return turn.hiddenInterrupt ? Team.OUR : turn.currentTeam;
  }

  uiLocked(): boolean {
    const t = this.state;
    if (t.turn.currentTeam !== Team.OUR || t.turn.attackBusyCount > 0 || t.gameEvents.length > 0) return true;
    return teamMembers(t, Team.OUR).some((s) => this.isBusy(s));
  }

  combatView(): CombatSnapshot | null {
    const t = this.state;
    if (!t.inCombat) return null;
    const message = t.turn.topMessage;
    const progress = t.turn.aiProgress;
    return {
      team: this.visibleTeam(),
      round: t.turn.round,
      interrupt: this.interruptOpen(),
      uiLocked: this.uiLocked(),
      topMessage: message ? { kind: topMessageName(message.kind), team: message.team, bloodcats: message.bloodcats } : null,
      ai: showsAiProgress(message) ? { current: progress.current, total: progress.total } : null,
      aiTurn: this.#shownAiTurnSoldier(),
    };
  }

  #shownAiTurnSoldier(): number | null {
    const t = this.state;
    if (t.turn.hiddenInterrupt) return null;
    const holder = t.soldiers.find((s) => s?.aiTurnControl);
    return holder && shownToPlayer(holder) ? holder.id : null;
  }
}
