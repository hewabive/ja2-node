import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { ItemClass, ItemFlags } from '../content/items/items.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../content/world/grid.ts';
import type { ShopBoxView, ShopView } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { header } from '../sim/strategic/economy/merchants/state.ts';
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

const DEALER = 91;
const TONY = 0;
const TALKER = 94;
const RIFLE = 'SKS';
const MAGAZINE = 'CLIP762W_10_AP';
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const AID_SLICE_TICKS = 2000;
const AID_SLICES = 40;
const SLOW_SCENARIO_MS = 60_000;

interface Squad {
  readonly session: CampaignSession;
  readonly live: Session;
  readonly mercs: readonly number[];
}

async function inA10(seed: number): Promise<Squad> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const mercs = session.view().strategic?.mercs.map((m) => m.id) ?? [];
  expect(session.dispatch({ type: 'route', soldier: mercs[0], to: 'A10' })).toMatchObject({ ok: true });
  const live = new ReloadingSession('inv', session);
  const there = () => session.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !there(); k++) live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live, mercs };
}

function soldier(squad: Squad, id: number): Soldier {
  const s = squad.session.campaign.tactical?.state.soldiers[id];
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function walkNextToDealer(squad: Squad, merc: number): void {
  const t = squad.session.campaign.tactical?.state;
  const dealer = t?.soldiers.find((s) => s?.placed && s.profile === DEALER);
  if (!dealer) throw new Error('the dealer is not in A10');
  if (pythSpacesAway(soldier(squad, merc).gridNo, dealer.gridNo) <= 2) return;
  expect(squad.session.dispatch({ type: 'move', soldier: merc, to: dealer.gridNo + 2, mode: 'walk' })).toMatchObject({ ok: true });
  squad.live.advance({ idle: true });
}

const def = (name: string) => kit.content.items.byName.get(name);

function rifleBox(shop: ShopView): ShopBoxView | undefined {
  return shop.boxes.find((b) => {
    const d = def(b.item);
    return d?.itemClass === ItemClass.GUN && (d.flags & ItemFlags.TWO_HANDED) !== 0 && (b.unitPrice ?? Infinity) <= shop.balance;
  });
}

function slotOf(s: Soldier, item: string): number {
  return s.inv.findIndex((o) => o.item === def(item)?.index);
}

function events(report: { readonly events: readonly SimEvent[] }, type: string): SimEvent[] {
  return report.events.filter((e) => e.type === type);
}

describe('inventory commands in a stub campaign', { timeout: SLOW_SCENARIO_MS }, () => {
  it('buys a rifle and magazines from the dealer, puts the rifle into the hand, reloads it, fires it, unloads and reloads by hand', async () => {
    const squad = await inA10(4);
    const merc = squad.mercs[0] as number;
    walkNextToDealer(squad, merc);
    const merchants = squad.session.campaign.state.merchants;
    for (const name of [RIFLE, MAGAZINE]) {
      const stocked = header(merchants, TONY, def(name)?.index ?? -1);
      stocked.total = Math.max(stocked.total, 2);
      stocked.perfect = Math.max(stocked.perfect, 2);
    }
    const opened = squad.session.dispatch({ type: 'openShop', dealer: DEALER, soldier: merc });
    expect(opened).toMatchObject({ ok: true, data: { kind: 'buySell' } });
    const shop = opened.data as ShopView;
    const rifle = rifleBox(shop);
    const magazines = shop.boxes.find((b) => b.item === MAGAZINE);
    if (!rifle || !magazines) throw new Error(`no rifle or magazine: ${shop.boxes.map((b) => `${b.item}:${b.unitPrice}`).join(', ')}`);
    const buy = [
      { ...rifle.key, count: 1 },
      { ...magazines.key, count: 2 },
    ];
    expect(squad.session.dispatch({ type: 'trade', buy, useBalance: true })).toMatchObject({ ok: true });
    expect(squad.session.dispatch({ type: 'closeShop' })).toEqual({ ok: true });
    const s = () => soldier(squad, merc);
    const bought = slotOf(s(), rifle.item);
    expect(bought).toBeGreaterThan(InvSlot.HAND);
    expect(squad.session.dispatch({ type: 'moveItem', soldier: merc, from: bought, to: 'hand' })).toMatchObject({ ok: true });
    squad.live.advance({ idle: true });
    expect(s().inv[InvSlot.HAND]?.item).toBe(def(rifle.item)?.index);
    expect(slotOf(s(), 'GLOCK_17')).toBe(bought);
    const reloaded = squad.session.dispatch({ type: 'reload', soldier: merc });
    expect(reloaded, reloaded.reason).toMatchObject({ ok: true });
    const shots = s().inv[InvSlot.HAND]?.gunShotsLeft ?? 0;
    expect(shots).toBe(def(MAGAZINE)?.magazine?.capacity);
    const target = s().gridNo + 6 * 160;
    expect(squad.session.dispatch({ type: 'attack', soldier: merc, target })).toMatchObject({ ok: true });
    const fired = squad.live.advance({ idle: true });
    expect(events(fired, 'shotFired')).toEqual(expect.arrayContaining([expect.objectContaining({ soldier: merc })]));
    expect(s().inv[InvSlot.HAND]?.gunShotsLeft).toBeLessThan(shots);
    const unloaded = squad.session.dispatch({ type: 'unload', soldier: merc });
    expect(unloaded, unloaded.reason).toMatchObject({ ok: true, data: { magazine: MAGAZINE } });
    expect(s().inv[InvSlot.HAND]?.gunShotsLeft).toBe(0);
    const full = s().inv.findIndex((o) => o.item === def(MAGAZINE)?.index && o.status[0] === shots);
    const byHand = squad.session.dispatch({ type: 'reload', soldier: merc, ammo: full });
    expect(byHand, byHand.reason).toMatchObject({ ok: true, data: { shots } });
  });

  it('stops the bleeding of a wounded merc with a first aid kit put into the medic hand', async () => {
    const squad = await inA10(5);
    const [medic, patient] = squad.mercs as [number, number];
    const m = soldier(squad, medic);
    const p = soldier(squad, patient);
    const bleeding = () => soldier(squad, patient).bleeding;
    const kitItem = def('FIRSTAIDKIT');
    if (!kitItem) throw new Error('no first aid kit item');
    m.inv[InvSlot.SMALLPOCK1] = {
      ...structuredClone(m.inv[InvSlot.SMALLPOCK1] as NonNullable<(typeof m.inv)[number]>),
      item: kitItem.index,
      count: 1,
      status: [100],
    };
    p.life -= 20;
    p.bleeding = 15;
    expect(squad.session.dispatch({ type: 'bandage', soldier: medic, target: patient })).toMatchObject({
      ok: false,
      data: { refusal: 'noKit' },
    });
    expect(squad.session.dispatch({ type: 'moveItem', soldier: medic, from: 'smallPocket1', to: 'hand' })).toMatchObject({ ok: true });
    squad.live.advance({ idle: true });
    expect(squad.session.dispatch({ type: 'bandage', soldier: medic, target: patient })).toMatchObject({ ok: true });
    const seen: string[] = [];
    for (let k = 0; k < AID_SLICES && bleeding() > 0; k++)
      seen.push(...squad.live.advance({ ticks: AID_SLICE_TICKS }).events.map((e) => e.type));
    expect(bleeding()).toBe(0);
    expect(seen).toEqual(expect.arrayContaining(['firstAidStarted', 'bandaged', 'firstAidDone']));
    expect(soldier(squad, medic).inv[InvSlot.HAND]?.status[0]).toBeLessThan(100);
  });

  it('passes items between mercs and through the sector inventory on the map screen', async () => {
    const squad = await inA10(6);
    const [a, b] = squad.mercs as [number, number];
    const session = squad.session;
    session.drainEvents();
    const dropped = session.dispatch({ type: 'moveItem', soldier: a, from: slotOf(soldier(squad, a), 'CLIP9_15'), to: 'ground' });
    expect(dropped, dropped.reason).toMatchObject({ ok: true });
    squad.live.advance({ idle: true });
    expect(session.dispatch({ type: 'inventory', soldier: a })).toMatchObject({
      ok: true,
      data: { usable: false, refusal: 'tacticalOnly' },
    });
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const listed = session.dispatch({ type: 'inventory', soldier: a });
    expect(listed).toMatchObject({ ok: true, data: { sector: 'A10', usable: true } });
    const stash = (listed.data as { stash: { index: number; item: string; count: number; reachable: boolean }[] }).stash;
    const clips = stash.find((e) => e.item === 'CLIP9_15');
    expect(clips).toMatchObject({ count: 2, reachable: true });
    expect(session.dispatch({ type: 'moveItem', soldier: b, from: 'ground', item: clips?.index, to: 'smallPocket2' })).toMatchObject({
      ok: true,
    });
    expect(soldier(squad, b).inv[InvSlot.SMALLPOCK2]?.item).toBe(def('CLIP9_15')?.index);
    expect(session.dispatch({ type: 'moveItem', soldier: b, from: 'hand', toSoldier: a, to: 'secondHand' })).toMatchObject({ ok: true });
    expect(soldier(squad, a).inv[InvSlot.SECOND_HAND]?.item).toBe(def('GLOCK_17')?.index);
    expect(session.dispatch({ type: 'moveItem', soldier: a, from: 'secondHand', to: 'ground' })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'applyItem', soldier: a, slot: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'tacticalOnly' },
    });
    expect(session.drainEvents().filter((e) => e.type === 'itemMoved')).toHaveLength(3);
    expect(session.dispatch({ type: 'route', soldier: a, to: 'A9' })).toMatchObject({ ok: true });
    const gone = () => session.view().strategic?.mercs.every((m) => m.sector === 'A9' && !m.betweenSectors) === true;
    for (let k = 0; k < ROUTE_BUDGET && !gone(); k++) squad.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
    expect(session.campaign.tactical).toBeNull();
    const left = session.dispatch({ type: 'inventory', sector: 'A10' });
    expect(left).toMatchObject({ ok: true, data: { sector: 'A10', mercs: [] } });
    const pistol = (left.data as { stash: { index: number; item: string; reachable: boolean }[] }).stash.find((e) => e.item === 'GLOCK_17');
    expect(pistol).toMatchObject({ reachable: true });
    expect(
      session.dispatch({ type: 'moveItem', soldier: a, from: 'ground', sector: 'A10', item: pistol?.index, to: 'secondHand' }),
    ).toMatchObject({ ok: false, data: { refusal: 'notInSector' } });
  });

  it('lets time run on the map screen right after a conversation closes (finding 19)', async () => {
    const squad = await inA10(7);
    const merc = squad.mercs[0] as number;
    const talked = squad.session.dispatch({ type: 'talk', soldier: merc, target: { npc: TALKER } });
    expect(talked, talked.reason).toMatchObject({ ok: true });
    if ((talked.data as { walking?: boolean }).walking) squad.live.advance({ idle: true });
    expect(squad.session.view().conversation).toBeTruthy();
    expect(squad.session.dispatch({ type: 'closeTalk' })).toMatchObject({ ok: true });
    expect(squad.session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(squad.live.advance({ worldSeconds: 600 }).reason).toBe('worldTime');
  });
});
