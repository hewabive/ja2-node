import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../content/world/grid.ts';
import type { BoxingView, NpcRequestPromptView } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { NarrativeHistory } from '../sim/strategic/narrative/history-codes.ts';
import { Insertion } from '../sim/tactical/insertion.ts';
import { BOXING_RING } from '../sim/tactical/narrative/boxing-state.ts';
import { type Soldier, Team } from '../sim/tactical/soldier.ts';
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

const CLUB_OWNER = 87;
const COLS = 160;
const NEAR_THE_OWNER = [65 * COLS + 40, 65 * COLS + 41];
const RING_TILE = 70 * COLS + 36;
const OUR_TURN_BUDGET = 40;
const NEIGHBOURS = [-COLS - 1, -COLS, -COLS + 1, -1, 1, COLS - 1, COLS, COLS + 1];
const PUNCHES_PER_TURN = 4;
const SETTLE_BUDGET = 20;

interface Club {
  readonly session: CampaignSession;
  readonly live: Session;
  readonly mercs: readonly number[];
}

async function inTheClub(seed: number, mode?: RunMode): Promise<Club> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const c = session.campaign;
  const ctx = c.strategic;
  const roster = c.battle?.roster;
  if (!ctx || !roster) throw new Error('no strategic layer');
  const club = parseSectorString('D5');
  const mercs = roster.all().map((m) => m.id);
  roster.all().forEach((m, k) => {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, club, group);
    m.insertionCode = Insertion.GRIDNO;
    m.soldier.insertionData = NEAR_THE_OWNER[k] ?? NEAR_THE_OWNER[0] ?? 0;
  });
  const enter = { type: 'enterSector', sector: 'D5' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  const live = new ReloadingSession('boxing', session);
  live.advance({ idle: true });
  return { session, live, mercs };
}

function request(session: CampaignSession): NpcRequestPromptView | null {
  return (session.view().npcRequest as NpcRequestPromptView | null | undefined) ?? null;
}

function boxing(club: Club): BoxingView | null {
  return club.session.view().boxing ?? null;
}

