import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString, type Sector, sectorShortString, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { NpcRequestPromptView, StrategicSectorView } from '../protocol/view.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
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

const SKYRIDER = 97;
const FRED = 106;
const DRASSEN_DEALER = 147;
const HELIPAD = 54 * 160 + 42;
const MINE_OFFICE = 66 * 160 + 73;
const MINE_OFFICE_DOOR = 66 * 160 + 74;
const SHOP = 52 * 160 + 74;
const SHOP_DOOR = 52 * 160 + 75;
const ROUTE_BUDGET = 20;
const ROUTE_SLICE_SECONDS = 2 * 3600;
const DAY_SECONDS = 24 * 3600;
const TRAINING_SLICE_SECONDS = 6 * 3600;
const TRAINING_BUDGET = 12;
const LOYALTY_TO_TRAIN = 20;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function landedCampaign(seed: number, quiet: readonly string[]): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 3, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const name of ['A9', ...quiet]) Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), noGarrison());
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return { session, live: new ReloadingSession('kinds', session) };
}

function noGarrison() {
  return { numAdmins: 0, numTroops: 0, numElites: 0 };
}

function teleportSquad(session: CampaignSession, sector: Sector): void {
  const c = session.campaign;
  const ctx = c.strategic;
  if (!ctx || !c.battle) throw new Error('no strategic layer');
  for (const m of c.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

function sectorView(session: CampaignSession, name: string): StrategicSectorView | undefined {
  return session.view().strategic?.sectors.find((s) => s.sector === name);
}

function routeSquadTo(c: Campaign, name: string): SimEvent[] {
  const first = c.session.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(c.session.dispatch({ type: 'route', soldier: first.id, to: name })).toMatchObject({ ok: true });
  const events: SimEvent[] = [];
  const there = () => c.session.view().strategic?.mercs.every((m) => m.sector === name && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !there(); k++) events.push(...c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS }).events);
  expect(there()).toBe(true);
  return events;
}

async function enter(c: Campaign, name: string): Promise<void> {
  const command = { type: 'enterSector', sector: name };
  await c.session.prepare(command);
  expect(c.session.dispatch(command)).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
}

function placedProfiles(session: CampaignSession): number[] {
  return (session.campaign.tactical?.state.soldiers ?? []).filter((s) => s?.placed && s.team === Team.CIV).map((s) => s?.profile ?? -1);
}

function soldierOfProfile(session: CampaignSession, profile: number): number {
  const s = session.campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === profile);
  if (!s) throw new Error(`profile ${profile} is not in the sector`);
  return s.id;
}

function talkThrough(c: Campaign, cmd: Record<string, unknown>): void {
  const result = c.session.dispatch({ type: String(cmd.type), ...cmd });
  expect(result.ok, result.reason).toBe(true);
  c.live.advance({ idle: true });
}

function talk(c: Campaign, merc: number, npc: number): number[] {
  talkThrough(c, { type: 'talk', soldier: merc, target: { npc } });
  return c.session.view().conversation?.lastQuotes.map((q) => q.quote) ?? [];
}

function walkTo(c: Campaign, merc: number, gridNo: number): void {
  const moved = c.session.dispatch({ type: 'move', soldier: merc, to: gridNo, mode: 'walk' });
  expect(moved.ok, moved.reason).toBe(true);
  c.live.advance({ idle: true });
  expect(c.session.campaign.tactical?.state.soldiers[merc]?.gridNo).toBe(gridNo);
}

function openDoor(c: Campaign, merc: number, gridNo: number): void {
  const opened = c.session.dispatch({ type: 'door', soldier: merc, gridNo, action: 'open' });
  expect(opened.ok, opened.reason).toBe(true);
  c.live.advance({ idle: true });
}

function firstMerc(session: CampaignSession): number {
  const merc = session.view().strategic?.mercs[0];
  if (!merc) throw new Error('no merc');
  return merc.id;
}

