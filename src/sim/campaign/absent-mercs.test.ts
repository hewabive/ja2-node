import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kit as medicalKit } from '../../../tests/support/economy.ts';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { SmokeEffectId } from '../../content/items/explosions.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { newSmokeEffect, smokeEffectOnTile } from '../tactical/explosions/smoke.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { NOWHERE } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { RT_TURN_MS, STRATEGIC_OVERHEAD_MS } from '../tactical/turns/turns.ts';
import { Quote } from './contracts/quotes.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const MORAGA = 2;
const LANDING = 'A9';
const ELSEWHERE = 'B9';
const TICK_MS = 5;
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;
const FIRST_TURN = { ticks: 1010 };
const NEXT_TURN = { ticks: 1004 };
const BEFORE_THE_FIRST_TURN = { ticks: RT_TURN_MS / TICK_MS - 2 };
const ACROSS_THE_FIRST_TURN = { ticks: (4 * TICK_MS + STRATEGIC_OVERHEAD_MS) / TICK_MS };
const ON_THE_MAP = { ticks: 2000 };
const LINE_TICKS = { ticks: 3000 };
const WOUNDED = { lifeMax: 80, life: 60, bleeding: 20, nextBleed: 0.5 };
const WINDED = { breathRed: 3000, tilesMovedPerRTBreathUpdate: 0 };
const SPENT_COUNTERS = { numHitsThisTurn: 3, shock: 6 };
const WEARING_OFF = { future: 0, rate: -2, effect: 2, sideEffect: 20, sideEffectRate: 0 };
const ADRENALINE_SIDE_EFFECT_RATE = 2;

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
  const profiles = [KESTREL, VANT, MORAGA];
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: new ReloadingSession('absent-mercs', session) };
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

async function vantToB9(c: Campaign): Promise<void> {
  await order(c, { type: 'mapScreen' });
  const vant = merc(c, VANT).id;
  await order(c, { type: 'assignSquad', soldier: vant, squad: 'new' });
  await order(c, { type: 'route', soldier: vant, to: ELSEWHERE });
  const arrived = () => {
    const m = merc(c, VANT);
    return sameSector(m.sector, parseSectorString(ELSEWHERE)) && !m.betweenSectors;
  };
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`Vant did not reach ${ELSEWHERE}`);
}