function soldier(club: Club, id: number): Soldier {
  const s = club.session.campaign.tactical?.state.soldiers[id];
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function aiBoxer(club: Club): Soldier | null {
  const t = club.session.campaign.tactical?.state;
  return t?.soldiers.find((s) => s?.placed && s.team === Team.CIV && s.boxer) ?? null;
}

function talkThrough(club: Club, cmd: Record<string, unknown>): { events: SimEvent[]; quotes: number[] } {
  const result = club.session.dispatch({ type: String(cmd.type), ...cmd });
  expect(result.ok, result.reason).toBe(true);
  const events = [...club.session.drainEvents(), ...club.live.advance({ idle: true }).events];
  return { events, quotes: events.flatMap((e) => (e.type === 'npcQuote' ? [e.quote] : [])) };
}

function betAndStart(club: Club, merc: number): SimEvent[] {
  const { session } = club;
  talkThrough(club, { type: 'talk', soldier: merc, target: { npc: CLUB_OWNER } });
  expect(session.view().conversation?.lastQuotes.map((q) => q.quote)).toEqual([0]);
  expect(talkThrough(club, { type: 'approach', kind: 'direct' }).quotes).toEqual([1]);
  const prompt = request(session);
  expect(prompt).toMatchObject({ request: 'boxingBet', npc: CLUB_OWNER, choices: ['yes', 'no'] });
  const answered = talkThrough(club, { type: 'answer', prompt: prompt?.id, choice: 'yes' });
  expect(answered.quotes).toEqual([4]);
  return answered.events;
}

function freeHands(club: Club, merc: number): void {
  expect(club.session.dispatch({ type: 'drop', soldier: merc, slot: 'hand' }).ok).toBe(true);
  club.live.advance({ idle: true });
}

function adjacentFreeTile(club: Club, me: Soldier, target: Soldier): number | null {
  const t = club.session.campaign.tactical?.state;
  if (!t) return null;
  const free = NEIGHBOURS.map((d) => target.gridNo + d).filter(
    (g) => t.world.level.rooms[g] === BOXING_RING && !t.soldiers.some((s) => s?.placed && s.gridNo === g),
  );
  free.sort((a, b) => pythSpacesAway(me.gridNo, a) - pythSpacesAway(me.gridNo, b));
  return free[0] ?? null;
}

function ourTurn(club: Club): boolean {
  const combat = club.session.view().combat;
  return !!combat && combat.team === Team.OUR;
}

function fightOneTurn(club: Club, merc: number): SimEvent[] {
  const { session, live } = club;
  const events: SimEvent[] = [];
  const settle = () => events.push(...live.advance({ idle: true }).events);
  const me = soldier(club, merc);
  const target = aiBoxer(club);
  if (target && pythSpacesAway(me.gridNo, target.gridNo) > 1) {
    const to = adjacentFreeTile(club, me, target);
    if (to !== null && session.dispatch({ type: 'move', soldier: merc, to, mode: 'walk' }).ok) settle();
  }
  for (let punch = 0; punch < PUNCHES_PER_TURN && ourTurn(club) && boxing(club)?.state === 'boxing'; punch++) {
    const foe = aiBoxer(club);
    if (!foe) break;
    const hit = session.dispatch({ type: 'attack', soldier: merc, target: foe.gridNo });
    if (!hit.ok) break;
    settle();
  }
  if (ourTurn(club) && boxing(club)?.state === 'boxing') session.dispatch({ type: 'endTurn' });
  settle();
  return events;
}

async function boxingMatch(mode?: RunMode): Promise<CampaignSession> {
  const club = await inTheClub(31, mode);
  const { session, live } = club;
  const merc = club.mercs[0] as number;
  freeHands(club, merc);
  expect(boxing(club)).toBeNull();
  const started = betAndStart(club, merc);
  expect(started).toContainEqual(expect.objectContaining({ type: 'boxingBell' }));
  expect(boxing(club)).toEqual({ state: 'waitingForPlayer', boxers: [], uiLocked: false });
  expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: false, data: { refusal: 'boxingInProgress' } });
  expect(session.dispatch({ type: 'move', soldier: merc, to: RING_TILE, mode: 'walk' }).ok).toBe(true);
  const events: SimEvent[] = [...started];
  for (let k = 0; k < SETTLE_BUDGET && boxing(club)?.state !== 'boxing'; k++) events.push(...live.advance({ idle: true }).events);
  expect(events).toContainEqual(expect.objectContaining({ type: 'boxingState', state: 'waitingForPlayer', previous: 'notBoxing' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'boxingState', state: 'preBoxing' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'boxerPicked' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'combatStarted' }));
  expect(boxing(club)?.state).toBe('boxing');
  expect(boxing(club)?.boxers).toContain(merc);
  expect(session.campaign.strategic?.world.boxing()).toBe(true);
  const fight: SimEvent[] = [];
  for (let turn = 0; turn < OUR_TURN_BUDGET && boxing(club)?.state === 'boxing'; turn++) {
    if (ourTurn(club)) fight.push(...fightOneTurn(club, merc));
    else fight.push(...live.advance({ idle: true }).events);
  }
  for (let k = 0; k < SETTLE_BUDGET && boxing(club) !== null; k++) fight.push(...live.advance({ idle: true }).events);
  const round = session.campaign.state.narrative.boxing;
  expect(fight).toContainEqual(expect.objectContaining({ type: 'boxingRoundOver' }));
  expect(fight).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'boxing' }));
  expect(fight).toContainEqual(expect.objectContaining({ type: 'boxingEnded', soldier: merc }));
  expect(boxing(club)).toBeNull();
  const won = round.lastMatchWonByPlayer;
  expect(session.campaign.state.laptop.history.at(-1)).toMatchObject({
    code: won ? NarrativeHistory.WON_BOXING : NarrativeHistory.LOST_BOXING,
  });
  expect(round.matchesWon).toBe(won ? 1 : 0);
  expect(round.fought[0]).toBe(true);
  expect(soldier(club, merc).underAiControl).toBe(false);
  expect(session.view().conversation?.lastQuotes.map((q) => q.quote)).toEqual([won ? 7 : 8]);
  expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return session;
}

describe('a boxing match at the stub club', () => {
  it('is bet on through the requestor, fought bare-handed with attack and closed by the owner, the same across reloads', async () => {
    await expectReloadsInvisible(boxingMatch);
  });
});
