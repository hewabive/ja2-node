// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead_Types.h CIV_GROUP_* hostility; Strategic/Quests.h IN_BROTHEL, IN_BROTHEL_GUARD_ROOM;
// @src Boxing.h BOXING_SECTOR_*;
// @src Map_Screen_Interface_Map.h TIXA_SECTOR_*; Strategic_Town_Loyalty.h; externalized mercs-profile-info.json.

export const NUM_CIV_GROUPS = 20;
export const CivGroupHostility = { NEUTRAL: 0, WILL_EVENTUALLY_BECOME_HOSTILE: 1, WILL_BECOME_HOSTILE: 2, HOSTILE: 3 } as const;

export const Profile = {
  MIGUEL: 57,
  CARLOS: 58,
  IRA: 59,
  DIMITRI: 60,
  ROBOT: 62,
  SLAY: 64,
  DYNAMO: 66,
  SHANK: 67,
  IGGY: 68,
  CONRAD: 70,
  QUEEN: 75,
  CARMEN: 78,
  JOE: 79,
  ANNIE: 82,
  CHRIS: 83,
  BRENDA: 85,
  KINGPIN: 86,
  MARIA: 88,
  ANGEL: 89,
  JOEY: 90,
  SKYRIDER: 97,
  PABLO: 98,
  WARDEN: 102,
  MADAME: 107,
  MARTHA: 109,
  TIFFANY: 110,
  T_REX: 111,
  DRUGGIST: 112,
  HANS: 117,
  JOHN: 118,
  MARY: 119,
  GENERAL: 120,
  ELDIN: 127,
  BILLY: 133,
  ELLIOT: 135,
  DOREEN: 139,
  JIM: 140,
  JACK: 141,
  OLAF: 142,
  RAY: 143,
  OLGA: 144,
  TYRONE: 145,
  MADLAB: 146,
  MIKE: 149,
  MANNY: 155,
} as const;

export const ASSASSINS: ReadonlySet<number> = new Set([Profile.JIM, Profile.JACK, Profile.OLAF, Profile.RAY, Profile.OLGA, Profile.TYRONE]);
export const TERRORISTS: ReadonlySet<number> = new Set([
  Profile.DRUGGIST,
  Profile.SLAY,
  Profile.ANNIE,
  Profile.CHRIS,
  Profile.TIFFANY,
  Profile.T_REX,
]);
export const REBEL_SYMPATHIZERS: ReadonlySet<number> = new Set([
  Profile.IRA,
  Profile.DIMITRI,
  Profile.MIGUEL,
  Profile.CARLOS,
  Profile.MADLAB,
  Profile.DYNAMO,
  Profile.SHANK,
]);

export const Town = { DRASSEN: 2, CAMBRIA: 6, BALIME: 10 } as const;
const GAIN_PTS_PER_LOYALTY_PT = 500;
export const Loyalty = {
  PENALTY_ELDIN_KILLED: 20 * GAIN_PTS_PER_LOYALTY_PT,
  PENALTY_MARTHA_HEART_ATTACK: 20 * GAIN_PTS_PER_LOYALTY_PT,
  PENALTY_JOEY_KILLED: 10 * GAIN_PTS_PER_LOYALTY_PT,
  BONUS_CHILDREN_FREED_DOREEN_KILLED: 10 * GAIN_PTS_PER_LOYALTY_PT,
  BONUS_CHILDREN_FREED_DOREEN_SPARED: 20 * GAIN_PTS_PER_LOYALTY_PT,
} as const;

export const BrothelRooms = { FIRST: 91, LAST: 119, GUARD_ROOM: 110 } as const;
export const BROTHEL_SECTOR = { x: 5, y: 3 } as const;
export const BOXING_SECTOR = { x: 5, y: 4 } as const;
export const KINGPIN_DOOR_GRIDNOS: ReadonlySet<number> = new Set([11010, 11177, 11176]);
export const TIXA_SECTOR = { x: 9, y: 10 } as const;
export const HICKS_FARM_SECTOR = { x: 10, y: 6 } as const;
export const WARDEN_ALERT_RADIUS = 5;
export const MuseumRooms = { FIRST: 22, LAST: 41, DISPLAY_A: 39, DISPLAY_B: 40 } as const;
export const HicksCurfew = { MORNING_MINUTE: 365, EVENING_MINUTE: 1320 } as const;
export const HOSTILITY_DELAY_MINUTES = 300;
export const NpcRecord = { CARMEN_WAR: 28, CARMEN_PEACE: 29, ANGEL_RESCUED: 12, ANGEL_DEED: 20, FIRST_SEEN: 4, IGGY_SEEN: 9 } as const;
