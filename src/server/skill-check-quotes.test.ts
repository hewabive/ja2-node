import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { campaignCombatContext } from '../sim/campaign/off-map-combat.ts';
import { SkillCheckReason, skillCheck } from '../sim/tactical/combat/skill-check.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { unseenVictim } from '../sim/tactical/unseen-sources.ts';
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

describe('the curse of a failed skill check off the loaded map (SkillCheck.cc SkillCheck, Soldier_Control.cc DoMercBattleSound)', () => {
  it("reaches the map screen in the merc's voice, but for a silent check", async () => {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { profiles: [KESTREL], land: false });
    const c = session.campaign;
    expect([c.tactical, c.state.flow]).toEqual([null, 'strategic']);
    const merc = c.battle?.roster.all()[0]?.soldier;
    if (!merc) throw new Error('no merc hired');
    const context = { ...campaignCombatContext(() => c, c.state, kit.content)(), pre: { int: () => FAILING_ROLL } };
    c.drainEvents();
    const tick = c.tick;
    for (const reason of [SkillCheckReason.UNJAM_GUN, SkillCheckReason.NOTICE_DART, SkillCheckReason.LOCKPICKING])
      skillCheck(context, merc, reason, 0);
    expect(c.drainEvents().filter((e) => e.type === 'skillCheckFailed')).toEqual([
      { type: 'skillCheckFailed', soldier: merc.id, certain: true, mapScreen: true, cry: { ...unseenVictim(merc), team: Team.OUR }, tick },
    ]);
  });
});
