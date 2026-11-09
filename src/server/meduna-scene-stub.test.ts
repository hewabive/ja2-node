import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { QuoteFlag } from '../content/formats/npc.ts';
import { type Sector, sectorFromId, sectorFromStrategicIndex, sectorShortString, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { i8 } from '../core/int.ts';
import type { SimEvent } from '../sim/events.ts';
import { Meanwhile, Town } from '../sim/strategic/ai/constants.ts';
import { scheduleMeanwhileEvent } from '../sim/strategic/ai/meanwhile.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { type Soldier, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;
const exists = (path: string) => kit.worlds.exists(path);

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const A9: Sector = { x: 9, y: 1, z: 0 };
const SELECTED: Sector = { x: 5, y: 5, z: 0 };
const PALACE = 'P3';
const P3_M_MAP = 'stubs/world/maps/p3_m.dat';
const NO_GARRISON = { numAdmins: 0, numTroops: 0, numElites: 0 };
const SCENE_NPCS = [Npc.QUEEN, Npc.ELLIOT, Npc.JOE];
const ELLIOT_SHOT = 17;
const ELLIOT_BEFORE = 5;
const ELLIOT_POSTED = ELLIOT_BEFORE + 1;
const MEANWHILE_HIT_CHANCE = 100;
const ALL_MISSILE_SITES = 4;
const STALL_BUDGET = 3000;
const SCENE_STOPS = 20;
const SCENE_STOP_BUDGET = 3000;
const QUEEN_RECORDS_WITH_TWO_TOWNS = [0, 1, 2, 3, 4, 7, 11];
const QUEEN_RECORDS_BEFORE_THE_SITE_COUNT = [0, 1, 2, 3, 4];

function never(): never {
  throw new Error('missing');
}

function nowMinutes(session: CampaignSession): number {
  return Math.trunc(session.campaign.state.clock.seconds / 60);
}

interface Landed {
  readonly session: CampaignSession;
  readonly live: Session;
}

interface LandingOptions {
  readonly read?: ReadFile;
  readonly hall?: boolean;
}

async function landed(seed: number, mode?: RunMode, options: LandingOptions = {}): Promise<Landed> {
  const created = await createCampaignSession(options.read ?? kit.read, exists, seed, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode ?? null);
  Object.assign(sectorInfo(session.campaign.state.map, A9), NO_GARRISON);
  for (const cmd of [{ type: 'compressTime', mode: CompressMode.MIN5 }, { type: 'skipHelicopterDrop' }]) {
    await session.prepare(cmd);
    expect(session.dispatch(cmd).ok).toBe(true);
  }
  if (options.hall !== false) await session.worlds?.prepare([P3_M_MAP]);
  const live = new ReloadingSession('meduna', session);
  live.advance({ ticks: 1 });
  return { session, live };
}

function schedule(session: CampaignSession, id: number, minutesFromNow = 0): void {
  scheduleMeanwhileEvent(session.campaign.queen ?? never(), id, nowMinutes(session) + minutesFromNow);
}

const types = (events: readonly SimEvent[]) => events.map((e) => e.type);

function sceneEvents(events: readonly SimEvent[]): string[] {
  return types(events).filter((t) => t === 'meanwhileStarted' || t === 'meanwhileEnded');
}

function sectorsLoaded(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'sectorLoaded' ? [e.sector] : []));
}