describe('stub sector kinds in a campaign', () => {
  it('liberates a stub mine whose head miner starts it, pays for it the next day and trains militia in the town', async () => {
    const c = await landedCampaign(61, ['B13', 'C13', 'D13']);
    teleportSquad(c.session, parseSectorString('C13'));
    routeSquadTo(c, 'D13');
    expect(sectorView(c.session, 'D13')?.playerControlled).toBe(true);
    await enter(c, 'D13');
    expect(c.session.view().mapPath).toBe('stubs/world/maps/d13.dat');
    expect(placedProfiles(c.session)).toContain(FRED);
    openDoor(c, firstMerc(c.session), MINE_OFFICE_DOOR);
    walkTo(c, firstMerc(c.session), MINE_OFFICE);
    expect(talk(c, firstMerc(c.session), FRED)).toEqual([0]);
    expect(c.session.dispatch({ type: 'closeTalk' })).toMatchObject({ ok: true });
    c.live.advance({ ticks: 10 });
    expect(c.session.campaign.state.economy.mines.find((m) => m.spokeToHeadMiner)).toBeDefined();
    expect(c.session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const events: SimEvent[] = [];
    for (let k = 0; k < 4 && !events.some((e) => e.type === 'mineIncome'); k++)
      events.push(...c.live.advance({ worldSeconds: DAY_SECONDS / 2 }).events);
    expect(events.map((e) => e.type)).toContain('mineIncome');
    const deposit = c.session.campaign.state.finances.ledger.find((r) => r.code === FinanceCode.DEPOSIT_FROM_SILVER_MINE);
    expect(deposit?.amount ?? 0).toBeGreaterThan(0);

    const drassen = c.session.campaign.state.economy.towns[sectorView(c.session, 'D13')?.town ?? -1];
    if (drassen) drassen.rating = Math.max(drassen.rating, LOYALTY_TO_TRAIN);
    const trainer = firstMerc(c.session);
    const assigned = c.session.dispatch({ type: 'assign', soldiers: [trainer], to: { kind: 'trainMilitia' } });
    expect(assigned.ok, assigned.reason).toBe(true);
    const prompt = c.session.view().prompt;
    if (prompt?.kind === 'militiaPayment') expect(c.session.dispatch({ type: 'answer', choice: 'yes' })).toMatchObject({ ok: true });
    const trained: SimEvent[] = [];
    for (let k = 0; k < TRAINING_BUDGET && !trained.some((e) => e.type === 'militiaTrained'); k++) {
      const report = c.live.advance({ worldSeconds: TRAINING_SLICE_SECONDS });
      trained.push(...report.events);
      if (c.session.view().prompt?.kind === 'militiaContinue') c.session.dispatch({ type: 'answer', choice: 'no' });
    }
    expect(trained.map((e) => e.type)).toContain('militiaTrained');
    expect((sectorView(c.session, 'D13')?.militia ?? []).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('takes a stub SAM site and a stub town with its dealer', async () => {
    const c = await landedCampaign(62, ['C13', 'D14', 'D15']);
    teleportSquad(c.session, parseSectorString('D14'));
    routeSquadTo(c, 'D15');
    expect(sectorView(c.session, 'D15')?.playerControlled).toBe(true);
    const ctx = c.session.campaign.strategic;
    if (!ctx) throw new Error('no strategic layer');
    const d15 = parseSectorString('D15');
    expect(ctx.state.map.elements[strategicIndex(d15)]?.enemyControlled).toBe(false);
    await enter(c, 'D15');
    expect(c.session.view().mapPath).toBe('stubs/world/maps/d15.dat');
    expect(c.session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    teleportSquad(c.session, parseSectorString('C13'));
    await enter(c, 'C13');
    expect(c.session.view().mapPath).toBe('stubs/world/maps/c13.dat');
    expect(placedProfiles(c.session)).toContain(DRASSEN_DEALER);
    openDoor(c, firstMerc(c.session), SHOP_DOOR);
    walkTo(c, firstMerc(c.session), SHOP);
    const keeper = c.session.campaign.tactical?.state.soldiers[soldierOfProfile(c.session, DRASSEN_DEALER)]?.gridNo ?? 0;
    expect(c.session.dispatch({ type: 'turn', soldier: firstMerc(c.session), toward: keeper })).toMatchObject({ ok: true });
    c.live.advance({ idle: true });
    const dealer = c.session.view().soldiers.find((s) => s.profile === DRASSEN_DEALER);
    expect(dealer?.merchant).toBe('buySell');
    const opened = c.session.dispatch({ type: 'openShop', dealer: DRASSEN_DEALER, soldier: firstMerc(c.session) });
    expect(opened.ok, opened.reason).toBe(true);
  });

  it('escorts Skyrider from his farm to the Drassen helipad and gets his helicopter', async () => {
    const c = await landedCampaign(63, ['B13']);
    const skyrider = c.session.campaign.narrative.profile(SKYRIDER);
    if (!skyrider) throw new Error('no Skyrider');
    const farm: Sector = { x: skyrider.sectorX, y: skyrider.sectorY, z: 0 };
    Object.assign(sectorInfo(c.session.campaign.state.map, farm), noGarrison());
    teleportSquad(c.session, farm);
    await enter(c, sectorShortString(farm));
    expect(c.session.view().mapPath).toBe(`stubs/world/maps/${sectorShortString(farm).toLowerCase()}_a.dat`);
    const merc = firstMerc(c.session);
    expect(talk(c, merc, SKYRIDER)).toEqual([0]);
    talkThrough(c, { type: 'approach', kind: 'recruit' });
    const prompt = c.session.view().npcRequest as NpcRequestPromptView | null | undefined;
    expect(prompt).toMatchObject({ request: 'escort', npc: SKYRIDER });
    talkThrough(c, { type: 'answer', prompt: prompt?.id, choice: 'yes' });
    if (c.session.view().conversation) c.session.dispatch({ type: 'closeTalk' });
    expect(c.session.campaign.battle?.roster.byProfile(SKYRIDER)).toBeDefined();
    expect(c.session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    teleportSquad(c.session, parseSectorString('B13'));
    await enter(c, 'B13');
    expect(c.session.view().mapPath).toBe('stubs/world/maps/b13.dat');
    c.session.drainEvents();
    const escort = soldierOfProfile(c.session, SKYRIDER);
    expect(c.session.dispatch({ type: 'move', soldier: escort, to: HELIPAD, mode: 'walk' })).toMatchObject({ ok: true });
    const events = c.live.advance({ idle: true }).events;
    const all = [...events, ...c.session.drainEvents()].map((e) => e.type);
    expect(all).toContain('helicopterSetUp');
    expect(c.session.view().strategic?.helicopter).toBeDefined();
  });
});
