// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc StartQuest, InternalStartQuest, EndQuest, InternalEndQuest, InitQuestEngine,
// @src CheckForQuests; Laptop/History.h HISTORY_ACCEPTED_ASSIGNMENT_FROM_ENRICO, HISTORY_QUEST_STARTED, HISTORY_QUEST_FINISHED.
// @src See docs/25 §2.2–§2.3.

import type { SectorPosition } from '../state.ts';
import { Quest } from './fact-ids.ts';
import { type NarrativeState, QuestStatus, questStatus, setQuestStatus } from './facts.ts';

export const QuestHistory = { ACCEPTED_ASSIGNMENT_FROM_ENRICO: 5, QUEST_STARTED: 15, QUEST_FINISHED: 16 } as const;

const CAMBRIA_MEDICAL_OBJECTS_SCI_FI = 21;
const CAMBRIA_MEDICAL_OBJECTS_REALISTIC = 18;

export interface QuestNpcCounters {
  npcData: number;
  npcData2: number;
}

export interface QuestContext {
  readonly narrative: NarrativeState;
  readonly sciFi: boolean;
  history(code: number, secondCode: number, sector: SectorPosition | null): void;
  madame(): QuestNpcCounters | null;
}

export function internalStartQuest(ctx: QuestContext, quest: number, sector: SectorPosition | null, withHistory: boolean): void {
  const n = ctx.narrative;
  const wasNotStarted = questStatus(n, quest) === QuestStatus.NOT_STARTED;
  setQuestStatus(n, quest, QuestStatus.IN_PROGRESS);
  if (wasNotStarted && withHistory) ctx.history(QuestHistory.QUEST_STARTED, quest, sector);
}

export function internalEndQuest(ctx: QuestContext, quest: number, sector: SectorPosition | null, withHistory: boolean): void {
  const n = ctx.narrative;
  const wasInProgress = questStatus(n, quest) === QuestStatus.IN_PROGRESS;
  setQuestStatus(n, quest, QuestStatus.DONE);
  if (wasInProgress && withHistory) ctx.history(QuestHistory.QUEST_FINISHED, quest, sector);
  if (quest !== Quest.RESCUE_MARIA) return;
  const madame = ctx.madame();
  if (!madame) return;
  madame.npcData = 0;
  madame.npcData2 = 0;
}

export function startQuest(ctx: QuestContext, quest: number, sector: SectorPosition | null): void {
  internalStartQuest(ctx, quest, sector, true);
}

export function endQuest(ctx: QuestContext, quest: number, sector: SectorPosition | null): void {
  internalEndQuest(ctx, quest, sector, true);
}

export function checkForQuests(ctx: QuestContext): void {
  if (questStatus(ctx.narrative, Quest.DELIVER_LETTER) !== QuestStatus.NOT_STARTED) return;
  ctx.history(QuestHistory.ACCEPTED_ASSIGNMENT_FROM_ENRICO, 0, null);
  startQuest(ctx, Quest.DELIVER_LETTER, null);
}

export function initQuestEngine(ctx: QuestContext): void {
  const n = ctx.narrative;
  n.quests.fill(0);
  n.facts.fill(0);
  checkForQuests(ctx);
  n.cambriaMedicalObjects = ctx.sciFi ? CAMBRIA_MEDICAL_OBJECTS_SCI_FI : CAMBRIA_MEDICAL_OBJECTS_REALISTIC;
  n.boxing.matchesWon = 0;
  n.boxing.rests = 0;
  n.boxing.resting = false;
}
