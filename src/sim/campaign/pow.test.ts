import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { removeCharacterFromSquads } from '../strategic/forces/squads.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../strategic/narrative/facts.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const ALMA = { x: 13, y: 9, z: 0 };

function landed(seed: number): { c: CampaignSim; mercs: readonly RosterMerc[] } {
  const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 3, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  return { c, mercs: roster.all() };
}

function makePow(c: CampaignSim, m: RosterMerc): void {
  const ctx = c.strategic;
  if (!ctx) throw new Error('no strategic layer');
  removeCharacterFromSquads(ctx, m.id);
  m.assignment = Assignment.ASSIGNMENT_POW;
  m.soldier.neutral = true;
}

describe('captives on a sector load (docs/26 §3.4)', () => {
  it('reports the POWs in Alma, leaves them prisoners and ends the Alma quest with the rescue experience', () => {
    const { c, mercs } = landed(61);
    const [a, b] = mercs;
    if (!a || !b) throw new Error('mercs');
    makePow(c, a);
    makePow(c, b);
    c.state.narrative.quests[Quest.HELD_IN_ALMA] = QuestStatus.IN_PROGRESS;
    c.state.worldSector = ALMA;
    c.drainEvents();
    c.pows.beginSectorLoad();
    c.pows.powPlaced(a);
    c.pows.powPlaced(b);
    c.pows.endSectorLoad();
    expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'powsFound', sector: 'I13', soldiers: [a.id, b.id] }));
    expect([a.assignment, b.assignment]).toEqual([Assignment.ASSIGNMENT_POW, Assignment.ASSIGNMENT_POW]);
    expect(c.state.narrative.quests[Quest.HELD_IN_ALMA]).toBe(QuestStatus.DONE);
  });

  it('puts captives held anywhere but Alma on one new squad and makes the first one non-neutral', () => {
    const { c, mercs } = landed(62);
    const [a, b] = mercs;
    if (!a || !b) throw new Error('mercs');
    makePow(c, a);
    makePow(c, b);
    c.pows.beginSectorLoad();
    c.pows.powPlaced(a);
    c.pows.powPlaced(b);
    c.pows.endSectorLoad();
    expect(a.assignment).toBeLessThan(Assignment.ON_DUTY);
    expect(b.assignment).toBe(a.assignment);
    expect(a.soldier.neutral).toBe(false);
    expect(b.soldier.neutral).toBe(true);
  });

  it('frees a POW who has a path to the hallway or outside', () => {
    const { c, mercs } = landed(63);
    const [a] = mercs;
    if (!a) throw new Error('mercs');
    makePow(c, a);
    c.state.worldSector = ALMA;
    c.drainEvents();
    c.pows.doPowPathChecks();
    expect(a.soldier.neutral).toBe(false);
    expect(a.assignment).toBeLessThan(Assignment.ON_DUTY);
    expect(c.drainEvents()).toContainEqual(expect.objectContaining({ type: 'powFreed', soldier: a.id, sector: 'I13' }));
  });
});
