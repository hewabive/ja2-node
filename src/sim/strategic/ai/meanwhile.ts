// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc ScheduleMeanwhileEvent, BeginMeanwhile, AreInMeanwhile, ProcessImplicationsOfMeanwhile,
// @src HandleMeanWhileEventPostingForTownLiberation, HandleMeanWhileEventPostingForTownLoss, HandleMeanWhileEventPostingForSAMLiberation,
// @src HandleFlowersMeanwhileScene, HandleOutskirtsOfMedunaMeanwhileScene, HandleKillChopperMeanwhileScene,
// @src HandleScientistAWOLMeanwhileScene, HandleFirstBattleVictory, HandleDelayedFirstBattleVictory,
// @src HandleFirstBattleEndingWhileInTown, HandleFirstMeanWhileSetUpWithTrashWorld; Game_Event_Hook.cc EVENT_MEANWHILE,
// @src DelayEventIfBattleInProgress; Queen_Command.cc EndCaptureSequence (the interrogation's schedule); Interface_Dialogue.cc
// @src NPC_ACTION_ADD_RAT.

import { type Sector, sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i8, u32 } from '../../../core/int.ts';
import { Difficulty, SectorFlag } from '../forces/constants.ts';
import { getSectorFlagStatus } from '../map/sectors.ts';
import { Quest } from '../narrative/fact-ids.ts';
import { Npc } from '../narrative/npc-ids.ts';
import { setProfileSector } from '../narrative/presence.ts';
import type { SectorPosition } from '../state.ts';
import { EventKind } from '../time/constants.ts';
import { addAdvancedStrategicEvent, addStrategicEvent, type StrategicEvent } from '../time/event-queue.ts';
import { interruptTime, lockPauseState, pauseGame, worldTotalMinutes } from '../time/world-clock.ts';
import {
  ELLIOT_MAX_SLAPS,
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
import { emptyMeanwhileDefinition, type MeanwhileDefinition, type MeanwhileSector } from './queen-state.ts';
import { executeStrategicAIAction } from './reactions.ts';

const OUTSKIRTS_ROW_M = 13;
const OUTSKIRTS_ROW_N = 14;
const OUTSKIRTS_M_FROM_X = 2;
const OUTSKIRTS_M_TO_X = 6;
const OUTSKIRTS_N_X = 6;
const LOCK_PAUSE_MEANWHILE = 6;
const MEANWHILE_TRIGGER_RECORD = 0;
const MINUTES_PER_HOUR = 60;
const FLOWERS_NEXT_DAY_HOURS = { base: 20, spread: 5 } as const;
const FLOWERS_LATER_HOURS = { base: 24, spread: 48 } as const;
const KILL_CHOPPER_DELAY_MINUTES = 55;
const KILL_CHOPPER_DELAY_VARIANCE = 10;
const RAT_SECTOR: SectorPosition = { x: 9, y: 7, z: 0 };
const QUEST_SECTOR_NONE: SectorPosition = { x: -1, y: -1, z: 0 };
const NO_SECTOR: SectorPosition = { x: 0, y: 0, z: 0 };

export const MEDUNA_QUEEN_SECTOR: MeanwhileSector = { x: 3, y: 16 };
export const INTERROGATION_SECTOR: MeanwhileSector = { x: 7, y: 14 };
export const INTERROGATION_MINUTE = 10;
export const FLOWERS_NEXT_DAY_CODE = 0;

function meanwhileFlag(id: number): number {
  return MEANWHILE_FLAGS[id] ?? 0;
}

export function meanwhileScheduled(q: QueenContext, id: number): boolean {
  return (q.state.meanwhile.flags & meanwhileFlag(id)) !== 0;
}

function countElliotSlap(q: QueenContext): void {
  const elliot = q.queenHooks.profile(Npc.ELLIOT);
  if (elliot && elliot.npcData !== ELLIOT_MAX_SLAPS) elliot.npcData = i8(elliot.npcData + 1);
}

export function scheduleMeanwhileEvent(q: QueenContext, id: number, minute: number, sector: MeanwhileSector = MEDUNA_QUEEN_SECTOR): void {
  if (meanwhileScheduled(q, id)) return;
  const m = q.state.meanwhile;
  m.flags = u32(m.flags | meanwhileFlag(id));
  m.currentId = id;
  m.defs[id] = { sector: { ...sector }, trigger: MEANWHILE_TRIGGER_RECORD, id, npc: Npc.QUEEN };
  countElliotSlap(q);
  addStrategicEvent(q.state.queue, EventKind.MEANWHILE, minute, id);
}

function inFiveMinutes(q: QueenContext): number {
  return worldTotalMinutes(q.state.clock) + MEANWHILE_DELAY_MINUTES;
}

function madlabAlternateMapSector(q: QueenContext): SectorPosition {
  let found = NO_SECTOR;
  const placement = q.content.npcPlacements.find((p) => p.profile === Npc.MADLAB);
  for (const id of placement?.sectors ?? []) {
    const s = sectorFromId(id);
    if (getSectorFlagStatus(q.state.map, s, SectorFlag.USE_ALTERNATE_MAP)) found = { x: s.x, y: s.y, z: 0 };
  }
  return found;
}

function placeProfile(q: QueenContext, profile: number, sector: SectorPosition): void {
  const p = q.queenHooks.profile(profile);
  if (p) setProfileSector(p, sector);
}

function scientistWentAwol(q: QueenContext): void {
  q.queenHooks.startQuest(Quest.FIND_SCIENTIST, QUEST_SECTOR_NONE);
  const sector = madlabAlternateMapSector(q);
  placeProfile(q, Npc.MADLAB, sector);
  placeProfile(q, Npc.ROBOT, sector);
}

function sendTroopsToSam(q: QueenContext, id: number): void {
  const sam = q.content.samSites[SAM_LIBERATION_MEANWHILES.indexOf(id)];
  if (sam) executeStrategicAIAction(q, StrategicAiAction.SEND_TROOPS_TO_SAM, sectorFromId(sam.sector));
}

export function processImplicationsOfMeanwhile(q: QueenContext, id: number): void {
  switch (id) {
    case Meanwhile.END_OF_PLAYERS_FIRST_BATTLE:
      if (q.state.options.difficulty === Difficulty.HARD) executeStrategicAIAction(q, StrategicAiAction.WAKE_QUEEN, null);
      return;
    case Meanwhile.DRASSEN_LIBERATED:
    case Meanwhile.CAMBRIA_LIBERATED:
    case Meanwhile.ALMA_LIBERATED:
    case Meanwhile.GRUMM_LIBERATED:
    case Meanwhile.CHITZENA_LIBERATED:
    case Meanwhile.BALIME_LIBERATED:
      executeStrategicAIAction(q, StrategicAiAction.WAKE_QUEEN, null);
      return;
    case Meanwhile.CREATURES:
      placeProfile(q, Npc.RAT, RAT_SECTOR);
      return;
    case Meanwhile.AWOL_SCIENTIST:
      scientistWentAwol(q);
      return;
    case Meanwhile.NW_SAM:
    case Meanwhile.NE_SAM:
    case Meanwhile.CENTRAL_SAM:
      sendTroopsToSam(q, id);
      return;
    default:
      return;
  }
}

export function beginMeanwhile(q: QueenContext, id: number): void {
  const m = q.state.meanwhile;
  m.current = m.defs[id] ?? emptyMeanwhileDefinition();
  m.trying = true;
  pauseGame(q.state.clock);
  lockPauseState(q.state.clock, LOCK_PAUSE_MEANWHILE);
  m.npcSaves.length = 0;
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
  beginMeanwhile(q, e.param);
  interruptTime(q.state.clock);
}

export function currentMeanwhile(q: Pick<QueenContext, 'state'>): MeanwhileDefinition {
  return q.state.meanwhile.current;
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

export function areInMeanwhile(q: QueenContext): boolean {
  if (q.state.movement.tacticalTraversal.active) return false;
  if (q.state.meanwhile.inScene) return true;
  return meanwhilePendingThisSecond(q);
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

export function handleFlowersMeanwhileScene(q: QueenContext, code: number): void {
  if (meanwhileScheduled(q, Meanwhile.FLOWERS)) return;
  const hours = code === FLOWERS_NEXT_DAY_CODE ? FLOWERS_NEXT_DAY_HOURS : FLOWERS_LATER_HOURS;
  const minute = worldTotalMinutes(q.state.clock) + MINUTES_PER_HOUR * (hours.base + q.random.int(hours.spread));
  scheduleMeanwhileEvent(q, Meanwhile.FLOWERS, minute);
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

export function handleKillChopperMeanwhileScene(q: QueenContext): void {
  if (meanwhileScheduled(q, Meanwhile.KILL_CHOPPER)) return;
  const minute = worldTotalMinutes(q.state.clock) + KILL_CHOPPER_DELAY_MINUTES + q.random.int(KILL_CHOPPER_DELAY_VARIANCE);
  scheduleMeanwhileEvent(q, Meanwhile.KILL_CHOPPER, minute);
}

export function handleScientistAwolMeanwhileScene(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.AWOL_SCIENTIST, inFiveMinutes(q));
}

export function handleCreatureRelease(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.CREATURES, inFiveMinutes(q));
}

export function scheduleInterrogation(q: QueenContext): void {
  scheduleMeanwhileEvent(q, Meanwhile.INTERROGATION, INTERROGATION_MINUTE, INTERROGATION_SECTOR);
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

function camelCase(name: string): string {
  return name.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function meanwhileSceneName(id: number): string {
  const entry = Object.entries(Meanwhile).find(([, v]) => v === id);
  return entry ? camelCase(entry[0]) : `meanwhile${id}`;
}

export function meanwhileScheduledIn(m: { readonly flags: number }, id: number): boolean {
  return (m.flags & meanwhileFlag(id)) !== 0;
}
