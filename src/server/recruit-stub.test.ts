import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { ConversationView, NpcRequestPromptView } from '../protocol/view.ts';
import { MercKind } from '../sim/campaign/roster.ts';
import type { SimEvent } from '../sim/events.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Insertion } from '../sim/tactical/insertion.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const MARSH = 65;
const MIRELA = 123;
const MARSH_SALARY = 120;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const RPC_JOINED_TEAM = 23;
const RECRUITED = 0x01;
const EPC_ACTIVE = 0x40;

async function inA10(seed: number): Promise<{ session: CampaignSession; live: Session; merc: number }> {
  const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const first = session.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(session.dispatch({ type: 'route', soldier: first.id, to: 'A10' })).toMatchObject({ ok: true });
  const live = new Session('t', session);
  for (let k = 0; k < ROUTE_BUDGET && !session.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors); k++)
    live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live, merc: first.id };
}

function lines(r: { readonly data?: unknown }): number[] {
  return ((r.data as { lines?: { quote: number }[] } | undefined)?.lines ?? []).map((l) => l.quote);
}

function request(r: { readonly data?: unknown }): NpcRequestPromptView | null {
  return (r.data as { npcRequest?: NpcRequestPromptView } | undefined)?.npcRequest ?? null;
}

function talkTo(session: CampaignSession, live: Session, merc: number, npc: number): ConversationView | null {
  const started = session.dispatch({ type: 'talk', soldier: merc, target: { npc } });
  expect(started.ok, started.reason).toBe(true);
  if ((started.data as { walking?: boolean }).walking) expect(live.advance({ idle: true }).reason).toBe('decision');
  return session.view().conversation ?? null;
}

function eventsOf(session: CampaignSession, type: string): SimEvent[] {
  return session.drainEvents().filter((e) => e.type === type);
}

function escortMirela(session: CampaignSession, live: Session, merc: number): number {
  expect(talkTo(session, live, merc, MIRELA)?.lastQuotes.map((q) => q.quote)).toEqual([10]);
  const asked = session.dispatch({ type: 'approach', kind: 'recruit' });
  expect(lines(asked)).toEqual([11]);
  const prompt = request(asked);
  expect(prompt).toMatchObject({ request: 'escort', npc: MIRELA, choices: ['yes', 'no'] });
  session.drainEvents();
  const answered = session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'yes' });
  expect(answered.ok, answered.reason).toBe(true);
  const events = session.drainEvents();
  expect(events).toContainEqual(expect.objectContaining({ type: 'npcRecruited', profile: MIRELA, kind: 'epc' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'npcMessage', kind: 'nowEscorted', profile: MIRELA }));
  const escort = session.campaign.battle?.roster.byProfile(MIRELA);
  if (!escort) throw new Error('Mirela is not escorted');
  return escort.id;
}

