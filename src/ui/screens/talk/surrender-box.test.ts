import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';
import { Team } from '../../../sim/tactical/soldier.ts';
import { teamMembers } from '../../../sim/tactical/state.ts';
import { civQuoteLifetime } from '../../speech.ts';

const OFFER_BUDGET = 30;
const SLICE_BUDGET_TICKS = 20_000;
const TWO_ROWS = 2 * 160;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function pressOn(campaign: CampaignSession): void {
  const t = campaign.campaign.tactical?.state;
  const merc = t ? teamMembers(t, Team.OUR).find((s) => s.life > 0 && s.placed) : undefined;
  const enemy = t ? teamMembers(t, Team.ENEMY).find((s) => s.life > 0 && s.placed) : undefined;
  if (!t || !merc || !enemy) throw new Error('no fight in the landing sector');
  if (t.inCombat && t.turn.currentTeam === Team.OUR) campaign.dispatch({ type: 'endTurn' });
  else if (!t.inCombat) campaign.dispatch({ type: 'move', soldier: merc.id, to: enemy.gridNo + TWO_ROWS, mode: 'run' });
}

async function offeredSurrender(seed: number): Promise<{ f: TacticalUiTest; campaign: CampaignSession }> {
  const campaign = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 1, land: false });
  const land = { type: 'compressTime', mode: 2 };
  await campaign.prepare(land);
  expect(campaign.dispatch(land).ok).toBe(true);
  const session = new Session('surrender', campaign);
  const f = await tacticalUiTest(kit, ui, seed, session);
  for (let k = 0; k < OFFER_BUDGET && !campaign.view().prompt; k++) {
    session.advance({ events: ['surrenderOffered'] }, SLICE_BUDGET_TICKS);
    if (!campaign.view().prompt) pressOn(campaign);
  }
  f.deliver();
  return { f, campaign };
}

describe('the enemy surrender offer on the tactical screen', () => {
  it('asks Surrender? once the offer’s quote box has closed and answers No with reject, so the battle goes on', async () => {
    const { f, campaign } = await offeredSurrender(3);
    const prompt = f.client.view.prompt;
    expect(prompt).toMatchObject({ kind: 'surrender', context: 'tactical' });
    const civ = f.screen.dialogue.presenter.civQuote;
    expect(civ).not.toBeNull();
    await f.settle();
    expect(f.find('surrenderBox')).toBeUndefined();
    f.t.frame(civQuoteLifetime(civ?.chars ?? 0) + 1);
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('surrenderBox');
    expect(f.widget('surrenderBox').text).toBe('Surrender?');
    await f.click('surrenderBox.no');
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'answer', prompt: prompt?.id, choice: 'reject' }, reply: { ok: true } });
    expect(f.client.view.prompt ?? null).toBeNull();
    expect(campaign.campaign.state.battle.prompt).toBeNull();
    expect(f.t.runtime.host.modal).toBeNull();
    expect(f.session.advance({ ticks: 50 }).reason).toBe('ticks');
  });

  it('answers Yes with accept', async () => {
    const { f } = await offeredSurrender(4);
    const prompt = f.client.view.prompt;
    f.t.frame(civQuoteLifetime(f.screen.dialogue.presenter.civQuote?.chars ?? 0) + 1);
    await f.settle();
    await f.click('surrenderBox.yes');
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'answer', prompt: prompt?.id, choice: 'accept' }, reply: { ok: true } });
  });
});
