import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, ourGroupAtPreBattleInB9 } from '../../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';

let kit: CampaignKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
  ui = await tacticalUiKit(sectors);
});

afterAll(async () => {
  await kit.sectors.dispose();
});

function placingSession(): Session {
  const { campaign: c, roster } = ourGroupAtPreBattleInB9(kit, 'plain');
  const sim = new CampaignSession(c, kit.sectors.timelines.presentation, roster);
  const pbi = c.state.battle.prompt;
  if (!sim.dispatch({ type: 'answer', prompt: pbi?.id, choice: 'enterSector' }).ok) throw new Error('cannot enter B9');
  return new Session('b9-placement', sim);
}

describe('the world behind the tactical placement panel (GameScreen.cc InOverheadMap, StrategicMap.cc BeginLoadScreen)', () => {
  it('stays hidden from the first frame of the tactical screen until Done closes the placement prompt', async () => {
    const f = await tacticalUiTest(kit.sectors, ui, 5, placingSession());
    expect(f.client.view.prompt?.kind).toBe('tacticalPlacement');
    expect([f.screen.controls.overhead.placing, f.screen.worldHidden, f.screen.worldCovered]).toEqual([true, true, false]);
    await f.click('placement.spread');
    expect(f.screen.worldHidden).toBe(true);
    await f.click('placement.done');
    f.advance(1);
    expect(f.client.view.prompt ?? null).toBeNull();
    expect([f.screen.controls.overhead.open, f.screen.worldHidden]).toEqual([false, false]);
  });
});
