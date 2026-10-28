// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.h Approach, NPC_TALK_RADIUS; NPC.cc StandardQuoteIDs, gsCivQuoteSector,
// @src NUM_CIVQUOTE_SECTORS, MINERS_CIV_QUOTE_INDEX, INITIATING_FACTOR, LARGE_AMOUNT_MONEY; TacticalAI/AI.h QuoteActionType;
// @src Tactical/Interface_Dialogue.h NPCAction (the codes the dialogue mechanics use); Strategic/Quests.h Quests,
// @src QUESTNOTSTARTED, QUESTINPROGRESS, QUESTDONE; src/externalized/internals/enums.cc getApproachEnumFromString,
// @src getQuestEnumFromString; Tactical/Civ_Quotes.h CIV_QUOTE_*, NUM_CIV_QUOTES; Civ_Quotes.cc gubNumEntries,
// @src CIV_QUOTE_HINT, CIV_QUOTE_TEXT_SIZE.

export const NUM_PROFILES = 200;
export const NO_PROFILE = 200;

export const Approach = {
  NONE: 0,
  FRIENDLY: 1,
  DIRECT: 2,
  THREATEN: 3,
  RECRUIT: 4,
  REPEAT: 5,
  GIVINGITEM: 6,
  NPC_INITIATING_CONV: 7,
  NPC_INITIAL_QUOTE: 8,
  NPC_WHOAREYOU: 9,
  TRIGGER_NPC: 10,
  GIVEFIRSTAID: 11,
  SPECIAL_INITIAL_QUOTE: 12,
  ENEMY_NPC_QUOTE: 13,
  DECLARATION_OF_HOSTILITY: 14,
  EPC_IN_WRONG_SECTOR: 15,
  EPC_WHO_IS_RECRUITED: 16,
  INITIAL_QUOTE: 17,
  CLOSING_SHOP: 18,
  SECTOR_NOT_SAFE: 19,
  DONE_SLAPPED: 20,
  DONE_PUNCH_0: 21,
  DONE_PUNCH_1: 22,
  DONE_PUNCH_2: 23,
  DONE_OPEN_STRUCTURE: 24,
  DONE_GET_ITEM: 25,
  DONE_GIVING_ITEM: 26,
  DONE_TRAVERSAL: 27,
  BUYSELL: 28,
  ONE_OF_FOUR_STANDARD: 29,
  FRIENDLY_DIRECT_OR_RECRUIT: 30,
} as const;

export const NUM_REAL_APPROACHES = Approach.RECRUIT;

export function approachByName(name: string): number | undefined {
  if (name === '') return Approach.NONE;
  return (Approach as Readonly<Record<string, number>>)[name];
}

export function approachName(id: number): string {
  return Object.entries(Approach).find(([, v]) => v === id)?.[0] ?? String(id);
}

export const QuestId = {
  DELIVER_LETTER: 0,
  FOOD_ROUTE: 1,
  KILL_TERRORISTS: 2,
  KINGPIN_IDOL: 3,
  KINGPIN_MONEY: 4,
  RUNAWAY_JOEY: 5,
  RESCUE_MARIA: 6,
  CHITZENA_IDOL: 7,
  HELD_IN_ALMA: 8,
  INTERROGATION: 9,
  ARMY_FARM: 10,
  FIND_SCIENTIST: 11,
  DELIVER_VIDEO_CAMERA: 12,
  BLOODCATS: 13,
  FIND_HERMIT: 14,
  CREATURES: 15,
  CHOPPER_PILOT: 16,
  ESCORT_SKYRIDER: 17,
  FREE_DYNAMO: 18,
  ESCORT_TOURISTS: 19,
  FREE_CHILDREN: 20,
  LEATHER_SHOP_DREAM: 21,
  FREE_SHANK: 22,
  KILL_DEIDRANNA: 25,
} as const;

export const QuestStatusValue = { NOT_STARTED: 0, IN_PROGRESS: 1, DONE: 2 } as const;
export const MAX_QUESTS = 30;

export function questByName(name: string): number | undefined {
  return (QuestId as Readonly<Record<string, number>>)[name];
}

export const StandardQuote = {
  INTRO: 0,
  SUBS_INTRO: 1,
  FRIENDLY_DEFAULT1: 2,
  FRIENDLY_DEFAULT2: 3,
  GIVEITEM_NO: 4,
  DIRECT_DEFAULT: 5,
  THREATEN_DEFAULT: 6,
  RECRUIT_NO: 7,
  BYE: 8,
  GETLOST: 9,
} as const;

