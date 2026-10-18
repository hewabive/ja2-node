import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, RELOAD_TEST_TIMEOUT_MS, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { ConversationView } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem, createMoney } from '../sim/items/object.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
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

const VASKO = 94;
const COLS = 160;
const NEAR_VASKO = 74 * COLS + 75;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const Quote = { FIRST_MEETING: 10, FIRST_MEETING_2: 11, NO_USE: 4, ROUNDS: 25, MONEY: 26, NO_GUNS: 27 } as const;

async function inA10(seed: number, mode?: RunMode): Promise<{ session: CampaignSession; live: Session }> {
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
  const first = session.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(session.dispatch({ type: 'route', soldier: first.id, to: 'A10' })).toMatchObject({ ok: true });
  const live = new ReloadingSession('t', session);
  for (let k = 0; k < ROUTE_BUDGET && !session.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors); k++)
    live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

function soldier(session: CampaignSession, id: number): Soldier {
  const s = session.campaign.tactical?.state.soldiers[id];
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function item(session: CampaignSession, name: string): number {
  const index = session.campaign.tactical?.state.content.items.byName.get(name)?.index;
  if (index === undefined) throw new Error(`no item ${name}`);
  return index;
}

interface GiveData {
  readonly outcome?: string;
  readonly conversation?: ConversationView | null;
  readonly lines?: { quote: number; text?: string }[];
  readonly refusal?: string;
  readonly walking?: boolean;
}

function data(r: { readonly data?: unknown }): GiveData {
  return (r.data ?? {}) as GiveData;
}

function quotes(r: { readonly data?: unknown }): number[] {
  return (data(r).lines ?? []).map((l) => l.quote);
}

async function nearVasko(seed: number, mode?: RunMode) {
  const { session, live } = await inA10(seed, mode);
  const merc = session.view().strategic?.mercs[0]?.id ?? 0;
  expect(session.dispatch({ type: 'move', soldier: merc, to: NEAR_VASKO, mode: 'walk' }).ok).toBe(true);
  live.advance({ idle: true });
  return { session, live, merc };
}

const SLOW_SCENARIO_MS = 30_000;

describe('giving items and money to the stub NPC in A10', { timeout: SLOW_SCENARIO_MS }, () => {
  it('takes a magazine after his first-meeting lines, refuses the pistol and returns it, takes money', async () => {
    const { session, merc } = await nearVasko(21);
    const m = soldier(session, merc);
    const clip = item(session, 'CLIP9_15');
    const pocket = m.inv.findIndex((o) => o.item === clip);
    expect(m.inv[pocket]).toMatchObject({ item: clip, count: 2 });

    const rounds = session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: pocket, count: 1 });
    expect(rounds.ok, rounds.reason).toBe(true);
    expect(data(rounds).outcome).toBe('taken');
    expect(quotes(rounds)).toEqual([Quote.FIRST_MEETING, Quote.FIRST_MEETING_2, Quote.ROUNDS]);
    expect(data(rounds).lines?.at(-1)?.text).toContain('rounds');
    expect(data(rounds).conversation).toMatchObject({ profile: VASKO, initiatedBy: 'player', talker: merc });
    expect(m.inv[pocket]).toMatchObject({ item: clip, count: 1 });
    const profile = session.campaign.state.profiles.get(VASKO);
    expect(profile?.inventory).toContain(clip);
    const vasko = session.campaign.tactical?.state.soldiers.find((s) => s?.profile === VASKO);
    expect(vasko?.inv.some((o) => o.item === clip)).toBe(true);
    expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });

    const glock = item(session, 'GLOCK_17');
    const pistol = session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: 'hand' });
    expect(pistol.ok, pistol.reason).toBe(true);
    expect(data(pistol).outcome).toBe('returned');
    expect(quotes(pistol)).toEqual([Quote.NO_GUNS]);
    expect(m.inv[InvSlot.HAND]?.item).toBe(glock);
    expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });

    Object.assign(m.inv[InvSlot.SMALLPOCK1] as object, createMoney(session.campaign.tactical?.state.content.items as never, 500));
    expect(session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, money: 105 })).toMatchObject({
      ok: false,
      data: { refusal: 'badMoney' },
    });
    session.drainEvents();
    const cash = session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, money: 100 });
    expect(cash.ok, cash.reason).toBe(true);
    expect(data(cash).outcome).toBe('taken');
    expect(quotes(cash)).toEqual([Quote.MONEY]);
    expect(m.inv[InvSlot.SMALLPOCK1]?.money).toBe(400);
    expect(profile?.money).toBe(100);
    expect(session.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'npcTookItem', profile: VASKO, from: merc, item: 'MONEY', money: 100 }),
    );
  });

  it('answers an unwanted item with the default line, closes and hands it back; gives from inside a conversation', async () => {
    const { session, live, merc } = await nearVasko(22);
    const m = soldier(session, merc);
    const items = session.campaign.tactical?.state.content.items;
    if (!items) throw new Error('no items');
    const kit = item(session, 'FIRSTAIDKIT');
    Object.assign(m.inv[InvSlot.SMALLPOCK2] as object, createItem(items, kit, 100));
    const talk = session.dispatch({ type: 'talk', soldier: merc, target: { npc: VASKO } });
    expect(talk.ok, talk.reason).toBe(true);
    if (data(talk).walking) live.advance({ idle: true });
    expect(session.view().conversation?.menu).toContain('give');
    const refused = session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: InvSlot.SMALLPOCK2 });
    expect(refused.ok, refused.reason).toBe(true);
    expect(data(refused).outcome).toBe('returned');
    expect(quotes(refused)).toEqual([Quote.NO_USE]);
    expect(data(refused).conversation).toBeNull();
    expect(m.inv.some((o) => o.item === kit)).toBe(true);
    expect(session.view().scriptedSequence).toBeUndefined();
  });

  it('refuses gives the original does not allow', async () => {
    const { session, merc } = await nearVasko(23);
    const give = (extra: Record<string, unknown>) => session.dispatch({ type: 'give', soldier: merc, target: { npc: VASKO }, ...extra });
    expect(give({})).toMatchObject({ ok: false, data: { refusal: 'needItemOrMoney' } });
    expect(give({ slot: InvSlot.SMALLPOCK8 })).toMatchObject({ ok: false, data: { refusal: 'emptySlot' } });
    expect(give({ slot: 40 })).toMatchObject({ ok: false, data: { refusal: 'noSlot' } });
    const pocket = soldier(session, merc).inv.findIndex((o) => o.item === item(session, 'CLIP9_15'));
    expect(give({ slot: pocket, count: 3 })).toMatchObject({ ok: false, data: { refusal: 'badCount' } });
    expect(give({ money: 100 })).toMatchObject({ ok: false, data: { refusal: 'notEnoughMoney' } });
    expect(session.dispatch({ type: 'give', soldier: merc, target: merc, slot: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'noSuchTarget' },
    });
  });

  it('hands an item to a squad mate, who gets one magazine while the whole source pocket is emptied', async () => {
    const { session, live, merc } = await nearVasko(24);
    const mate = session.view().strategic?.mercs[1]?.id;
    if (mate === undefined) throw new Error('no second merc');
    const clip = item(session, 'CLIP9_15');
    const before = soldier(session, mate)
      .inv.filter((o) => o.item === clip)
      .reduce((n, o) => n + o.count, 0);
    const pocket = soldier(session, merc).inv.findIndex((o) => o.item === clip);
    const handed = session.dispatch({ type: 'give', soldier: merc, target: mate, slot: pocket, count: 1 });
    expect(handed.ok, handed.reason).toBe(true);
    const report = live.advance({ idle: true });
    expect(report.events.map((e: SimEvent) => e.type)).toContain('itemGiven');
    const after = soldier(session, mate)
      .inv.filter((o) => o.item === clip)
      .reduce((n, o) => n + o.count, 0);
    expect(after).toBe(before + 1);
    expect(soldier(session, merc).inv[pocket]?.count ?? 0).toBe(0);
  });

  it(
    'gives to the NPC and to a squad mate the same way when the session is saved and restored after every input',
    async () => {
      await expectReloadsInvisible(async (mode) => {
        const { session, live, merc } = await nearVasko(26, mode);
        const step = (cmd: Record<string, unknown>) => {
          const r = live.dispatch({ type: String(cmd.type), ...cmd });
          live.advance({ idle: true });
          return r;
        };
        const pocket = () => soldier(session, merc).inv.findIndex((o) => o.item === item(session, 'CLIP9_15'));
        step({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: pocket(), count: 1 });
        step({ type: 'closeTalk' });
        step({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: 'hand' });
        step({ type: 'closeTalk' });
        const mate = session.view().strategic?.mercs[1]?.id;
        step({ type: 'give', soldier: merc, target: mate, slot: pocket(), count: 1 });
        return session;
      });
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it('ends in the same state under the instant and the manual driver', async () => {
    const digest = async (instant: boolean) => {
      const { session, live, merc } = await nearVasko(25);
      if (instant) live.setDriver({ mode: 'instant' });
      const step = (cmd: Record<string, unknown>) => {
        const r = live.dispatch({ type: String(cmd.type), ...cmd });
        if (!instant) live.advance({ idle: true });
        return r;
      };
      const pocket = soldier(session, merc).inv.findIndex((o) => o.item === item(session, 'CLIP9_15'));
      step({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: pocket, count: 1 });
      step({ type: 'closeTalk' });
      step({ type: 'give', soldier: merc, target: { npc: VASKO }, slot: 'hand' });
      step({ type: 'closeTalk' });
      live.setDriver({ mode: 'manual' });
      const c = session.campaign;
      return JSON.stringify({
        tick: c.tick,
        inv: soldier(session, merc).inv,
        flags: c.state.npcRecords.arrays[VASKO]?.map((q) => q.flags),
        profile: c.state.profiles.get(VASKO),
      });
    };
    expect(await digest(true)).toBe(await digest(false));
  });
});
