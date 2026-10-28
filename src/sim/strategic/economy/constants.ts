// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.h (assignments, train stats, BREATHMAX_*); Assignments.cc (rates and divisors);
// @src Town_Militia.h; Strategic_Town_Loyalty.cc/.h; Strategic_Mines.cc/.h; Strategic_Status.h; Tactical/Overhead_Types.h;
// @src Tactical/Soldier_Profile_Type.h SkillTrait; StrategicMap.h town ids.

export const Assignment = {
  SQUAD_1: 0,
  SQUAD_20: 19,
  ON_DUTY: 20,
  DOCTOR: 21,
  PATIENT: 22,
  VEHICLE: 23,
  IN_TRANSIT: 24,
  REPAIR: 25,
  TRAIN_SELF: 26,
  TRAIN_TOWN: 27,
  TRAIN_TEAMMATE: 28,
  TRAIN_BY_OTHER: 29,
  ASSIGNMENT_DEAD: 30,
  ASSIGNMENT_UNCONCIOUS: 31,
  ASSIGNMENT_POW: 32,
  ASSIGNMENT_HOSPITAL: 33,
  ASSIGNMENT_EMPTY: 34,
} as const;

export const TrainStat = {
  STRENGTH: 0,
  DEXTERITY: 1,
  AGILITY: 2,
  HEALTH: 3,
  MARKSMANSHIP: 4,
  MEDICAL: 5,
  MECHANICAL: 6,
  LEADERSHIP: 7,
  EXPLOSIVE: 8,
} as const;
export const NUM_TRAINABLE_STATS = 9;

export const SkillTrait = { ELECTRONICS: 3, NIGHTOPS: 4, TEACHING: 6, MARTIALARTS: 12 } as const;

export const MilitiaRank = { GREEN: 0, REGULAR: 1, ELITE: 2 } as const;
export const MAX_MILITIA_LEVELS = 3;

export const SoldierClass = {
  ADMINISTRATOR: 1,
  ELITE: 2,
  ARMY: 3,
  GREEN_MILITIA: 4,
  REG_MILITIA: 5,
  ELITE_MILITIA: 6,
} as const;

export const Town = {
  BLANK: 0,
  OMERTA: 1,
  DRASSEN: 2,
  ALMA: 3,
  GRUMM: 4,
  TIXA: 5,
  CAMBRIA: 6,
  SAN_MONA: 7,
  ESTONI: 8,
  ORTA: 9,
  BALIME: 10,
  MEDUNA: 11,
  CHITZENA: 12,
} as const;
export const FIRST_TOWN = 1;
export const NUM_TOWNS = 13;

export const LoyaltyEvent = {
  BATTLE_WON: 0,
  BATTLE_LOST: 1,
  ENEMY_KILLED: 2,
  NATIVE_KILLED: 3,
  GAIN_TOWN_SECTOR: 4,
  LOSE_TOWN_SECTOR: 5,
  LIBERATE_WHOLE_TOWN: 6,
  ABANDON_MILITIA: 7,
  GAIN_MINE: 8,
  LOSE_MINE: 9,
  GAIN_SAM: 10,
  LOSE_SAM: 11,
  QUEEN_BATTLE_WON: 12,
} as const;

export const MoraleEvent = {
  TOWN_LIBERATED: 'TOWN_LIBERATED',
  TOWN_LOST: 'TOWN_LOST',
  MINE_LIBERATED: 'MINE_LIBERATED',
  MINE_LOST: 'MINE_LOST',
  SAM_SITE_LIBERATED: 'SAM_SITE_LIBERATED',
  SAM_SITE_LOST: 'SAM_SITE_LOST',
  KILLED_CIVILIAN: 'KILLED_CIVILIAN',
  RAN_AWAY: 'RAN_AWAY',
} as const;
export type MoraleEvent = (typeof MoraleEvent)[keyof typeof MoraleEvent];

export const HeadMinerQuote = { RUNNING_OUT: 0, CREATURES_ATTACK: 1, CREATURES_GONE: 2, CREATURES_AGAIN: 3 } as const;

export const OKLIFE = 15;
export const CONSCIOUSNESS = 10;
export const TRAINING_RATING_CAP = 85;
export const NO_PROFILE = 200;

export const GAIN_PTS_PER_LOYALTY_PT = 500;
export const MAX_LOYALTY_VALUE = 100;
export const HOSTILE_OMERTA_LOYALTY_RATING = 10;
export const LOYALTY_EVENT_DISTANCE_THRESHOLD = 3;
export const LOYALTY_CHUNK = 10000;
export const UNREACHED_DISTANCE = 999999;

export const MAX_ALLOWABLE_MILITIA_PER_SECTOR = 20;
export const MILITIA_TRAINING_SQUAD_SIZE = 10;
export const MILITIA_TRAINING_COST = 750;
export const MIN_RATING_TO_TRAIN_TOWN = 20;
export const MAX_MILITIA_TRAINERS_PER_SECTOR = 2;

export const BREATHMAX_ABSOLUTE_MINIMUM = 10;
export const BREATHMAX_GOTTA_STOP_MOVING = 30;
export const BREATHMAX_PRETTY_TIRED = 50;
export const BREATHMAX_CANCEL_COLLAPSE = 60;
export const BREATHMAX_CANCEL_TIRED = 75;
export const BREATHMAX_FULLY_RESTED = 95;
export const MAX_BREATH = 100;

export const MINUTES_FOR_ASSIGNMENT_TO_COUNT = 45;

export const SECTORS_WITH_SOLDIERS_Z_LEVELS = 4;
export const HOSPITAL_SECTOR = { x: 8, y: 6, z: 0 } as const;
export const GUN_RANGE_SECTOR = { x: 13, y: 8, z: 0 } as const;

export const EnricoFlag = {
  SOME_PROGRESS: 0x0001,
  ABOUT_HALFWAY: 0x0002,
  NEARLY_DONE: 0x0004,
  MINOR_SETBACK: 0x0008,
  MAJOR_SETBACK: 0x0010,
  CREATURES: 0x0020,
  SETBACK_OVER: 0x0040,
  LACK_PROGRESS1: 0x0080,
  LACK_PROGRESS2: 0x0100,
  LACK_PROGRESS3: 0x0200,
} as const;

export const StatAmt = {
  HEALTH: 1,
  AGILITY: 2,
  DEXTERITY: 3,
  WISDOM: 4,
  MEDICAL: 5,
  EXPLOSIVES: 6,
  MECHANICAL: 7,
  MARKSMANSHIP: 8,
  EXPERIENCE: 9,
  STRENGTH: 10,
  LEADERSHIP: 11,
} as const;
export const StatCause = { SUCCESS: 0, FAILURE: 1, TRAINING: 2 } as const;
export const SOLDIER_QUOTE_SAID_DONE_ASSIGNMENT = 0x0020;
