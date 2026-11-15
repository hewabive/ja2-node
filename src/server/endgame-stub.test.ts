import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapItemRecord } from '../../tests/support/map-items.ts';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, type SessionSources, stubSessionSources } from '../../tests/support/session-reload.ts';
import { type MapDef, MapFlags, parseMap, writeMap } from '../content/formats/map.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { WORLD_COLS } from '../content/world/grid.ts';
import type { TacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { handleSoldierDeath } from '../sim/tactical/combat/death.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import type { ProfileProgress } from '../sim/tactical/profiles.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { Visibility } from '../sim/tactical/world-items.ts';
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

const BASEMENT = { x: 3, y: 16, z: 1 } as const;
const PALACE_MAPS = ['stubs/world/maps/p3.dat', 'stubs/world/maps/p3_b1.dat'];

interface BasementSetup {
  readonly sources: SessionSources;
  readonly queen: (queen: ProfileProgress) => void;
}

const asBuilt = (): BasementSetup => ({ sources: stubSessionSources(kit), queen: () => {} });

async function inThePalaceBasement(
  seed: number,
  mode?: RunMode,
  setup: BasementSetup = asBuilt(),
): Promise<{ session: CampaignSession; live: Session }> {
  const { sources } = setup;
  const created = await createCampaignSession(sources.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const session = drivenSession(created, sources, mode);
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
  await session.worlds?.prepare(PALACE_MAPS);
  const c = session.campaign;
  const ctx = c.strategic;
  if (!ctx || !c.battle) throw new Error('no strategic layer');
  for (const m of c.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, BASEMENT, group);
    m.sector = { ...BASEMENT };
  }
  const queen = c.narrative.profile(Npc.QUEEN);
  if (queen) {
    queen.sectorZ = 1;
    setup.queen(queen);
  }
  expect(c.sectors?.setCurrentWorldSector(BASEMENT)).toBe(true);
  return { session, live: new ReloadingSession('endgame', session) };
}

function killTheQueen(session: CampaignSession): void {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  const queen = t.soldiers.find((s) => s?.placed && s.profile === Npc.QUEEN);
  const killer = teamMembers(t, Team.OUR)[0];
  if (!queen || !killer) throw new Error('the Queen or the squad is missing');
  queen.attacker = killer;
  queen.life = 0;
  handleSoldierDeath(t, queen);
}

const types = (events: readonly SimEvent[]) => events.map((e) => e.type);

describe('the end of the campaign in the stub palace', () => {
  it('kills the Queen in the basement, moves the squad upstairs, runs Derek and Oliver and ends the campaign, the same across reloads', async () => {
    await expectReloadsInvisible(winTheCampaign);
  });

  it('defers the ending while the creature quest runs and wins once the creature queen dies', async () => {
    const { session, live } = await inThePalaceBasement(42);
    session.campaign.state.narrative.quests[Quest.CREATURES] = QuestStatus.IN_PROGRESS;
    killTheQueen(session);
    const deferred = live.advance({ idle: true });
    expect(deferred.reason).toBe('event');
    expect(types(deferred.events)).toContain('endgameDeferred');
    expect(session.view().strategic).toMatchObject({ flow: 'tactical', campaign: 'playing' });
    const c = session.campaign;
    const t = c.tactical?.state;
    const killer = t ? teamMembers(t, Team.OUR)[0] : undefined;
    c.endgame.creatureQueenDied(killer ?? null, 0, 0);
    const won = live.advance({ idle: true });
    expect(won.reason).toBe('ended');
    expect(types(won.events)).toEqual(expect.arrayContaining(['creatureQueenKilled', 'campaignWon']));
  });
});

async function winTheCampaign(mode: RunMode): Promise<CampaignSession> {
  const { session, live } = await inThePalaceBasement(41, mode);
  killTheQueen(session);
  expect(session.view().strategic?.flow).toBe('endgame');
  const refused = session.dispatch({ type: 'stopTime' });
  expect(refused).toMatchObject({ ok: false, data: { refusal: 'endgameInProgress' } });
  const report = live.advance({ idle: true });
  expect(report.reason).toBe('ended');
  const seen = types(report.events);
  expect(seen).toEqual(expect.arrayContaining(['queenKilled', 'squadMovedUpstairs', 'sectorLoaded', 'npcQuote', 'campaignWon']));
  expect(seen.indexOf('queenKilled')).toBeLessThan(seen.indexOf('squadMovedUpstairs'));
  const c = session.campaign;
  expect(c.state.worldSector).toEqual({ x: 3, y: 16, z: 0 });
  expect(c.narrative.checkFact(170, 0)).toBe(true);
  expect(c.state.queen.awake).toBe(false);
  expect(c.narrative.profile(Npc.ELLIOT)?.sectorX).toBe(1);
  const p3 = sectorInfo(c.state.map, { x: 3, y: 16 });
  expect([p3.numAdmins, p3.numTroops, p3.numElites]).toEqual([0, 0, 0]);
  const view = session.view();
  expect(view.strategic).toMatchObject({ flow: 'ended', campaign: 'won' });
  expect(view.ended).toMatchObject({ outcome: 'victory', ending: { miguelAlive: true, skyriderAlive: true } });
  expect(live.advance({ idle: true })).toMatchObject({ reason: 'ended', events: [] });
  expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: false, data: { refusal: 'campaignOver' } });
  return session;
}

