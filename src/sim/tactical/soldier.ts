// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h SOLDIERTYPE (movement, animation and AI fields used by ja2-node)

import type { StructureInstance } from '../../content/world/structures.ts';
import type { ItemObject } from '../items/object.ts';
import { emptyInventory, type Inventory } from './inventory.ts';
import type { LightSprite } from './lighting/lighting.ts';
import type { WorldItem } from './world-items.ts';

export const Body = {
  REGMALE: 0,
  BIGMALE: 1,
  STOCKYMALE: 2,
  REGFEMALE: 3,
  ADULTFEMALEMONSTER: 4,
  AM_MONSTER: 5,
  YAF_MONSTER: 6,
  YAM_MONSTER: 7,
  LARVAE_MONSTER: 8,
  INFANT_MONSTER: 9,
  QUEENMONSTER: 10,
  FATCIV: 11,
  MANCIV: 12,
  MINICIV: 13,
  DRESSCIV: 14,
  HATKIDCIV: 15,
  KIDCIV: 16,
  CRIPPLECIV: 17,
  COW: 18,
  CROW: 19,
  BLOODCAT: 20,
  ROBOTNOWEAPON: 21,
  HUMVEE: 22,
  TANK_NW: 23,
  TANK_NE: 24,
  ELDORADO: 25,
  ICECREAMTRUCK: 26,
  JEEP: 27,
} as const;

export const SkillTrait = {
  NONE: 0,
  LOCKPICKING: 1,
  HANDTOHAND: 2,
  ELECTRONICS: 3,
  NIGHTOPS: 4,
  THROWING: 5,
  TEACHING: 6,
  HEAVY_WEAPS: 7,
  AUTO_WEAPS: 8,
  STEALTHY: 9,
  AMBIDEXT: 10,
  THIEF: 11,
  MARTIALARTS: 12,
  KNIFING: 13,
  ONROOF: 14,
  CAMOUFLAGED: 15,
} as const;

export const SKILL_TRAIT_BONUS = [0, 25, 15, 15, 15, 12, 15, 15, 0, 15, 0, 0, 30, 30, 15, 0];

export const Personality = {
  NONE: 0,
  HEAT_INTOLERANT: 1,
  NERVOUS: 2,
  CLAUSTROPHOBIC: 3,
  NONSWIMMER: 4,
  FEAR_OF_INSECTS: 5,
  FORGETFUL: 6,
  PSYCHO: 7,
} as const;

export function numSkillTraits(s: { readonly skillTrait1: number; readonly skillTrait2: number }, trait: number): number {
  return (s.skillTrait1 === trait ? 1 : 0) + (s.skillTrait2 === trait ? 1 : 0);
}

export const ReasonCantFinishMove = { NO_APS: 0, STOPPED_SIGHT: 1 } as const;

export const SoldierStatusFlags = {
  PC: 0x00000008,
  PCUNDERAICONTROL: 0x00000020,
  UNDERAICONTROL: 0x00000040,
  DEAD: 0x00000080,
  ROBOT: 0x00001000,
  MONSTER: 0x00002000,
  ANIMAL: 0x00004000,
  VEHICLE: 0x00008000,
  COWERING: 0x00400000,
  GASSED: 0x01000000,
  OFF_MAP: 0x02000000,
  DRIVER: 0x08000000,
  PASSENGER: 0x10000000,
} as const;

export const Team = { OUR: 0, ENEMY: 1, CREATURE: 2, MILITIA: 3, CIV: 4 } as const;
export const Side = { FRIENDLY: 0, ENEMY: 1, HOSTILE: 2, NONE: 3 } as const;
export const NO_PROFILE = 200;
export const NOWHERE = -1;
export const NO_PENDING_ANIMATION = -1;
export const NO_PENDING_DIRECTION = -1;
export const OKLIFE = 15;
export const OKBREATH = 10;
export const TOTAL_SOLDIERS = 156;
export const TEAM_SIZES = [20, 32, 32, 32, 32, 8] as const;
export const TEAM_FIRST_ID = [0, 20, 52, 84, 116, 148] as const;

export function firstFreeSoldierId(taken: (id: number) => boolean, team: number): number {
  const first = TEAM_FIRST_ID[team] ?? 0;
  const size = TEAM_SIZES[team] ?? 0;
  for (let id = first; id < first + size; id++) if (!taken(id)) return id;
  return -1;
}
export const NO_INTERRUPT = 127;

