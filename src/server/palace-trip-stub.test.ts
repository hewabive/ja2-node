import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { advance, expectReloadsInvisible, type RunMode, reloadPoint } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import type { Sector } from '../content/strategic/sector-ids.ts';
import { GUIDE_DESCRIPTION_COUNTDOWN_RANGE } from '../sim/campaign/narrative/guide-description.ts';
import { sectorKey } from '../sim/campaign/sector-diff.ts';
import { Meanwhile } from '../sim/strategic/ai/constants.ts';
import { beginMeanwhile, scheduleMeanwhileEvent } from '../sim/strategic/ai/meanwhile.ts';
import { InsertionCode, SectorFlag } from '../sim/strategic/forces/constants.ts';
import { getSectorFlagStatus, sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { fact, setFactTrue } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { CompressMode, EventKind } from '../sim/strategic/time/constants.ts';
import { addStrategicEventUsingSeconds, deleteStrategicEvent } from '../sim/strategic/time/event-queue.ts';
import { handleDoorChangeFromGridNo, isDoorOpenAt } from '../sim/tactical/doors.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { NO_PROFILE, type Soldier, Team } from '../sim/tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;
const exists = (path: string) => kit.worlds.exists(path);

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const A9: Sector = { x: 9, y: 1, z: 0 };
const B13: Sector = { x: 13, y: 2, z: 0 };
const PALACE: Sector = { x: 3, y: 16, z: 0 };
const P3_M_MAP = 'stubs/world/maps/p3_m.dat';
const P3_MAP = 'stubs/world/maps/p3.dat';
const LINE_TICKS_LEFT = 400;
const B13_MAP = 'stubs/world/maps/b13.dat';
const NO_GARRISON = { numAdmins: 0, numTroops: 0, numElites: 0 };
const PALACE_GUARDS = { numAdmins: 0, numTroops: 0, numElites: 2 };
const AIRFIELD_DOOR = 8060;
const CORPSE_PROFILE = 200;
const LIFE_OF_A_BEATEN_AIDE = 10;
const WALKED_TO = [8380, 8384];
const FAR_LATER_MINUTES = 60 * 24 * 30;
const SCENE_NPCS = [Npc.QUEEN, Npc.JOE, Npc.ELLIOT].sort((a, b) => a - b);
const THE_SERVANT_AND_THE_FREE_CIVILIAN = 2;
const THE_SERVANT = 1;
const TENSE_QUOTE_DELAY_RANGE = 20;
const CROWS_POSSIBLE_RANGE = 5;
const PRESERVED_TILE_RANGE = 2;
const ENTRY_DRAWS = [TENSE_QUOTE_DELAY_RANGE, CROWS_POSSIBLE_RANGE];
const FIRST_PALACE_ENTRY_DRAWS = [GUIDE_DESCRIPTION_COUNTDOWN_RANGE, ...ENTRY_DRAWS];

function never(): never {
  throw new Error('missing');
}

function tacticalOf(session: CampaignSession): TacticalState {
  return session.campaign.tactical?.state ?? never();
}

function nowMinutes(session: CampaignSession): number {
  return Math.trunc(session.campaign.state.clock.seconds / 60);
}

async function newCampaign(seed: number, mode?: RunMode): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, exists, seed, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  const map = session.campaign.state.map;
  Object.assign(sectorInfo(map, A9), NO_GARRISON);
  Object.assign(sectorInfo(map, B13), NO_GARRISON);
  Object.assign(sectorInfo(map, PALACE), PALACE_GUARDS);
  await session.worlds?.prepare([P3_M_MAP, B13_MAP]);
  return session;
}

async function land(session: CampaignSession): Promise<void> {
  for (const cmd of [{ type: 'compressTime', mode: CompressMode.MIN5 }, { type: 'skipHelicopterDrop' }]) {
    await session.prepare(cmd);
    expect(session.dispatch(cmd).ok).toBe(true);
  }
}

