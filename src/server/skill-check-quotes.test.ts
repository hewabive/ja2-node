import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { campaignCombatContext } from '../sim/campaign/off-map-combat.ts';
import { SkillCheckReason, skillCheck } from '../sim/tactical/combat/skill-check.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { createCampaignSession } from './campaign-factory.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const WISE = 90;
const FAILING_ROLL = 50;
const ATTEMPTS_TO_GIVE_UP = 3;

describe('the can’t-do line of a skill check on the map screen (SkillCheck.cc SkillCheck)', () => {
  it('reaches the dialogue queue with no sector loaded, through the campaign narrative of the off-map context', async () => {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { profiles: [KESTREL], land: false });
    const c = session.campaign;
    expect(c.tactical).toBeNull();
    const merc = c.battle?.roster.all()[0]?.soldier;
    if (!merc) throw new Error('no merc hired');
    merc.stats.wisdom = WISE;
    const context = campaignCombatContext(() => c, c.state, kit.content)();
    const pre = { int: () => FAILING_ROLL };
    for (let k = 0; k < ATTEMPTS_TO_GIVE_UP; k++) skillCheck({ ...context, pre }, merc, SkillCheckReason.LOCKPICKING, 0);
    expect(c.talk?.host.talk.queue).toContainEqual(
      expect.objectContaining({ kind: 'quote', speaker: KESTREL, quote: MercQuote.DEFINITE_CANT_DO }),
    );
  });
});
