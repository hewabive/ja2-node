import { sectorShortString } from '../content/strategic/sector-ids.ts';
import type { QuestLogEntryView, QuestStepView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { HistoryRecord } from '../sim/campaign/laptop/laptop-state.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestHistory } from '../sim/strategic/narrative/quests.ts';

const QUEST_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(Quest).map(([name, id]) => [id, name]));

function step(h: HistoryRecord): QuestStepView {
  return { minute: h.date, sector: h.x >= 1 && h.y >= 1 ? sectorShortString({ x: h.x, y: h.y }) : null };
}

export function questLog(campaign: CampaignSim): QuestLogEntryView[] {
  const entries = new Map<number, { started: QuestStepView | null; finished: QuestStepView | null }>();
  for (const h of campaign.state.laptop.history) {
    if (h.code !== QuestHistory.QUEST_STARTED && h.code !== QuestHistory.QUEST_FINISHED) continue;
    const entry = entries.get(h.secondCode) ?? { started: null, finished: null };
    if (h.code === QuestHistory.QUEST_STARTED) entry.started ??= step(h);
    else entry.finished ??= step(h);
    entries.set(h.secondCode, entry);
  }
  return [...entries].map(([id, e]) => ({ id, quest: QUEST_NAMES.get(id) ?? `QUEST_${id}`, ...e }));
}