export const AlertStatus = { GREEN: 0, YELLOW: 1, RED: 2, BLACK: 3 } as const;

export const Orders = {
  STATIONARY: 0,
  ONGUARD: 1,
  CLOSEPATROL: 2,
  FARPATROL: 3,
  POINTPATROL: 4,
  ONCALL: 5,
  SEEKENEMY: 6,
  RNDPTPATROL: 7,
} as const;

export const Attitude = {
  DEFENSIVE: 0,
  BRAVESOLO: 1,
  BRAVEAID: 2,
  CUNNINGSOLO: 3,
  CUNNINGAID: 4,
  AGGRESSIVE: 5,
  ATTACKSLAYONLY: 6,
} as const;

export const SoldierClass = {
  NONE: 0,
  ADMINISTRATOR: 1,
  ELITE: 2,
  ARMY: 3,
  GREEN_MILITIA: 4,
  REG_MILITIA: 5,
  ELITE_MILITIA: 6,
  CREATURE: 7,
  MINER: 8,
} as const;

export interface SoldierPalettes {
  readonly hair: string;
  readonly skin: string;
  readonly vest: string;
  readonly pants: string;
}

export interface SoldierStats {
  agility: number;
  dexterity: number;
  strength: number;
  wisdom: number;
  leadership: number;
  marksmanship: number;
  mechanical: number;
  explosives: number;
  medical: number;
  experience: number;
}

export interface AiState {
  alertStatus: number;
  orders: number;
  attitude: number;
  patrolGrid: number[];
  patrolCount: number;
  nextPatrolPoint: number;
  action: number;
  actionData: number;
  nextAction: number;
  nextActionData: number;
  nextTargetLevel: number;
  pickupItem: WorldItem | null;
  nextPickupItem: WorldItem | null;
  lastAction: number;
  actionInProgress: boolean;
  counter: number;
  handleEveryFrame: boolean;
  newSituation: number;
  bypassToGreen: number;
  blackList: number;
  dominantDir: number;
  noiseGridNo: number;
  noiseLevel: number;
  noiseVolume: number;
  oppCount: number;
  underFire: number;
  morale: number;
  cautious: boolean;
}

export interface Soldier {
  readonly id: number;
  readonly team: number;
  side: number;
  neutral: boolean;
  readonly name: string;
  readonly profile: number;
  readonly soldierClass: number;
  bodyType: number;
  readonly palettes: SoldierPalettes;
  readonly inv: Inventory;
  readonly stats: SoldierStats;
  life: number;
  lifeMax: number;
  morale: number;
  dead: boolean;
  skillTrait1: number;
  skillTrait2: number;
  personalityTrait: number;
  bleeding: number;
  breath: number;
  breathMax: number;
  breathRed: number;
  actionPoints: number;
  initialActionPoints: number;
  weightCarriedAtTurnStart: number;
  stealthMode: boolean;
  cowering: boolean;
  civilianGroup: number;
  hasKeys: boolean;
  visible: number;
  underAiControl: boolean;
  monsterOrAnimal: boolean;

  state: number;
  pc: number;
  frame: number;
  aniDelay: number;
  nextFrameAt: number;
  pendingAnimation: number;
  pendingDirection: number;
  direction: number;
  desiredDirection: number;
  turnIncrement: number;
  turningUntilDone: boolean;
  lookOnNextTurn: boolean;
  pausedMove: boolean;
  pauseAnimMove: boolean;
  noAPToFinishMove: boolean;
  dontUpdateNewGridNoOnMoveAnimChange: number;
  continueMoveAfterStanceChange: number;
  inNonInterruptibleAnimation: boolean;
  rtNonInterruptible: boolean;
  desiredHeight: number;
  pendingStanceChange: number;
  forecastGridNo: number;
  placed: boolean;
  structure: StructureInstance | null;

  x: number;
  y: number;
  gridNo: number;
  oldGridNo: number;
  level: number;
  destination: number;
  destX: number;
  destY: number;
  finalDestination: number;
  absoluteFinalDestination: number;
  movementDirection: number;
  pastX: boolean;
  pastY: boolean;
  uiMovementMode: number;
  path: number[];
  pathIndex: number;
  pathSize: number;
  pathStored: boolean;
  goodContPath: boolean;
  reverse: boolean;
  overTerrain: number;
  tilesMoved: number;

