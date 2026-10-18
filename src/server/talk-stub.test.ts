import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { ConversationView } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { questStatus } from '../sim/strategic/narrative/facts.ts';
import { Body, NO_PROFILE, Team } from '../sim/tactical/soldier.ts';
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
const DEALER = 91;
const LOOKOUT_TILE = 11755;
const HERMIT_QUEST = 14;
const HERMIT_FACT = 132;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const QUEST_IN_PROGRESS = 1;
const QUEST_DONE = 2;
const CIV_LOW_LOYALTY_LINES: ReadonlySet<number> = new Set([6, 7]);

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

function conversation(r: { readonly data?: unknown }): ConversationView | null {
  return (r.data as { conversation?: ConversationView | null } | undefined)?.conversation ?? null;
}

function lines(r: { readonly data?: unknown }): { quote: number; text?: string }[] {
  return (r.data as { lines?: { quote: number; text?: string }[] } | undefined)?.lines ?? [];
}

function walkUpAndTalk(session: CampaignSession, live: Session, merc: number) {
  const started = session.dispatch({ type: 'talk', soldier: merc, target: { npc: VASKO } });
  expect(started.ok, started.reason).toBe(true);
  if ((started.data as { walking?: boolean }).walking) {
    const report = live.advance({ idle: true });
    expect(report.reason).toBe('decision');
  }
  return session.view().conversation ?? null;
}

const SLOW_SCENARIO_MS = 30_000;

