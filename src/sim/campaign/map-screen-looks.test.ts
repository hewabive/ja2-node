import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { snapshotSession } from '../../server/session-snapshot.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode, NUM_SEC_IN_DAY } from '../strategic/time/constants.ts';
import { ANY_SMOKE, newSmokeEffect, smokeFlagsAt } from '../tactical/explosions/smoke.ts';
import { lightTrueLevel } from '../tactical/lighting/lighting.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { RevealedFlags, restoreFogOfWar } from '../tactical/perception/fov.ts';
import { setLookSkipping } from '../tactical/perception/look-memo.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, Visibility } from '../tactical/world-items.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

afterEach(() => {
  setLookSkipping(true);
  vi.restoreAllMocks();
});

const KESTREL = 0;
const VANT = 1;
const LANDING = 'A9';
const TICKS_PER_POLL = 4;
const HOUSE_ROOM = 1;
const LOOKOUT = gridNo(79, 71);
const IN_THE_HOUSE = gridNo(71, 71);
const IN_THE_OPEN = gridNo(76, 71);
const OUT_OF_THE_WAY = gridNo(85, 66);
const FIFTEEN_TILES_EAST = gridNo(94, 71);
const ON_THE_WAY_EAST = gridNo(86, 71);
const LONG_BLINDNESS = 120;
const SPOTTED_SOMETHING = [11, 12];
const SIGHT_RETURNS_WITHIN = 6;
const SMOKE_CLEARS_WITHIN = 100;
const CLOCK_MOVES_WITHIN = 100;
const UNTIL_NIGHT = { worldSeconds: 16 * 3600 };
const NIGHT_FALLS_WITHIN = { ticks: 4000 };
const TACTICAL_SLICE = { ticks: 20 };
const ALL_CLOUDS = 0;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

interface Poll {
  readonly events: readonly SimEvent[];
  readonly draws: readonly number[];
  readonly rng: string;
  readonly flow: string;
}

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await c.session.prepare(cmd);
  expect(c.session.dispatch(cmd)).toMatchObject({ ok: true });
}

