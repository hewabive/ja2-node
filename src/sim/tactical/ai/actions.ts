// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AI.h ActionType, situation values; AIInternals.h delays; AIUtils.cc Urgency, MovementMode;
// @src src/game/Tactical/Overhead.cc RT_DELAY_BETWEEN_AI_HANDLING; TacticalAI/AIMain.cc AI_DELAY. See docs/09.

export const AiAction = {
  NONE: 0,
  RANDOM_PATROL: 1,
  SEEK_FRIEND: 2,
  SEEK_OPPONENT: 3,
  TAKE_COVER: 4,
  GET_CLOSER: 5,
  POINT_PATROL: 6,
  LEAVE_WATER_GAS: 7,
  SEEK_NOISE: 8,
  ESCORTED_MOVE: 9,
  RUN_AWAY: 10,
  KNIFE_MOVE: 11,
  APPROACH_MERC: 12,
  TRACK: 13,
  EAT: 14,
  PICKUP_ITEM: 15,
  SCHEDULE_MOVE: 16,
  WALK: 17,
  RUN: 18,
  MOVE_TO_CLIMB: 19,
  CHANGE_FACING: 20,
  CHANGE_STANCE: 21,
  YELLOW_ALERT: 22,
  RED_ALERT: 23,
  CREATURE_CALL: 24,
  PULL_TRIGGER: 25,
  USE_DETONATOR: 26,
  FIRE_GUN: 27,
  TOSS_PROJECTILE: 28,
  KNIFE_STAB: 29,
  THROW_KNIFE: 30,
  GIVE_AID: 31,
  WAIT: 32,
  PENDING_ACTION: 33,
  DROP_ITEM: 34,
  COWER: 35,
  STOP_COWERING: 36,
  OPEN_OR_CLOSE_DOOR: 37,
  UNLOCK_DOOR: 38,
  LOCK_DOOR: 39,
  LOWER_GUN: 40,
  ABSOLUTELY_NONE: 41,
  CLIMB_ROOF: 42,
  END_TURN: 43,
  END_COWER_AND_MOVE: 44,
  TRAVERSE_DOWN: 45,
  OFFER_SURRENDER: 46,
} as const;

export const FIRST_MOVEMENT_ACTION = AiAction.RANDOM_PATROL;
export const LAST_MOVEMENT_ACTION = AiAction.CHANGE_STANCE;

export const Situation = { NOT_NEW: 0, WAS_NEW: 1, IS_NEW: 2 } as const;

export const AI_DELAY = 100;
export const RT_DELAY_BETWEEN_AI_HANDLING = 50;
export const MAX_ROAMING_RANGE = 160;
export const NEW_SITUATION_DELAY_RANGE = 1000;

const URGENCY_LOW = 0;
const URGENCY_MED = 1;
const URGENCY_HIGH = 2;

export const URGENCY: readonly (readonly number[])[] = [
  [URGENCY_LOW, URGENCY_LOW, URGENCY_LOW, URGENCY_LOW, URGENCY_LOW],
  [URGENCY_HIGH, URGENCY_MED, URGENCY_MED, URGENCY_LOW, URGENCY_LOW],
  [URGENCY_HIGH, URGENCY_MED, URGENCY_MED, URGENCY_MED, URGENCY_MED],
  [URGENCY_HIGH, URGENCY_HIGH, URGENCY_HIGH, URGENCY_MED, URGENCY_MED],
];

export type MoveName = 'WALKING' | 'RUNNING' | 'SWATTING';

const W: MoveName = 'WALKING';
const R: MoveName = 'RUNNING';
const S: MoveName = 'SWATTING';

export const MOVEMENT_MODE: readonly (readonly MoveName[])[] = [
  [W, W, W],
  [W, W, W],
  [W, R, R],
  [W, R, R],
  [R, R, R],
  [W, R, R],
  [W, W, W],
  [W, R, R],
  [W, S, R],
  [R, R, R],
  [W, R, R],
  [R, R, R],
  [W, W, W],
  [R, R, R],
  [R, R, R],
  [W, R, S],
  [W, W, W],
  [W, W, W],
  [R, R, R],
  [W, R, R],
  [W, R, R],
  [W, R, R],
];
