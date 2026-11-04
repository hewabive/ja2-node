import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { TICK_MS } from '../sim/clock.ts';
import { createItem } from '../sim/items/object.ts';
import { TacticalModal } from '../sim/narrative/talk-state.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { MercQuote } from '../sim/tactical/narrative/merc-quotes.ts';
import { type Soldier, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import { addItemToPool, Visibility } from '../sim/tactical/world-items.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { saveRefusal } from './save-rules.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const SURE_TRAP = 1;
const QUOTE_TICKS = 3000;
const FROZEN_TICKS = 20;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function squadInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  const live = new ReloadingSession('stop-time quote', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

function tactical(c: Campaign): TacticalState {
  const t = c.session.campaign.tactical?.state;
  if (!t) throw new Error('no sector is loaded');
  return t;
}

function kestrel(c: Campaign): Soldier {
  const s = tactical(c).soldiers.find((m) => m?.placed && m.team === Team.OUR && m.profile === KESTREL);
  if (!s) throw new Error('Kestrel is not in the sector');
  return s;
}

function tacticalModal(c: Campaign): number {
  return c.session.campaign.talk?.talk.tacticalModal ?? TacticalModal.OFF;
}

async function spotTrap(c: Campaign): Promise<number> {
  const t = tactical(c);
  const merc = kestrel(c);
  const canteen = t.content.items.byName.get('CANTEEN')?.index ?? 0;
  const o = createItem(t.content.items, canteen, 100);
  o.trap = SURE_TRAP;
  addItemToPool(t, merc.gridNo, o, Visibility.VISIBLE, 0);
  const pickUp = { type: 'pickUp', soldier: merc.id };
  await c.session.prepare(pickUp);
  expect(c.session.dispatch(pickUp)).toMatchObject({ ok: true });
  const said = c.live.advance({ events: ['mercQuote'], ticks: QUOTE_TICKS }).events;
  expect(said).toContainEqual(expect.objectContaining({ type: 'mercQuote', profile: KESTREL, id: MercQuote.BOOBYTRAP_ITEM }));
  return merc.gridNo;
}

describe('the booby-trap quote in a campaign stops time (Dialogue_Control.cc CheckForStopTimeQuotes, GameScreen.cc HandleModalTactical)', () => {
  it('runs one more tactical frame, then only the dialogue and the clocks until the line ends, then asks to disarm', async () => {
    const c = await squadInA9(93);
    const gridNo = await spotTrap(c);
    expect(tacticalModal(c)).toBe(TacticalModal.ENTERED);
    const tick = tactical(c).tick;
    c.live.advance({ ticks: 1 });
    expect(tactical(c).tick).toBe(tick + 1);
    const clockMs = tactical(c).clockMs;
    c.live.advance({ ticks: FROZEN_TICKS });
    expect(tacticalModal(c)).toBe(TacticalModal.FROZEN);
    expect(tactical(c).tick).toBe(tick + 1);
    expect(tactical(c).clockMs).toBe(clockMs + FROZEN_TICKS * TICK_MS);
    expect(c.session.campaign.state.realMs).toBe(tactical(c).clockMs);
    const seconds = c.session.campaign.state.clock.seconds;
    const report = c.live.advance({ idle: true });
    expect(report.reason).toBe('decision');
    expect(tacticalModal(c)).toBe(TacticalModal.OFF);
    expect(tactical(c).tick).toBe(tick + 1);
    expect(c.session.campaign.state.clock.seconds).toBeGreaterThan(seconds);
    expect(c.session.view().prompt).toEqual({
      id: expect.stringMatching(/^disarmTrap-\d+-1$/),
      kind: 'disarmTrap',
      soldier: kestrel(c).id,
      gridNo,
      buried: false,
      item: 'CANTEEN',
      choices: ['yes', 'no'],
    });
  });

  it('refuses orders and saves while the line plays, and every command but the answer while the box is up', async () => {
    const c = await squadInA9(81);
    const gridNo = await spotTrap(c);
    const move = { type: 'move', soldier: kestrel(c).id, to: gridNo + 2 };
    expect(c.session.dispatch(move)).toMatchObject({ ok: false, data: { refusal: 'stopTimeQuote' } });
    expect(saveRefusal(c.session)).toBe('stopTimeQuote');
    c.live.advance({ idle: true });
    expect(c.session.dispatch(move)).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
    expect(c.session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
    expect(saveRefusal(c.session)).toBe('promptOpen');
    const campaign = c.session.campaign;
    const before = [campaign.tick, campaign.state.realMs];
    campaign.step();
    expect([campaign.tick, campaign.state.realMs]).toEqual(before);
    expect(c.live.advance({ ticks: FROZEN_TICKS }).reason).toBe('decision');
    expect(c.live.dispatch({ type: 'answer', choice: 'no' })).toMatchObject({ ok: true });
    expect(c.session.view().prompt ?? null).toBeNull();
    expect(c.session.dispatch(move)).toMatchObject({ ok: true });
  });
});
