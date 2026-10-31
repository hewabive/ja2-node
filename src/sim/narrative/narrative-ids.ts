// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Facts.h (the facts the dialogue code reads and writes); externalized mercs-profile-info.json
// @src (the profiles named in TacticalAI/NPC.cc, Tactical/Interface_Dialogue.cc and Dialogue_Control.cc);
// @src Tactical/Soldier_Profile_Type.h PROFILE_MISC_FLAG*.

export const NarrativeFact = {
  CURRENT_SECTOR_IS_SAFE: 31,
  NPC_BLEEDING_BUT_OKAY: 70,
  WOUNDED_MERCS_NEARBY: 75,
  ONE_WOUNDED_MERC_NEARBY: 76,
  NPC_IS_ENEMY: 81,
  CARLA_AVAILABLE: 89,
  CINDY_AVAILABLE: 90,
  BAMBI_AVAILABLE: 91,
  DARREN_EXPECTING_MONEY: 99,
  PC_NEAR: 100,
  LARGE_AMOUNT_OF_MONEY: 127,
  SMALL_AMOUNT_OF_MONEY: 128,
  VINCE_EXPECTING_MONEY: 149,
  ITEM_POOR_CONDITION: 199,
  NEED_TO_SAY_SOMETHING: 267,
  DARREN_EXPLAINED_RULES: 281,
  NPC_HOSTILE_OR_PISSED_OFF: 289,
} as const;

export const NarrativeProfile = {
  MIGUEL: 57,
  CARLOS: 58,
  IRA: 59,
  DIMITRI: 60,
  ROBOT: 62,
  VINCE: 69,
  CONRAD: 70,
  DARREL: 73,
  QUEEN: 75,
  JOE: 79,
  STEVE: 80,
  KINGPIN: 86,
  DARREN: 87,
  ANGEL: 89,
  FRANK: 92,
  KYLE: 95,
  SKYRIDER: 97,
  PABLO: 98,
  MADAME: 107,
  GERARD: 115,
  GENERAL: 120,
  WALTER: 131,
  ELLIOT: 135,
  JIM: 140,
  JACK: 141,
  OLAF: 142,
  RAY: 143,
  OLGA: 144,
  TYRONE: 145,
  MIKE: 149,
} as const;

export const ASSASSIN_PROFILES: ReadonlySet<number> = new Set([
  NarrativeProfile.JIM,
  NarrativeProfile.JACK,
  NarrativeProfile.OLAF,
  NarrativeProfile.RAY,
  NarrativeProfile.OLGA,
  NarrativeProfile.TYRONE,
]);

export const GET_LOST_ENEMIES: ReadonlySet<number> = new Set([NarrativeProfile.CONRAD, NarrativeProfile.GENERAL]);

export const ProfileFlag = {
  RECRUITED: 0x01,
  HAVESEENCREATURE: 0x02,
  FORCENPCQUOTE: 0x04,
  WOUNDEDBYPLAYER: 0x08,
  SAID_HOSTILE_QUOTE: 0x20,
  EPCACTIVE: 0x40,
} as const;

export const ProfileFlag2 = {
  BANDAGED_TODAY: 0x04,
  SAID_FIRSTSEEN_QUOTE: 0x08,
  NEEDS_TO_SAY_HOSTILE_QUOTE: 0x10,
  ASKED_BY_HICKS: 0x40,
} as const;

export const MIGUEL_LET_GO_RECORD = 6;
export const QUOTE_RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO = 64;
export const DARREN_RULES_RECORD = 11;
