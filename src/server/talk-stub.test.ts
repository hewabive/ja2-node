import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { StructureFlags } from '../content/world/structures.ts';
import { syntheticStructure } from '../content/world/synthetic.ts';
import type { ConversationView, ViewFrame } from '../protocol/view.ts';
import type { StopCondition } from '../sim/advance.ts';
import type { SimEvent } from '../sim/events.ts';
import { FINAL_TALKING_DELAY_TICKS, lineTicks, TICKS_PER_CHARACTER } from '../sim/narrative/dialogue-queue.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { questStatus } from '../sim/strategic/narrative/facts.ts';
import { Body, NO_PROFILE, Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { FRAME_TICKS, type Session } from './session.ts';

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
const THREE_TILES_SOUTH = 3 * 160;
const SCRIPTED_RECORD = 2;
const SETTLE_TICKS = 400;
const WAY_CLEAR_TICKS = 4_000;

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

function quotesOf(events: readonly SimEvent[]): number[] {
  return events.flatMap((e) => (e.type === 'npcQuote' ? [e.quote] : []));
}

function talkThrough(session: CampaignSession, live: Session, cmd: Record<string, unknown>, until: StopCondition = { idle: true }) {
  const result = session.dispatch({ type: String(cmd.type), ...cmd });
  expect(result.ok, result.reason).toBe(true);
  const report = live.advance(until);
  return { result, report, quotes: quotesOf(report.events) };
}

interface LineShown {
  readonly quote: number;
  readonly said: number;
  readonly shown: number;
}

function linesShownIn(frame: ViewFrame): LineShown[] {
  return (frame.events ?? []).flatMap((e) => (e.type === 'npcQuote' ? [{ quote: e.quote, said: e.tick, shown: frame.tick }] : []));
}

function linesShown(frames: readonly ViewFrame[]): LineShown[] {
  return frames.flatMap(linesShownIn);
}

function walkUpAndTalk(session: CampaignSession, live: Session, merc: number) {
  const { report } = talkThrough(session, live, { type: 'talk', soldier: merc, target: { npc: VASKO } });
  expect(report.reason).toBe('decision');
  return session.view().conversation ?? null;
}

describe('the stub NPC in A10', () => {
  it('talks: initial quote, approaches, a quest, a scripted walk and a tile trigger', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    const opened = walkUpAndTalk(session, live, merc);
    expect(opened).toMatchObject({ profile: VASKO, initiatedBy: 'player', talker: merc });
    expect(opened?.lastQuotes.map((q) => q.quote)).toEqual([10, 11]);
    expect(opened?.lastQuotes[0]?.text).toContain('Strangers');
    expect(live.advance({ ticks: 10 })).toMatchObject({ reason: 'refused' });
    expect(session.dispatch({ type: 'move', soldier: merc, to: 0 })).toMatchObject({ ok: false, data: { refusal: 'conversationOpen' } });

    const direct = talkThrough(session, live, { type: 'approach', kind: 'direct' });
    expect(direct.result.data).toMatchObject({ pending: true });
    expect(direct.quotes).toEqual([14, 15]);
    expect(direct.report.reason).toBe('decision');
    const n = () => session.campaign.state.narrative;
    expect(questStatus(n(), HERMIT_QUEST)).toBe(QUEST_IN_PROGRESS);
    expect(n().facts[HERMIT_FACT]).toBe(1);
    expect(talkThrough(session, live, { type: 'approach', kind: 'direct' }).quotes).toEqual([5]);
    expect(talkThrough(session, live, { type: 'approach', kind: 'repeat' }).quotes).toEqual([5]);

    const untilTheWalk: StopCondition = { idle: true, events: ['scriptedSequence'] };
    let walk = talkThrough(session, live, { type: 'approach', kind: 'friendly' }, untilTheWalk);
    if (walk.quotes.includes(13)) walk = talkThrough(session, live, { type: 'approach', kind: 'friendly' }, untilTheWalk);
    expect(walk.quotes).toContain(16);
    expect(walk.quotes).toContain(17);
    expect(walk.report.reason).toBe('event');
    expect(session.view().conversation ?? null).toBeNull();
    expect(session.view().scriptedSequence).toBe(true);
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
    expect(questStatus(n(), HERMIT_QUEST)).toBe(QUEST_DONE);

    expect(session.dispatch({ type: 'closeTalk' })).toEqual({ ok: true });
    expect(session.view().conversation).toBeNull();
    expect(session.view().scriptedSequence).toBeUndefined();
    expect(live.advance({ ticks: 10 }).reason).toBe('ticks');
  });

  it('returns a conversation command at once and says its lines in the ticks after it, each in the frame of its tick', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    const frames: ViewFrame[] = [];
    live.subscribe((m) => {
      if (m.t === 'frames') frames.push(...m.frames);
    });
    const start = session.tick;
    expect(session.view().conversation?.busy).toBe(false);
    expect(live.dispatch({ type: 'approach', kind: 'direct' })).toMatchObject({ ok: true, data: { pending: true } });
    expect(session.tick).toBe(start);
    expect(session.view().conversation?.busy).toBe(true);
    expect(live.advance({ idle: true }).reason).toBe('decision');
    expect(session.view().conversation?.busy).toBe(false);
    const shown = linesShown(frames);
    expect(shown.map((l) => l.quote)).toEqual([14, 15]);
    expect(shown.every((l) => l.shown >= l.said && l.shown - l.said < FRAME_TICKS)).toBe(true);
    const [first, second] = shown;
    expect(first?.said).toBe(start + 1);
    const said = frames.flatMap((f) => f.events ?? []).find((e) => e.type === 'npcQuote');
    expect((second?.said ?? start) - (first?.said ?? start)).toBe(lineTicks(said?.type === 'npcQuote' ? said.chars : 0));
    const busy = frames.filter((f) => f.conversation !== undefined).map((f) => [f.tick, f.conversation?.busy]);
    expect(busy.at(-1)).toEqual([session.tick, false]);
    expect(busy.slice(0, -1).every(([, b]) => b === true)).toBe(true);
  });

  it('cuts a line short on skipLine, so the next one follows on the next tick, and ignores a skip of a line already over', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    expect(session.dispatch({ type: 'approach', kind: 'direct' }).ok).toBe(true);
    const first = live.advance({ events: ['npcQuote'] }).events.find((e) => e.type === 'npcQuote');
    expect(first).toMatchObject({ quote: 14, tick: session.tick });
    const skip = { type: 'skipLine', profile: VASKO, tick: first?.tick };
    expect(session.dispatch(skip)).toEqual({ ok: true, data: { skipped: true } });
    const next = live.advance({ events: ['npcQuote'] }).events;
    expect(next.find((e) => e.type === 'lineCut')).toMatchObject({ profile: VASKO, saidAt: first?.tick, tail: false });
    const second = next.find((e) => e.type === 'npcQuote');
    expect(second).toMatchObject({ quote: 15, tick: (first?.tick ?? 0) + 1 });
    expect(session.dispatch(skip)).toEqual({ ok: true, data: { skipped: false } });
    expect(session.dispatch({ type: 'skipLine', profile: DEALER })).toEqual({ ok: true, data: { skipped: false } });
    expect(session.dispatch({ type: 'skipLine' })).toEqual({ ok: true, data: { skipped: true } });
    expect(session.campaign.talk?.frozen()).toBe(true);
  });

  it('ends a line 300 ms after a viewer said it without a voice, as the original closes the mouth first', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    expect(session.dispatch({ type: 'approach', kind: 'direct' }).ok).toBe(true);
    const first = live.advance({ events: ['npcQuote'] }).events.find((e) => e.type === 'npcQuote');
    const talkOver = { type: 'skipLine', profile: VASKO, tick: first?.tick, talkEnded: true };
    expect(session.dispatch(talkOver)).toEqual({ ok: true, data: { skipped: true } });
    expect(session.dispatch(talkOver)).toEqual({ ok: true, data: { skipped: false } });
    const next = live.advance({ events: ['npcQuote'] }).events;
    expect(next.filter((e) => e.type === 'lineCut')).toEqual([
      expect.objectContaining({ profile: VASKO, saidAt: first?.tick, tail: true }),
    ]);
    expect(next.find((e) => e.type === 'npcQuote')).toMatchObject({ quote: 15, tick: (first?.tick ?? 0) + FINAL_TALKING_DELAY_TICKS });
  });

  it('says every line for one tick under setSpeech skip, kept across a load of the session', async () => {
    const { session, live } = await inA10(5);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    expect(live.dispatch({ type: 'setSpeech', mode: 'loud' })).toMatchObject({ ok: false, data: { refusal: 'unknownSpeech' } });
    expect(live.dispatch({ type: 'setSpeech', mode: 'skip' })).toEqual({ ok: true, data: { speech: 'skip' } });
    walkUpAndTalk(session, live, merc);
    const start = session.tick;
    const direct = talkThrough(session, live, { type: 'approach', kind: 'direct' });
    expect(direct.quotes).toEqual([14, 15]);
    expect(direct.report.events.filter((e) => e.type === 'npcQuote').every((e) => e.skipped === true)).toBe(true);
    expect(direct.report.tick - start).toBeLessThanOrEqual(3);
    expect(
      live.log
        .full()
        .entries.filter((e) => e.kind === 'speech')
        .map((e) => e.payload),
    ).toEqual([{ mode: 'skip' }]);
    expect(live.dispatch({ type: 'setSpeech', mode: 'listen' }).ok).toBe(true);
    const listened = talkThrough(session, live, { type: 'approach', kind: 'direct' });
    expect(listened.report.tick - start).toBeGreaterThan(TICKS_PER_CHARACTER);
    expect(listened.report.events.some((e) => e.type === 'npcQuote' && e.skipped)).toBe(false);
  });

  it('gives defaults once and then sends the squad away, the same day opens silently', async () => {
    const { session, live } = await inA10(6);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    walkUpAndTalk(session, live, merc);
    expect(talkThrough(session, live, { type: 'approach', kind: 'threaten' }).quotes).toEqual([19]);
    expect(session.view().conversation ?? null).toBeNull();
    const again = talkThrough(session, live, { type: 'talk', soldier: merc, target: { npc: VASKO } });
    expect(again.quotes).toEqual([]);
    expect(conversation(again.result)).toMatchObject({ profile: VASKO });
    expect(talkThrough(session, live, { type: 'approach', kind: 'recruit' }).quotes).toEqual([7]);
    expect(talkThrough(session, live, { type: 'approach', kind: 'recruit' }).quotes).toEqual([9]);
    expect(session.view().conversation ?? null).toBeNull();
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
    talkThrough(session, live, { type: 'approach', kind: 'direct' });
    const asked = talkThrough(session, live, { type: 'approach', kind: 'recruit' });
    expect(asked.quotes).toEqual([20]);
    expect(asked.report.reason).toBe('decision');
    const request = session.view().npcRequest;
    expect(request).toMatchObject({ kind: 'npcRequest', request: 'lie', npc: VASKO, choices: ['yes', 'no', 'lie'] });
    expect(session.view().conversation ?? null).toBeNull();
    const tick = session.campaign.tick;
    expect(live.advance({ ticks: 10 }).reason).toBe('decision');
    expect(session.campaign.tick).toBe(tick);
    expect(session.dispatch({ type: 'move', soldier: merc, to: 0 }).ok).toBe(false);
    expect(session.dispatch({ type: 'answer', choice: 'maybe' })).toMatchObject({ ok: false });
    const answered = talkThrough(session, live, { type: 'answer', prompt: request?.id, choice: 'no' });
    expect(session.view().npcRequest ?? null).toBeNull();
    expect(answered.quotes).toEqual([22]);
    expect(session.view().conversation).toMatchObject({ profile: VASKO, initiatedBy: 'npc' });
    expect(session.view().conversation?.lastQuotes.map((q) => q.quote)).toEqual([22]);
  });

  it('continues exactly when the session is saved and restored after every input', async () => {
    await expectReloadsInvisible(async (mode) => {
      const { session, live } = await inA10(9, mode);
      const merc = session.view().strategic?.mercs[0]?.id ?? 0;
      walkUpAndTalk(session, live, merc);
      talkThrough(session, live, { type: 'approach', kind: 'direct' });
      talkThrough(session, live, { type: 'approach', kind: 'recruit' });
      live.advance({ ticks: 10 });
      talkThrough(session, live, { type: 'answer', prompt: session.view().npcRequest?.id, choice: 'no' });
      talkThrough(session, live, { type: 'approach', kind: 'friendly' });
      session.dispatch({ type: 'approach', kind: 'friendly' });
      live.advance({ idle: true });
      session.dispatch({ type: 'closeTalk' });
      live.advance({ ticks: 200 });
      return session;
    });
  });

  it('lets an unnamed civilian bark a civilian quote instead of opening a panel, the same across reloads', async () => {
    await expectReloadsInvisible(civilianBark);
  });

  it('opens the shop of the stub dealer through the talk menu', async () => {
    const { session, live } = await inA10(7);
    const merc = session.view().strategic?.mercs[0]?.id ?? 0;
    const dealer = session.campaign.tactical?.state.soldiers.find((s) => s?.profile === DEALER);
    if (!dealer) throw new Error('no dealer');
    const moved = session.dispatch({ type: 'move', soldier: merc, to: dealer.gridNo + 2, mode: 'walk' });
    expect(moved.ok).toBe(true);
    live.advance({ idle: true });
    const opened = talkThrough(session, live, { type: 'talk', soldier: merc, target: dealer.id });
    expect(session.view().conversation?.menu).toContain('buySell:buySell');
    expect(conversation(opened.result)?.menu).toContain('buySell:buySell');
    const shop = session.dispatch({ type: 'approach', kind: 'buySell' });
    expect(shop).toMatchObject({ ok: true, data: { conversation: null, shop: { kind: 'buySell' } } });
    expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  });

  it('keeps Vasko walking to his own tile for good once a scripted tile under four tiles away cannot be reached, even after the way clears (kept quirk)', async () => {
    const { session, live } = await inA10(13);
    const sector = () => {
      const t = session.campaign.tactical?.state;
      if (!t) throw new Error('no sector');
      return t;
    };
    const vasko = () => {
      const s = sector().soldiers.find((x) => x?.placed && x.profile === VASKO);
      if (!s) throw new Error('no Vasko');
      return s;
    };
    const home = vasko().gridNo;
    const blocked = home + THREE_TILES_SOUTH;
    const block = sector().world.structures.add(blocked, 0, syntheticStructure(StructureFlags.GENERIC));
    if (!block) throw new Error('the tile cannot be blocked');
    sector().narrative.npcGotoGridNo(VASKO, blocked, SCRIPTED_RECORD);
    live.advance({ ticks: SETTLE_TICKS });
    expect(vasko().absoluteFinalDestination).toBe(home);
    sector().world.structures.remove(block);
    live.advance({ ticks: WAY_CLEAR_TICKS });
    expect([vasko().gridNo, vasko().absoluteFinalDestination, vasko().quoteRecord]).toEqual([home, home, SCRIPTED_RECORD + 1]);
  });
});

async function civilianBark(mode: RunMode): Promise<CampaignSession> {
  const { session, live } = await inA10(11, mode);
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
  expect(session.campaign.tactical?.state.soldiers[villager.id]?.currentCivQuote).toBeGreaterThanOrEqual(0);
  return session;
}
