import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import { MoraleEvent } from './morale.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const VERY_SEXIST = 2;
const FEMALE = 1;
const NORMAL_ATTITUDE = 0;
const SECTOR = { x: 9, y: 1, z: 0 };

describe('the morale of a marriage (Morale.cc:565-602)', () => {
  it("reads how sexist a merc is from her profile, through the campaign's morale context", async () => {
    const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { mercs: 2, land: 'skip' });
    const battle = session.campaign.battle;
    if (!battle) throw new Error('no battle flow');
    const [groom, colleague] = battle.roster.all() as [RosterMerc, RosterMerc];
    const record = battle.content.profiles[colleague.profile];
    const progress = battle.profileOf(colleague.profile);
    if (!record || !progress) throw new Error('no profile');
    Object.assign(progress, { sex: FEMALE, attitude: NORMAL_ATTITUDE, hated: [] });
    const sexist = record.sexist;
    Object.assign(record, { sexist: VERY_SEXIST });
    battle.moraleEvent(groom, MoraleEvent.MERC_MARRIED, SECTOR);
    Object.assign(record, { sexist });
    expect(colleague.soldier.strategicMoraleMod).toBe(-10);
  });
});