function moveSquadTo(session: CampaignSession, sector: Sector): void {
  const flow = session.campaign.sectors ?? never();
  for (const m of flow.setup.roster.all()) {
    m.sector = { ...sector };
    m.insertionCode = InsertionCode.NORTH;
  }
  expect(flow.setCurrentWorldSector(sector)).toBe(true);
  reloadPoint(session);
}

function ours(session: CampaignSession): Soldier[] {
  return teamMembers(tacticalOf(session), Team.OUR).sort((a, b) => a.id - b.id);
}

async function squadAtTheAirfield(seed: number, mode?: RunMode): Promise<{ session: CampaignSession; tiles: number[] }> {
  const session = await newCampaign(seed, mode);
  await land(session);
  moveSquadTo(session, B13);
  ours(session).forEach((s, k) => {
    expect(session.dispatch({ type: 'move', soldier: s.id, to: WALKED_TO[k], mode: 'run' }).ok).toBe(true);
  });
  advance(session, { idle: true });
  const tiles = ours(session).map((s) => s.gridNo);
  expect(tiles).toEqual(WALKED_TO);
  return { session, tiles };
}

function palaceSceneBegun(session: CampaignSession, id: number): void {
  const c = session.campaign;
  const q = c.queen ?? never();
  scheduleMeanwhileEvent(q, id, nowMinutes(session) + FAR_LATER_MINUTES);
  deleteStrategicEvent(c.state.queue, EventKind.MEANWHILE, id);
  beginMeanwhile(q, id);
  c.state.meanwhile.trying = false;
}

interface Leg {
  readonly main: number[];
  readonly pre: number[];
  readonly entered: Sector[];
  readonly left: Sector[];
  readonly museumAlarmLeft: boolean;
}

function asSector(s: Sector): Sector {
  return { x: s.x, y: s.y, z: s.z };
}

function recordedLeg(session: CampaignSession, act: () => void): Leg {
  const c = session.campaign;
  setFactTrue(c.state.narrative, Fact.MUSEUM_ALARM_WENT_OFF);
  const main = vi.spyOn(c.state.rng, 'int');
  const pre = vi.spyOn(c.state.pre, 'int');
  const entry = vi.spyOn(c.narrative, 'handleQuestCodeOnSectorEntry');
  const exit = vi.spyOn(c.narrative, 'handleQuestCodeOnSectorExit');
  try {
    act();
    return {
      main: main.mock.calls.map(([n]) => n),
      pre: pre.mock.calls.map(([n]) => n),
      entered: entry.mock.calls.map(([s]) => asSector(s)),
      left: exit.mock.calls.map(([s]) => asSector(s)),
      museumAlarmLeft: fact(session.campaign.state.narrative, Fact.MUSEUM_ALARM_WENT_OFF),
    };
  } finally {
    for (const spy of [main, pre, entry, exit]) spy.mockRestore();
  }
}

function goToThePalace(session: CampaignSession): Leg {
  const c = session.campaign;
  const elliot = c.narrative.profile(Npc.ELLIOT) ?? never();
  elliot.life = LIFE_OF_A_BEATEN_AIDE;
  c.drainEvents();
  const out = recordedLeg(session, () => expect(session.campaign.meanwhile.goToThePalace()).toBe(true));
  expect(out.main.slice(-FIRST_PALACE_ENTRY_DRAWS.length)).toEqual(FIRST_PALACE_ENTRY_DRAWS);
  expect(getSectorFlagStatus(session.campaign.state.map, PALACE, SectorFlag.HAVE_USED_GUIDE_QUOTE)).toBe(true);
  expectInThePalaceHall(session);
  reloadPoint(session);
  return out;
}

function endTheScene(session: CampaignSession): void {
  const flow = session.campaign.meanwhile;
  flow.endMeanwhile();
  expect(session.campaign.state.meanwhile.returnTrip).not.toBeNull();
  flow.settle();
}

