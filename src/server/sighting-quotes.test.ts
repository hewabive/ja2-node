import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { MercQuote, QuoteSaidFlag } from '../sim/tactical/narrative/merc-quotes.ts';
import { SightFlags } from '../sim/tactical/perception/opp.ts';
import { handleSight } from '../sim/tactical/perception/sight.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const TILES_AHEAD = 3;
const QUOTE_TICKS = 3000;
const LINE_ROLL = 30;
const SECOND_ENEMY_OFFSET = 2;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function squadInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  const live = new ReloadingSession('sightings', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

function loadedSector(c: Campaign): TacticalSim {
  const sim = c.session.campaign.tactical;
  if (!sim) throw new Error('no sector is loaded');
  return sim;
}

function ours(t: TacticalState, profile: number): Soldier {
  const s = t.soldiers.find((m) => m?.placed && m.team === Team.OUR && m.profile === profile);
  if (!s) throw new Error(`no merc with profile ${profile}`);
  return s;
}

function withRolls(t: TacticalState, rolls: readonly number[], run: () => void): void {
  const rng = t.rng as unknown as { int(n: number): number };
  const queued = [...rolls];
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    const v = queued.shift();
    return v === undefined ? real(n) : v;
  };
  try {
    run();
  } finally {
    delete (rng as { int?: unknown }).int;
  }
  expect(queued).toEqual([]);
}

function quotesSaid(events: readonly SimEvent[]): [number, number][] {
  const sighting = [MercQuote.SEE_ENEMY, MercQuote.SEE_ENEMY_VARIATION] as readonly number[];
  return events.flatMap((e) => (e.type === 'mercQuote' && sighting.includes(e.id) ? [[e.profile, e.id] as [number, number]] : []));
}

describe('sighting quotes in a campaign (OppList.cc OurTeamSeesSomeone, SaySeenQuote)', () => {
  it('says the first sighting line through the dialogue queue, ends the virgin sector and rolls for the next sighting', async () => {
    const c = await squadInA9(81);
    const sim = loadedSector(c);
    const t = sim.state;
    expect(t.turn.virginSector).toBe(true);
    const kestrel = ours(t, KESTREL);
    const record = () => c.session.campaign.battle?.roster.get(ours(loadedSector(c).state, KESTREL).id);
    const said = record();
    if (said) said.quoteSaidFlags |= QuoteSaidFlag.IN_SHIT;
    const first = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, kestrel.gridNo + TILES_AHEAD, kestrel.direction);
    handleSight(t, kestrel, SightFlags.LOOK | SightFlags.RADIO);
    expect([t.inCombat, t.turn.virginSector]).toEqual([true, false]);
    expect((record()?.quoteSaidFlags ?? 0) & QuoteSaidFlag.IN_SHIT).toBe(0);
    expect(quotesSaid(c.live.advance({ ticks: QUOTE_TICKS }).events)).toEqual([[KESTREL, MercQuote.SEE_ENEMY_VARIATION]]);
    const later = loadedSector(c);
    expect(later.state.turn.virginSector).toBe(false);
    const spotter = ours(later.state, KESTREL);
    spawnSoldier(later, ENEMY_ID + 1, Team.ENEMY, first.gridNo + SECOND_ENEMY_OFFSET, spotter.direction);
    withRolls(later.state, [LINE_ROLL], () => handleSight(later.state, spotter, SightFlags.LOOK | SightFlags.RADIO));
    expect(quotesSaid(c.live.advance({ ticks: QUOTE_TICKS }).events)).toEqual([[KESTREL, MercQuote.SEE_ENEMY]]);
  });
});