  delayedMovement: number;
  delayedMovementCause: number;
  delayedMovementFlags: number;
  nextTileCheckAt: number;
  blockedByAnotherMerc: boolean;
  blockedByAnotherMercDirection: number;
  reservedGridNo: number;
  endDoorOpenCode: number;
  endDoorOpenCodeData: number;
  pendingDoorGridNo: number;
  breathCollapsed: boolean;
  collapsed: boolean;
  dontChargeReadyAPs: boolean;
  dontChargeAPsForStanceChange: boolean;

  ai: AiState;
  readonly oppList: Int8Array;
  readonly lastKnownOpp: Int16Array;
  newOppCnt: number;
  interruptDuelPts: number;
  movementNoiseHeard: number;

  moved: boolean;
  movedPriorToInterrupt: boolean;
  passedLastInterrupt: boolean;
  aiTurnControl: boolean;
  turnInProgress: boolean;
  intStartAPs: number;
  lastTwoLocations: [number, number];
  shock: number;
  nextBleed: number;
  suppressionPoints: number;
  apsLostToSuppression: number;
  reasonCantFinishMove: number;
  oldLife: number;
  lastRenderVisible: number;
  fadeStep: number;
  nextFadeAt: number;
  pauseAllAnimation: boolean;
  numHitsThisTurn: number;
  closeCall: boolean;
  lastTarget: number;
  dontChargeTurningAPs: boolean;
  contPathLocation: number;
  collapsedTurns: number;
  tilesMovedPerRTBreathUpdate: number;
  lastMovementAnimPerRTBreathUpdate: number;

  aimTime: number;
  aimShotLocation: number;
  doBurst: number;
  doSpread: number;
  bulletsLeft: number;
  attackingHand: number;
  attackingWeapon: number;
  target: Soldier | null;
  opponent: Soldier | null;
  targetGridNo: number;
  targetLevel: number;
  targetCubeLevel: number;
  turningToShoot: boolean;
  dontUnsetLastTargetFromTurn: boolean;
  attackNoticed: boolean;
  muzzleFlash: boolean;
  muzzleFlashLight: LightSprite | null;
  muzzleFlashCount: number;
  weaponMode: number;
  lastAttackHit: boolean;
  attacker: Soldier | null;
  previousAttacker: Soldier | null;
  nextToPreviousAttacker: Soldier | null;
  beingAttackedCount: number;
  hitLocation: number;
  gettingHit: number;
  goBackToAimAfterHit: boolean;
  damageWindow: number;
  damageWindowSteps: number;
  nextDamageStepAt: number;
  numPelletsHitBy: number;
  intendedTarget: boolean;
  suppressor: Soldier | null;
  tryingToFall: boolean;
  startFallDir: number;
  fallClockwise: boolean;
  lastDamageReason: number;
  deadSoundPlayed: boolean;
  doingExternalDeath: boolean;
  pendingActionData1: number;
  turningFromHit: boolean;
  changingStanceDueToSuppression: boolean;
  statDamage: { strength: number; dexterity: number; agility: number; wisdom: number };
  kills: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  timesWounded: number;
  lastSkillCheck: number;
  skillCheckAttempts: number;
  skillCheckGridNo: number;
  turningFromPronePosition: number;
  sleepDrugCounter: number;
  monsterSmell: number;
  sayAmmoQuotePending: boolean;
  teamMoraleMod: number;
  tacticalMoraleMod: number;
  strategicMoraleMod: number;
  delayedStrategicMoraleMod: number;
  ctgtTarget: Soldier | null;
  blindedCounter: number;
  displayDamage: boolean;
  oldState: number;
  oldPc: number;
  pendingActionData2: number;
  spreadLocations: number[];
  pendingPickup: PendingPickup | null;
  tempObject: ItemObject | null;
  tempNewGridNo: number;
  heightAdjustment: number;
  groupId: number;
  insertionGridNo: number;
  insertionData: number;
  useExitGridForReentryDirection: boolean;
  preTraversalGridNo: number;
  waitActionToDo: number;
  quoteActionId: number;
  offWorldGridNo: number;
  militiaKills: number;
  offMap: boolean;
}

export interface PendingPickup {
  readonly gridNo: number;
  readonly actionGridNo: number;
  readonly zLevel: number;
  readonly selection: readonly WorldItem[] | null;
}

