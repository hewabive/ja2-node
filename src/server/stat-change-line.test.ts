import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { StatAmt, StatCause } from '../sim/strategic/economy/constants.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { processUpdateStats } from '../sim/tactical/combat/experience.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { profileProgress } from '../sim/tactical/profiles.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const LINE_TICKS = 3000;
const LEVEL_SUBPOINTS = 350;
const HEALTH_SUBPOINTS = 50;
const TRAINABLE_HEALTH = 60;
const TRAINING_POINTS = 40;

describe("the stat line in a campaign (Campaign.cc ChangeStat's DisplayStatChange event)", () => {
  it('flashes a level at once and prints its message and the experience-gain quote through the dialogue queue', async () => {
    const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { profiles: [KESTREL], land: false });
    const session = drivenSession(created, stubSessionSources(kit));
    Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
    const land = { type: 'compressTime', mode: 2 };
    await session.prepare(land);
    expect(session.dispatch(land).ok).toBe(true);
    expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
    const live = new ReloadingSession('stat line', session);
    live.advance({ idle: true });
    const t = session.campaign.tactical?.state;
    const merc = t?.soldiers.find((s) => s?.placed && s.team === Team.OUR && s.profile === KESTREL);
    const p = t && merc ? profileProgress(t, merc.profile) : null;
    if (!t || !merc || !p) throw new Error('Kestrel is not on the loaded map');
    p.gains.experience = LEVEL_SUBPOINTS * p.stats.experience;
    processUpdateStats(t, merc);
    const report = live.advance({ ticks: LINE_TICKS });
    const told = report.events.flatMap((e): string[] => {
      if (e.type === 'statChanged' || e.type === 'statChangeAnnounced') return [`${e.type} ${e.stat}${'queued' in e ? ' queued' : ''}`];
      return e.type === 'mercQuote' && e.id === MercQuote.EXPERIENCE_GAIN ? [`quote of ${e.profile}`] : [];
    });
    expect(told).toEqual(['statChanged experience queued', 'statChangeAnnounced experience', `quote of ${KESTREL}`]);
    const statGains = report.messages.filter((m) => JSON.stringify(m.args ?? []).includes('sStatGainStrings'));
    expect(statGains).toHaveLength(1);
  });

  it("flashes and prints a stat a merc gains training off the loaded map, as on it (TrainSoldierWithPts' StatChange, Assignments.cc:2616)", async () => {
    const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { profiles: [KESTREL], land: false });
    const session = drivenSession(created, stubSessionSources(kit));
    const live = new ReloadingSession('stat off the map', session);
    expect(session.campaign.tactical).toBeNull();
    const merc = session.campaign.battle?.roster.all().find((m) => m.soldier.profile === KESTREL);
    const p = session.campaign.state.profiles.get(KESTREL);
    const crew = session.campaign.economy?.crew;
    if (!merc || !p || !crew) throw new Error('Kestrel is not hired');
    p.stats.lifeMax = TRAINABLE_HEALTH;
    merc.soldier.lifeMax = TRAINABLE_HEALTH;
    p.gains.lifeMax = HEALTH_SUBPOINTS - 1;
    crew.statChange(merc.id, StatAmt.HEALTH, TRAINING_POINTS, StatCause.TRAINING);
    const report = live.advance({ ticks: 1 });
    expect(report.events.filter((e) => e.type === 'statChanged')).toEqual([
      expect.objectContaining({ type: 'statChanged', soldier: merc.id, stat: 'lifeMax', change: 1 }),
    ]);
    const statGains = report.messages.filter((m) => JSON.stringify(m.args ?? []).includes('sStatGainStrings'));
    expect(statGains).toHaveLength(1);
  });

  it('prints the level a merc gains off the loaded map once, through the dialogue queue before his line (ChangeStat)', async () => {
    const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), 7, { profiles: [KESTREL], land: false });
    const session = drivenSession(created, stubSessionSources(kit));
    const live = new ReloadingSession('level off the map', session);
    expect(session.campaign.tactical).toBeNull();
    const merc = session.campaign.battle?.roster.all().find((m) => m.soldier.profile === KESTREL);
    const p = session.campaign.state.profiles.get(KESTREL);
    const crew = session.campaign.economy?.crew;
    if (!merc || !p || !crew) throw new Error('Kestrel is not hired');
    p.gains.experience = LEVEL_SUBPOINTS * p.stats.experience;
    crew.statChange(merc.id, StatAmt.EXPERIENCE, 0, StatCause.SUCCESS);
    const report = live.advance({ ticks: LINE_TICKS });
    const told = report.events.flatMap((e): string[] => {
      if (e.type === 'statChanged' || e.type === 'statChangeAnnounced') return [`${e.type} ${e.stat}${'queued' in e ? ' queued' : ''}`];
      return e.type === 'mercQuote' && e.id === MercQuote.EXPERIENCE_GAIN ? [`quote of ${e.profile}`] : [];
    });
    expect(told).toEqual(['statChanged experience queued', 'statChangeAnnounced experience', `quote of ${KESTREL}`]);
    const statGains = report.messages.filter((m) => JSON.stringify(m.args ?? []).includes('sStatGainStrings'));
    expect(statGains).toHaveLength(1);
  });
});
