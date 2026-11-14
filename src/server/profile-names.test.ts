import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STUB_NPC } from '../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { diffPlayerView } from '../protocol/view.ts';
import { shownNickname } from '../sim/campaign/profile-names.ts';
import { createCampaignSession } from './campaign-factory.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const REVEALED = 'Revealed Name';

describe('the name a profile shows after NPC_ACTION_TERRORIST_REVEALS_SELF overwrote its nickname', () => {
  it('is the new nickname in the server texts, the agent views and the view map the browser renames its faces with', async () => {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 3, { land: false });
    const c = session.campaign;
    const content = c.battle?.content.profiles[STUB_NPC]?.nickname ?? null;
    expect(content).not.toBeNull();
    expect([shownNickname(c, STUB_NPC), session.messageFacts().profileName(STUB_NPC)]).toEqual([content, content]);
    const before = session.view();
    expect(before).not.toHaveProperty('nicknames');
    const progress = c.state.profiles.get(STUB_NPC);
    if (!progress) throw new Error('no progress of the stub NPC');
    progress.nickname = REVEALED;
    const after = session.view();
    expect([shownNickname(c, STUB_NPC), session.messageFacts().profileName(STUB_NPC)]).toEqual([REVEALED, REVEALED]);
    expect(after.nicknames).toEqual({ [STUB_NPC]: REVEALED });
    expect(diffPlayerView(before, after)?.nicknames).toEqual({ [STUB_NPC]: REVEALED });
  });
});
