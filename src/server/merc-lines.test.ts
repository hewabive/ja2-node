import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem } from '../sim/items/object.ts';
import { deleteTalkingMenu } from '../sim/narrative/converse.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { MercQuote, QuoteSaidFlag } from '../sim/tactical/narrative/merc-quotes.ts';
import { SightFlags } from '../sim/tactical/perception/opp.ts';
import { handleSight } from '../sim/tactical/perception/sight.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { addItemToPool, Visibility } from '../sim/tactical/world-items.ts';
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
const FOUND_SOMETHING_SPEAKER = 7;
const COOL_GUN = 'AK74';
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const NPC = 94;
const NPC_ID = TEAM_FIRST_ID[Team.CIV];
const MALE = 0;
const TILES_AHEAD = 3;
const QUOTE_TICKS = 3000;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function squadInA9(seed: number, profiles: readonly number[] = [KESTREL, VANT]): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles, land: false });
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

describe('the found-something-special line in a campaign (Handle_Items.cc SoldierGetItemFromWorld)', () => {
  it("is said through the dialogue queue and marked in the roster's quote flags", async () => {
    const c = await squadInA9(83, [FOUND_SOMETHING_SPEAKER]);
    const t = loadedSector(c).state;
    const merc = ours(t, FOUND_SOMETHING_SPEAKER);
    addItemToPool(
      t,
      merc.gridNo,
      createItem(t.content.items, t.content.items.byName.get(COOL_GUN)?.index ?? 0, 100),
      Visibility.VISIBLE,
      0,
    );
    const pickUp = { type: 'pickUp', soldier: merc.id };
    await c.session.prepare(pickUp);
    expect(c.session.dispatch(pickUp)).toMatchObject({ ok: true });
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.FOUND_SOMETHING_SPECIAL])).toEqual([[FOUND_SOMETHING_SPEAKER, MercQuote.FOUND_SOMETHING_SPECIAL]]);
    const record = c.session.campaign.battle?.roster.get(ours(loadedSector(c).state, FOUND_SOMETHING_SPEAKER).id);
    expect((record?.quoteSaidFlags ?? 0) & QuoteSaidFlag.FOUND_SOMETHING_NICE).toBe(QuoteSaidFlag.FOUND_SOMETHING_NICE);
  });
});

describe('the out-of-ammo line in a campaign (Overhead.cc InternalReduceAttackBusyCount)', () => {
  it('is said through the dialogue queue after the shot that emptied the gun', async () => {
    const c = await squadInA9(85);
    const sim = loadedSector(c);
    const kestrel = ours(sim.state, KESTREL);
    const enemy = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, kestrel.gridNo + TILES_AHEAD, kestrel.direction, { life: 100 });
    handleSight(sim.state, kestrel, SightFlags.LOOK | SightFlags.RADIO);
    expect(sim.state.inCombat).toBe(true);
    const gun = kestrel.inv[InvSlot.HAND];
    if (!gun) throw new Error('Kestrel has no gun');
    gun.gunShotsLeft = 1;
    const attack = { type: 'attack', soldier: kestrel.id, target: enemy.gridNo, aimTime: 0 };
    await c.session.prepare(attack);
    expect(c.session.dispatch(attack)).toMatchObject({ ok: true });
    const said = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(said, [MercQuote.OUT_OF_AMMO])).toEqual([[KESTREL, MercQuote.OUT_OF_AMMO]]);
  });
});
