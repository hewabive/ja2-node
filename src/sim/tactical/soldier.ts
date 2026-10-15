// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h SOLDIERTYPE (movement, animation and AI fields used by ja2-node)

import type { HandClass } from '../../content/items/weapons.ts';

export const Team = { OUR: 0, ENEMY: 1, CREATURE: 2, MILITIA: 3, CIV: 4 } as const;
export const Side = { FRIENDLY: 0, HOSTILE: 1, NEUTRAL: 2 } as const;
export const NO_PROFILE = 200;
export const NOWHERE = -1;
export const NO_PENDING_ANIMATION = -1;
export const NO_PENDING_DIRECTION = -1;
export const OKLIFE = 15;
export const OKBREATH = 10;

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

export const Attitude = { DEFENSIVE: 0, BRAVESOLO: 1, BRAVEAID: 2, CUNNINGSOLO: 3, CUNNINGAID: 4, AGGRESSIVE: 5 } as const;

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
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly wisdom: number;
  readonly leadership: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly medical: number;
  readonly experience: number;
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
  actionInProgress: boolean;
  aiDelayUntil: number;
  nextActionAt: number;
  handleEveryFrame: boolean;
  newSituation: number;
  lastActionTime: number;
  bypassToGreen: boolean;
}

export interface Soldier {
  readonly id: number;
  readonly team: number;
  side: number;
  readonly name: string;
  readonly profile: number;
  readonly soldierClass: number;
  bodyType: number;
  readonly palettes: SoldierPalettes;
  readonly handItem: number;
  readonly hand: HandClass;
  readonly stats: SoldierStats;
  life: number;
  readonly lifeMax: number;
  breath: number;
  breathMax: number;
  breathRed: number;
  stealthMode: boolean;
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
  breathCollapsed: boolean;
  collapsed: boolean;

  ai: AiState;
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
  readonly handItem?: number;
  readonly hand?: HandClass;
  readonly stats: SoldierStats;
  readonly life: number;
  readonly lifeMax?: number;
  readonly breath?: number;
  readonly gridNo: number;
  readonly level?: number;
  readonly direction: number;
  readonly state: number;
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
    side: init.side ?? (init.team === Team.OUR ? Side.FRIENDLY : init.team === Team.CIV ? Side.NEUTRAL : Side.HOSTILE),
    name: init.name,
    profile: init.profile ?? NO_PROFILE,
    soldierClass: init.soldierClass ?? SoldierClass.NONE,
    bodyType: init.bodyType,
    palettes: init.palettes,
    handItem: init.handItem ?? 0,
    hand: init.hand ?? 'nothing',
    stats: init.stats,
    life: init.life,
    lifeMax: init.lifeMax ?? init.life,
    breath: init.breath ?? 100,
    breathMax: init.breath ?? 100,
    breathRed: 0,
    stealthMode: false,
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
    breathCollapsed: false,
    collapsed: false,
    ai: {
      alertStatus: AlertStatus.GREEN,
      orders: Orders.STATIONARY,
      attitude: Attitude.DEFENSIVE,
      patrolGrid: [],
      patrolCount: 0,
      nextPatrolPoint: 1,
      action: 0,
      actionData: 0,
      nextAction: 0,
      nextActionData: 0,
      actionInProgress: false,
      aiDelayUntil: 0,
      nextActionAt: 0,
      handleEveryFrame: false,
      newSituation: 0,
      lastActionTime: 0,
      bypassToGreen: false,
      ...init.ai,
    },
  };
}
