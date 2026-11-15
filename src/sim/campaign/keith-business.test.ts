import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, runUntilIdle } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadMerchantTestContent, type MerchantTestContent } from '../../../tests/support/merchants.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { parseSectorString, type Sector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { getGroup, setGroupSectorValue } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { fact, setFact } from '../strategic/narrative/facts.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { checkForEndOfBattle } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;
let merchants: MerchantTestContent;

beforeAll(async () => {
  const [sectors, economy, army, m] = await Promise.all([
    loadStubSectorKit(),
    loadEconomyTestContent(),
    loadArmyTestContent(),
    loadMerchantTestContent(),
  ]);
  kit = { sectors, economy, army };
  merchants = m;
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const F10 = parseSectorString('F10');
const NO_GARRISON = { numAdmins: 0, numTroops: 0, numElites: 0 };

function landedCampaign(seed: number): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed,
    mercs: 2,
    garrison: { admins: 0, troops: 0, elites: 0 },
    merchants: merchants.content,
  });
  landFirstSquad(c);
  runUntilIdle(c);
  return c;
}

function squadEnters(c: CampaignSim, sector: Sector): void {
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  Object.assign(sectorInfo(c.state.map, sector), NO_GARRISON);
  const ctx = c.strategic;
  const roster = c.battle?.roster;
  if (!ctx || !roster) throw new Error('no strategic layer');
  for (const m of roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
    m.insertionCode = InsertionCode.NORTH;
  }
  expect(c.dispatch({ type: 'enterSector', sector: sectorShortString(sector) })).toMatchObject({ ok: true });
  runUntilIdle(c);
  expect(c.state.worldSector).toEqual(sector);
}

function winTheBattle(c: CampaignSim): void {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  t.turn.enemyInSector = true;
  expect(checkForEndOfBattle(t)).toBe(true);
}

describe('the hillbillies of F10 (NPC.cc HandleVictoryInNPCSector from Overhead.cc CheckForEndOfBattle)', () => {
  it('records them dead and puts Keith back in business when a tactical battle in F10 is won', () => {
    const c = landedCampaign(37);
    squadEnters(c, F10);
    setFact(c.state.narrative, Fact.KEITH_OUT_OF_BUSINESS);
    winTheBattle(c);
    expect(fact(c.state.narrative, Fact.HILLBILLIES_KILLED)).toBe(true);
    expect(fact(c.state.narrative, Fact.KEITH_OUT_OF_BUSINESS)).toBe(false);
  });

  it('leaves them alone after a battle won elsewhere', () => {
    const c = landedCampaign(38);
    setFact(c.state.narrative, Fact.KEITH_OUT_OF_BUSINESS);
    winTheBattle(c);
    expect(fact(c.state.narrative, Fact.HILLBILLIES_KILLED)).toBe(false);
    expect(fact(c.state.narrative, Fact.KEITH_OUT_OF_BUSINESS)).toBe(true);
  });
});

describe("Keith's shop shut by his script (NPC.cc HandleShopKeepHasBeenShutDown)", () => {
  it("answers the merchants' shopClosedByScript hook from Keith's facts, for him alone", () => {
    const c = landedCampaign(39);
    const closed = (profile: number) => c.merchants?.hooks.shopClosedByScript(profile);
    expect(closed(Npc.KEITH)).toBe(false);
    setFact(c.state.narrative, Fact.KEITH_OUT_OF_BUSINESS);
    expect([closed(Npc.KEITH), closed(Npc.FRANZ)]).toEqual([true, false]);
  });
});
