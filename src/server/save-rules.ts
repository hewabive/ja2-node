// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc CanGameBeSaved, DoDeadIsDeadSaveIfNecessary; SaveLoadScreen.cc DoQuickSave, DoAutoSave,
// @src DoDeadIsDeadSave; Tactical/Handle_UI.cc UIHandleEndTurn; Tactical/TeamTurns.cc StartPlayerTeamTurn, EndTurn;
// @src Strategic/Meanwhile.cc BeginMeanwhile; Strategic/Map_Screen_Interface.cc HandleGroupAboutToArrive;
// @src Tactical/Turn_Based_Input.cc and Strategic/Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo. See docs/27 §1.1, §1.6.

import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { SimEvent } from '../sim/events.ts';
import { numEnemiesInAnySector } from '../sim/strategic/forces/groups.ts';
import type { SaveMode } from '../sim/strategic/state.ts';
import { EventKind } from '../sim/strategic/time/constants.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { npcRequestView, promptView } from './battle-view.ts';
import { CampaignSession } from './campaign-session.ts';
import { contractPromptView } from './contract-view.ts';
import { TacticalSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';

export const SAVE_REFUSALS = ['conversation', 'meanwhileStarting', 'promptOpen', 'shopOpen', 'ironMan', 'deadIsDead'] as const;

export type SaveRefusal = (typeof SAVE_REFUSALS)[number];

export type SaveRequestKind = 'player' | 'quick';

export const SAVE_REFUSAL_MESSAGES: Readonly<Record<SaveRefusal, string>> = {
  conversation: 'a conversation is open or the dialogue queue is busy',
  meanwhileStarting: 'a meanwhile scene is starting or playing',
  promptOpen: 'a decision prompt is open',
  shopOpen: 'a shop is open',
  ironMan: 'Iron Man: no saves in combat or while enemies are in the loaded sector',
  deadIsDead: 'Dead is Dead: the game saves itself into its one file; explicit saves are refused',
};

const DEFAULT_SAVE_MODE: SaveMode = 'anywhere';

function campaignOf(sim: SessionSim): CampaignSim | null {
  return sim instanceof CampaignSession ? sim.campaign : null;
}

function tacticalOf(sim: SessionSim): TacticalSim | null {
  if (sim instanceof TacticalSession) return sim.sim;
  const campaign = campaignOf(sim);
  return campaign?.state.flow === 'tactical' ? campaign.tactical : null;
}

export function saveModeOf(sim: SessionSim): SaveMode {
  return campaignOf(sim)?.state.options.saveMode ?? DEFAULT_SAVE_MODE;
}

export function inTurnBasedCombat(sim: SessionSim): boolean {
  return tacticalOf(sim)?.state.inCombat ?? false;
}

function conversationOpen(campaign: CampaignSim): boolean {
  const talk = campaign.talk;
  return talk !== null && (talk.view() !== null || talk.scriptedSequence() || !talk.isIdle());
}

function meanwhileStarting(campaign: CampaignSim): boolean {
  const m = campaign.state.meanwhile;
  return m.trying || m.inScene;
}

function promptOpen(campaign: CampaignSim): boolean {
  if (campaign.state.flow === 'autoresolve') return true;
  if (campaign.battle && promptView(campaign)) return true;
  if (campaign.contracts && contractPromptView(campaign)) return true;
  return campaign.talk !== null && npcRequestView(campaign) !== null;
}

function enemiesInLoadedSector(campaign: CampaignSim): boolean {
  const sector = campaign.state.worldSector;
  const ctx = campaign.strategic;
  return sector !== null && ctx !== null && numEnemiesInAnySector(ctx, sector) > 0;
}

export function canGameBeSaved(sim: SessionSim): boolean {
  if (saveModeOf(sim) !== 'ironMan') return true;
  if (inTurnBasedCombat(sim)) return false;
  const campaign = campaignOf(sim);
  return campaign === null || !enemiesInLoadedSector(campaign);
}

function modalRefusal(campaign: CampaignSim): SaveRefusal | null {
  if (conversationOpen(campaign)) return 'conversation';
  if (meanwhileStarting(campaign)) return 'meanwhileStarting';
  if (promptOpen(campaign)) return 'promptOpen';
  if (campaign.shop?.isOpen()) return 'shopOpen';
  return null;
}

export function saveRefusal(sim: SessionSim, request: SaveRequestKind = 'player'): SaveRefusal | null {
  const mode = saveModeOf(sim);
  if (mode === 'deadIsDead' && request === 'player') return 'deadIsDead';
  const campaign = campaignOf(sim);
  const modal = campaign ? modalRefusal(campaign) : null;
  if (modal) return modal;
  return canGameBeSaved(sim) ? null : 'ironMan';
}

function ourTurn(sim: SessionSim): boolean {
  const t = tacticalOf(sim)?.state;
  return !t?.inCombat || t.turn.currentTeam === Team.OUR;
}

function actionInProgress(sim: SessionSim): boolean {
  const tactical = tacticalOf(sim);
  return tactical !== null && !tactical.isIdle();
}

export function deadIsDeadWritable(sim: SessionSim): boolean {
  if (!ourTurn(sim) || actionInProgress(sim)) return false;
  const campaign = campaignOf(sim);
  return campaign === null || modalRefusal(campaign) === null;
}

export function startsOurTurn(events: readonly SimEvent[]): boolean {
  return events.some((e) => e.type === 'turnStarted' && e.team === Team.OUR);
}

export function startsMeanwhile(events: readonly SimEvent[]): boolean {
  return events.some((e) => e.type === 'meanwhile' || e.type === 'meanwhileStarted');
}

export interface PendingArrival {
  readonly seq: number;
  readonly stamp: number;
}

export function groupsAboutToArrive(sim: SessionSim): PendingArrival[] {
  const campaign = campaignOf(sim);
  if (!campaign) return [];
  return campaign.state.queue.events.filter((e) => e.kind === EventKind.GROUP_ABOUT_TO_ARRIVE).map((e) => ({ seq: e.seq, stamp: e.stamp }));
}

export function aboutToArriveFired(sim: SessionSim, before: readonly PendingArrival[]): boolean {
  const campaign = campaignOf(sim);
  if (!campaign || before.length === 0) return false;
  const now = campaign.state.clock.seconds;
  const queued = new Set(campaign.state.queue.events.map((e) => e.seq));
  return before.some((e) => !queued.has(e.seq) && e.stamp <= now);
}

export interface SaveStatus {
  readonly saveMode: SaveMode;
  readonly canSave: boolean;
  readonly saveRefusal?: SaveRefusal;
}

export function saveStatus(sim: SessionSim): SaveStatus {
  const refusal = saveRefusal(sim);
  return { saveMode: saveModeOf(sim), canSave: refusal === null, ...(refusal ? { saveRefusal: refusal } : {}) };
}
