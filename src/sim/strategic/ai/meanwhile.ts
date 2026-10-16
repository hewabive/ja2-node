// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc ScheduleMeanwhileEvent, ProcessImplicationsOfMeanwhile (skipped scene),
// @src HandleMeanWhileEventPostingForTownLiberation, HandleMeanWhileEventPostingForTownLoss, HandleMeanWhileEventPostingForSAMLiberation,
// @src HandleOutskirtsOfMedunaMeanwhileScene, HandleFirstBattleVictory, HandleDelayedFirstBattleVictory,
// @src HandleFirstBattleEndingWhileInTown, HandleFirstMeanWhileSetUpWithTrashWorld; Game_Event_Hook.cc EVENT_MEANWHILE,
// @src DelayEventIfBattleInProgress. See docs/17 §9.4.

import { type Sector, sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import { Difficulty } from '../forces/constants.ts';
import { EventKind } from '../time/constants.ts';
import { addAdvancedStrategicEvent, addStrategicEvent, type StrategicEvent } from '../time/event-queue.ts';
import { interruptTime, worldTotalMinutes } from '../time/world-clock.ts';
import {
  MEANWHILE_BATTLE_DELAY_SECONDS,
  MEANWHILE_BATTLE_DELAY_VARIANCE,
  MEANWHILE_DELAY_MINUTES,
  MEANWHILE_FLAGS,
  Meanwhile,
  SAM_LIBERATION_MEANWHILES,
  StrategicAiAction,
  TOWN_LIBERATION_MEANWHILES,
  Town,
} from './constants.ts';
import type { QueenContext } from './context.ts';
import { executeStrategicAIAction } from './reactions.ts';

const OUTSKIRTS_ROW_M = 13;
const OUTSKIRTS_ROW_N = 14;
const OUTSKIRTS_M_FROM_X = 2;
const OUTSKIRTS_M_TO_X = 6;
const OUTSKIRTS_N_X = 6;

function meanwhileFlag(id: number): number {
  return MEANWHILE_FLAGS[id] ?? 0;
}

export function meanwhileScheduled(q: QueenContext, id: number): boolean {
  return (q.state.meanwhile.flags & meanwhileFlag(id)) !== 0;
}

export function scheduleMeanwhileEvent(q: QueenContext, id: number, minute: number): void {
  if (meanwhileScheduled(q, id)) return;
  q.state.meanwhile.flags = u32(q.state.meanwhile.flags | meanwhileFlag(id));
  q.state.meanwhile.currentId = id;
  addStrategicEvent(q.state.queue, EventKind.MEANWHILE, minute, id);
}

function inFiveMinutes(q: QueenContext): number {
  return worldTotalMinutes(q.state.clock) + MEANWHILE_DELAY_MINUTES;
}

export function processImplicationsOfMeanwhile(q: QueenContext, id: number): void {
  if (id === Meanwhile.END_OF_PLAYERS_FIRST_BATTLE) {
    if (q.state.options.difficulty === Difficulty.HARD) executeStrategicAIAction(q, StrategicAiAction.WAKE_QUEEN, null);
    return;
  }
  if ([...TOWN_LIBERATION_MEANWHILES.values()].includes(id)) {
    executeStrategicAIAction(q, StrategicAiAction.WAKE_QUEEN, null);
    return;
  }
  const samIndex = SAM_LIBERATION_MEANWHILES.indexOf(id);
  const sam = q.content.samSites[samIndex];
  if (samIndex >= 0 && sam) executeStrategicAIAction(q, StrategicAiAction.SEND_TROOPS_TO_SAM, sectorFromId(sam.sector));
}

export function handleMeanwhileEvent(q: QueenContext, e: StrategicEvent): void {
  if (q.world.enemyInSector()) {
    const delayed = addAdvancedStrategicEvent(
      q.state.queue,
      e.frequency,
      e.kind,
      e.stamp + MEANWHILE_BATTLE_DELAY_SECONDS + q.random.int(MEANWHILE_BATTLE_DELAY_VARIANCE),
      e.param,
    );
    if (delayed) delayed.offset = e.offset;
    return;
  }
  processImplicationsOfMeanwhile(q, e.param);
  interruptTime(q.state.clock);
}

export function meanwhilePendingThisSecond(q: QueenContext): boolean {
  if (q.state.movement.tacticalTraversal.active) return false;
  const now = q.state.clock.seconds;
  for (const e of q.state.queue.events) {
    if (e.stamp !== now) return false;
    if (e.kind === EventKind.MEANWHILE) return true;
  }
  return false;
}

export function handleMeanwhileEventPostingForTownLiberation(q: QueenContext, townId: number): void {
  const id = TOWN_LIBERATION_MEANWHILES.get(townId);
  if (id !== undefined) scheduleMeanwhileEvent(q, id, inFiveMinutes(q));
}

export function handleMeanwhileEventPostingForTownLoss(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.LOST_TOWN, inFiveMinutes(q));
}

export function handleMeanwhileEventPostingForSamLiberation(q: QueenContext, samId: number): void {
  const id = SAM_LIBERATION_MEANWHILES[samId];
  if (id !== undefined) scheduleMeanwhileEvent(q, id, inFiveMinutes(q));
}

export function isMedunaOutskirts(s: Sector): boolean {
  if (s.z !== 0) return false;
  return (
    (s.y === OUTSKIRTS_ROW_M && s.x >= OUTSKIRTS_M_FROM_X && s.x <= OUTSKIRTS_M_TO_X) || (s.y === OUTSKIRTS_ROW_N && s.x === OUTSKIRTS_N_X)
  );
}

export function handleOutskirtsOfMedunaMeanwhileScene(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.OUTSKIRTS_MEDUNA, inFiveMinutes(q));
}

function handleFirstBattleVictory(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE, inFiveMinutes(q));
}

export function handleFirstBattleEndingWhileInTown(q: QueenContext, s: Sector, fromAutoResolve: boolean): void {
  if (meanwhileScheduled(q, Meanwhile.END_OF_PLAYERS_FIRST_BATTLE)) return;
  const queen = q.state.queen;
  const townId = q.state.map.elements[strategicIndex(s)]?.nameId ?? Town.BLANK_SECTOR;
  if (townId === Town.BLANK_SECTOR) {
    handleFirstBattleVictory(q);
    queen.firstBattleMeanwhilePending = false;
  } else if (queen.firstBattleMeanwhilePending || fromAutoResolve) {
    handleFirstBattleVictory(q);
    queen.firstBattleMeanwhilePending = false;
  } else queen.firstBattleMeanwhilePending = true;
}

export function handleFirstMeanwhileSetUpWithTrashWorld(q: QueenContext): void {
  if (!q.state.queen.firstBattleMeanwhilePending) return;
  handleFirstBattleVictory(q);
  q.state.queen.firstBattleMeanwhilePending = false;
}
