import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, ourGroupAtPreBattleInB9 } from '../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../tests/support/sectors.ts';
import { InsertionCode } from '../sim/strategic/forces/constants.ts';
import { edgepointList } from '../sim/tactical/edgepoints.ts';
import { CampaignSession } from './campaign-session.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

function placingSession(): CampaignSession {
  const { campaign: c, roster } = ourGroupAtPreBattleInB9(kit, 'plain');
  const session = new CampaignSession(c, kit.sectors.timelines.presentation, roster);
  const pbi = c.state.battle.prompt;
  expect(session.dispatch({ type: 'answer', prompt: pbi?.id, choice: 'enterSector' })).toMatchObject({ ok: true });
  return session;
}

describe('the placement prompt in the view', () => {
  it("names the mercs with their sides, groups and pieces, the button, the edge points of their sides by gridNo and whether Done is open (the overhead map's placement panel)", () => {
    const session = placingSession();
    const view = session.view();
    const prompt = view.prompt;
    expect(prompt).toMatchObject({ kind: 'tacticalPlacement', sector: 'B9', button: 'clear', everyonePlaced: false });
    if (prompt?.kind !== 'tacticalPlacement') return;
    expect(prompt.choices).toEqual(['place', 'spread', 'group', 'clear', 'done']);
    expect(prompt.mercs).toEqual([0, 1, 2, 3].map((soldier) => ({ soldier, side: 'north', group: prompt.mercs[0]?.group, placed: false })));
    const t = session.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    expect(Object.keys(prompt.edgepoints)).toEqual(['north']);
    expect(prompt.edgepoints.north).toEqual(edgepointList(t, InsertionCode.NORTH, true));
    expect(session.dispatch({ type: 'answer', prompt: prompt.id, choice: 'spread' })).toEqual({ ok: true });
    const spread = session.view().prompt;
    if (spread?.kind !== 'tacticalPlacement') throw new Error('the prompt closed');
    expect(spread).toMatchObject({ button: 'spread', everyonePlaced: true });
    const shown = new Map(session.view().soldiers.map((s) => [s.id, s.gridNo]));
    expect(spread.mercs.map((m) => m.gridNo)).toEqual(spread.mercs.map((m) => shown.get(m.soldier)));
  });
});