describe("the Queen's crate in the stub palace basement", () => {
  const BASEMENT_MAP = 'stubs/world/maps/p3_b1.dat';
  const CRATE = 57 * WORLD_COLS + 75;
  const ROCKET_RIFLE_SLOT = InvSlot.BIGPOCK1;
  const id = (name: string) => kit.content.items.byName.get(name)?.index ?? -1;

  function crateItems() {
    const items = kit.content.items;
    return [
      mapItemRecord(items, 'OWNERSHIP', CRATE, { owner: Npc.QUEEN, visible: Visibility.HIDDEN_ITEM }),
      mapItemRecord(items, 'AUTO_ROCKET_RIFLE', CRATE),
      mapItemRecord(items, 'SPECTRA_HELMET_18', CRATE),
    ];
  }

  function withCrate(map: MapDef): MapDef {
    return { ...map, flags: map.flags | MapFlags.WORLD_ITEMS, items: [...map.items, ...crateItems()] };
  }

  function crateSetup(): BasementSetup {
    const base = stubSessionSources(kit);
    const read: ReadFile = async (path) => {
      const bytes = await base.read(path);
      return path === BASEMENT_MAP && bytes ? writeMap(withCrate(parseMap(bytes))) : bytes;
    };
    const world = (path: string): TacticalWorld => {
      const w = kit.world(path);
      return path === BASEMENT_MAP ? { ...w, map: withCrate(w.map) } : w;
    };
    const queen = (q: ProfileProgress) => {
      q.inventory[ROCKET_RIFLE_SLOT] = id('ROCKET_RIFLE');
      q.inventoryCount[ROCKET_RIFLE_SLOT] = 1;
      q.inventoryStatus[ROCKET_RIFLE_SLOT] = 100;
    };
    return { sources: { ...base, read, world }, queen };
  }

  it('arms the Queen who fled to the basement with the automatic rocket rifle and the helmet from her crate: the map items load before she is placed', async () => {
    const { session } = await inThePalaceBasement(43, undefined, crateSetup());
    const t = session.campaign.tactical?.state;
    const queen = t?.soldiers.find((s) => s?.placed && s.profile === Npc.QUEEN);
    expect([queen?.inv[ROCKET_RIFLE_SLOT]?.item, queen?.inv[InvSlot.HELMET]?.item]).toEqual([
      id('AUTO_ROCKET_RIFLE'),
      id('SPECTRA_HELMET_18'),
    ]);
    expect(t?.worldItems.filter((wi) => wi.gridNo === CRATE)).toEqual([]);
  });
});
