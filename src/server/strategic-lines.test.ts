import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { characterDialogue, tacticalCharacterDialogue } from '../sim/narrative/dialogue-queue.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { EventKind } from '../sim/strategic/time/constants.ts';
import { addStrategicEvent } from '../sim/strategic/time/event-queue.ts';
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
const DRASSEN_MINE = 1;
const DRASSEN_SECTORS = ['B13', 'C13', 'D13'];
const FRED_RUNNING_OUT = 17;
const FRED_CREATURES_GONE = 27;
const TEN_MINUTES_OF_TICKS = 200 * 600;

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
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
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

describe("the locator of a merc's line without a soldier (Map_Screen_Interface.cc TurnOnSectorLocator)", () => {
  it("marks the sector of a merc's profile for his line without a soldier", async () => {
    const c = await onTheMap(127);
    const talk = c.session.campaign.talk;
    const away = c.session.campaign.state.profiles.get(VANT + 2);
    if (!talk || !away) throw new Error('no talk flow or no profile away from the team');
    Object.assign(away, { sectorX: 13, sectorY: 2, sectorZ: 0 });
    characterDialogue(talk.host, VANT + 2, MercQuote.HEADSHOT, false, false);
    const line = c.live.advance({ events: ['mercQuote'] }).events.find((e) => e.type === 'mercQuote');
    expect(line).toMatchObject({ soldier: -1, profile: VANT + 2, sector: 'B13' });
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

describe("a head miner's line (Map_Screen_Interface.cc HandleMinerEvent, Strategic_Mines.cc IssueHeadMinerQuote)", () => {
  function playerRunsTheDrassenMine(c: Campaign): void {
    const state = c.session.campaign.state;
    for (const sector of DRASSEN_SECTORS) {
      const element = state.map.elements[strategicIndex(parseSectorString(sector))];
      if (element) element.enemyControlled = false;
      Object.assign(sectorInfo(state.map, parseSectorString(sector)), { numAdmins: 0, numTroops: 0, numElites: 0 });
    }
    Object.assign(state.economy.towns[DRASSEN_TOWN] ?? {}, { started: true, rating: LOYAL });
    Object.assign(state.economy.mines[DRASSEN_MINE] ?? {}, { spokeToHeadMiner: true });
  }

  function minerLines(events: readonly SimEvent[]): number[] {
    return events.flatMap((e) => (e.type === 'headMinerQuote' ? [e.quote] : []));
  }

  it('leaves tactical for the map screen once the step that queued the running-out line is done, and says it there', async () => {
    const c = await squadInA9(131);
    playerRunsTheDrassenMine(c);
    const state = c.session.campaign.state;
    Object.assign(state.economy.mines[DRASSEN_MINE] ?? {}, { remainingOreSupply: 13000, oreRunningOutPoint: 12999 });
    addStrategicEvent(state.queue, EventKind.HANDLE_MINE_INCOME, worldTotalMinutes(state.clock) + 1, 0);
    expect(c.session.campaign.state.flow).toBe('tactical');
    const warned = c.live.advance({ events: ['mineRunningOut'], ticks: TEN_MINUTES_OF_TICKS });
    expect(warned.reason).toBe('event');
    expect(minerLines(warned.events)).toEqual([]);
    expect(c.session.campaign.state.flow).toBe('strategic');
    const said = c.live.advance({ events: ['headMinerQuote'], ticks: TEN_MINUTES_OF_TICKS });
    expect(minerLines(said.events)).toEqual([FRED_RUNNING_OUT]);
    expect(said.events.find((e) => e.type === 'headMinerQuote')).toMatchObject({ panel: { mine: DRASSEN_MINE } });
    expect(c.session.campaign.state.flow).toBe('strategic');
  });

  it('keeps the player in tactical for the creatures-gone line: he is in that mine, so he knows', async () => {
    const c = await squadInA9(133);
    playerRunsTheDrassenMine(c);
    const state = c.session.campaign.state;
    Object.assign(state.economy.mines[DRASSEN_MINE] ?? {}, { shutDown: true, shutDownIsPermanent: false });
    addStrategicEvent(state.queue, EventKind.CHECK_IF_MINE_CLEARED, worldTotalMinutes(state.clock) + 1, 0);
    const reopened = c.live.advance({ events: ['mineReopened'], ticks: TEN_MINUTES_OF_TICKS });
    expect(reopened.reason).toBe('event');
    expect(c.session.campaign.state.flow).toBe('tactical');
    const said = c.live.advance({ events: ['headMinerQuote'], ticks: TEN_MINUTES_OF_TICKS });
    expect(minerLines(said.events)).toEqual([FRED_CREATURES_GONE]);
    expect(c.session.campaign.state.flow).toBe('tactical');
  });
});

describe('a squad too tired to go on (Strategic_Movement.cc PlayerGroupArrivedSafelyInSector, Assignments.cc AnyMercInGroupCantContinueMoving)', () => {
  const NEED_SLEEP = 25;
  const ME_TOO = 73;
  const TOO_TIRED_TO_MOVE = 29;
  const ROUTE = ['A10', 'A11'];

  function quietRoute(c: Campaign): void {
    for (const sector of ROUTE)
      Object.assign(sectorInfo(c.session.campaign.state.map, parseSectorString(sector)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  }

  function tire(c: Campaign, profile: number): void {
    const merc = c.session.campaign.battle?.roster.byProfile(profile);
    if (!merc) throw new Error(`no merc with profile ${profile}`);
    Object.assign(merc, { breathMax: TOO_TIRED_TO_MOVE, complainedThatTired: true });
  }

  function squadGroup(c: Campaign) {
    const id = ours(c, KESTREL).id;
    const g = c.session.campaign.state.forces.groups.find((x) => x.player && x.members.includes(id));
    if (!g) throw new Error('no squad group');
    return g;
  }

  it('refuses a move while a merc of the squad is too tired for it, naming him', async () => {
    const c = await onTheMap(135);
    tire(c, VANT);
    const route = c.live.dispatch({ type: 'route', soldier: ours(c, KESTREL).id, to: 'A11' });
    expect(route).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: ours(c, VANT).id } });
  });

  it('stops at the next sector, where the first says he needs sleep and the next me too, both asleep beyond waking', async () => {
    const c = await onTheMap(137);
    quietRoute(c);
    expect(c.live.dispatch({ type: 'route', soldier: ours(c, KESTREL).id, to: 'A11' })).toMatchObject({ ok: true });
    tire(c, KESTREL);
    tire(c, VANT);
    const stopped = c.live.advance({ compressionStopped: true, mode: 3 });
    expect(stopped.events).toContainEqual(expect.objectContaining({ type: 'compressionStopped', reason: 'halted' }));
    expect(squadGroup(c)).toMatchObject({ sector: parseSectorString('A10'), betweenSectors: false, waypoints: [] });
    const said = [...stopped.events, ...c.live.advance({ idle: true }).events];
    expect(lines(said)).toEqual([`${KESTREL}:${NEED_SLEEP}`, `${VANT}:${ME_TOO}`]);
    const ids = [ours(c, KESTREL).id, ours(c, VANT).id];
    expect(said.filter((e) => e.type === 'fellAsleep')).toEqual(
      ids.map((soldier) => expect.objectContaining({ soldier, collapsed: true })),
    );
    const map = c.session.view().strategic;
    expect(map?.mercs.filter((m) => ids.includes(m.id)).map((m) => [m.asleep, m.collapsed])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(map?.groups.find((g) => g.members.includes(ids[0] ?? -1))?.path).toEqual([]);
    const onwards = c.live.dispatch({ type: 'route', soldier: ids[0], to: 'A11' });
    expect(onwards).toMatchObject({ ok: false, data: { refusal: 'tooTired', soldier: ids[0] } });
    expect(c.live.dispatch({ type: 'wake', soldier: ids[1] })).toMatchObject({ ok: false, data: { refusal: 'collapsed' } });
  });
});