function civilians(t: TacticalState): { readonly profiled: number[]; readonly unprofiled: number } {
  const placed = teamMembers(t, Team.CIV).filter((s) => s.placed);
  return {
    profiled: placed
      .filter((s) => s.profile !== NO_PROFILE)
      .map((s) => s.profile)
      .sort((a, b) => a - b),
    unprofiled: placed.filter((s) => s.profile === NO_PROFILE).length,
  };
}

function preservableCivilians(t: TacticalState): number {
  const inSector = (s: Soldier) => s.placed || s.offMap || s.away;
  return t.soldiers.filter((s) => s?.team === Team.CIV && inSector(s) && s.profile === NO_PROFILE && s.life > 0).length;
}

function expectInThePalaceHall(session: CampaignSession): void {
  const c = session.campaign;
  const t = tacticalOf(session);
  const map = c.state.map;
  expect([c.state.worldSector, c.tactical?.world.mapPath, c.state.meanwhile.inScene]).toEqual([PALACE, P3_M_MAP, true]);
  expect(teamMembers(t, Team.ENEMY)).toEqual([]);
  expect(civilians(t)).toEqual({ profiled: SCENE_NPCS, unprofiled: THE_SERVANT_AND_THE_FREE_CIVILIAN });
  expect(teamMembers(t, Team.OUR).filter((s) => s.placed)).toEqual([]);
  const flags = [SectorFlag.ALREADY_LOADED, SectorFlag.HAS_ENTERED_TACTICAL, SectorFlag.ALREADY_VISITED];
  expect(flags.map((f) => getSectorFlagStatus(map, PALACE, f))).toEqual([true, true, false]);
  const elliot = c.narrative.profile(Npc.ELLIOT);
  expect(elliot?.life).toBe(elliot?.stats.lifeMax);
  expect(c.state.meanwhile.skipSectorSave).toBe(true);
}