export interface SoldierInit {
  readonly id: number;
  readonly team: number;
  readonly side?: number;
  readonly name: string;
  readonly profile?: number;
  readonly soldierClass?: number;
  readonly bodyType: number;
  readonly palettes: SoldierPalettes;
  readonly inv?: Inventory;
  readonly stats: SoldierStats;
  readonly life: number;
  readonly lifeMax?: number;
  readonly morale?: number;
  readonly skillTrait1?: number;
  readonly skillTrait2?: number;
  readonly personalityTrait?: number;
  readonly breath?: number;
  readonly gridNo: number;
  readonly level?: number;
  readonly direction: number;
  readonly state: number;
  readonly civilianGroup?: number;
  readonly ai?: Partial<AiState>;
}

export function cellCentre(g: number): { x: number; y: number } {
  return { x: (g % 160) * 10 + 5, y: Math.trunc(g / 160) * 10 + 5 };
}

export function createSoldier(init: SoldierInit): Soldier {
  const centre = cellCentre(init.gridNo);
  return {
    id: init.id,
    team: init.team,
    side:
      init.side ??
      (init.team === Team.OUR || init.team === Team.MILITIA ? Side.FRIENDLY : init.team === Team.CREATURE ? Side.NONE : Side.ENEMY),
    neutral: init.team === Team.CIV,
    name: init.name,
    profile: init.profile ?? NO_PROFILE,
    soldierClass: init.soldierClass ?? SoldierClass.NONE,
    bodyType: init.bodyType,
    palettes: init.palettes,
    inv: init.inv ?? emptyInventory(),
    stats: init.stats,
    life: init.life,
    lifeMax: init.lifeMax ?? init.life,
    morale: init.morale ?? 50,
    dead: false,
    skillTrait1: init.skillTrait1 ?? 0,
    skillTrait2: init.skillTrait2 ?? 0,
    personalityTrait: init.personalityTrait ?? 0,
    bleeding: 0,
    breath: init.breath ?? 100,
    breathMax: init.breath ?? 100,
    breathRed: 0,
    actionPoints: 0,
    initialActionPoints: 0,
    weightCarriedAtTurnStart: 0,
    stealthMode: false,
    cowering: false,
    civilianGroup: init.civilianGroup ?? 0,
    hasKeys: false,
    visible: init.team === Team.OUR ? 1 : -1,
    underAiControl: false,
    monsterOrAnimal: false,
    state: init.state,
    pc: 0,
    frame: 0,
    aniDelay: 0,
    nextFrameAt: 0,
    pendingAnimation: NO_PENDING_ANIMATION,
    pendingDirection: NO_PENDING_DIRECTION,
    direction: init.direction,
    desiredDirection: init.direction,
    turnIncrement: 0,
    turningUntilDone: false,
    lookOnNextTurn: false,
    pausedMove: false,
    pauseAnimMove: false,
    noAPToFinishMove: false,
    dontUpdateNewGridNoOnMoveAnimChange: 0,
    continueMoveAfterStanceChange: 0,
    inNonInterruptibleAnimation: false,
    rtNonInterruptible: false,
    desiredHeight: 255,
    pendingStanceChange: 255,
    forecastGridNo: NOWHERE,
    placed: false,
    structure: null,
    x: Math.fround(centre.x),
    y: Math.fround(centre.y),
    gridNo: init.gridNo,
    oldGridNo: init.gridNo,
    level: init.level ?? 0,
    destination: init.gridNo,
    destX: centre.x,
    destY: centre.y,
    finalDestination: init.gridNo,
    absoluteFinalDestination: NOWHERE,
    movementDirection: init.direction,
    pastX: false,
    pastY: false,
    uiMovementMode: 0,
    path: [],
    pathIndex: 0,
    pathSize: 0,
    pathStored: false,
    goodContPath: false,
    reverse: false,
    overTerrain: 0,
    tilesMoved: 0,
    delayedMovement: 0,
    delayedMovementCause: NOWHERE,
    delayedMovementFlags: 0,
    nextTileCheckAt: 0,
    blockedByAnotherMerc: false,
    blockedByAnotherMercDirection: 0,
    reservedGridNo: NOWHERE,
    endDoorOpenCode: 0,
    endDoorOpenCodeData: NOWHERE,
    pendingDoorGridNo: NOWHERE,
    breathCollapsed: false,
    collapsed: false,
    dontChargeReadyAPs: false,
    dontChargeAPsForStanceChange: false,
    ai: {
      alertStatus: AlertStatus.GREEN,
      orders: Orders.STATIONARY,
      attitude: Attitude.DEFENSIVE,
      patrolGrid: [],
      patrolCount: 0,
      nextPatrolPoint: 1,
      action: 0,
      actionData: NOWHERE,
      nextAction: 0,
      nextActionData: 0,
      nextTargetLevel: 0,
      pickupItem: null,
      nextPickupItem: null,
      lastAction: 0,
      actionInProgress: false,
      counter: 0,
      handleEveryFrame: false,
      newSituation: 0,
      bypassToGreen: 0,
      blackList: NOWHERE,
      dominantDir: init.direction,
      noiseGridNo: NOWHERE,
      noiseLevel: 0,
      noiseVolume: 0,
      oppCount: 0,
      underFire: 0,
      morale: 0,
      cautious: false,
      ...init.ai,
    },
    oppList: new Int8Array(TOTAL_SOLDIERS),
    lastKnownOpp: new Int16Array(TOTAL_SOLDIERS).fill(NOWHERE),
    newOppCnt: 0,
    interruptDuelPts: NO_INTERRUPT,
    movementNoiseHeard: 0,
    moved: false,
    movedPriorToInterrupt: false,
    passedLastInterrupt: false,
    aiTurnControl: false,
    turnInProgress: false,
    intStartAPs: 0,
    lastTwoLocations: [NOWHERE, NOWHERE],
    shock: 0,
    nextBleed: 0,
    suppressionPoints: 0,
    apsLostToSuppression: 0,
    reasonCantFinishMove: ReasonCantFinishMove.NO_APS,
    oldLife: init.life,
    lastRenderVisible: -1,
    fadeStep: 0,
    nextFadeAt: 0,
    pauseAllAnimation: false,
    numHitsThisTurn: 0,
    closeCall: false,
    lastTarget: NOWHERE,
    dontChargeTurningAPs: false,
    contPathLocation: NOWHERE,
    collapsedTurns: 0,
    tilesMovedPerRTBreathUpdate: 0,
    lastMovementAnimPerRTBreathUpdate: init.state,
    aimTime: 0,
    aimShotLocation: 0,
    doBurst: 0,
    doSpread: 0,
    bulletsLeft: 0,
    attackingHand: 5,
    attackingWeapon: 0,
    target: null,
    opponent: null,
    targetGridNo: NOWHERE,
    targetLevel: 0,
    targetCubeLevel: 0,
    turningToShoot: false,
    dontUnsetLastTargetFromTurn: false,
    attackNoticed: false,
    muzzleFlash: false,
    muzzleFlashLight: null,
    muzzleFlashCount: 0,
    weaponMode: 0,
    lastAttackHit: false,
    attacker: null,
    previousAttacker: null,
    nextToPreviousAttacker: null,
    beingAttackedCount: 0,
    hitLocation: 0,
    gettingHit: 0,
    goBackToAimAfterHit: false,
    damageWindow: 0,
    damageWindowSteps: 0,
    nextDamageStepAt: 0,
    numPelletsHitBy: 0,
    intendedTarget: false,
    suppressor: null,
    tryingToFall: false,
    startFallDir: 0,
    fallClockwise: false,
    lastDamageReason: 0,
    deadSoundPlayed: false,
    doingExternalDeath: false,
    pendingActionData1: 0,
    turningFromHit: false,
    changingStanceDueToSuppression: false,
    statDamage: { strength: 0, dexterity: 0, agility: 0, wisdom: 0 },
    kills: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    timesWounded: 0,
    lastSkillCheck: -1,
    skillCheckAttempts: 0,
    skillCheckGridNo: NOWHERE,
    turningFromPronePosition: 0,
    sleepDrugCounter: 0,
    monsterSmell: 0,
    sayAmmoQuotePending: false,
    teamMoraleMod: 0,
    tacticalMoraleMod: 0,
    strategicMoraleMod: 0,
    delayedStrategicMoraleMod: 0,
    ctgtTarget: null,
    blindedCounter: 0,
    displayDamage: false,
    oldState: 0,
    oldPc: 0,
    pendingActionData2: 0,
    spreadLocations: [0, 0, 0, 0, 0, 0],
    pendingPickup: null,
    tempObject: null,
    tempNewGridNo: NOWHERE,
    heightAdjustment: 0,
    groupId: 0,
    insertionGridNo: NOWHERE,
    insertionData: 0,
    useExitGridForReentryDirection: false,
    preTraversalGridNo: NOWHERE,
    waitActionToDo: 0,
    quoteActionId: 0,
    offWorldGridNo: NOWHERE,
    militiaKills: 0,
    offMap: false,
  };
}
