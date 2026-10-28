import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { handleSoldierDeath } from '../sim/tactical/combat/death.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
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

async function inThePalaceBasement(seed: number, mode?: RunMode): Promise<{ session: CampaignSession; live: Session }> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
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
  if (queen) queen.sectorZ = 1;
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