function expectThePalaceLeftUnsaved(session: CampaignSession): void {
  const c = session.campaign;
  expect(c.state.sectorDiffs.has(sectorKey(PALACE))).toBe(false);
  expect(getSectorFlagStatus(c.state.map, PALACE, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(false);
  expect([c.state.meanwhile.inScene, c.state.meanwhile.returnTrip]).toEqual([false, null]);
  for (const id of [Npc.QUEEN, Npc.ELLIOT]) expect(c.narrative.profile(id)).toMatchObject({ sectorX: PALACE.x, sectorY: PALACE.y });
}

function lyingCorpse(gridNo: number) {
  return {
    gridNo,
    level: 0,
    heightAdjustment: 0,
    bodyType: 0,
    direction: 0,
    state: 0,
    profile: CORPSE_PROFILE,
    type: 1,
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows: 0,
  };
}

async function fromTactical(mode?: RunMode): Promise<CampaignSession> {
  const { session, tiles } = await squadAtTheAirfield(71, mode);
  const [first] = ours(session);
  expect(session.dispatch({ type: 'drop', soldier: first?.id, slot: InvSlot.HAND })).toEqual({ ok: true });
  advance(session, { idle: true });
  const t = tacticalOf(session);
  handleDoorChangeFromGridNo(t, null, AIRFIELD_DOOR);
  t.corpses.push(lyingCorpse((first ?? never()).gridNo + 3));
  const items = t.worldItems.map((wi) => [wi.gridNo, wi.object.item]);
  expect([items.length > 0, isDoorOpenAt(t, AIRFIELD_DOOR)]).toEqual([true, true]);
  const airfieldCivilians = preservableCivilians(t);
  reloadPoint(session);

  palaceSceneBegun(session, Meanwhile.FLOWERS);
  const out = goToThePalace(session);
  expect([out.left, out.entered, out.museumAlarmLeft]).toEqual([[B13], [PALACE], false]);
  expect(out.pre).toEqual(new Array<number>(airfieldCivilians).fill(PRESERVED_TILE_RANGE));
  const c0 = session.campaign;
  expect(c0.state.meanwhile.returnTrip).toEqual({ sector: B13, selectedSector: B13, screen: 'tactical' });
  expect(c0.sectors?.mapsNeededSoon()).toContain(B13_MAP);
  expect([c0.state.sectorDiffs.has(sectorKey(B13)), sectorInfo(c0.state.map, B13).timeLastLoaded]).toEqual([true, nowMinutes(session)]);

  const back = recordedLeg(session, () => endTheScene(session));
  expect([back.left, back.entered, back.pre, back.main.slice(-ENTRY_DRAWS.length), back.museumAlarmLeft]).toEqual([
    [PALACE],
    [B13],
    [],
    ENTRY_DRAWS,
    false,
  ]);
  const c = session.campaign;
  expectThePalaceLeftUnsaved(session);
  expect([c.state.worldSector, c.state.flow, c.state.map.selectedSector, c.state.meanwhile.skipSectorSave]).toEqual([
    B13,
    'tactical',
    B13,
    false,
  ]);
  const here = tacticalOf(session);
  expect(ours(session).map((s) => s.gridNo)).toEqual(tiles);
  expect(here.worldItems.map((wi) => [wi.gridNo, wi.object.item])).toEqual(items);
  expect(isDoorOpenAt(here, AIRFIELD_DOOR)).toBe(true);
  expect(here.corpses.map((k) => k.profile)).toEqual([CORPSE_PROFILE]);
  reloadPoint(session);
  return session;
}

async function fromTheMapWithTheAirfieldLoaded(mode?: RunMode): Promise<CampaignSession> {
  const { session, tiles } = await squadAtTheAirfield(72, mode);
  expect(session.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  expect(session.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok).toBe(true);
  session.campaign.state.map.selectedSector = { ...A9 };
  reloadPoint(session);

  palaceSceneBegun(session, Meanwhile.LOST_TOWN);
  const out = goToThePalace(session);
  const c0 = session.campaign;
  expect(c0.state.meanwhile.returnTrip).toEqual({ sector: B13, selectedSector: A9, screen: 'strategic' });
  expect([c0.state.flow, c0.state.clock.pauseLocked, c0.state.clock.paused]).toEqual(['tactical', false, false]);
  expect([c0.state.clock.mode, c0.state.clock.compressionOn]).toEqual([CompressMode.X1, false]);
  expect([out.left, out.entered, out.museumAlarmLeft]).toEqual([[B13], [PALACE], false]);

  const back = recordedLeg(session, () => endTheScene(session));
  expect([back.left, back.entered, back.pre, back.museumAlarmLeft]).toEqual([[PALACE], [B13], [], false]);
  const c = session.campaign;
  expectThePalaceLeftUnsaved(session);
  expect([c.state.worldSector, c.tactical?.world.mapPath, c.state.flow, c.state.map.selectedSector]).toEqual([
    B13,
    B13_MAP,
    'strategic',
    B13,
  ]);
  expect([c.state.clock.mode, c.state.clock.compressionOn, c.state.clock.pauseLocked]).toEqual([CompressMode.X0, false, false]);
  expect(ours(session).map((s) => s.gridNo)).toEqual(tiles);
  reloadPoint(session);
  return session;
}

async function fromTheMapWithNoWorld(mode?: RunMode): Promise<CampaignSession> {
  const session = await newCampaign(73, mode);
  const selected = { ...session.campaign.state.map.selectedSector };
  expect([session.campaign.state.flow, session.campaign.tactical]).toEqual(['strategic', null]);
  reloadPoint(session);

  palaceSceneBegun(session, Meanwhile.KILL_CHOPPER);
  const out = goToThePalace(session);
  expect([out.left, out.entered, out.museumAlarmLeft]).toEqual([[], [PALACE], true]);
  expect(session.campaign.state.meanwhile.returnTrip).toEqual({ sector: null, selectedSector: selected, screen: 'strategic' });

  const back = recordedLeg(session, () => endTheScene(session));
  expect(back).toEqual({ main: [], pre: [], entered: [], left: [], museumAlarmLeft: true });
  const c = session.campaign;
  expectThePalaceLeftUnsaved(session);
  expect([c.state.worldSector, c.tactical, c.state.flow, c.state.map.selectedSector]).toEqual([null, null, 'strategic', selected]);
  expect([c.state.clock.mode, c.state.clock.pauseLocked, c.state.meanwhile.skipSectorSave]).toEqual([CompressMode.X0, false, true]);
  reloadPoint(session);
  await land(session);
  expect([session.campaign.state.worldSector, session.campaign.state.meanwhile.skipSectorSave]).toEqual([A9, false]);
  return session;
}

describe('the round trip of a palace scene to P3_m and back (Meanwhile.cc StartMeanwhile, DoneFadeOutMeanwhileOnceDone)', () => {
  it('from tactical: saves the airfield through its exit quest code, loads the hall with no enemies and every civilian placement, saves nothing of it, and brings the squad back on its tiles with its items, door and corpse, the same across reloads', async () => {
    await expectReloadsInvisible(fromTactical);
  });

  it('from the map with a world loaded: loads the hall at X1, reloads the old sector, restores the selected sector and enters the map again, whose entry selects the loaded sector and turns X1 into X0 (deviation "Speed on a sector load from the map"; V:Strategic/MapScreen.c:2699-2706), the same across reloads', async () => {
    await expectReloadsInvisible(fromTheMapWithTheAirfieldLoaded);
  });

  it('from the map with no world loaded: trashes the hall on the way back with no exit quest code and no draw, and the skip of the hall save outlives it until the next load (quirk), the same across reloads', async () => {
    await expectReloadsInvisible(fromTheMapWithNoWorld);
  });

  it("loads P3_m in the second a palace scene is due, without enemies but with the palace's civilian setup, which only a scene under way skips (StrategicMap.cc:632 reads AreInMeanwhile, Soldier_Init_List.cc:500 gfInMeanwhile)", async () => {
    const session = await newCampaign(74);
    await land(session);
    const c = session.campaign;
    addStrategicEventUsingSeconds(c.state.queue, EventKind.MEANWHILE, c.state.clock.seconds, Meanwhile.FLOWERS);
    moveSquadTo(session, PALACE);
    const t = tacticalOf(session);
    expect([c.state.meanwhile.inScene, c.tactical?.world.mapPath]).toEqual([false, P3_M_MAP]);
    expect(teamMembers(t, Team.ENEMY)).toEqual([]);
    expect(civilians(t)).toEqual({ profiled: SCENE_NPCS, unprofiled: THE_SERVANT });
    expect(getSectorFlagStatus(c.state.map, PALACE, SectorFlag.ALREADY_VISITED)).toBe(false);
  });

  it('with P3 itself loaded loads nothing either way, so the scene plays on the palace map, and a line still talking at its end goes on: the way back cuts speech only when it loads (StrategicMap.cc:438, :488)', async () => {
    const session = await newCampaign(75);
    Object.assign(sectorInfo(session.campaign.state.map, PALACE), NO_GARRISON);
    await session.worlds?.prepare([P3_MAP]);
    await land(session);
    moveSquadTo(session, PALACE);
    const c = session.campaign;
    palaceSceneBegun(session, Meanwhile.LOST_TOWN);
    const out = recordedLeg(session, () => expect(c.meanwhile.goToThePalace()).toBe(true));
    expect([c.state.worldSector, c.tactical?.world.mapPath, c.state.meanwhile.inScene]).toEqual([PALACE, P3_MAP, true]);
    expect([out.entered, out.left]).toEqual([[], []]);
    const talk = c.talk?.talk ?? never();
    const busyUntil = c.tick + LINE_TICKS_LEFT;
    talk.face = { speaker: Npc.QUEEN, saidAt: c.tick, busyUntil, pcTrigger: null, modal: false, soldierFace: false };
    c.drainEvents();
    const back = recordedLeg(session, () => endTheScene(session));
    expect([back.entered, back.left, c.state.worldSector, c.tactical?.world.mapPath]).toEqual([[], [], PALACE, P3_MAP]);
    expect(c.drainEvents().filter((e) => e.type === 'lineCut')).toEqual([]);
    expect(talk.face?.busyUntil).toBe(busyUntil);
  });
});
