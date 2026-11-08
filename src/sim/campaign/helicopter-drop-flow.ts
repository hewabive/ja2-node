// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/GameScreen.cc InitHelicopterEntranceByMercs (gfTacticalDoHeliRun and gfFirstHeliRun) and
// @src MainGameScreenHandle's gfTacticalDoHeliRun (StartHelicopterRun on the north entry point, then
// @src SetGameTimeCompressionLevel(TIME_COMPRESS_X1)); Tactical/Merc_Hiring.cc MercArrivesCallback (a merc arriving in
// @src the loaded start sector without the chopper code gets it, a run and the way out of the map screen);
// @src Tactical/Merc_Entering.cc StartHelicopterRun's InterruptTime, HandleHeliDrop's Esc branch (the lock's end) and
// @src HandleFirstHeliDropOfGame.

import { type Sector, sameSector, sectorFromId } from '../../content/strategic/sector-ids.ts';
import { addDialogueEvent } from '../narrative/dialogue-queue.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { interruptTime, setGameTimeCompressionLevel } from '../strategic/time/world-clock.ts';
import { unPauseAi } from '../tactical/ai/pause.ts';
import { callAvailableEnemiesTo } from '../tactical/doors/door-traps.ts';
import { helicopterDropStalled, skipHelicopterDrop, startHelicopterRun } from '../tactical/helicopter-drop.ts';
import { forgetHelicopterShadows, type HelicopterDrop } from '../tactical/helicopter-drop-state.ts';
import { MercQuote, sayQuoteFromAnyBodyInSector } from '../tactical/narrative/merc-quotes.ts';
import { StopTimeCallback } from '../tactical/narrative/port.ts';
import { sectorMapOf, type TacticalState } from '../tactical/state.ts';
import { numEnemyInSector, syncStrategicTurnTimes } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { syncInterfaceLockPause } from './interface-lock-pause.ts';
import { openTacticalScreen } from './screens.ts';

export interface ChopperArrival {
  insertionCode: number;
  readonly sector: Sector;
}

function dropOf(campaign: CampaignSim): HelicopterDrop {
  return campaign.state.sectorFlow.helicopterDrop;
}

function startSector(campaign: CampaignSim): Sector | null {
  const start = campaign.strategic?.content.policy.startSector;
  return start === undefined ? null : sectorFromId(start);
}

export function initHelicopterEntranceByMercs(campaign: CampaignSim): void {
  const drop = dropOf(campaign);
  drop.doHeliRun = true;
  drop.firstHeliRun = true;
}

export function chopperIntoLoadedStartSector(campaign: CampaignSim, merc: ChopperArrival): void {
  const start = startSector(campaign);
  if (merc.insertionCode === InsertionCode.CHOPPER || !start || !sameSector(merc.sector, start)) return;
  dropOf(campaign).doHeliRun = true;
  if (campaign.state.flow === 'strategic') openTacticalScreen(campaign);
  merc.insertionCode = InsertionCode.CHOPPER;
}

export function handleTacticalDoHeliRun(campaign: CampaignSim): boolean {
  const drop = dropOf(campaign);
  const t = campaign.tactical?.state;
  if (!drop.doHeliRun || !t || campaign.state.flow !== 'tactical') return false;
  const started = startHelicopterRun(t, sectorMapOf(t).info.northGridNo);
  if (started) interruptTime(campaign.state.clock);
  setGameTimeCompressionLevel(campaign.clockContext, CompressMode.X1);
  drop.doHeliRun = false;
  syncInterfaceLockPause(campaign);
  return started;
}

export function helicopterDropUnderWay(campaign: CampaignSim): boolean {
  const t = campaign.tactical?.state;
  if (!t?.helicopterDrop.running) return false;
  return !helicopterDropStalled(t);
}

export function skipHelicopterDropOf(campaign: CampaignSim): boolean {
  const t = campaign.tactical?.state;
  if (!t || campaign.state.flow !== 'tactical' || !skipHelicopterDrop(t)) return false;
  syncInterfaceLockPause(campaign);
  return true;
}

function sendUnPauseAi(campaign: CampaignSim, t: TacticalState): void {
  const host = campaign.talk?.host;
  if (host) addDialogueEvent(host, { kind: 'callback', name: StopTimeCallback.UN_PAUSE_AI });
  else unPauseAi(t);
}

export function handleFirstHeliDropOfGame(campaign: CampaignSim, t: TacticalState): void {
  const drop = dropOf(campaign);
  if (drop.firstHeliRun) {
    syncStrategicTurnTimes(t.realtimeClock, t.clockMs);
    callAvailableEnemiesTo(t, drop.sweetSpot);
    if (numEnemyInSector(t) > 0) sayQuoteFromAnyBodyInSector(t, MercQuote.ENEMY_PRESENCE);
    drop.firstHeliRun = false;
  }
  sendUnPauseAi(campaign, t);
}

export function cutHelicopterDropShort(campaign: CampaignSim, giveNorthCode: (id: number) => void): void {
  const drop = dropOf(campaign);
  forgetHelicopterShadows(drop);
  if (!drop.running && !drop.doHeliRun) return;
  for (const id of drop.seats.slice(drop.running ? drop.curDrop : 0)) giveNorthCode(id);
  drop.seats.length = 0;
  drop.running = false;
  drop.doHeliRun = false;
  drop.firstHeliRun = false;
}