function placedProfile(session: CampaignSession, profile: number): Soldier | null {
  return session.campaign.tactical?.state.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

function saidRecords(session: CampaignSession, profile: number): number[] {
  const records = session.campaign.talk?.host.records.arrays[profile] ?? [];
  return records.flatMap((r, index) => (((r?.flags ?? 0) & QuoteFlag.SAID) !== 0 ? [index] : []));
}

interface ProfileSpot {
  readonly sectorX: number;
  readonly sectorY: number;
  readonly gridNo: number;
}

function spotsOf(session: CampaignSession, npcs: readonly number[]): Map<number, ProfileSpot> {
  return new Map(
    npcs.map((npc) => {
      const p = session.campaign.narrative.profile(npc) ?? never();
      return [npc, { sectorX: p.sectorX, sectorY: p.sectorY, gridNo: p.gridNo }];
    }),
  );
}

function expectNpcsBack(session: CampaignSession, before: ReadonlyMap<number, ProfileSpot>): void {
  for (const [npc, spot] of before)
    expect(session.campaign.narrative.profile(npc)).toMatchObject({ ...spot, gridNo: i8(spot.gridNo), useProfileInsertion: false });
}

function untilStarted(live: Session): SimEvent[] {
  const begun = live.advance({ events: ['meanwhileStarted'] }, SCENE_STOP_BUDGET);
  expect(types(begun.events)).toContain('meanwhileStarted');
  return [...begun.events];
}

function untilEnded(live: Session, events: SimEvent[], each: () => void = () => {}): void {
  for (let k = 0; k < SCENE_STOPS && !types(events).includes('meanwhileEnded'); k++) {
    events.push(...live.advance({ events: ['conversationOpened'] }, SCENE_STOP_BUDGET).events);
    each();
  }
  expect(types(events)).toContain('meanwhileEnded');
}

function expectInTheHall(session: CampaignSession, scene: string): void {
  const view = session.view();
  expect([view.strategic?.flow, view.strategic?.worldSector, view.meanwhile]).toEqual(['meanwhile', PALACE, { seq: 1, scene }]);
  const shown = view.soldiers.map((s) => s.profile);
  for (const npc of SCENE_NPCS) expect(shown).toContain(npc);
  expect(session.campaign.tactical?.state.pathEnv.showAllMercs).toBe(true);
  expect(session.dispatch({ type: 'stopTime' })).toMatchObject({ ok: false, data: { refusal: 'inMeanwhile' } });
  const clock = session.campaign.state.clock;
  expect([clock.paused, clock.pauseLocked]).toEqual([true, true]);
}

async function outskirtsInTactical(mode?: RunMode): Promise<CampaignSession> {
  const { session, live } = await landed(81, mode);
  const elliot = session.campaign.narrative.profile(Npc.ELLIOT) ?? never();
  elliot.npcData = ELLIOT_BEFORE;
  const before = spotsOf(session, SCENE_NPCS);
  const tiles = teamMembers(session.campaign.tactical?.state ?? never(), Team.OUR).map((s) => s.gridNo);
  schedule(session, Meanwhile.OUTSKIRTS_MEDUNA);
  session.drainEvents();
  const events = untilStarted(live);
  expect(sectorsLoaded(events)).toEqual([PALACE]);
  const clock = session.campaign.state.clock;
  expect([clock.paused, clock.pauseLocked]).toEqual([false, false]);
  expect(session.campaign.narrative.profile(Npc.ELLIOT)?.npcData).toBe(ELLIOT_POSTED);
  expect(session.campaign.narrative.profile(Npc.JOE)).toMatchObject({ sectorX: 3, sectorY: 16 });
  events.push(...live.advance({ events: ['soldierHit'] }, SCENE_STOP_BUDGET).events);
  const aide = placedProfile(session, Npc.ELLIOT) ?? never();
  expect(events).toContainEqual(expect.objectContaining({ type: 'shotFired', chance: MEANWHILE_HIT_CHANCE, hit: true }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'soldierHit', soldier: aide.id, life: 1 }));
  expect([aide.life, session.campaign.narrative.profile(Npc.ELLIOT)?.npcData]).toEqual([1, ELLIOT_SHOT]);
  expectInTheHall(session, 'outskirtsMeduna');
  const seconds = session.campaign.state.clock.seconds;
  untilEnded(live, events, () => {
    if (session.campaign.state.meanwhile.inScene) expect(session.campaign.state.clock.seconds).toBe(seconds);
  });
  const c = session.campaign;
  expect(sectorsLoaded(events)).toEqual([PALACE, sectorShortString(A9)]);
  expect([c.state.flow, c.state.worldSector, c.tactical?.state.pathEnv.showAllMercs]).toEqual(['tactical', A9, false]);
  expect(teamMembers(c.tactical?.state ?? never(), Team.OUR).map((s) => s.gridNo)).toEqual(tiles);
  expect(c.state.meanwhile.log.map((e) => e.id)).toEqual([Meanwhile.OUTSKIRTS_MEDUNA]);
  expect(c.narrative.profile(Npc.ELLIOT)?.npcData).toBe(ELLIOT_SHOT);
  expectNpcsBack(session, before);
  expect([c.state.clock.pauseLocked, c.meanwhile.underWay()]).toEqual([false, false]);
  return session;
}

