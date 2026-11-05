import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import type { MessageEntry } from '../../protocol/message-log.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import type { TacticalState } from '../tactical/state.ts';
import { HistoryCode, Quote } from './contracts/quotes.ts';
import type { RosterMerc } from './roster.ts';
import { sectorKey } from './sector-diff.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const LANDING = 'A9';
const ELSEWHERE = 'B9';
const SUSPICIOUS_DEATH = 1;
const INSURED_LONG_AGO = 0;
const LAST_LIFE_POINT = 1;
const BLOOD_LOSS_LIFE = 1;
const BLOOD_LOSS_BREATH = 100;
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;
const AFTER_THE_SKULL = { ticks: 2000 };
const LINE_TICKS = { ticks: 3000 };
const COLLAPSED_LIFE = 5;
const COLLAPSE_TICKS = { ticks: 400 };

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await c.session.prepare(cmd);
  expect(c.session.dispatch(cmd)).toMatchObject({ ok: true });
}

function quiet(session: CampaignSession): void {
  const map = session.campaign.state.map;
  for (const name of [LANDING, ELSEWHERE])
    Object.assign(sectorInfo(map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

async function landedInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('death-off-the-map', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'enterSector', sector: LANDING });
  c.live.advance({ idle: true });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function tactical(c: Campaign): TacticalState {
  return c.session.campaign.tactical?.state ?? never('loaded sector');
}

async function kestrelInB9(seed: number): Promise<Campaign> {
  const c = await landedInA9(seed);
  await order(c, { type: 'mapScreen' });
  const kestrel = merc(c, KESTREL).id;
  await order(c, { type: 'assignSquad', soldier: kestrel, squad: 'new' });
  await order(c, { type: 'route', soldier: kestrel, to: ELSEWHERE });
  const arrived = () => {
    const m = merc(c, KESTREL);
    return sameSector(m.sector, parseSectorString(ELSEWHERE)) && !m.betweenSectors;
  };
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`Kestrel did not reach ${ELSEWHERE}`);
  await order(c, { type: 'tacticalScreen' });
  return c;
}

function insure(m: RosterMerc): void {
  m.contract.lifeInsurance = 1;
  m.contract.startTimeOfInsuranceContract = INSURED_LONG_AGO;
}

function bleedTheLastPoint(t: TacticalState, m: RosterMerc): void {
  m.soldier.life = LAST_LIFE_POINT;
  soldierTakeDamage(t, m.soldier, BLOOD_LOSS_LIFE, BLOOD_LOSS_BREATH, DamageReason.BLOODLOSS, null);
}

function collapse(c: Campaign, profile: number): void {
  const wounded = merc(c, profile).soldier;
  soldierTakeDamage(tactical(c), wounded, wounded.life - COLLAPSED_LIFE, 0, DamageReason.BLOODLOSS, null);
  c.live.advance(COLLAPSE_TICKS);
  expect([merc(c, profile).soldier.collapsed, merc(c, profile).soldier.life]).toEqual([true, COLLAPSED_LIFE]);
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function buddyLines(events: readonly SimEvent[], speaker: number): SimEvent[] {
  return ofType(events, 'mercQuote').filter((e) => e.soldier === speaker && e.id === Quote.BUDDY_ONE_KILLED);
}

function deathsInHistory(events: readonly SimEvent[]): Extract<SimEvent, { type: 'historyAdded' }>[] {
  return ofType(events, 'historyAdded').filter((e) => e.code === HistoryCode.MERC_KILLED);
}

function deadLines(messages: readonly MessageEntry[]): MessageEntry[] {
  return messages.filter((m) => m.table === 'pMercDeadString');
}

function inSomeSquad(c: Campaign, id: number): boolean {
  return c.session.campaign.state.forces.squads.some((squad) => squad.includes(id));
}

describe('a merc of ours dying off the tactical map (Soldier_Control.cc HandleTakeDamageDeath, its strategic branch)', () => {
  it('bleeding to death in another sector while the tactical screen is up gets the strategic bookkeeping at once and mercDied', async () => {
    const c = await kestrelInB9(31);
    const kestrel = merc(c, KESTREL);
    const vant = merc(c, VANT);
    insure(kestrel);
    const deaths = c.session.campaign.state.status.mercDeaths;
    const morale = vant.soldier.morale;
    expect([kestrel.soldier.placed, vant.soldier.placed, c.session.campaign.state.flow]).toEqual([false, true, 'tactical']);
    bleedTheLastPoint(tactical(c), kestrel);
    const events = c.session.campaign.drainEvents();
    expect(deathsInHistory(events)).toMatchObject([{ profile: KESTREL, sector: ELSEWHERE }]);
    expect(ofType(events, 'mercDied')).toEqual([{ type: 'mercDied', soldier: kestrel.id, sector: ELSEWHERE, tick: expect.any(Number) }]);
    expect(ofType(events, 'soldierDied')).toEqual([]);
    const state = c.session.campaign.state;
    expect(state.status.mercDeaths).toBe(deaths + 1);
    expect(kestrel.soldier.dead).toBe(true);
    expect(kestrel.assignment).toBe(Assignment.ASSIGNMENT_DEAD);
    expect(inSomeSquad(c, kestrel.id)).toBe(false);
    expect(vant.soldier.morale).toBeLessThan(morale);
    expect(state.laptop.insurance.payouts.filter((p) => p.active)).toMatchObject([{ soldier: kestrel.id, profile: KESTREL }]);
    expect(state.queue.events.some((e) => e.kind === EventKind.INSURANCE_INVESTIGATION_STARTED)).toBe(true);
  });

  it('an insured merc dying off the map with no enemy in the loaded sector is a suspicious death (quirk)', async () => {
    const c = await kestrelInB9(32);
    const kestrel = merc(c, KESTREL);
    insure(kestrel);
    expect(tactical(c).turn.enemyInSector).toBe(false);
    bleedTheLastPoint(tactical(c), kestrel);
    expect(c.session.campaign.state.profiles.get(KESTREL)?.suspiciousDeath).toBe(SUSPICIOUS_DEATH);
  });

  it('leaves no body and no gear while the tactical screen is up, and nobody comments (quirk)', async () => {
    const c = await kestrelInB9(36);
    const kestrel = merc(c, KESTREL);
    const records = () => JSON.stringify(c.session.campaign.state.sectorDiffs.get(sectorKey(parseSectorString(ELSEWHERE))) ?? null);
    const before = records();
    const gear = JSON.stringify(kestrel.soldier.inv);
    const corpses = tactical(c).corpses.length;
    bleedTheLastPoint(tactical(c), kestrel);
    const report = c.live.advance(LINE_TICKS);
    expect(ofType(report.events, 'mercDied').map((e) => e.soldier)).toEqual([kestrel.id]);
    expect(records()).toBe(before);
    expect(tactical(c).corpses).toHaveLength(corpses);
    expect(JSON.stringify(merc(c, KESTREL).soldier.inv)).toBe(gear);
    expect(buddyLines(report.events, merc(c, VANT).id)).toEqual([]);
    expect(deadLines(report.messages)).toEqual([]);
  });

  it('lying collapsed on the tactical map still dies through the skull, with the bookkeeping once and the buddy line of the sector', async () => {
    const c = await landedInA9(34);
    collapse(c, KESTREL);
    const kestrel = merc(c, KESTREL);
    const deaths = c.session.campaign.state.status.mercDeaths;
    bleedTheLastPoint(tactical(c), kestrel);
    expect(c.session.campaign.state.status.mercDeaths).toBe(deaths);
    const report = c.live.advance(AFTER_THE_SKULL);
    const lines = c.live.advance(LINE_TICKS);
    const events = [...report.events, ...lines.events];
    expect(ofType(events, 'soldierDied').map((e) => e.soldier)).toEqual([kestrel.id]);
    expect(ofType(events, 'mercDied')).toEqual([]);
    expect(deathsInHistory(events).map((e) => e.profile)).toEqual([KESTREL]);
    expect(c.session.campaign.state.status.mercDeaths).toBe(deaths + 1);
    expect(merc(c, KESTREL).assignment).toBe(Assignment.ASSIGNMENT_DEAD);
    expect(buddyLines(events, merc(c, VANT).id)).toHaveLength(1);
  });

  it('while the map screen is up, of a merc of the loaded sector lying collapsed: the bookkeeping at once and "%s is dead" in the list', async () => {
    const c = await landedInA9(35);
    collapse(c, VANT);
    await order(c, { type: 'mapScreen' });
    const vant = merc(c, VANT);
    const deaths = c.session.campaign.state.status.mercDeaths;
    expect(vant.soldier.placed).toBe(true);
    bleedTheLastPoint(tactical(c), vant);
    const events = c.session.campaign.drainEvents();
    expect(ofType(events, 'mercDied')).toEqual([
      { type: 'mercDied', soldier: vant.id, sector: LANDING, mapScreen: true, tick: expect.any(Number) },
    ]);
    expect(c.session.campaign.state.status.mercDeaths).toBe(deaths + 1);
    expect(vant.soldier.dead).toBe(true);
  });
});