async function vantInB9(seed: number): Promise<Campaign> {
  const c = await landedInA9(seed);
  await vantToB9(c);
  await order(c, { type: 'tacticalScreen' });
  return c;
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function bleedingLines(events: readonly SimEvent[]): number[] {
  const lines = ofType(events, 'mercQuote').filter((e) => e.id === MercQuote.STARTING_TO_BLEED || e.id === MercQuote.ME_TOO);
  return lines.map((e) => e.soldier);
}

function lastTurnMs(c: Campaign): number {
  return tactical(c).realtimeClock.lastTurnMs;
}

function firstTurnAfter(c: Campaign, startMs: number): number {
  expect(lastTurnMs(c)).toBe(startMs);
  c.live.advance(BEFORE_THE_FIRST_TURN);
  expect(lastTurnMs(c)).toBe(startMs);
  c.live.advance(ACROSS_THE_FIRST_TURN);
  return lastTurnMs(c) - startMs;
}

describe('our mercs off the loaded map at its real-time turns (Tactical_Turns.cc HandleTacticalEndTurn: FOR_EACH_IN_TEAM(OUR_TEAM))', () => {
  it('get their breath back and bleed, with no damage number on the map but the bleeding feedback', async () => {
    const c = await vantInB9(61);
    const vant = merc(c, VANT);
    expect([vant.soldier.placed, vant.soldier.gridNo]).toEqual([false, NOWHERE]);
    Object.assign(vant.soldier, WINDED);
    c.live.advance(FIRST_TURN);
    expect(merc(c, VANT).soldier.breathRed).toBeLessThan(WINDED.breathRed);
    Object.assign(merc(c, VANT).soldier, WOUNDED);
    const report = c.live.advance(NEXT_TURN);
    expect(merc(c, VANT).soldier.life).toBe(WOUNDED.life - 1);
    expect(ofType(report.events, 'damageFeedback').map((e) => e.soldier)).toContain(vant.id);
    expect(ofType(report.events, 'lifeLost').filter((e) => e.soldier === vant.id)).toEqual([]);
  });

  it('start in id order with those on the map, so the merc elsewhere says the second bleeding line, ME_TOO', async () => {
    const c = await vantInB9(62);
    const team = [KESTREL, VANT, MORAGA].map((p) => merc(c, p));
    expect(team.map((m) => [m.id, m.soldier.placed])).toEqual([
      [0, true],
      [1, false],
      [2, true],
    ]);
    for (const m of team) Object.assign(m.soldier, WOUNDED);
    const turn = c.live.advance(FIRST_TURN);
    const lines = [turn, c.live.advance(LINE_TICKS), c.live.advance(LINE_TICKS)].flatMap((r) => r.events);
    expect(bleedingLines(lines)).toEqual([0, 1, 2]);
    expect(ofType(lines, 'mercQuote').find((e) => e.soldier === 1 && e.id === MercQuote.ME_TOO)).toBeDefined();
  });

  it('bleed to death through the turn as a death off the tactical map: mercDied, and no buddy says a word', async () => {
    const c = await vantInB9(63);
    const vant = merc(c, VANT);
    Object.assign(vant.soldier, { ...WOUNDED, life: 1 });
    const turn = c.live.advance(FIRST_TURN);
    const events = [...turn.events, ...c.live.advance(LINE_TICKS).events];
    expect(ofType(events, 'mercDied')).toMatchObject([{ soldier: vant.id, sector: ELSEWHERE }]);
    expect(merc(c, VANT).soldier.dead).toBe(true);
    expect(ofType(events, 'mercQuote').filter((e) => e.id === Quote.BUDDY_ONE_KILLED)).toEqual([]);
  });

  it('include prisoners of war and mercs in transit, and skip the dead', async () => {
    const c = await vantInB9(64);
    const breathBack = (assignment: number, turn: { readonly ticks: number }) => {
      const vant = merc(c, VANT);
      vant.assignment = assignment;
      Object.assign(vant.soldier, WINDED);
      c.live.advance(turn);
      return merc(c, VANT).soldier.breathRed < WINDED.breathRed;
    };
    expect(breathBack(Assignment.ASSIGNMENT_POW, FIRST_TURN)).toBe(true);
    expect(breathBack(Assignment.IN_TRANSIT, NEXT_TURN)).toBe(true);
    const vant = merc(c, VANT);
    vant.soldier.life = 1;
    soldierTakeDamage(tactical(c), vant.soldier, 1, 100, DamageReason.BLOODLOSS, null);
    Object.assign(merc(c, VANT).soldier, SPENT_COUNTERS);
    c.live.advance(NEXT_TURN);
    const dead = merc(c, VANT).soldier;
    expect([dead.dead, dead.numHitsThisTurn, dead.shock]).toEqual([true, SPENT_COUNTERS.numHitsThisTurn, SPENT_COUNTERS.shock]);
  });

  it('do not bleed while a doctor in their own sector can heal them, even themselves (AnyDoctorWhoCanHealThisPatient)', async () => {
    const c = await vantInB9(65);
    Object.assign(merc(c, VANT).soldier, WOUNDED);
    c.live.advance(FIRST_TURN);
    expect(merc(c, VANT).soldier.life).toBe(WOUNDED.life - 1);
    const vant = merc(c, VANT);
    vant.soldier.inv[InvSlot.BIGPOCK4] = medicalKit(tactical(c).content.items, 'MEDICKIT', [100]);
    await order(c, { type: 'assign', soldiers: [vant.id], to: { kind: 'doctor' } });
    Object.assign(merc(c, VANT).soldier, { nextBleed: WOUNDED.nextBleed });
    c.live.advance(NEXT_TURN);
    expect([merc(c, VANT).soldier.life, merc(c, VANT).soldier.nextBleed]).toEqual([WOUNDED.life - 1, WOUNDED.nextBleed]);
  });

  it('step their drug courses: the adrenaline wears off into its crash and its morale, and the regeneration booster heals', async () => {
    const c = await vantInB9(66);
    const vant = merc(c, VANT);
    Object.assign(vant.soldier, { lifeMax: 80, life: 60, regenerationCounter: 1 });
    Object.assign(vant.soldier.drugs.adrenaline, WEARING_OFF);
    const morale = vant.soldier.tacticalMoraleMod;
    c.live.advance(FIRST_TURN);
    const after = merc(c, VANT).soldier;
    expect(after.drugs.adrenaline).toMatchObject({ effect: 0, rate: 0, sideEffectRate: ADRENALINE_SIDE_EFFECT_RATE });
    expect(after.tacticalMoraleMod).toBeLessThan(morale);
    expect([after.life > 60, after.regenerationCounter]).toEqual([true, 0]);
  });
});

describe('the real-time turn after a sector load and after a return from the map (Strategic_Turns.cc SyncStrategicTurnTimes)', () => {
  it('comes at the first 20 ms count past 5 s after a sector load', async () => {
    const c = await landedInA9(67);
    await vantToB9(c);
    await order(c, { type: 'enterSector', sector: ELSEWHERE });
    const loadedAt = tactical(c).clockMs;
    const waited = firstTurnAfter(c, loadedAt);
    expect(waited).toBeGreaterThan(RT_TURN_MS);
    expect(waited).toBeLessThanOrEqual(RT_TURN_MS + STRATEGIC_OVERHEAD_MS);
  });

  it('comes as long after a return to the loaded sector from the map, its stamps moved back with the clock', async () => {
    const c = await landedInA9(70);
    await order(c, { type: 'mapScreen' });
    c.live.advance(ON_THE_MAP);
    expect(c.session.campaign.state.realMs).toBeGreaterThan(tactical(c).clockMs);
    await order(c, { type: 'tacticalScreen' });
    const backAt = tactical(c).clockMs;
    const waited = firstTurnAfter(c, backAt);
    expect(waited).toBeGreaterThan(RT_TURN_MS);
    expect(waited).toBeLessThanOrEqual(RT_TURN_MS + STRATEGIC_OVERHEAD_MS);
  });
});

describe('the gas test of a merc of ours off the loaded map (Soldier_Control.cc EVENT_BeginMercTurn, SmokeEffects.cc GetSmokeEffectOnTile)', () => {
  it('reads the newly loaded map where he stands, nowhere since the load took him off the old one, so a cloud at his old tile does not keep him gassed (quirk)', async () => {
    const c = await landedInA9(69);
    const left = merc(c, KESTREL).soldier.gridNo;
    await vantToB9(c);
    await order(c, { type: 'enterSector', sector: ELSEWHERE });
    const kestrel = merc(c, KESTREL).soldier;
    expect([kestrel.placed, kestrel.gridNo]).toEqual([false, NOWHERE]);
    kestrel.gassed = true;
    const t = tactical(c);
    newSmokeEffect(t, left, itemId(t, 'SMOKE_GRENADE'), 0, null);
    c.live.advance(FIRST_TURN);
    expect(smokeEffectOnTile(tactical(c), left, 0)).not.toBe(SmokeEffectId.NOTHING);
    expect(merc(c, KESTREL).soldier.gassed).toBe(false);
  });
});
