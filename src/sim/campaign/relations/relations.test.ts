import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { type ContractCampaign, type ContractHire, createContractCampaign } from '../../../../tests/support/contracts.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { handleMoraleEvent, MoraleEvent } from '../morale.ts';
import { canMercBeHired } from './hiring-check.ts';
import { BuddySlot, getFirstBuddyOnTeam, HatedSlot, whichBuddy, whichHated } from './relations.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const STUB = { kestrel: 0, vant: 1, moraga: 2, hollis: 3, tarrow: 4 } as const;

function landed(hires: readonly ContractHire[]): ContractCampaign {
  const cc = createContractCampaign(kit, { seed: 9, hires });
  landFirstSquad(cc.campaign);
  for (let i = 0; i < 20_000 && !cc.campaign.isIdle(); i++) cc.campaign.step();
  cc.campaign.drainEvents();
  return cc;
}

function profile(cc: ContractCampaign, id: number) {
  const p = cc.flow.profile(id);
  if (!p) throw new Error(`no profile ${id}`);
  return p;
}

describe('relation slots', () => {
  it('finds buddies and hated mercs in the three slots, the learned one last', () => {
    const cc = landed([{ profile: STUB.vant }]);
    const p = profile(cc, STUB.vant);
    p.buddies[2] = STUB.tarrow;
    p.hated[2] = STUB.moraga;
    expect(whichBuddy(p, STUB.kestrel)).toBe(BuddySlot.SLOT1);
    expect(whichBuddy(p, STUB.tarrow)).toBe(BuddySlot.LEARNED_TO_LIKE);
    expect(whichHated(p, STUB.moraga)).toBe(HatedSlot.LEARNED_TO_HATE);
    expect(whichHated(p, STUB.kestrel)).toBe(HatedSlot.NOT_FOUND);
  });

  it('counts a buddy on the team even in transit, but not a dead one', () => {
    const cc = landed([{ profile: STUB.vant }, { profile: STUB.kestrel }]);
    const team = { team: cc.roster.all(), profiles: cc.campaign.state.profiles };
    const vant = profile(cc, STUB.vant);
    const kestrel = cc.roster.get(1);
    if (kestrel) kestrel.assignment = Assignment.IN_TRANSIT;
    expect(getFirstBuddyOnTeam(team, vant)).toBe(BuddySlot.SLOT1);
    profile(cc, STUB.kestrel).mercStatus = MercStatus.IS_DEAD;
    expect(getFirstBuddyOnTeam(team, vant)).toBe(BuddySlot.NOT_FOUND);
  });
});

describe('hiring refusals', () => {
  it('refuses during a hangover even with a buddy on the team', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const team = { team: cc.roster.all(), profiles: cc.campaign.state.profiles };
    const vant = profile(cc, STUB.vant);
    expect(canMercBeHired(team, cc.campaign.state.status, vant)).toEqual({ accepted: true, quote: null });
    vant.daysOfMoraleHangover = 2;
    expect(canMercBeHired(team, cc.campaign.state.status, vant)).toMatchObject({
      accepted: false,
      refusal: 'hangover',
      quote: 'LAME_REFUSAL',
    });
  });

  it('joins a hated merc for a buddy, grumbles at a long tolerance and refuses a short one', () => {
    const cc = landed([{ profile: STUB.hollis }, { profile: STUB.kestrel }]);
    const team = { team: cc.roster.all(), profiles: cc.campaign.state.profiles };
    const status = cc.campaign.state.status;
    const moraga = profile(cc, STUB.moraga);
    expect(canMercBeHired(team, status, moraga)).toMatchObject({ accepted: false, refusal: 'hatesTeammate', hated: STUB.hollis });
    moraga.hatedTime[0] = 24;
    expect(canMercBeHired(team, status, moraga)).toEqual({ accepted: true, quote: 'PERSONALITY_BIAS_WITH_MERC_1' });
    moraga.hatedTime[0] = 6;
    moraga.buddies[1] = STUB.kestrel;
    expect(canMercBeHired(team, status, moraga)).toEqual({ accepted: true, quote: 'JOINING_CAUSE_BUDDY_2_ON_TEAM' });
  });

  it('lets a buddy outweigh the death rate and the reputation', () => {
    const cc = landed([{ profile: STUB.kestrel }]);
    const team = { team: cc.roster.all(), profiles: cc.campaign.state.profiles };
    const status = cc.campaign.state.status;
    status.mercDeaths = 2;
    status.manDaysPlayed = 4;
    const vant = profile(cc, STUB.vant);
    expect(canMercBeHired(team, status, vant)).toEqual({ accepted: true, quote: null });
    vant.buddies[0] = -1;
    expect(canMercBeHired(team, status, vant)).toMatchObject({ accepted: false, refusal: 'deathRate' });
    status.mercDeaths = 0;
    status.badReputation = 80;
    expect(canMercBeHired(team, status, vant)).toMatchObject({ accepted: false, refusal: 'reputation' });
  });
});

describe('reputation from morale events', () => {
  it('changes once per event, whoever is affected, and by the level of a dead teammate', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }]);
    const ctx = cc.flow.moraleContext();
    const status = cc.campaign.state.status;
    const a9 = { x: 9, y: 1, z: 0 };
    handleMoraleEvent(ctx, null, MoraleEvent.HEARD_BATTLE_LOST, a9);
    expect(status.badReputation).toBe(2);
    handleMoraleEvent(ctx, null, MoraleEvent.TOWN_LIBERATED, a9);
    expect(status.badReputation).toBe(0);
    const dead = cc.roster.get(0);
    if (!dead) throw new Error('no merc');
    handleMoraleEvent(ctx, dead, MoraleEvent.TEAMMATE_DIED, a9);
    expect(status.badReputation).toBe(2 * dead.soldier.stats.experience);
  });

  it('whines once below 35 morale per event and forgets it above 65', () => {
    const cc = landed([{ profile: STUB.kestrel }, { profile: STUB.vant }]);
    for (const m of cc.roster.all()) m.soldier.strategicMoraleMod = -40;
    handleMoraleEvent(cc.flow.moraleContext(), null, MoraleEvent.TOWN_LOST, { x: 9, y: 1, z: 0 });
    const whines = cc.flow.drainEvents().filter((e) => e.type === 'mercQuote' && e.quote === 'startingToWhine');
    expect(whines).toHaveLength(1);
    expect(cc.roster.all().map((m) => (m.quoteSaidFlags & 0x10) !== 0)).toEqual([true, false]);
    for (const m of cc.roster.all()) m.soldier.strategicMoraleMod = 40;
    handleMoraleEvent(cc.flow.moraleContext(), null, MoraleEvent.TOWN_LIBERATED, { x: 9, y: 1, z: 0 });
    expect(cc.roster.all().map((m) => m.quoteSaidFlags & 0x10)).toEqual([0, 0]);
  });
});