function quiet(session: CampaignSession): void {
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

async function onTheMapInA9(seed: number, skipping: boolean): Promise<Campaign> {
  setLookSkipping(skipping);
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('map-screen-looks', session) };
  await order(c, { type: 'compressTime', mode: CompressMode.MIN5 });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  await order(c, { type: 'mapScreen' });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function loaded(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

function soldierOf(c: Campaign, s: Soldier): Soldier {
  return loaded(c).soldiers[s.id] ?? never(`soldier ${s.id}`);
}

function lookout(c: Campaign, direction: number, blindness: number): Soldier {
  const t = loaded(c);
  const vant = merc(c, VANT).soldier;
  setSoldierPosition(t, vant, OUT_OF_THE_WAY);
  vant.blindedCounter = LONG_BLINDNESS;
  const kestrel = merc(c, KESTREL).soldier;
  setSoldierPosition(t, kestrel, LOOKOUT);
  Object.assign(kestrel, { direction, desiredDirection: direction, blindedCounter: blindness });
  return kestrel;
}

function hideRoom(t: TacticalState, room: number): void {
  const rooms = t.world.level.rooms;
  const revealed = Uint8Array.from(t.fog.revealed, (flags, g) => (rooms[g] === room ? flags & ~RevealedFlags.GROUND : flags));
  const roomHidden = Uint8Array.from(t.fog.roomHidden, (hidden, r) => (r === room ? 1 : hidden));
  restoreFogOfWar(t, revealed, roomHidden);
}

function hiddenItemAt(t: TacticalState, g: number): void {
  addItemToPool(t, g, createItem(t.content.items, itemId(t, 'GLOCK_17'), 100), Visibility.INVISIBLE, 0);
}

function civilianAt(c: Campaign, g: number): Soldier {
  const sim = c.session.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.CIV];
  while (sim.state.soldiers[id]) id++;
  const civilian = spawnSoldier(sim, id, Team.CIV, g, Direction.WEST);
  civilian.neutral = true;
  return civilian;
}

async function compressing(c: Campaign, mode: number): Promise<void> {
  await order(c, { type: 'compressTime', mode });
}

function poll(c: Campaign): Poll {
  const rng = c.session.campaign.state.rng;
  const draw = rng.int.bind(rng);
  const draws: number[] = [];
  vi.spyOn(rng, 'int').mockImplementation((n) => {
    draws.push(n);
    return draw(n);
  });
  const report = c.live.advance({ ticks: TICKS_PER_POLL });
  vi.restoreAllMocks();
  return { events: report.events, draws, rng: JSON.stringify(c.session.campaign.state.rng.state()), flow: c.session.campaign.state.flow };
}

function polls(c: Campaign, count: number): Poll[] {
  return Array.from({ length: count }, () => poll(c));
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function pollWith(log: readonly Poll[], found: (p: Poll) => boolean): number {
  return log.findIndex(found);
}

describe('the map screen look with the skip on and off (the look is skipped only when it would change nothing)', () => {
  async function sightReturnsBesideAHiddenRoom(skipping: boolean, itemAt: number) {
    const c = await onTheMapInA9(91, skipping);
    const t = loaded(c);
    lookout(c, Direction.WEST, 1);
    hideRoom(t, HOUSE_ROOM);
    hiddenItemAt(t, itemAt);
    await compressing(c, CompressMode.MIN5);
    return { c, log: polls(c, SIGHT_RETURNS_WITHIN) };
  }

  it('says the spotted-something line on the map when a look there reveals a room with items, drawing Random(2) at the same poll (quirk)', async () => {
    const on = await sightReturnsBesideAHiddenRoom(true, IN_THE_HOUSE);
    const off = await sightReturnsBesideAHiddenRoom(false, IN_THE_HOUSE);
    expect(on.log).toEqual(off.log);
    const revealed = pollWith(on.log, (p) => ofType(p.events, 'roomRevealed').some((e) => e.room === HOUSE_ROOM));
    expect(revealed).toBeGreaterThan(0);
    const at = on.log[revealed] ?? never('poll');
    expect([at.flow, at.draws.includes(2)]).toEqual(['strategic', true]);
    const lines = on.log.flatMap((p) => ofType(p.events, 'mercQuote')).filter((e) => e.soldier === merc(on.c, KESTREL).id);
    expect(lines.map((e) => SPOTTED_SOMETHING.includes(e.id))).toEqual([true]);
    expect(ofType(at.events, 'itemsRevealed').map((e) => e.gridNo)).toEqual([IN_THE_HOUSE]);
  });

  it('shows items lying in the open at the poll a look on the map first reaches them, as without the skip', async () => {
    const on = await sightReturnsBesideAHiddenRoom(true, IN_THE_OPEN);
    const off = await sightReturnsBesideAHiddenRoom(false, IN_THE_OPEN);
    expect(on.log).toEqual(off.log);
    const shown = pollWith(on.log, (p) => ofType(p.events, 'itemsRevealed').some((e) => e.gridNo === IN_THE_OPEN));
    expect(shown).toBeGreaterThan(0);
    expect(on.log[shown]?.flow).toBe('strategic');
  });

  function untilTheClockMoves(c: Campaign): void {
    const seconds = c.session.campaign.state.clock.seconds;
    for (let k = 0; k < CLOCK_MOVES_WITHIN && c.session.campaign.state.clock.seconds === seconds; k++) poll(c);
  }

  async function smokeBetween(skipping: boolean) {
    const c = await onTheMapInA9(92, skipping);
    const kestrel = lookout(c, Direction.EAST, 0);
    const civilian = civilianAt(c, FIFTEEN_TILES_EAST);
    await compressing(c, CompressMode.MIN5);
    untilTheClockMoves(c);
    newSmokeEffect(loaded(c), ON_THE_WAY_EAST, itemId(loaded(c), 'SMOKE_GRENADE'), 0, null);
    const sees: boolean[] = [];
    const clear: boolean[] = [];
    const log: Poll[] = [];
    for (let k = 0; k < SMOKE_CLEARS_WITHIN && !sees.at(-1); k++) {
      log.push(poll(c));
      sees.push(soldierOf(c, kestrel).oppList[civilian.id] === Opp.SEEN_CURRENTLY);
      clear.push((smokeFlagsAt(loaded(c), ON_THE_WAY_EAST, 0) & ANY_SMOKE) === 0);
    }
    return { log, sees, clear };
  }

  it('opens a sight line at the poll a smoke cloud on the map leaves it, as without the skip', async () => {
    const on = await smokeBetween(true);
    const off = await smokeBetween(false);
    expect(on.log).toEqual(off.log);
    const seen = on.sees.indexOf(true);
    expect(seen).toBeGreaterThan(0);
    expect(on.clear.indexOf(true)).toBe(seen);
  });

  async function duskOverTheMap(skipping: boolean) {
    const c = await onTheMapInA9(93, skipping);
    const kestrel = lookout(c, Direction.EAST, 0);
    const civilian = civilianAt(c, FIFTEEN_TILES_EAST);
    await compressing(c, CompressMode.MIN60);
    const dayLight = lightTrueLevel(loaded(c), LOOKOUT, 0);
    c.live.advance(UNTIL_NIGHT);
    const onTheMap = [lightTrueLevel(loaded(c), LOOKOUT, 0), soldierOf(c, kestrel).oppList[civilian.id]];
    await order(c, { type: 'tacticalScreen' });
    const ticks: number[] = [];
    for (let k = 0; k * TACTICAL_SLICE.ticks < NIGHT_FALLS_WITHIN.ticks; k++) {
      c.live.advance(TACTICAL_SLICE);
      if (soldierOf(c, kestrel).oppList[civilian.id] !== Opp.SEEN_CURRENTLY) {
        ticks.push(c.session.campaign.tick);
        break;
      }
    }
    return { dayLight, onTheMap, nightLight: lightTrueLevel(loaded(c), LOOKOUT, 0), ticks, rng: c.session.campaign.state.rng.state() };
  }

  it('keeps the day light of the loaded sector over dusk on the map; the first look back in tactical loses the far civilian at the same tick (EnvironmentController runs only on the game screen)', async () => {
    const on = await duskOverTheMap(true);
    const off = await duskOverTheMap(false);
    expect(on).toEqual(off);
    expect(on.onTheMap).toEqual([on.dayLight, Opp.SEEN_CURRENTLY]);
    expect(on.nightLight).toBeGreaterThan(on.dayLight);
    expect(on.ticks).toHaveLength(1);
  });

  async function aCompressedDay(skipping: boolean) {
    const c = await onTheMapInA9(94, skipping);
    const t = loaded(c);
    lookout(c, Direction.WEST, 2);
    hideRoom(t, HOUSE_ROOM);
    hiddenItemAt(t, IN_THE_HOUSE);
    hiddenItemAt(t, IN_THE_OPEN);
    civilianAt(c, FIFTEEN_TILES_EAST);
    newSmokeEffect(t, ON_THE_WAY_EAST, itemId(t, 'SMOKE_GRENADE'), 0, null);
    await compressing(c, CompressMode.MIN60);
    const report = c.live.advance({ worldSeconds: NUM_SEC_IN_DAY });
    const clouds = loaded(c).explosives.smokeClouds.filter((cloud) => cloud !== null).length;
    return {
      events: report.events,
      clouds,
      rng: c.session.campaign.state.rng.state(),
      pre: c.session.campaign.state.pre.state(),
      snapshot: JSON.stringify(snapshotSession(c.session)),
    };
  }

  it('ends a compressed day with a loaded sector in the same snapshot and stream states', async () => {
    const on = await aCompressedDay(true);
    const off = await aCompressedDay(false);
    expect(on.clouds).toBe(ALL_CLOUDS);
    expect(ofType(on.events, 'roomRevealed').length).toBeGreaterThan(0);
    expect(on.rng).toEqual(off.rng);
    expect(on.pre).toEqual(off.pre);
    expect(on.events).toEqual(off.events);
    expect(on.snapshot === off.snapshot).toBe(true);
  });
});
