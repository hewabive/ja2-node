// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Init.cc InitNewGame, InitStrategicLayer; StrategicMap.cc SetupNewStrategicGame;
// @src Game_Clock.cc InitNewGameClock; Campaign_Init.cc InitNewCampaign; Tactical/Arms_Dealer_Init.cc InitAllArmsDealers
// @src (InitNewGame step 3). See docs/15 §4, docs/23 §3.

import { initStrategicAiForNewCampaign } from '../strategic/ai/strategic-ai.ts';
import { addStartingCash, initEconomyStrategicLayer } from '../strategic/economy/init.ts';
import { initAllArmsDealers } from '../strategic/economy/merchants/daily.ts';
import { initStrategicLayerMap } from '../strategic/map/init.ts';
import { CompressMode, EventKind, STARTING_TIME } from '../strategic/time/constants.ts';
import { buildDayLightLevels } from '../strategic/time/environment.ts';
import {
  addEveryDayStrategicEvent,
  addFutureDayStrategicEvent,
  addPeriodStrategicEvent,
  deleteAllStrategicEvents,
} from '../strategic/time/event-queue.ts';
import type { WorldClock } from '../strategic/time/world-clock.ts';
import type { CampaignSim } from './campaign-sim.ts';

const QUEST_CHECK_EVENT_TIME = 8 * 60;
const BOBBYRAY_UPDATE_TIME = 9 * 60;
const INSURANCE_UPDATE_TIME = 0;
const EARLY_MORNING_TIME = 4 * 60;
const ENRICO_MAIL_TIME = 7 * 60;
const MIDNIGHT = 0;
const HOURLY_MINUTES = 60;
const QUARTER_HOUR_MINUTES = 15;
const SPECK_EMAIL_TIME = 7 * 60;

const DAILY_EVENTS: readonly (readonly [number, number])[] = [
  [EventKind.CHECKFORQUESTS, QUEST_CHECK_EVENT_TIME],
  [EventKind.DAILY_EARLY_MORNING_EVENTS, EARLY_MORNING_TIME],
  [EventKind.DAILY_UPDATE_BOBBY_RAY_INVENTORY, BOBBYRAY_UPDATE_TIME],
  [EventKind.DAILY_UPDATE_OF_MERC_SITE, MIDNIGHT],
  [EventKind.HANDLE_INSURED_MERCS, INSURANCE_UPDATE_TIME],
  [EventKind.MERC_DAILY_UPDATE, MIDNIGHT],
  [EventKind.SETUP_MINE_INCOME, MIDNIGHT],
  [EventKind.ENRICO_MAIL, ENRICO_MAIL_TIME],
];

function initNewGameClock(c: WorldClock): void {
  c.seconds = STARTING_TIME;
  c.previousSeconds = STARTING_TIME;
  c.secondsPerRealSecond = 0;
  c.resolution = 1;
}

function setupNewStrategicGame(campaign: CampaignSim): void {
  const s = campaign.state;
  initNewGameClock(s.clock);
  deleteAllStrategicEvents(s.queue);
  buildDayLightLevels(s.queue, s.clock);
  for (const [kind, minute] of DAILY_EVENTS) addEveryDayStrategicEvent(s.queue, s.clock, kind, minute, 0);
  addPeriodStrategicEvent(s.queue, s.clock, EventKind.HOURLY_UPDATE, HOURLY_MINUTES, 0);
  addPeriodStrategicEvent(s.queue, s.clock, EventKind.QUARTER_HOUR_UPDATE, QUARTER_HOUR_MINUTES, 0);
}

export function initNewGame(campaign: CampaignSim): void {
  const economy = campaign.economy;
  const queen = campaign.queen;
  if (!economy || !queen) throw new Error('a new game needs the strategic AI and the economy');
  const s = campaign.state;
  if (campaign.merchants) initAllArmsDealers(campaign.merchants);
  setupNewStrategicGame(campaign);
  initStrategicLayerMap(economy, {
    initStrategicAI: () => initStrategicAiForNewCampaign(queen),
    initNpcs: () => initEconomyStrategicLayer(economy),
  });
  s.clock.mode = CompressMode.X0;
  s.clock.secondsPerRealSecond = 0;
  s.clock.resolution = 0;
  s.clock.compressionOn = false;
  addStartingCash(economy);
  const policy = economy.content.policy;
  const days = economy.random.int(policy.mercOnlineMaxDays - policy.mercOnlineMinDays + 1) + policy.mercOnlineMinDays;
  if (days > 0) addFutureDayStrategicEvent(s.queue, s.clock, EventKind.DAY3_ADD_EMAIL_FROM_SPECK, SPECK_EMAIL_TIME, 0, days);
  s.didGameJustStart = true;
}
