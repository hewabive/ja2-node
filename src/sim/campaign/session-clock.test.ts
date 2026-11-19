import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers, runTicks } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { TICK_MS } from '../clock.ts';
import { markStatChange } from '../tactical/combat/experience.ts';
import { campaignOffMapCombatContext } from './off-map-combat.ts';

const ON_THE_MAP_TICKS = 100;
const IN_THE_SECTOR_TICKS = 200;

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

describe("the clock a stat's change time is stamped on (Timer_Control.cc GetJA2Clock)", () => {
  it("reads the session's tick, which the view carries, in the loaded sector and off it, never the sector's own tick", () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 5 });
    runTicks(c, ON_THE_MAP_TICKS);
    landFirstSquad(c);
    runTicks(c, IN_THE_SECTOR_TICKS);
    const t = c.tactical?.state;
    const merc = ourSoldiers(c)[0];
    if (!t || !merc) throw new Error('no squad in the sector');
    const sessionMs = c.state.session.tick * TICK_MS;
    expect(t.tick).not.toBe(c.state.session.tick);
    expect(t.sessionClock.ms()).toBe(sessionMs);
    expect(campaignOffMapCombatContext(c, c.state, kit.sectors.content).sessionClock.ms()).toBe(sessionMs);
    markStatChange(t, merc, 'wisdom', true);
    expect(merc.statChanges.wisdom).toEqual({ at: sessionMs, up: true });
  });
});