function liberate(session: CampaignSession, towns: readonly number[]): void {
  const map = session.campaign.state.map;
  map.elements.forEach((e, index) => {
    if (!towns.includes(e.nameId)) return;
    e.enemyControlled = false;
    Object.assign(sectorInfo(map, sectorFromStrategicIndex(index)), NO_GARRISON);
  });
  expect(session.campaign.meanwhile.wholeTownsUnderControlExceptOmerta()).toBe(towns.length);
}

async function townSceneFromTheMap(mode?: RunMode): Promise<CampaignSession> {
  const { session, live } = await landed(82, mode);
  liberate(session, [Town.DRASSEN, Town.CAMBRIA]);
  expect(session.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  session.campaign.state.map.selectedSector = { ...SELECTED };
  const before = spotsOf(session, [Npc.QUEEN, Npc.ELLIOT]);
  schedule(session, Meanwhile.DRASSEN_LIBERATED, 1);
  const begun = live.advance({ compressionStopped: true, mode: CompressMode.MIN5 });
  expect(types(begun.events)).toEqual(expect.arrayContaining(['meanwhileStarted', 'sectorLoaded']));
  expect(begun.events).toContainEqual(expect.objectContaining({ type: 'compressionStopped', reason: 'meanwhile' }));
  expect(session.campaign.state.meanwhile.returnTrip).toEqual({ sector: A9, selectedSector: SELECTED, screen: 'strategic' });
  const events = [...begun.events];
  events.push(...live.advance({ events: ['conversationOpened'] }, SCENE_STOP_BUDGET).events);
  expectInTheHall(session, 'drassenLiberated');
  const seconds = session.campaign.state.clock.seconds;
  const said = new Set<number>();
  untilEnded(live, events, () => {
    if (!session.campaign.state.meanwhile.inScene) return;
    for (const record of saidRecords(session, Npc.QUEEN)) said.add(record);
    expect(session.campaign.state.clock.seconds).toBe(seconds);
  });
  expect([...said].sort((a, b) => a - b)).toEqual(QUEEN_RECORDS_WITH_TWO_TOWNS);
  const c = session.campaign;
  expect(sectorsLoaded(events)).toEqual([PALACE, sectorShortString(A9)]);
  expect([c.state.flow, c.state.worldSector, c.state.map.selectedSector]).toEqual(['strategic', A9, SELECTED]);
  expect([c.state.clock.mode, c.state.clock.pauseLocked]).toEqual([CompressMode.X0, false]);
  expectNpcsBack(session, before);
  return session;
}

describe('a palace meanwhile scene played in the stub hall P3_m (Meanwhile.cc StartMeanwhile, DoneFadeInMeanwhile, EndMeanwhile)', () => {
  it("outskirts, in tactical: the box's OK lifts the meanwhile pause lock until the conversation locks it again, the Queen shoots her aide down to 1 life whatever her marksmanship, his count goes to 17, Joe comes along and everyone goes back, the clock standing and the squad on its tiles, the same across reloads", async () => {
    await expectReloadsInvisible(outskirtsInTactical);
  });

  it("a town scene from the map: the scene's NPCs shown to the player, the town count picking the Queen's line for two towns, and the map entered again with the mode lost and the selected sector back, the same across reloads", async () => {
    await expectReloadsInvisible(townSceneFromTheMap);
  });

  it('endMeanwhile (Esc) ends a palace scene at once: the implications, the way back and the NPCs restored; it is refused outside one', async () => {
    const { session, live } = await landed(83);
    expect(session.dispatch({ type: 'endMeanwhile' })).toMatchObject({ ok: false, data: { refusal: 'noPalaceScene' } });
    const before = spotsOf(session, [Npc.QUEEN, Npc.ELLIOT]);
    expect(session.campaign.state.queen.awake).toBe(false);
    schedule(session, Meanwhile.DRASSEN_LIBERATED);
    session.drainEvents();
    const events = untilStarted(live);
    events.push(...live.advance({ events: ['arrived'] }, SCENE_STOP_BUDGET).events);
    expect(session.campaign.state.meanwhile.inScene).toBe(true);
    expect(session.dispatch({ type: 'endMeanwhile' })).toEqual({ ok: true });
    events.push(...session.drainEvents());
    const c = session.campaign;
    expect([c.state.flow, c.state.worldSector, c.meanwhile.underWay()]).toEqual(['tactical', A9, false]);
    expect(sectorsLoaded(events)).toEqual([PALACE, sectorShortString(A9)]);
    expect(sceneEvents(events)).toEqual(['meanwhileStarted', 'meanwhileEnded']);
    expect(c.state.queen.awake).toBe(true);
    expect(c.state.meanwhile.log.map((e) => e.id)).toEqual([Meanwhile.DRASSEN_LIBERATED]);
    expectNpcsBack(session, before);
    expect(c.state.clock.pauseLocked).toBe(false);
    expect(session.dispatch({ type: 'endMeanwhile' })).toMatchObject({ ok: false, data: { refusal: 'noPalaceScene' } });
  });

  it('stalls when the player holds all four missile sites (quirk): the site count triggers no line, and only endMeanwhile goes on', async () => {
    const { session, live } = await landed(84);
    const ctx = session.campaign.strategic ?? never();
    expect(ctx.content.samSites).toHaveLength(ALL_MISSILE_SITES);
    for (const sam of ctx.content.samSites) {
      const element = ctx.state.map.elements[strategicIndex(sectorFromId(sam.sector))] ?? never();
      element.enemyControlled = false;
    }
    expect(session.campaign.meanwhile.samSitesUnderPlayerControl()).toBe(ALL_MISSILE_SITES);
    schedule(session, Meanwhile.NW_SAM);
    untilStarted(live);
    for (let k = 0; k < 2; k++) expect(live.advance({ idle: true }, STALL_BUDGET).reason).toBe('budget');
    expect(session.campaign.state.meanwhile.inScene).toBe(true);
    expect(saidRecords(session, Npc.QUEEN)).toEqual(QUEEN_RECORDS_BEFORE_THE_SITE_COUNT);
    expect(session.dispatch({ type: 'endMeanwhile' })).toEqual({ ok: true });
    expect([session.campaign.state.worldSector, session.campaign.meanwhile.underWay()]).toEqual([A9, false]);
  });

  it('ends at once without the hall P3_m (deviation: the original stops on the missing file): the implications run and nothing loads', async () => {
    const { session, live } = await landed(85, undefined, { hall: false });
    expect(session.campaign.state.queen.awake).toBe(false);
    schedule(session, Meanwhile.DRASSEN_LIBERATED);
    session.drainEvents();
    const events = untilStarted(live);
    const c = session.campaign;
    expect(sceneEvents(events)).toEqual(['meanwhileStarted', 'meanwhileEnded']);
    expect(sectorsLoaded(events)).toEqual([]);
    expect([c.state.worldSector, c.state.flow, c.meanwhile.underWay()]).toEqual([A9, 'tactical', false]);
    expect(c.state.queen.awake).toBe(true);
  });

  it("ends at once without the scene's record files (deviation: the original refuses to start), after the trip there and back", async () => {
    const hidden = (path: string) => /npcdata\/161\.npc$/.test(path);
    const read: ReadFile = (path) => (hidden(path) ? Promise.resolve(null) : kit.read(path));
    const { session, live } = await landed(86, undefined, { read });
    expect(session.campaign.state.queen.awake).toBe(false);
    schedule(session, Meanwhile.DRASSEN_LIBERATED);
    session.drainEvents();
    const events = untilStarted(live);
    const c = session.campaign;
    expect(sceneEvents(events)).toEqual(['meanwhileStarted', 'meanwhileEnded']);
    expect(sectorsLoaded(events)).toEqual([PALACE, sectorShortString(A9)]);
    expect([c.state.worldSector, c.meanwhile.underWay()]).toEqual([A9, false]);
    expect(c.state.queen.awake).toBe(true);
  });
});
