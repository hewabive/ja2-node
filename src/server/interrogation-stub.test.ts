import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { beginCaptureSequence, endCaptureSequence, enemyCapturesPlayerSoldier } from '../sim/campaign/merc-fate.ts';
import type { SimEvent } from '../sim/events.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { removeSoldierFromTacticalSector } from '../sim/tactical/sector-presence.ts';
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

const N7_MAP = 'stubs/world/maps/n7.dat';
const INTERROGATION_GRIDNOS = [7756, 7757];

async function capturedTwice(seed: number, mode?: RunMode): Promise<{ session: CampaignSession; live: Session }> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const n7 = sectorInfo(session.campaign.state.map, parseSectorString('N7'));
  n7.numAdmins = 0;
  n7.numTroops = 0;
  n7.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  const c = session.campaign;
  c.state.narrative.quests[Quest.HELD_IN_ALMA] = QuestStatus.DONE;
  const battle = c.battle;
  const t = c.tactical?.state;
  if (!battle || !t) throw new Error('no battle flow');
  const [first, second, free] = battle.roster.all();
  const ctx = c.strategic;
  if (!first || !second || !free || !ctx) throw new Error('three mercs expected');
  beginCaptureSequence(battle);
  for (const m of [first, second]) {
    removeSoldierFromTacticalSector(t, m.soldier);
    expect(enemyCapturesPlayerSoldier(battle, m, c.state.rng)).toBe(true);
  }
  endCaptureSequence(battle);
  removeSoldierFromTacticalSector(t, free.soldier);
  const away = parseSectorString('A10');
  const group = getGroup(ctx, free.groupId);
  if (group) setGroupSectorValue(ctx, away, group);
  free.sector = away;
  expect(c.state.narrative.quests[Quest.INTERROGATION]).toBe(QuestStatus.IN_PROGRESS);
  c.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  await session.worlds?.prepare([N7_MAP]);
  return { session, live: new ReloadingSession('interrogation', session) };
}

const types = (events: readonly SimEvent[]) => events.map((e) => e.type);

function quotesOf(events: readonly SimEvent[], profile: number): number[] {
  return events.flatMap((e) => (e.type === 'npcQuote' && e.profile === profile ? [e.quote] : []));
}

async function untilThePrompt(seed: number, mode?: RunMode) {
  const { session, live } = await capturedTwice(seed, mode);
  expect(session.campaign.state.flow).toBe('strategic');
  const begun = live.advance({ compressionStopped: true, mode: 2 });
  expect(types(begun.events)).toEqual(expect.arrayContaining(['meanwhileStarted', 'sectorLoaded']));
  expect(begun.events).toContainEqual(expect.objectContaining({ type: 'compressionStopped', reason: 'meanwhile' }));
  expect(session.campaign.state.worldSector).toEqual({ x: 7, y: 14, z: 0 });
  expect(session.view().meanwhile).toEqual({ seq: 1, scene: 'interrogation' });
  expect(session.view().strategic?.flow).toBe('meanwhile');
  expect(session.dispatch({ type: 'stopTime' })).toMatchObject({ ok: false, data: { refusal: 'inMeanwhile' } });
  const prompt = live.advance({ idle: true });
  expect(prompt.reason).toBe('decision');
  expect(session.view().npcRequest).toMatchObject({ request: 'lie', choices: ['yes', 'no', 'lie'] });
  return { session, live };
}

function expectEscapeSetUp(session: CampaignSession): void {
  const c = session.campaign;
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector');
  expect(c.state.meanwhile.inScene).toBe(false);
  expect(c.state.flow).toBe('tactical');
  expect(session.view().strategic?.flow).toBe('tactical');
  const captives = teamMembers(t, Team.OUR).filter((s) => c.battle?.roster.get(s.id)?.sector.x === 7);
  expect(captives.map((s) => s.gridNo).sort()).toEqual(INTERROGATION_GRIDNOS);
  for (const s of captives) {
    const m = c.battle?.roster.get(s.id);
    expect(m && m.assignment < Assignment.ON_DUTY).toBe(true);
    expect(s.neutral).toBe(false);
  }
  for (const npc of [Npc.QUEEN, Npc.JOE, Npc.ELLIOT]) {
    expect(t.soldiers.some((s) => s?.placed && s.profile === npc)).toBe(false);
    expect(c.narrative.profile(npc)).toMatchObject({ sectorX: 3, sectorY: 16, useProfileInsertion: false });
  }
  expect(c.state.meanwhile.log.map((e) => e.id)).toEqual([11]);
}

async function answeredYes(mode?: RunMode): Promise<CampaignSession> {
  const { session, live } = await untilThePrompt(51, mode);
  const answered = session.dispatch({ type: 'answer', choice: 'yes' });
  expect(answered.ok, answered.reason).toBe(true);
  const all = types(session.drainEvents());
  for (let k = 0; k < 4 && !all.includes('meanwhileEnded'); k++) all.push(...types(live.advance({ idle: true }).events));
  expect(all).toContain('meanwhileEnded');
  expectEscapeSetUp(session);
  return session;
}

describe('the interrogation in the stub prison yard', () => {
  it('loads N7 with the captives, asks the lie question and leaves the captives free on a squad, the same across reloads', async () => {
    await expectReloadsInvisible(answeredYes);
  });

  it('runs the liar through the skill check and ends the scene either way', async () => {
    const { session, live } = await untilThePrompt(52);
    const answered = session.dispatch({ type: 'answer', choice: 'lie' });
    expect(answered.ok, answered.reason).toBe(true);
    const events = session.drainEvents();
    for (let k = 0; k < 4 && !types(events).includes('meanwhileEnded'); k++) events.push(...live.advance({ idle: true }).events);
    expect(types(events)).toContain('meanwhileEnded');
    const said = quotesOf(events, Npc.QUEEN);
    expect(said.includes(4) || said.includes(5)).toBe(true);
    if (said.includes(4)) expect(said).toContain(6);
    expectEscapeSetUp(session);
  });
});
