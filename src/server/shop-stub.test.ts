import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armSquadWithPistols } from '../../tests/support/pistol-kit.ts';
import { expectReloadsInvisible, RELOAD_TEST_TIMEOUT_MS, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../content/world/grid.ts';
import type { ShopView } from '../protocol/view.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const DEALER = 91;
const REPAIRMAN = 128;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const REPAIR_WAIT_SECONDS = 3600;

async function inA10(seed: number, mode?: RunMode): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  armSquadWithPistols(created, kit.content.items);
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
  return session;
}

function soldierOf(session: CampaignSession, profile: number) {
  const s = session.campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === profile);
  if (!s) throw new Error(`profile ${profile} is not in the sector`);
  return s;
}

function walkNextTo(session: CampaignSession, merc: number, dealer: number): void {
  const t = session.campaign.tactical?.state;
  const target = soldierOf(session, dealer).gridNo;
  const from = t?.soldiers[merc]?.gridNo ?? 0;
  if (pythSpacesAway(from, target) <= 2) return;
  const live = new ReloadingSession('t', session);
  const to = target + 2;
  expect(session.dispatch({ type: 'move', soldier: merc, to, mode: 'walk' })).toMatchObject({ ok: true });
  live.advance({ idle: true });
}

describe('stub dealers in A10', () => {
  it('stand as merchants a stub squad reaches from the start sector without a fight', async () => {
    const session = await inA10(3);
    const view = session.view();
    expect(view.mapPath).toBe('stubs/world/maps/a10.dat');
    const labels = view.soldiers.filter((s) => s.team === Team.CIV && s.merchant).map((s) => [s.name, s.merchant]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ['Okonjo', 'buySell'],
        ['Castell', 'repair'],
      ]),
    );
  });

  it(
    'buy and sell at the dealer, then a repair at the repairman, the same across reloads',
    async () => {
      await expectReloadsInvisible(tradeAndRepair);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});

async function tradeAndRepair(mode?: RunMode): Promise<CampaignSession> {
  const session = await inA10(4, mode);
  const merc = session.view().strategic?.mercs[0]?.id ?? 0;
  walkNextTo(session, merc, DEALER);
  const opened = session.dispatch({ type: 'openShop', dealer: DEALER, soldier: merc });
  expect(opened).toMatchObject({ ok: true, data: { kind: 'buySell' } });
  const shop = opened.data as ShopView;
  const box = shop.boxes.find((b) => b.unitPrice !== undefined && b.unitPrice <= shop.balance);
  if (!box) throw new Error('the dealer sells nothing affordable');
  const buy = { buy: [{ item: box.key.item, element: box.key.element, count: 1 }], useBalance: true };
  expect(session.dispatch({ type: 'quoteTrade', ...buy })).toMatchObject({ ok: true });
  const balance = session.campaign.state.finances.balance;
  expect(session.dispatch({ type: 'trade', ...buy })).toMatchObject({ ok: true });
  expect(session.campaign.state.finances.balance).toBeLessThan(balance);
  const inv = session.campaign.tactical?.state.soldiers[merc]?.inv ?? [];
  const slot = inv.findIndex((o) => o?.item === kit.content.items.byName.get('CLIP9_15')?.index);
  expect(slot).toBeGreaterThanOrEqual(0);
  const sell = { sell: [{ soldier: merc, slot, index: 0 }] };
  const quoted = session.dispatch({ type: 'quoteTrade', ...sell });
  expect(quoted).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'trade', ...sell })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });

  walkNextTo(session, merc, REPAIRMAN);
  const gun = session.campaign.tactical?.state.soldiers[merc]?.inv[5];
  if (!gun?.item) throw new Error('no gun in hand');
  gun.status[0] = 60;
  expect(session.dispatch({ type: 'openShop', dealer: REPAIRMAN, soldier: merc })).toMatchObject({ ok: true, data: { kind: 'repair' } });
  const repair = { repair: [{ soldier: merc, slot: 'hand' }], useBalance: true };
  const estimate = session.dispatch({ type: 'quoteTrade', ...repair });
  expect(estimate).toMatchObject({ ok: true, data: { repair: [{ item: 'GLOCK_17', owner: 0 }] } });
  expect((estimate.data as { refusal?: unknown }).refusal ?? null).toBeNull();
  expect(session.dispatch({ type: 'trade', ...repair })).toMatchObject({ ok: true });
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  new ReloadingSession('t', session).advance({ worldSeconds: REPAIR_WAIT_SECONDS });
  expect(session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
  session.drainEvents();
  expect(session.dispatch({ type: 'openShop', dealer: REPAIRMAN, soldier: merc })).toMatchObject({ ok: true });
  const events = session.drainEvents().map((e) => e.type);
  expect(events).toContain('repairCollected');
  expect(session.campaign.tactical?.state.soldiers[merc]?.inv[5]?.status[0]).toBe(100);
  expect(session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
  return session;
}
