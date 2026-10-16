// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.h (compositions, actions), Strategic_AI.cc (sector lists, times), Campaign_Types.h (SEC_*);
// @src Tactical/Interface_Dialogue.h (NPC actions), Tactical/Soldier_Profile.h, Strategic/Meanwhile.h. See docs/17 §15.

import { parseSectorId } from '../../../content/strategic/sector-ids.ts';

export const Composition = {
  QUEEN_DEFENCE: 0,
  MEDUNA_DEFENCE: 1,
  MEDUNA_SAMSITE: 2,
  LEVEL1_DEFENCE: 3,
  LEVEL2_DEFENCE: 4,
  LEVEL3_DEFENCE: 5,
  ORTA_DEFENCE: 6,
  EAST_GRUMM_DEFENCE: 7,
  WEST_GRUMM_DEFENCE: 8,
  GRUMM_MINE: 9,
  OMERTA_WELCOME_WAGON: 10,
  BALIME_DEFENCE: 11,
  TIXA_PRISON: 12,
  TIXA_SAMSITE: 13,
  ALMA_DEFENCE: 14,
  ALMA_MINE: 15,
  CAMBRIA_DEFENCE: 16,
  CAMBRIA_MINE: 17,
  CHITZENA_DEFENCE: 18,
  CHITZENA_MINE: 19,
  CHITZENA_SAMSITE: 20,
  DRASSEN_AIRPORT: 21,
  DRASSEN_DEFENCE: 22,
  DRASSEN_MINE: 23,
  DRASSEN_SAMSITE: 24,
  ROADBLOCK: 25,
  SANMONA_SMALL: 26,
} as const;

export const MAX_STRATEGIC_TEAM_SIZE = 20;
export const QUEEN_DEFENCE_MAX = 32;
export const ENEMY_TEAM_SLOTS = 32;
export const NO_GARRISON = 255;
export const NO_PATROL = -1;
export const NO_RELOOP = -1;
export const SAI_VERSION = 29;
export const DEFAULT_GROUP_PRIORITY = 50;
export const HUNDRED = 100;
export const FULL_FORCE_PERCENT = 100;
export const WEIGHT_MULTIPLIER = 3;
export const WEIGHT_DIVISOR = 96;
export const MIN_WEIGHT = 2;
export const MIN_ALMA_SHARE_PERCENT = 67;
export const STAGING_TOP_UP_THRESHOLD = 4;
export const STAGING_TOP_UP_BASE = 3;
export const STAGING_TOP_UP_VARIANCE = 3;
export const MAX_REINFORCEMENT_FACTOR_DIVISOR = 50;
export const DENIAL_DIFFICULTY_BASE = 6;
export const WAKE_VICTORIES_BASE = 5;
export const RECRUITED_TROOPS = 30;
export const RECRUITING_INTERVAL_FACTOR = 10;
export const REQUEST_POINTS_FOR_FAST_EVALUATION = 100;
export const EVALUATION_SPREAD_FACTOR = 4;
export const START_MINUTE_OF_DAY = 475;
export const CHECK_PERIOD_BASE = 140;
export const CHECK_PERIOD_PER_DIFFICULTY = 20;
export const CHECK_PERIOD_VARIANCE = 4;
export const ROADBLOCK_CHANCE = 20;
export const START_VARIANCE = 51;
export const START_VARIANCE_OFFSET = 25;
export const DRASSEN_MIN_ADMINS = 5;
export const TIXA_MIN_ADMINS = 8;
export const PATROL_SIZE_VARIANCE = 3;
export const ADMIN_PATROLS: readonly number[] = [3, 4];
export const NIGHT_NOTICE_DIVISOR = 3;
export const NIGHT_ALERTNESS_GAIN_CHANCE = 33;
export const OMERTA_OPEN_MINUTE = 3345;
export const DRASSEN_OPEN_MINUTE = 4710;
export const SECONDS_PER_HOUR = 3600;
export const HALF_HOUR_SECONDS = 1800;
export const PATROL_FILL_DAY_MODULO = 100;
export const PHASE_PERCENT = 10;
export const FACTOR_CENTER = 50;
export const MIN_EVOLVED_DESIRED = 6;
export const EXTRA_ELITE_FACTOR = 15;
export const EXTRA_ELITES_PER_DIFFICULTY = 5;
export const ADMIN_UPGRADE_PER_PROGRESS = 10;
export const SAM_SQUAD_BASE = 3;
export const SAM_SQUAD_PROGRESS_DIVISOR = 15;
export const SAM_CONDITION_REPAIRED = 100;
export const MINE_RAN_OUT_PRIORITY_DIVISOR = 4;
export const OFFENCE_ADMIN = 2;
export const OFFENCE_TROOP = 3;
export const OFFENCE_ELITE = 4;
export const NOTICE_OFFENCE_ADMIN = 2;
export const NOTICE_OFFENCE_TROOP = 4;
export const NOTICE_OFFENCE_ELITE = 6;
export const DEFENCE_MERC_TOO_STRONG = 5;
export const DEFENCE_MERC_APPROVAL = 4;
export const GARRISON_ATTACK_RATIO_ENEMY = 2;
export const GARRISON_ATTACK_RATIO_PLAYER = 3;
export const NO_FIRST_ALMA_GARRISON = -1;
export const ALMA_GARRISONS = 4;
export const SOURCE_NONE = -1;

