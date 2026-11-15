import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { Rng } from '../core/rng.ts';
import type { SimEvent } from '../sim/events.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const DESTINATION = 'A10';
const ROUTE_BUDGET = 20;
const ROUTE_SLICE_SECONDS = 600;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

async function landedCampaign(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const name of ['A9', DESTINATION])
    Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return { session, live: new ReloadingSession('arrival-line', session) };
}

function squadMembers(c: Campaign): readonly number[] {
  const squad = c.session.campaign.state.forces.groups.find((g) => g.player);
  if (!squad) throw new Error('no squad');
  return [...squad.members];
}

function routeSquad(c: Campaign): SimEvent[] {
  const [first] = squadMembers(c);
  expect(c.session.dispatch({ type: 'route', soldier: first, to: DESTINATION })).toMatchObject({ ok: true });
  const events: SimEvent[] = [];
  const there = () => c.session.view().strategic?.mercs.every((m) => m.sector === DESTINATION && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !there(); k++) events.push(...c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS }).events);
  expect(there()).toBe(true);
  events.push(...c.live.advance({ idle: true }).events);
  return events;
}

describe("a squad's arrival line (Strategic_Movement.cc HandleNonCombatGroupArrival, Map_Screen_Interface.cc RandomMercInGroupSaysQuote)", () => {
  it('has the merc the movement cosmetic stream draws say the reached-destination line through the dialogue queue as the squad ends its route', async () => {
    const c = await landedCampaign(41);
    const members = squadMembers(c);
    const speaker = members[Rng.fromState(c.session.campaign.state.cosmetic.movement.state()).int(members.length)];
    const events = routeSquad(c);
    const lines = events.flatMap((e) => (e.type === 'mercQuote' && e.id === MercQuote.MERC_REACHED_DESTINATION ? [e.soldier] : []));
    expect(lines).toEqual([speaker]);
    const arrival = events.findIndex((e) => e.type === 'groupArrived' && e.final);
    const line = events.findIndex((e) => e.type === 'mercQuote' && e.id === MercQuote.MERC_REACHED_DESTINATION);
    expect(arrival).toBeGreaterThanOrEqual(0);
    expect(line).toBeGreaterThan(arrival);
  });
});
