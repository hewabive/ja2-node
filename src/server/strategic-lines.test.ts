import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { tacticalCharacterDialogue } from '../sim/narrative/dialogue-queue.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';
import type { Soldier } from '../sim/tactical/soldier.ts';
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
const CONTRACTS_OVER = 89;
const MERC_GONE_UP_IN_PRICE = 116;
const WHINE_EQUIPMENT = 43;
const MENTION_DRASSEN_SAM_SITE = 20;
const SECOND_HALF_OF_MENTION_DRASSEN_SAM_SITE = 21;
const DRASSEN_SAM = 'D15';
const DRASSEN_TOWN = 2;
const LOYAL = 50;

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
  const live = new ReloadingSession('strategic lines', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

async function onTheMap(seed: number): Promise<Campaign> {
  const c = await squadInA9(seed);
  expect(c.session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
  return c;
}

function ours(c: Campaign, profile: number): Soldier {
  const s = c.session.campaign.battle?.roster.byProfile(profile)?.soldier;
  if (!s) throw new Error(`no merc with profile ${profile}`);
  return s;
}

function lines(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === 'mercQuote') return [`${e.profile}:${e.id}`];
    if (e.type === 'skyriderQuote') return [`skyrider:${e.quote}`];
    return [];
  });
}

describe('the contract renewal sequence behind its lines (Merc_Contract.cc HandleContractRenewalSequence, DialogueEventContract)', () => {
  it('opens the contract menu only after the merc said his contract is over and that his price went up', async () => {
    const c = await onTheMap(121);
    const campaign = c.session.campaign;
    const kestrel = campaign.battle?.roster.byProfile(KESTREL);
    const contracts = campaign.contracts;
    if (!kestrel || !contracts) throw new Error('no contract to renew');
    kestrel.contract.contractEnd = worldTotalMinutes(campaign.state.clock);
    kestrel.contract.contractPriceIncreased = true;
    campaign.state.contracts.renewal.list.push(KESTREL);
    contracts.beginRenewalSequence();
    const first = c.live.advance({ events: ['mercQuote'] });
    expect(lines(first.events)).toEqual([`${KESTREL}:${CONTRACTS_OVER}`]);
    expect(c.session.view().contractPrompt ?? null).toBeNull();
    const menu = c.live.advance({ idle: true });
    expect(menu.reason).toBe('decision');
    expect(lines(menu.events)).toEqual([`${KESTREL}:${MERC_GONE_UP_IN_PRICE}`]);
    expect(c.session.view().contractPrompt).toMatchObject({ kind: 'contractRenewal', soldier: ours(c, KESTREL).id, fromSequence: true });
  });
});

describe("Skyrider's monologue (Map_Screen_Helicopter.cc SkyriderDialogueWithSpecialEvent)", () => {
  it('queues his lines and reveals the Drassen SAM site only when the queue reaches its special event after the first line', async () => {
    const c = await onTheMap(123);
    const campaign = c.session.campaign;
    const ctx = campaign.strategic;
    if (!ctx) throw new Error('no strategic layer');
    const skyrider = kit.content.profiles[SKYRIDER];
    if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
    Object.assign(campaign.state.economy.towns[DRASSEN_TOWN] ?? {}, { started: true, rating: LOYAL });
    setUpHelicopterForPlayer(ctx, parseSectorString('B13'));
    const map = () => c.session.view().strategic;
    const queued = () => (c.session.campaign.talk?.talk.queue ?? []).map((e) => (e.kind === 'quote' ? `quote ${e.quote}` : e.kind));
    expect(c.live.advance({ events: ['skyriderMonologue'] }).reason).toBe('event');
    const secondHalf = `quote ${SECOND_HALF_OF_MENTION_DRASSEN_SAM_SITE}`;
    expect(queued()).toEqual([`quote ${MENTION_DRASSEN_SAM_SITE}`, 'callback', secondHalf, 'callback']);
    expect(map()?.secretsFound).not.toContain(DRASSEN_SAM);
    const revealed = c.live.advance({ events: ['samSitesRevealed'] });
    expect(revealed.reason).toBe('event');
    expect(queued()).toEqual([secondHalf, 'callback']);
    expect(map()?.secretsFound).toContain(DRASSEN_SAM);
  });
});

describe('a bark at an own merc (Handle_UI.cc HandleTalkInit, TacticalCharacterDialogue)', () => {
  it('passes the speaker checks of the dialogue queue: a gassed merc says nothing', async () => {
    const c = await squadInA9(125);
    ours(c, VANT).gassed = true;
    const bark = c.session.dispatch({ type: 'talk', soldier: ours(c, KESTREL).id, target: ours(c, VANT).id });
    expect(bark).toMatchObject({ ok: true });
    expect(lines(c.live.advance({ ticks: 10 }).events)).toEqual([]);
  });
});

describe('time compression while someone has something to say (Map_Screen_Interface_Bottom.cc AllowedToTimeCompress)', () => {
  it('refuses to start while lines wait in the queue, even in a pause the line did not lock', async () => {
    const c = await onTheMap(127);
    Object.assign(c.session.campaign.state.clock, { paused: true, playerPause: true });
    const talk = c.session.campaign.talk;
    if (!talk) throw new Error('the campaign has no talk flow');
    for (const quote of [MercQuote.HEADSHOT, MercQuote.KILLED_AN_ENEMY]) tacticalCharacterDialogue(talk.host, ours(c, KESTREL), quote);
    c.live.advance({ events: ['mercQuote'] });
    expect(c.session.campaign.state.clock).toMatchObject({ paused: true, pauseLocked: false });
    expect(c.session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: false, data: { refusal: 'dialogueQueued' } });
    c.live.advance({ idle: true });
    expect(c.session.campaign.talk?.talk.queue).toEqual([]);
    expect(c.session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: true });
  });
});

describe('a contract line on the map screen (Strategic_Merc_Handler.cc MercDailyUpdate, TacticalCharacterDialogue)', () => {
  it('waits its turn behind a line already playing, with the world clock standing until both ended', async () => {
    const c = await onTheMap(129);
    const campaign = c.session.campaign;
    const vant = campaign.battle?.roster.byProfile(VANT);
    if (!campaign.talk || !campaign.contracts || !vant) throw new Error('no talk or contract flow');
    const before = campaign.state.clock.seconds;
    tacticalCharacterDialogue(campaign.talk.host, ours(c, KESTREL), MercQuote.HEADSHOT);
    campaign.contracts.say(vant, 'WHINE_EQUIPMENT');
    const report = c.live.advance({ idle: true });
    expect(lines(report.events)).toEqual([`${KESTREL}:${MercQuote.HEADSHOT}`, `${VANT}:${WHINE_EQUIPMENT}`]);
    const [first, second] = report.events.filter((e) => e.type === 'mercQuote').map((e) => e.tick);
    expect(second).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY);
    expect(c.session.campaign.state.clock.seconds).toBe(before);
  });
});
