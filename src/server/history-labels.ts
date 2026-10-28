// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/History.cc ProcessHistoryTransactionString (pHistoryStrings with the town's locative name, the
// @src profile's full name or nickname, the quest strings of quests.edt), GetQuestStartedString, GetQuestEndedString,
// @src DrawHistoryRecordsText (pHistoryLocations without a sector, the detailed GetSectorIDString otherwise; a quest-start
// @src row of a quest in progress in red); Laptop/History.h (the codes).

import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { sectorShortString } from '../content/strategic/sector-ids.ts';
import { type UiStrings, uiString } from '../content/text/strings.ts';
import type { LaptopHistoryView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { HistoryRecord } from '../sim/campaign/laptop/laptop-state.ts';
import { QuestStatus, questStatus } from '../sim/strategic/narrative/facts.ts';
import type { TextSource } from './campaign-session.ts';
import { sectorIdString } from './sector-id-label.ts';

export const QUEST_TEXT_FILE = 'binarydata/quests.edt';
export const HISTORY_TEXT_FILES: readonly string[] = [QUEST_TEXT_FILE];
const QUEST_TEXT_SIZE = 80;
const HISTORY_STRINGS = 'pHistoryStrings';
const NO_LOCATION = 'pHistoryLocations';
const TOWN_LOCATIVES = 'strategic-map-town-name-locatives';
const NO_PROFILE = 200;
const DIRECTIVE = /%s/;
const DETAILED = true;

export const HistoryCode = {
  ENTERED_HISTORY_MODE: 0,
  HIRED_MERC_FROM_AIM: 1,
  HIRED_MERC_FROM_MERC: 2,
  MERC_KILLED: 3,
  SETTLED_ACCOUNTS_AT_MERC: 4,
  ACCEPTED_ASSIGNMENT_FROM_ENRICO: 5,
  CHARACTER_GENERATED: 6,
  PURCHASED_INSURANCE: 7,
  CANCELLED_INSURANCE: 8,
  INSURANCE_CLAIM_PAYOUT: 9,
  EXTENDED_CONTRACT_1_DAY: 10,
  EXTENDED_CONTRACT_1_WEEK: 11,
  EXTENDED_CONTRACT_2_WEEK: 12,
  MERC_FIRED: 13,
  MERC_QUIT: 14,
  QUEST_STARTED: 15,
  QUEST_FINISHED: 16,
  TALKED_TO_MINER: 17,
  LIBERATED_TOWN: 18,
  CHEAT_ENABLED: 19,
  TALKED_TO_FATHER_WALKER: 20,
  MERC_MARRIED_OFF: 21,
  MERC_CONTRACT_EXPIRED: 22,
  RPC_JOINED_TEAM: 23,
  ENRICO_COMPLAINED: 24,
  WONBATTLE: 25,
  MINE_RUNNING_OUT: 26,
  MINE_RAN_OUT: 27,
  MINE_SHUTDOWN: 28,
  MINE_REOPENED: 29,
  DISCOVERED_TIXA: 30,
  DISCOVERED_ORTA: 31,
  GOT_ROCKET_RIFLES: 32,
  DEIDRANNA_DEAD_BODIES: 33,
  BOXING_MATCHES: 34,
  SOMETHING_IN_MINES: 35,
  DEVIN: 36,
  MIKE: 37,
  TONY: 38,
  KROTT: 39,
  KYLE: 40,
  MADLAB: 41,
  GABBY: 42,
  KEITH_OUT_OF_BUSINESS: 43,
  HOWARD_CYANIDE: 44,
  KEITH: 45,
  HOWARD: 46,
  PERKO: 47,
  SAM: 48,
  FRANZ: 49,
  ARNOLD: 50,
  FREDO: 51,
  RICHGUY_BALIME: 52,
  JAKE: 53,
  BUM_KEYCARD: 54,
  WALTER: 55,
  DAVE: 56,
  PABLO: 57,
  KINGPIN_MONEY: 58,
  WON_BOXING: 59,
  LOST_BOXING: 60,
  DISQUALIFIED_BOXING: 61,
  FOUND_MONEY: 62,
  ASSASSIN: 63,
  LOSTTOWNSECTOR: 64,
  DEFENDEDTOWNSECTOR: 65,
  LOSTBATTLE: 66,
  FATALAMBUSH: 67,
  WIPEDOUTENEMYAMBUSH: 68,
  UNSUCCESSFULATTACK: 69,
  SUCCESSFULATTACK: 70,
  CREATURESATTACKED: 71,
  KILLEDBYBLOODCATS: 72,
  SLAUGHTEREDBLOODCATS: 73,
  NPC_KILLED: 74,
  GAVE_CARMEN_HEAD: 75,
  SLAY_MYSTERIOUSLY_LEFT: 76,
  MERC_KILLED_CHARACTER: 77,
} as const;

const H = HistoryCode;

const NAMING_A_TOWN: ReadonlySet<number> = new Set([
  H.LIBERATED_TOWN,
  H.MINE_RAN_OUT,
  H.MINE_REOPENED,
  H.MINE_RUNNING_OUT,
  H.MINE_SHUTDOWN,
  H.TALKED_TO_MINER,
]);

const NAMING_A_FULL_NAME: ReadonlySet<number> = new Set([
  H.HIRED_MERC_FROM_AIM,
  H.HIRED_MERC_FROM_MERC,
  H.MERC_CONTRACT_EXPIRED,
  H.RPC_JOINED_TEAM,
]);

const NAMING_A_NICKNAME: ReadonlySet<number> = new Set([
  H.CANCELLED_INSURANCE,
  H.DISQUALIFIED_BOXING,
  H.EXTENDED_CONTRACT_1_DAY,
  H.EXTENDED_CONTRACT_1_WEEK,
  H.EXTENDED_CONTRACT_2_WEEK,
  H.INSURANCE_CLAIM_PAYOUT,
  H.LOST_BOXING,
  H.MERC_FIRED,
  H.MERC_KILLED_CHARACTER,
  H.MERC_MARRIED_OFF,
  H.MERC_QUIT,
  H.NPC_KILLED,
  H.PURCHASED_INSURANCE,
  H.WON_BOXING,
]);

const VERBATIM: ReadonlySet<number> = new Set([
  H.ACCEPTED_ASSIGNMENT_FROM_ENRICO,
  H.ARNOLD,
  H.ASSASSIN,
  H.BOXING_MATCHES,
  H.BUM_KEYCARD,
  H.CHARACTER_GENERATED,
  H.CHEAT_ENABLED,
  H.CREATURESATTACKED,
  H.DAVE,
  H.DEFENDEDTOWNSECTOR,
  H.DEIDRANNA_DEAD_BODIES,
  H.DEVIN,
  H.DISCOVERED_ORTA,
  H.DISCOVERED_TIXA,
  H.ENRICO_COMPLAINED,
  H.ENTERED_HISTORY_MODE,
  H.FATALAMBUSH,
  H.FOUND_MONEY,
  H.FRANZ,
  H.FREDO,
  H.GABBY,
  H.GAVE_CARMEN_HEAD,
  H.GOT_ROCKET_RIFLES,
  H.HOWARD,
  H.HOWARD_CYANIDE,
  H.JAKE,
  H.KEITH,
  H.KEITH_OUT_OF_BUSINESS,
  H.KILLEDBYBLOODCATS,
  H.KINGPIN_MONEY,
  H.KROTT,
  H.KYLE,
  H.LOSTBATTLE,
  H.LOSTTOWNSECTOR,
  H.MADLAB,
  H.MIKE,
  H.PABLO,
  H.PERKO,
  H.RICHGUY_BALIME,
  H.SAM,
  H.SETTLED_ACCOUNTS_AT_MERC,
  H.SLAUGHTEREDBLOODCATS,
  H.SLAY_MYSTERIOUSLY_LEFT,
  H.SOMETHING_IN_MINES,
  H.SUCCESSFULATTACK,
  H.TALKED_TO_FATHER_WALKER,
  H.TONY,
  H.UNSUCCESSFULATTACK,
  H.WALTER,
  H.WIPEDOUTENEMYAMBUSH,
  H.WONBATTLE,
]);

export interface HistoryText {
  readonly texts: TextSource | null;
  readonly labels: UiStrings | null;
}

function filled(template: string, value: string): string {
  return template.replace(DIRECTIVE, () => value);
}

function questKey(row: number): TextKey {
  return { file: QUEST_TEXT_FILE, row, width: QUEST_TEXT_SIZE };
}

function profileName(campaign: CampaignSim, profile: number): string {
  return campaign.laptop?.profileRecord(profile)?.name ?? campaign.battle?.content.profiles[profile]?.name ?? '';
}

function profileNickname(campaign: CampaignSim, profile: number): string {
  return campaign.laptop?.profileRecord(profile)?.nickname ?? campaign.battle?.content.profiles[profile]?.nickname ?? '';
}

export function historyRowText(campaign: CampaignSim, text: HistoryText, h: HistoryRecord): string {
  const code = h.code;
  if (code === H.QUEST_STARTED || code === H.QUEST_FINISHED) {
    const row = h.secondCode * 2 + (code === H.QUEST_FINISHED ? 1 : 0);
    return text.texts?.text(questKey(row)) ?? '';
  }
  const labels = text.labels;
  if (!labels) return '';
  const template = uiString(labels, HISTORY_STRINGS, code) ?? '';
  if (NAMING_A_TOWN.has(code)) return filled(template, uiString(labels, TOWN_LOCATIVES, h.secondCode) ?? '');
  if (code === H.MERC_KILLED) return h.secondCode === NO_PROFILE ? '' : filled(template, profileName(campaign, h.secondCode));
  if (NAMING_A_FULL_NAME.has(code)) return filled(template, profileName(campaign, h.secondCode));
  if (NAMING_A_NICKNAME.has(code)) return filled(template, profileNickname(campaign, h.secondCode));
  return VERBATIM.has(code) ? template : '';
}

export function historyLocation(campaign: CampaignSim, labels: UiStrings | null, h: HistoryRecord): string {
  if (!labels) return '';
  if (h.x < 1 || h.y < 1) return uiString(labels, NO_LOCATION, 0) ?? '';
  return sectorIdString(campaign, labels, { x: h.x, y: h.y, z: h.z }, DETAILED);
}

export function historyQuestInProgress(campaign: CampaignSim, h: HistoryRecord): boolean {
  return h.code === H.QUEST_STARTED && questStatus(campaign.state.narrative, h.secondCode) === QuestStatus.IN_PROGRESS;
}

export function historyRowView(
  campaign: CampaignSim,
  text: HistoryText,
  h: HistoryRecord,
  date: LaptopHistoryView['date'],
): LaptopHistoryView {
  return {
    code: h.code,
    secondCode: h.secondCode,
    date,
    sector: h.x >= 1 && h.y >= 1 ? sectorShortString(h) : null,
    text: historyRowText(campaign, text, h),
    location: historyLocation(campaign, text.labels, h),
    questInProgress: historyQuestInProgress(campaign, h),
  };
}