describe('recruiting the stub RPC and escorting the stub EPC in A10', () => {
  it('hires the RPC through the pay request: team, squad, weapon in hand, history and views', async () => {
    const { session, live, merc } = await inA10(21);
    expect(talkTo(session, live, merc, MARSH)?.lastQuotes.map((q) => q.quote)).toEqual([10]);
    const asked = session.dispatch({ type: 'approach', kind: 'recruit' });
    expect(lines(asked)).toEqual([11]);
    const prompt = request(asked);
    expect(prompt).toMatchObject({ request: 'hire', npc: MARSH, amount: MARSH_SALARY });
    session.drainEvents();
    const answered = session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'yes' });
    expect(answered.ok, answered.reason).toBe(true);
    expect(lines(answered)).toContain(14);
    const events = session.drainEvents();
    expect(events).toContainEqual(expect.objectContaining({ type: 'npcRecruited', profile: MARSH, kind: 'rpc', salary: MARSH_SALARY }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'npcMessage', kind: 'recruited', profile: MARSH }));
    const c = session.campaign;
    const m = c.battle?.roster.byProfile(MARSH);
    expect(m?.kind).toBe(MercKind.NPC);
    expect(m?.soldier.team).toBe(Team.OUR);
    expect(m?.soldier.placed).toBe(true);
    expect(c.state.forces.squads[m?.assignment ?? -1]).toContain(m?.id);
    expect(m?.soldier.inv[InvSlot.HAND]?.item).toBe(c.battle?.content.items.byName.get('GLOCK_17')?.index);
    expect((c.state.profiles.get(MARSH)?.miscFlags ?? 0) & RECRUITED).toBe(RECRUITED);
    expect(c.state.laptop.history.at(-1)).toMatchObject({ code: RPC_JOINED_TEAM, secondCode: MARSH });
    expect(c.tactical?.state.soldiers.some((s) => s?.placed && s.team === Team.CIV && s.profile === MARSH)).toBe(false);
    expect(session.view().conversation).toBeNull();
    expect(session.view().strategic?.mercs.find((x) => x.id === m?.id)).toMatchObject({ kind: 'rpc' });
    expect(session.view().soldiers.find((x) => x.id === m?.id)).toMatchObject({ kind: 'rpc' });
  });

  it('keeps the RPC when the pay request is refused', async () => {
    const { session, live, merc } = await inA10(22);
    talkTo(session, live, merc, MARSH);
    const asked = session.dispatch({ type: 'approach', kind: 'recruit' });
    const answered = session.dispatch({ type: 'answer', prompt: request(asked)?.id, choice: 'no' });
    expect(answered.ok, answered.reason).toBe(true);
    expect(lines(answered)).toContain(13);
    expect(session.campaign.battle?.roster.byProfile(MARSH)).toBeUndefined();
  });

  it('escorts the EPC, talks to her as an escort and releases her in tactical through her wrong-sector record', async () => {
    const { session, live, merc } = await inA10(23);
    const id = escortMirela(session, live, merc);
    const c = session.campaign;
    expect((c.state.profiles.get(MIRELA)?.miscFlags ?? 0) & EPC_ACTIVE).toBe(EPC_ACTIVE);
    expect(session.view().strategic?.mercs.find((x) => x.id === id)).toMatchObject({ kind: 'epc' });
    expect(session.view().soldiers.find((x) => x.id === id)).toMatchObject({ kind: 'epc' });
    if (session.view().conversation) session.dispatch({ type: 'closeTalk' });
    const talk = talkTo(session, live, merc, MIRELA);
    expect(talk?.lastQuotes.map((q) => q.quote)).toEqual([12]);
    expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'unescort', soldier: merc })).toMatchObject({ ok: false, data: { refusal: 'notAnEpc' } });
    expect(session.dispatch({ type: 'unescort', soldier: 77 })).toMatchObject({ ok: false, data: { refusal: 'noSuchSoldier' } });
    session.drainEvents();
    const released = session.dispatch({ type: 'unescort', soldier: id });
    expect(released).toMatchObject({ ok: true, data: { triggered: true } });
    expect(lines(released)).toContain(13);
    expect(session.view().conversation).toBeNull();
    expect(eventsOf(session, 'epcReleased')).toEqual([expect.objectContaining({ profile: MIRELA })]);
    expect(c.battle?.roster.byProfile(MIRELA)).toBeUndefined();
    const civilian = c.tactical?.state.soldiers.find((s) => s?.placed && s.profile === MIRELA);
    expect(civilian?.team).toBe(Team.CIV);
    const p = c.state.profiles.get(MIRELA);
    expect(p).toMatchObject({ useProfileInsertion: true, insertionCode: Insertion.GRIDNO, insertionData: civilian?.gridNo });
    expect((p?.miscFlags ?? 0) & (EPC_ACTIVE | RECRUITED)).toBe(0);
  });

  it('releases the EPC from the map screen with her abandoning quote', async () => {
    const { session, live, merc } = await inA10(24);
    const id = escortMirela(session, live, merc);
    if (session.view().conversation) session.dispatch({ type: 'closeTalk' });
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    session.drainEvents();
    const released = session.dispatch({ type: 'unescort', soldier: id });
    expect(released).toMatchObject({ ok: true, data: { released: [{ profile: MIRELA, quote: 13 }] } });
    expect(lines(released)).toEqual([13]);
    expect(eventsOf(session, 'epcReleased')).toEqual([expect.objectContaining({ profile: MIRELA })]);
    const c = session.campaign;
    expect(c.battle?.roster.byProfile(MIRELA)).toBeUndefined();
    expect(c.tactical?.state.soldiers.find((s) => s?.placed && s.profile === MIRELA)?.team).toBe(Team.CIV);
    expect(session.view().strategic?.mercs.some((m) => m.id === id)).toBe(false);
  });
});
