import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { deleteTalkingMenu } from '../sim/narrative/converse.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
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
const NPC = 94;
const NPC_ID = TEAM_FIRST_ID[Team.CIV];
const MALE = 0;
const TILES_AHEAD = 3;
const QUOTE_TICKS = 3000;

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
  const live = new ReloadingSession('merc lines', session);
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

function withRolls(t: TacticalState, rolls: readonly number[], run: () => void): number[] {
  const rng = t.rng as unknown as { int(n: number): number };
  const queued = [...rolls];
  const draws: number[] = [];
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    draws.push(n);
    const v = queued.shift();
    return v === undefined ? real(n) : v;
  };
  try {
    run();
  } finally {
    delete (rng as { int?: unknown }).int;
  }
  expect(queued).toEqual([]);
  return draws;
}

function quotesSaid(events: readonly SimEvent[], ids: readonly number[]): [number, number][] {
  return events.flatMap((e) => (e.type === 'mercQuote' && ids.includes(e.id) ? [[e.profile, e.id] as [number, number]] : []));
}

describe('the comment a conversation left to say, in a campaign (Interface_Dialogue.cc DeleteTalkingMenu)', () => {
  it('has a merc near the NPC say the likable-person line through the dialogue queue when the talk panel closes', async () => {
    const c = await squadInA9(81);
    const sim = loadedSector(c);
    const t = sim.state;
    const kestrel = ours(t, KESTREL);
    const npc = spawnSoldier(sim, NPC_ID, Team.CIV, kestrel.gridNo + TILES_AHEAD, kestrel.direction, { profile: NPC });
    const campaign = c.session.campaign;
    const talk = campaign.talk;
    if (!talk) throw new Error('the campaign has no talk flow');
    const profile = campaign.state.profiles.get(NPC);
    if (!profile) throw new Error(`no profile ${NPC}`);
    campaign.state.profiles.set(NPC, { ...profile, sex: MALE });
    campaign.narrative.setFactTrue(Fact.NEED_TO_SAY_SOMETHING);
    Object.assign(talk.host.talk, { inPanel: true, charNum: NPC, niceNpc: NPC });
    talk.host.context.dest = npc.id;
    const draws = withRolls(t, [0], () => deleteTalkingMenu(talk.host, 'player'));
    expect(draws).toEqual([2]);
    expect(campaign.narrative.checkFact(Fact.NEED_TO_SAY_SOMETHING, 0)).toBe(false);
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.LISTEN_LIKABLE_PERSON])).toEqual([[KESTREL, MercQuote.LISTEN_LIKABLE_PERSON]]);
  });
});
