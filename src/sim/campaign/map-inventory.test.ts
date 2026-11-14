import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { InvSlot } from '../tactical/inventory.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

function onTheMap(): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed: 8, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return c;
}

function onTheMapWithA9Unloaded(): CampaignSim {
  const c = onTheMap();
  const mercs = c.battle?.roster.all() ?? [];
  for (const m of mercs) m.betweenSectors = true;
  expect(c.sectors?.checkAndHandleUnloadingOfCurrentWorld()).toBe(true);
  for (const m of c.battle?.roster.all() ?? []) m.betweenSectors = false;
  return c;
}

function mercIds(c: CampaignSim): number[] {
  return (c.battle?.roster.all() ?? []).map((m) => m.id);
}

const itemIndex = (name: string) => kit.sectors.content.items.byName.get(name)?.index;

describe('the map screen inventory', () => {
  it('tells the reload of a merc off the loaded map, as ReloadGun prints its line for any merc (Items.cc:1300)', () => {
    const c = onTheMapWithA9Unloaded();
    expect(c.tactical).toBeNull();
    const merc = mercIds(c)[0] as number;
    expect(c.dispatch({ type: 'unload', soldier: merc, to: 'bigPocket2' })).toMatchObject({ ok: true });
    c.drainEvents();
    const tick = c.tick;
    expect(c.dispatch({ type: 'reload', soldier: merc, ammo: InvSlot.BIGPOCK1 })).toMatchObject({ ok: true });
    expect(c.drainEvents().filter((e) => e.type === 'reloaded')).toEqual([
      { type: 'reloaded', soldier: merc, item: itemIndex('GLOCK_17'), mapScreen: true, tick },
    ]);
  });
});