export const QuoteActionId = {
  NONE: 0,
  CHECKFORDEST: 1,
  TURNTOWARDSPLAYER: 2,
  DRAWGUN: 3,
  LOWERGUN: 4,
  TRAVERSE_EAST: 5,
  TRAVERSE_SOUTH: 6,
  TRAVERSE_WEST: 7,
  TRAVERSE_NORTH: 8,
} as const;

export const NpcAction = {
  NONE: 0,
  DONT_ACCEPT_ITEM: 1,
  FACE_CLOSEST_PLAYER: 2,
  RECRUIT: 4,
  TRIGGER_FRIEND_WITH_HOSTILE_QUOTE: 21,
  BECOME_ENEMY: 22,
  RECRUIT_WITH_SALARY: 23,
  CLOSE_DIALOGUE_PANEL: 24,
  ENTER_COMBAT: 25,
  INITIATE_SHOPKEEPER_INTERFACE: 41,
  TRAVERSE_MAP_EAST: 103,
  TRAVERSE_MAP_SOUTH: 104,
  TRAVERSE_MAP_WEST: 105,
  TRAVERSE_MAP_NORTH: 106,
  DARREN_GIVEN_CASH: 141,
  ANGEL_GIVEN_CASH: 142,
  UN_RECRUIT_EPC: 149,
  TELEPORT_NPC: 150,
  SET_EPC_TO_NPC: 168,
  GERARD_GIVEN_CASH: 201,
  JOE_GIVEN_CASH: 203,
  INVOKE_CONVERSATION_MODE: 232,
  REMOVE_NPC: 264,
  TURN_TO_FACE_NEAREST_MERC: 500,
  LAST_TURN_TO_FACE_PROFILE: 650,
} as const;

export const NPC_TALK_RADIUS = 4;
export const INITIATING_FACTOR = 30;
export const LARGE_AMOUNT_MONEY = 1000;

export const NUM_CIVQUOTE_SECTORS = 20;
export const MINERS_CIV_QUOTE_INDEX = 16;
export const CIV_QUOTE_SECTORS: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 2],
  [13, 2],
  [13, 3],
  [13, 4],
  [8, 6],
  [9, 6],
  [8, 7],
  [9, 7],
  [1, 8],
  [2, 8],
  [3, 8],
  [8, 8],
  [13, 8],
  [14, 9],
  [11, 12],
  [12, 12],
];

export const SharedDialogueFile = { FIRST: 151, LAST: 154 } as const;

export const CivQuote = {
  ADULTS_BEGGING: 0,
  KIDS_BEGGING: 1,
  ADULTS_EXTREMLY_LOW_LOYALTY: 6,
  KIDS_EXTREMLY_LOW_LOYALTY: 7,
  ADULTS_HIGH_LOYALTY: 8,
  KIDS_HIGH_LOYALTY: 9,
  ADULTS_ALL_PURPOSE: 10,
  KIDS_ALL_PURPOSE: 11,
  HICKS_FRIENDLY: 16,
  HICKS_ENEMIES: 17,
  GOONS_FRIENDLY: 18,
  GOONS_ENEMIES: 19,
  ADULTS_REBELS: 20,
  KIDS_REBELS: 21,
  GREEN_MILITIA: 22,
  MEDIUM_MILITIA: 23,
  ELITE_MILITIA: 24,
  SAN_MONA_BEGGERS: 25,
  ENEMY_HURT: 26,
  ENEMY_ADMIN: 27,
  ENEMY_THREAT: 28,
  ENEMY_ELITE: 29,
  ADULTS_COWER: 30,
  KIDS_COWER: 31,
  PC_MARRIED: 32,
  KID_SLAVES: 33,
  KID_SLAVES_FREE: 34,
  MINERS_NOT_FOR_PLAYER: 35,
  MINERS_FOR_PLAYER: 36,
  ENEMY_OFFER_SURRENDER: 37,
  HICKS_SEE_US_AT_NIGHT: 38,
  DEIDRANNA_DEAD: 39,
  HINT: 99,
} as const;

export const NUM_CIV_QUOTES = 50;

const REGULAR_CIV_QUOTE_ENTRIES = 15;
const CIV_QUOTE_ENTRY_EXCEPTIONS: Readonly<Record<number, number>> = {
  20: 5,
  21: 5,
  32: 2,
  35: 10,
  36: 10,
  37: 5,
  38: 3,
  39: 10,
};
const LAST_THREE_ENTRY_TYPES_FROM = 40;
const THREE_ENTRIES = 3;

export function civQuoteEntries(quote: number): number {
  if (quote >= LAST_THREE_ENTRY_TYPES_FROM) return THREE_ENTRIES;
  return CIV_QUOTE_ENTRY_EXCEPTIONS[quote] ?? REGULAR_CIV_QUOTE_ENTRIES;
}
