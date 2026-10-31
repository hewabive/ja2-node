import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { LoadingScreen } from '../content/strategic/loading-screens.ts';
import { parseSectorString, type Sector } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { getGroup, setGroupSectorValue } from '../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { handleSoldierDeath } from '../sim/tactical/combat/death.ts';
import { directionToward } from '../sim/tactical/movement.ts';
import { TEAM_FIRST_ID, Team } from '../sim/tactical/soldier.ts';
import { Visibility } from '../sim/tactical/world-items.ts';
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

const ROUTE_BUDGET = 20;
const NEGATIVE_COMPANY = 41;
const SOCIAL_TRAIT = 44;
const PASSING_DISLIKE = 45;
const BARK_TRIES = 12;
const WITHOUT_PASSING_DISLIKE = 9;
const WITH_PASSING_DISLIKE = 4;
const ROUTE_SLICE_SECONDS = 2 * 3600;
const SPOTTED_SOMETHING_QUOTES = [11, 12];
const TILES_AHEAD = 2;
const QUOTE_TICKS = 60;
const TOWN_PICTURES = new Set<number>([LoadingScreen.DAYTOWN1, LoadingScreen.DAYTOWN2, LoadingScreen.NIGHTTOWN1, LoadingScreen.NIGHTTOWN2]);

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function landedCampaign(seed: number, quiet: readonly string[], profiles?: readonly number[]): Promise<Campaign> {
  const squad = profiles ? { profiles } : { mercs: 3 };
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { ...squad, land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const name of ['A9', ...quiet])
    Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  return { session, live: new ReloadingSession('hud', session) };
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

function firstMerc(session: CampaignSession): number {
  const merc = session.view().strategic?.mercs[0];
  if (!merc) throw new Error('no merc');
  return merc.id;
}

function routeSquadTo(c: Campaign, name: string): SimEvent[] {
  expect(c.session.dispatch({ type: 'route', soldier: firstMerc(c.session), to: name })).toMatchObject({ ok: true });
  const events: SimEvent[] = [];
  const there = () => c.session.view().strategic?.mercs.every((m) => m.sector === name && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !there(); k++) events.push(...c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS }).events);
  expect(there()).toBe(true);
  return events;
}