export const SEC = {
  A2: parseSectorId('A2'),
  A9: parseSectorId('A9'),
  A10: parseSectorId('A10'),
  B2: parseSectorId('B2'),
  B13: parseSectorId('B13'),
  C5: parseSectorId('C5'),
  C6: parseSectorId('C6'),
  C13: parseSectorId('C13'),
  D5: parseSectorId('D5'),
  D13: parseSectorId('D13'),
  D15: parseSectorId('D15'),
  F8: parseSectorId('F8'),
  F9: parseSectorId('F9'),
  F10: parseSectorId('F10'),
  G1: parseSectorId('G1'),
  G2: parseSectorId('G2'),
  G8: parseSectorId('G8'),
  G9: parseSectorId('G9'),
  H1: parseSectorId('H1'),
  H2: parseSectorId('H2'),
  H8: parseSectorId('H8'),
  H13: parseSectorId('H13'),
  H14: parseSectorId('H14'),
  I13: parseSectorId('I13'),
  I14: parseSectorId('I14'),
  J9: parseSectorId('J9'),
  P3: parseSectorId('P3'),
} as const;

export const ALMA_SUPPLIED_SECTORS: readonly number[] = [SEC.B13, SEC.C13, SEC.D13, SEC.D15, SEC.F8, SEC.F9, SEC.G8, SEC.G9, SEC.H8];

export const MINE_RAN_OUT_SECTORS: ReadonlyMap<number, readonly number[]> = new Map([
  [SEC.B2, [SEC.A2, SEC.B2]],
  [SEC.D13, [SEC.B13, SEC.C13, SEC.D13]],
  [SEC.H8, [SEC.F8, SEC.F9, SEC.G8, SEC.G9, SEC.H8]],
  [SEC.I14, [SEC.H13, SEC.H14, SEC.I13, SEC.I14]],
]);

export const SPAWNING_COMPOSITIONS: ReadonlySet<number> = new Set([
  Composition.LEVEL1_DEFENCE,
  Composition.LEVEL2_DEFENCE,
  Composition.LEVEL3_DEFENCE,
  Composition.ALMA_DEFENCE,
  Composition.ALMA_MINE,
]);

export const PHASE_EXCLUDED_COMPOSITIONS: ReadonlySet<number> = new Set([
  Composition.QUEEN_DEFENCE,
  Composition.MEDUNA_DEFENCE,
  Composition.MEDUNA_SAMSITE,
  Composition.LEVEL1_DEFENCE,
  Composition.LEVEL2_DEFENCE,
  Composition.LEVEL3_DEFENCE,
  Composition.OMERTA_WELCOME_WAGON,
  Composition.ROADBLOCK,
]);

export const Town = {
  BLANK_SECTOR: 0,
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

export const UNIMPORTANT_TOWNS: ReadonlySet<number> = new Set([Town.OMERTA, Town.SAN_MONA, Town.ESTONI]);

export const StrategicAiAction = {
  WAKE_QUEEN: 1,
  KINGPIN_DEAD: 2,
  QUEEN_DEAD: 3,
  SEND_SOLDIERS_TO_DRASSEN: 30,
  SEND_SOLDIERS_TO_BATTLE_LOCATION: 31,
  SEND_SOLDIERS_TO_OMERTA: 259,
  ADD_MORE_ELITES: 260,
  GIVE_KNOWLEDGE_OF_ALL_MERCS: 261,
  SEND_TROOPS_TO_SAM: 292,
} as const;

export const Profile = { IGGY: 68, QUEEN: 75, ELLIOT: 135, MIKE: 149 } as const;

export const Meanwhile = {
  END_OF_PLAYERS_FIRST_BATTLE: 0,
  DRASSEN_LIBERATED: 1,
  CAMBRIA_LIBERATED: 2,
  ALMA_LIBERATED: 3,
  GRUMM_LIBERATED: 4,
  CHITZENA_LIBERATED: 5,
  NW_SAM: 6,
  NE_SAM: 7,
  CENTRAL_SAM: 8,
  FLOWERS: 9,
  LOST_TOWN: 10,
  INTERROGATION: 11,
  CREATURES: 12,
  KILL_CHOPPER: 13,
  AWOL_SCIENTIST: 14,
  OUTSKIRTS_MEDUNA: 15,
  BALIME_LIBERATED: 16,
} as const;

export const MEANWHILE_FLAGS: readonly number[] = [
  0x00000001, 0x00000002, 0x00000004, 0x00000008, 0x00000010, 0x00000020, 0x00000040, 0x00000080, 0x00000100, 0x00000200, 0x00000400,
  0x00008000, 0x00000800, 0x00001000, 0x00002000, 0x00004000, 0x00010000,
];

export const TOWN_LIBERATION_MEANWHILES: ReadonlyMap<number, number> = new Map([
  [Town.DRASSEN, Meanwhile.DRASSEN_LIBERATED],
  [Town.CAMBRIA, Meanwhile.CAMBRIA_LIBERATED],
  [Town.ALMA, Meanwhile.ALMA_LIBERATED],
  [Town.GRUMM, Meanwhile.GRUMM_LIBERATED],
  [Town.CHITZENA, Meanwhile.CHITZENA_LIBERATED],
  [Town.BALIME, Meanwhile.BALIME_LIBERATED],
]);

export const SAM_LIBERATION_MEANWHILES: readonly number[] = [Meanwhile.NW_SAM, Meanwhile.NE_SAM, Meanwhile.CENTRAL_SAM];
export const MEANWHILE_DELAY_MINUTES = 5;
export const MEANWHILE_BATTLE_DELAY_SECONDS = 180;
export const MEANWHILE_BATTLE_DELAY_VARIANCE = 121;
export const ELLIOT_MAX_SLAPS = 17;
