import { describe, expect, it } from 'vitest';
import type { SectorPosition } from '../state.ts';
import { Fact, Quest } from './fact-ids.ts';
import { createNarrativeState, fact, QuestStatus, questStatus, setFactTrue, setQuestStatus } from './facts.ts';
import {
  checkForQuests,
  endQuest,
  initQuestEngine,
  internalEndQuest,
  internalStartQuest,
  type QuestContext,
  QuestHistory,
  startQuest,
} from './quests.ts';

interface Logged {
  readonly code: number;
  readonly quest: number;
  readonly sector: SectorPosition | null;
}

function harness(sciFi = true) {
  const narrative = createNarrativeState();
  const history: Logged[] = [];
  const madame = { npcData: 2, npcData2: 1 };
  const ctx: QuestContext = {
    narrative,
    sciFi,
    history: (code, quest, sector) => history.push({ code, quest, sector }),
    madame: () => madame,
  };
  return { narrative, history, madame, ctx };
}

const D5 = { x: 5, y: 4, z: 0 };

describe('facts store', () => {
  it('gives Jake his gas only the first time Estoni refuelling becomes possible', () => {
    const n = createNarrativeState();
    let calls = 0;
    const hooks = { estoniRefuellingPossible: () => calls++ };
    setFactTrue(n, Fact.ESTONI_REFUELLING_POSSIBLE, hooks);
    setFactTrue(n, Fact.ESTONI_REFUELLING_POSSIBLE, hooks);
    setFactTrue(n, Fact.MUSEUM_OPEN, hooks);
    expect(calls).toBe(1);
    expect(fact(n, Fact.ESTONI_REFUELLING_POSSIBLE)).toBe(true);
  });

  it('ignores quest ids outside the array', () => {
    const n = createNarrativeState();
    setQuestStatus(n, 40, QuestStatus.DONE);
    expect(questStatus(n, 40)).toBe(QuestStatus.NOT_STARTED);
  });
});

describe('quests', () => {
  it('logs a start and an end once, and changes silently otherwise', () => {
    const h = harness();
    startQuest(h.ctx, Quest.KINGPIN_MONEY, D5);
    startQuest(h.ctx, Quest.KINGPIN_MONEY, D5);
    endQuest(h.ctx, Quest.KINGPIN_MONEY, D5);
    endQuest(h.ctx, Quest.KINGPIN_MONEY, D5);
    startQuest(h.ctx, Quest.KINGPIN_MONEY, D5);
    expect(h.history).toEqual([
      { code: QuestHistory.QUEST_STARTED, quest: Quest.KINGPIN_MONEY, sector: D5 },
      { code: QuestHistory.QUEST_FINISHED, quest: Quest.KINGPIN_MONEY, sector: D5 },
    ]);
    expect(questStatus(h.narrative, Quest.KINGPIN_MONEY)).toBe(QuestStatus.IN_PROGRESS);
    endQuest(h.ctx, Quest.BLOODCATS, null);
    expect(questStatus(h.narrative, Quest.BLOODCATS)).toBe(QuestStatus.DONE);
    expect(h.history).toHaveLength(2);
  });

  it('skips Alma without history', () => {
    const h = harness();
    internalStartQuest(h.ctx, Quest.HELD_IN_ALMA, null, false);
    internalEndQuest(h.ctx, Quest.HELD_IN_ALMA, null, false);
    expect(h.history).toEqual([]);
    expect(questStatus(h.narrative, Quest.HELD_IN_ALMA)).toBe(QuestStatus.DONE);
  });

  it('clears Madame’s counters whenever the Maria quest ends', () => {
    const h = harness();
    internalEndQuest(h.ctx, Quest.RESCUE_MARIA, null, false);
    expect(h.madame).toEqual({ npcData: 0, npcData2: 0 });
  });

  it('starts the letter quest at init after Enrico’s assignment, and never again', () => {
    const h = harness(false);
    setFactTrue(h.narrative, Fact.MUSEUM_OPEN);
    h.narrative.boxing.matchesWon = 4;
    initQuestEngine(h.ctx);
    expect(fact(h.narrative, Fact.MUSEUM_OPEN)).toBe(false);
    expect(h.history.map((e) => [e.code, e.quest, e.sector])).toEqual([
      [QuestHistory.ACCEPTED_ASSIGNMENT_FROM_ENRICO, 0, null],
      [QuestHistory.QUEST_STARTED, Quest.DELIVER_LETTER, null],
    ]);
    expect(h.narrative.cambriaMedicalObjects).toBe(18);
    expect(h.narrative.boxing.matchesWon).toBe(0);
    checkForQuests(h.ctx);
    expect(h.history).toHaveLength(2);
    expect(harness(true).narrative.cambriaMedicalObjects).toBe(0);
  });
});