describe('strategic HUD events and refusals in a stub campaign', () => {
  it('reports the arrival, draws the town loading screen on entry and refuses with tokens', async () => {
    const c = await landedCampaign(71, ['B13', 'C13', 'D13']);
    const merc = firstMerc(c.session);
    expect(c.session.dispatch({ type: 'sleep', soldier: merc })).toEqual({ ok: false, reason: 'notTired', data: { refusal: 'notTired' } });
    expect(c.session.dispatch({ type: 'enterSector', sector: 'Z99' })).toMatchObject({ data: { refusal: 'badSector' } });
    expect(c.session.dispatch({ type: 'enterSector', sector: 'P16' })).toMatchObject({ data: { refusal: 'noMercThere' } });
    expect(c.session.dispatch({ type: 'assignSquad', soldier: merc, squad: 'x' })).toMatchObject({ data: { refusal: 'badSquad' } });
    teleportSquad(c.session, parseSectorString('C13'));
    const events = routeSquadTo(c, 'D13');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'groupArrived', sector: 'D13', final: true, who: { kind: 'squad', squad: 0 } }),
    );
    const entered = { type: 'enterSector', sector: 'D13' };
    await c.session.prepare(entered);
    expect(c.session.dispatch(entered)).toMatchObject({ ok: true });
    const report = c.live.advance({ ticks: 1 });
    const loaded = report.events.find((e) => e.type === 'sectorLoaded');
    expect(loaded).toMatchObject({ sector: 'D13' });
    const screen = loaded?.type === 'sectorLoaded' ? loaded.loadScreen : undefined;
    expect(TOWN_PICTURES.has(screen?.id ?? -1)).toBe(true);
    expect(screen?.path).toMatch(/^loadscreens\/ls_(day|night)town[12]\.sti$/);
    expect(c.session.dispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ data: { refusal: 'mapScreenOnly' } });
    const own = c.session.view().soldiers.find((s) => s.team === 0);
    expect(own).toMatchObject({ asleep: false, squad: 0, vehicle: null });
  });

  it('gives own-merc barks their text key, length and sector', async () => {
    const c = await landedCampaign(72, []);
    const enter = { type: 'enterSector', sector: 'A9' };
    await c.session.prepare(enter);
    expect(c.session.dispatch(enter)).toMatchObject({ ok: true });
    c.live.advance({ idle: true });
    const [talker, target] = c.session.view().soldiers.filter((s) => s.team === 0);
    if (!talker || !target) throw new Error('two mercs needed');
    const bark = c.session.dispatch({ type: 'talk', soldier: talker.id, target: target.id });
    expect(bark).toMatchObject({ ok: true });
    const quote = c.live.advance({ ticks: 1 }).events.find((e) => e.type === 'mercQuote');
    expect(quote).toMatchObject({ soldier: target.id, sector: 'A9', textKey: { file: expect.any(String) }, chars: expect.any(Number) });
  });

  it('barks the passing dislike on the second roll only for mercs whose quote table has it', async () => {
    const c = await landedCampaign(73, [], [WITHOUT_PASSING_DISLIKE, WITH_PASSING_DISLIKE]);
    const enter = { type: 'enterSector', sector: 'A9' };
    await c.session.prepare(enter);
    expect(c.session.dispatch(enter)).toMatchObject({ ok: true });
    c.live.advance({ idle: true });
    const own = c.session.view().soldiers.filter((s) => s.team === 0);
    const byProfile = (profile: number) => own.find((s) => s.profile === profile)?.id ?? -1;
    const barks = (talker: number, target: number): Set<number> => {
      const said = new Set<number>();
      for (let k = 0; k < BARK_TRIES; k++) {
        const reply = c.session.dispatch({ type: 'talk', soldier: byProfile(talker), target: byProfile(target) });
        said.add((reply.data as { bark: number }).bark);
        c.live.advance({ idle: true });
      }
      return said;
    };
    expect(barks(WITHOUT_PASSING_DISLIKE, WITH_PASSING_DISLIKE)).toEqual(new Set([NEGATIVE_COMPANY, PASSING_DISLIKE]));
    expect(barks(WITH_PASSING_DISLIKE, WITHOUT_PASSING_DISLIKE)).toEqual(new Set([NEGATIVE_COMPANY, SOCIAL_TRAIT]));
  });

  it('has the merc who sees a dead civilian’s drops say the items-seen quote once the dialogue queue runs it', async () => {
    const c = await landedCampaign(74, []);
    const enter = { type: 'enterSector', sector: 'A9' };
    await c.session.prepare(enter);
    expect(c.session.dispatch(enter)).toMatchObject({ ok: true });
    c.live.advance({ idle: true });
    const sim = c.session.campaign.tactical;
    if (!sim) throw new Error('no sector is loaded');
    const t = sim.state;
    const merc = t.soldiers.find((s) => s?.placed && s.team === Team.OUR);
    if (!merc) throw new Error('no merc');
    const victim = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV] ?? 0, Team.CIV, merc.gridNo + TILES_AHEAD, merc.direction);
    merc.direction = directionToward(merc.gridNo, victim.gridNo);
    victim.life = 0;
    handleSoldierDeath(t, victim);
    expect(t.worldItems.filter((i) => i.gridNo === victim.gridNo).map((i) => i.visible)).toEqual([Visibility.VISIBLE]);
    const events = c.live.advance({ ticks: QUOTE_TICKS }).events;
    const quotes = events.filter((e) => e.type === 'mercQuote' && SPOTTED_SOMETHING_QUOTES.includes(e.id));
    expect(quotes).toEqual([expect.objectContaining({ soldier: merc.id })]);
    expect(c.session.campaign.tactical?.state.turn.lockItemLocators).toBe(false);
  });
});