describe('the stub NPC in A10', { timeout: SLOW_SCENARIO_MS }, () => {
  it('talks: initial quote, approaches, a quest, a scripted walk and a tile trigger', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    const opened = walkUpAndTalk(session, live, merc);
    expect(opened).toMatchObject({ profile: VASKO, initiatedBy: 'player', talker: merc });
    expect(opened?.lastQuotes.map((q) => q.quote)).toEqual([10, 11]);
    expect(opened?.lastQuotes[0]?.text).toContain('Strangers');
    expect(live.advance({ ticks: 10 })).toMatchObject({ reason: 'refused' });
    expect(session.dispatch({ type: 'move', soldier: merc, to: 0 })).toMatchObject({ ok: false, data: { refusal: 'conversationOpen' } });

    const direct = session.dispatch({ type: 'approach', kind: 'direct' });
    expect(lines(direct).map((l) => l.quote)).toEqual([14, 15]);
    const n = session.campaign.state.narrative;
    expect(questStatus(n, HERMIT_QUEST)).toBe(QUEST_IN_PROGRESS);
    expect(n.facts[HERMIT_FACT]).toBe(1);
    expect(lines(session.dispatch({ type: 'approach', kind: 'direct' })).map((l) => l.quote)).toEqual([5]);
    expect(lines(session.dispatch({ type: 'approach', kind: 'repeat' })).map((l) => l.quote)).toEqual([5]);

    let walk = session.dispatch({ type: 'approach', kind: 'friendly' });
    if (lines(walk).some((l) => l.quote === 13)) walk = session.dispatch({ type: 'approach', kind: 'friendly' });
    const said = lines(walk).map((l) => l.quote);
    expect(said).toContain(16);
    expect(said).toContain(17);
    expect(conversation(walk)).toBeNull();
    expect((walk.data as { scriptedSequence?: boolean }).scriptedSequence).toBe(true);
    expect(session.dispatch({ type: 'move', soldier: merc, to: 0 })).toMatchObject({ ok: false, data: { refusal: 'scriptedSequence' } });

    const report = live.advance({ idle: true });
    expect(report.reason).toBe('decision');
    const types = report.events.map((e: SimEvent) => e.type);
    expect(types).toContain('conversationOpened');
    const reopened = session.view().conversation;
    expect(reopened).toMatchObject({ profile: VASKO, initiatedBy: 'npc' });
    expect(reopened?.lastQuotes.map((q) => q.quote)).toEqual([18]);
    const vasko = session.campaign.tactical?.state.soldiers.find((s) => s?.profile === VASKO);
    expect(Math.abs((vasko?.gridNo ?? 0) - LOOKOUT_TILE) % 160).toBeLessThan(4);
    expect(questStatus(n, HERMIT_QUEST)).toBe(QUEST_DONE);

    expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });
    expect(session.view().conversation).toBeNull();
    expect(session.view().scriptedSequence).toBeUndefined();
    expect(live.advance({ ticks: 10 }).reason).toBe('ticks');
  });

  it('gives defaults once and then sends the squad away, the same day opens silently', async () => {
    const { session, live } = await inA10(6);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    expect(lines(session.dispatch({ type: 'approach', kind: 'threaten' })).map((l) => l.quote)).toEqual([19]);
    expect(session.view().conversation).toBeNull();
    const again = session.dispatch({ type: 'talk', soldier: merc, target: { npc: VASKO } });
    expect(again.ok, again.reason).toBe(true);
    expect(lines(again)).toEqual([]);
    expect(lines(session.dispatch({ type: 'approach', kind: 'recruit' })).map((l) => l.quote)).toEqual([7]);
    const lost = session.dispatch({ type: 'approach', kind: 'recruit' });
    expect(lines(lost).map((l) => l.quote)).toEqual([9]);
    expect(conversation(lost)).toBeNull();
  });

  it('ends in the same state under the instant and the manual driver', async () => {
    const digest = async (instant: boolean) => {
      const { session, live } = await inA10(8);
      const merc = session.view().strategic?.mercs[0]?.id ?? 0;
      if (instant) live.setDriver({ mode: 'instant' });
      const step = (cmd: Record<string, unknown>) => {
        const r = live.dispatch({ type: String(cmd.type), ...cmd });
        if (!instant) live.advance({ idle: true });
        return r;
      };
      step({ type: 'talk', soldier: merc, target: { npc: VASKO } });
      step({ type: 'approach', kind: 'direct' });
      step({ type: 'approach', kind: 'friendly' });
      step({ type: 'approach', kind: 'friendly' });
      live.advance({ idle: true });
      step({ type: 'closeTalk' });
      live.setDriver({ mode: 'manual' });
      const c = session.campaign;
      const vasko = c.tactical?.state.soldiers.find((x) => x?.profile === VASKO);
      return JSON.stringify({
        tick: c.tick,
        gridNo: vasko?.gridNo,
        flags: c.state.npcRecords.arrays[VASKO]?.map((q) => q.flags),
        quests: [...c.state.narrative.quests],
        lines: c.talk?.talk.lines,
        profile: c.state.profiles.get(VASKO),
      });
    };
    expect(await digest(true)).toBe(await digest(false));
  });

  it('asks the lie prompt, stops time until it is answered and runs the chosen record', async () => {
    const { session, live } = await inA10(9);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    session.dispatch({ type: 'approach', kind: 'direct' });
    const asked = session.dispatch({ type: 'approach', kind: 'recruit' });
    expect(lines(asked).map((l) => l.quote)).toEqual([20]);
    const request = session.view().npcRequest;
    expect(request).toMatchObject({ kind: 'npcRequest', request: 'lie', npc: VASKO, choices: ['yes', 'no', 'lie'] });
    expect(conversation(asked)).toBeNull();
    const tick = session.campaign.tick;
    expect(live.advance({ ticks: 10 }).reason).toBe('decision');
    expect(session.campaign.tick).toBe(tick);
    expect(session.dispatch({ type: 'move', soldier: merc, to: 0 }).ok).toBe(false);
    expect(session.dispatch({ type: 'answer', choice: 'maybe' })).toMatchObject({ ok: false });
    const answered = session.dispatch({ type: 'answer', prompt: request?.id, choice: 'no' });
    expect(answered.ok, answered.reason).toBe(true);
    expect(session.view().npcRequest).toBeNull();
    expect(conversation(answered)).toMatchObject({ profile: VASKO, initiatedBy: 'npc' });
    expect(conversation(answered)?.lastQuotes.map((q) => q.quote)).toEqual([22]);
  });

  it('continues exactly when the session is saved and restored after every input', async () => {
    await expectReloadsInvisible(async (mode) => {
      const { session, live } = await inA10(9, mode);
      const merc = session.view().strategic?.mercs[0]?.id ?? 0;
      walkUpAndTalk(session, live, merc);
      session.dispatch({ type: 'approach', kind: 'direct' });
      session.dispatch({ type: 'approach', kind: 'recruit' });
      live.advance({ ticks: 10 });
      session.dispatch({ type: 'answer', prompt: session.view().npcRequest?.id, choice: 'no' });
      session.dispatch({ type: 'approach', kind: 'friendly' });
      session.dispatch({ type: 'approach', kind: 'friendly' });
      live.advance({ idle: true });
      session.dispatch({ type: 'closeTalk' });
      live.advance({ ticks: 200 });
      return session;
    });
  });

  it('lets an unnamed civilian bark a civilian quote instead of opening a panel', async () => {
    const { session, live } = await inA10(11);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    const t = session.campaign.tactical?.state;
    const villager = t?.soldiers.find((s) => s?.placed && s.team === Team.CIV && s.profile === NO_PROFILE && s.bodyType <= Body.KIDCIV);
    if (!t || !villager) throw new Error('no villager');
    expect(session.dispatch({ type: 'move', soldier: merc, to: villager.gridNo + 2, mode: 'walk' }).ok).toBe(true);
    live.advance({ idle: true });
    session.drainEvents();
    const started = session.dispatch({ type: 'talk', soldier: merc, target: villager.id });
    expect(started.ok, started.reason).toBe(true);
    let bark = (started.data as { civQuote?: { text?: string; quote: number; entry: number } | null }).civQuote;
    let events: readonly SimEvent[] = session.drainEvents();
    if ((started.data as { walking?: boolean }).walking) {
      const report = live.advance({ idle: true });
      events = report.events;
      bark = events.find((e) => e.type === 'civQuote') as unknown as typeof bark;
    }
    expect(CIV_LOW_LOYALTY_LINES.has(bark?.quote ?? -1)).toBe(true);
    expect(bark?.text?.length ?? 0).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'civQuote')).toBe(true);
    expect(session.view().conversation ?? null).toBeNull();
    expect(villager.currentCivQuote).toBeGreaterThanOrEqual(0);
  });

  it('opens the shop of the stub dealer through the talk menu', async () => {
    const { session, live } = await inA10(7);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    const dealer = session.campaign.tactical?.state.soldiers.find((s) => s?.profile === DEALER);
    if (!dealer) throw new Error('no dealer');
    const moved = session.dispatch({ type: 'move', soldier: merc, to: dealer.gridNo + 2, mode: 'walk' });
    expect(moved.ok).toBe(true);
    live.advance({ idle: true });
    const opened = session.dispatch({ type: 'talk', soldier: merc, target: dealer.id });
    expect(conversation(opened)?.menu).toContain('buySell:buySell');
    const shop = session.dispatch({ type: 'approach', kind: 'buySell' });
    expect(shop).toMatchObject({ ok: true, data: { conversation: null, shop: { kind: 'buySell' } } });
    expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  });
});
