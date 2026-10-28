import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { fact, QuestStatus } from '../../strategic/narrative/facts.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { QuestHistory } from '../../strategic/narrative/quests.ts';
import { CompressMode } from '../../strategic/time/constants.ts';
import { worldHour } from '../../strategic/time/world-clock.ts';
import type { CampaignSim } from '../campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const STARTING_MINUTE = 1500;
const MUSEUM_OPEN_HOUR = 9;
const STEP_BUDGET = 200_000;

function compressTo(c: CampaignSim, hour: number): void {
  if (!c.dispatch({ type: 'mapScreen' }).ok) throw new Error('no map screen');
  if (!c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok) throw new Error('cannot compress');
  for (let i = 0; i < STEP_BUDGET && worldHour(c.state.clock) !== hour; i++) c.step();
  c.dispatch({ type: 'stopTime' });
}

describe('quests, facts and NPC presence in a stub campaign', () => {
  it('starts the letter quest with Enrico’s assignment in the history at game start', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 11 });
    expect(c.state.narrative.quests[Quest.DELIVER_LETTER]).toBe(QuestStatus.IN_PROGRESS);
    expect(c.state.laptop.history.slice(0, 2).map((h) => [h.code, h.secondCode, h.date, h.x])).toEqual([
      [QuestHistory.ACCEPTED_ASSIGNMENT_FROM_ENRICO, 0, STARTING_MINUTE, -1],
      [QuestHistory.QUEST_STARTED, Quest.DELIVER_LETTER, STARTING_MINUTE, -1],
    ]);
    expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'questStarted', quest: 'DELIVER_LETTER', sector: null }));
  });

  it('runs the 04:00 event during the landing warp and the hourly quest facts afterwards', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 12, garrison: { admins: 0, troops: 0, elites: 0 } });
    const tony = testProfile(Npc.TONY, { lastDateSpokenTo: 1 });
    c.state.profiles.set(Npc.TONY, tony);
    landFirstSquad(c);
    expect(worldHour(c.state.clock)).toBe(7);
    const away = tony.sectorX === 0;
    expect(away || (tony.sectorX === 5 && tony.sectorY === 3)).toBe(true);
    expect(fact(c.state.narrative, Fact.TONY_NOT_AVAILABLE)).toBe(away);
    expect(fact(c.state.narrative, Fact.MUSEUM_OPEN)).toBe(false);
    compressTo(c, MUSEUM_OPEN_HOUR + 1);
    expect(fact(c.state.narrative, Fact.MUSEUM_OPEN)).toBe(true);
  });

  it('ends Kingpin’s money quest with his death and runs the creature quest through the quest engine', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 14 });
    const d5 = { x: 5, y: 4, z: 0 };
    c.narrative.startQuest(Quest.KINGPIN_MONEY, d5);
    c.narrative.profileDied(Npc.KINGPIN);
    expect(c.state.narrative.quests[Quest.KINGPIN_MONEY]).toBe(QuestStatus.DONE);
    expect(fact(c.state.narrative, Fact.KINGPIN_DEAD)).toBe(true);
    expect(c.state.laptop.history.slice(-2).map((h) => [h.code, h.secondCode])).toEqual([
      [QuestHistory.QUEST_STARTED, Quest.KINGPIN_MONEY],
      [QuestHistory.QUEST_FINISHED, Quest.KINGPIN_MONEY],
    ]);
    c.economy?.hooks.startCreatureQuest({ x: 13, y: 4, z: 0 });
    expect(c.state.narrative.quests[Quest.CREATURES]).toBe(QuestStatus.IN_PROGRESS);
    expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'questStarted', quest: 'CREATURES', sector: 'D13' }));
  });

  it('places profile NPCs by their campaign profile sector, with z', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 13 });
    landFirstSquad(c);
    const flow = c.sectors;
    const arnie = testProfile(Npc.ARNIE, { sectorX: 10, sectorY: 1 });
    c.state.profiles.set(Npc.ARNIE, arnie);
    if (!flow) throw new Error('no sector flow');
    expect(flow.populationEnv().profileHere(Npc.ARNIE)).toBe(false);
    arnie.sectorX = 9;
    arnie.sectorY = 1;
    expect(flow.populationEnv().profileHere(Npc.ARNIE)).toBe(true);
    arnie.sectorZ = 1;
    expect(flow.populationEnv().profileHere(Npc.ARNIE)).toBe(false);
  });
});
