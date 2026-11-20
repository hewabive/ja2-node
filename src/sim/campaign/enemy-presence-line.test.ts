import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HintSources, withQueries } from '../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString, sectorId } from '../../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../protocol/messages.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { saveRefusal } from '../../server/save-rules.ts';
import { strategicView } from '../../server/strategic-view.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import type { SectorExits } from '../hints/sector-exits.ts';
import { createNewEnemyGroupDepartingFromSector, removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { addStrategicEvent } from '../strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';

let kit: StubSectorKit;
let sources: HintSources;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const LANDING = 'A9';
const ENEMY_SECTOR = 'B9';
const NEXT_EAST = 'A10';
const QUIET_SECTORS = [LANDING, ENEMY_SECTOR, NEXT_EAST];
const NO_ENEMIES = { numAdmins: 0, numTroops: 0, numElites: 0 };
const TWO_TROOPS = { ...NO_ENEMIES, numTroops: 2 };
const ONE_ADMIN = { ...NO_ENEMIES, numAdmins: 1 };
const AN_HOUR = 3600;
const LINE_SEARCH_BUDGET = 24;
const TRAVERSAL_TICKS = 20_000;
const WALK_IN_TICKS = 400;
const ENEMY_TROOPS = 6;
const ARRIVAL_MINUTES = 1;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
}

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(c: Campaign, cmd: CommandEnvelope): Promise<CommandResult> {
  await c.session.prepare(cmd);
  return c.live.dispatch(cmd);
}

function enemiesIn(session: CampaignSession, sector: string, counts: typeof NO_ENEMIES): void {
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(sector)), counts);
}

async function landedInA9(seed: number, name: string): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  for (const sector of QUIET_SECTORS) enemiesIn(session, sector, NO_ENEMIES);
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
  const c = { session, live: withQueries(new ReloadingSession(name, session), sources) as ReloadingSession };
  expect(await order(c, { type: 'compressTime', mode: CompressMode.MIN5 })).toMatchObject({ ok: true });
  expect(await order(c, { type: 'skipHelicopterDrop' })).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
  return c;
}

function enemyPresenceLines(events: readonly SimEvent[]): Extract<SimEvent, { type: 'mercQuote' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'mercQuote' }> => e.type === 'mercQuote' && e.id === MercQuote.ENEMY_PRESENCE);
}

function squadIds(c: Campaign): number[] {
  return c.session.campaign.battle?.roster.all().map((m) => m.id) ?? [];
}

async function squadToB9(c: Campaign): Promise<void> {
  expect(await order(c, { type: 'mapScreen' })).toEqual({ ok: true });
  const routed = await order(c, { type: 'route', soldier: squadIds(c)[0] ?? never('merc'), to: ENEMY_SECTOR });
  expect(routed, routed.reason).toMatchObject({ ok: true });
}

function enemiesArriveInA9(c: Campaign): void {
  const campaign = c.session.campaign;
  const ctx = campaign.strategic ?? never('strategic layer');
  const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId(parseSectorString(NEXT_EAST)), 0, ENEMY_TROOPS, 0);
  g.next = parseSectorString(LANDING);
  g.betweenSectors = true;
  g.arrivalTime = worldTotalMinutes(campaign.state.clock) + ARRIVAL_MINUTES;
  addStrategicEvent(campaign.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
}

function untilTheEnemyPresenceLine(c: Campaign): Extract<SimEvent, { type: 'mercQuote' }> {
  for (let k = 0; k < LINE_SEARCH_BUDGET; k++) {
    const report = c.live.advance({ worldSeconds: AN_HOUR, mode: CompressMode.MIN30, events: ['mercQuote'] });
    const line = enemyPresenceLines(report.events)[0];
    if (line) return line;
    if (report.reason === 'decision') break;
  }
  return never('enemy-presence line');
}

async function exitEast(c: Campaign): Promise<void> {
  const answer = await c.live.query({ type: 'sectorExits' });
  const east = (answer.data as SectorExits).edges.find((e) => e.edge === 'east') ?? never('east edge');
  for (const [soldier, to] of Object.entries(east.walkTo))
    expect(await order(c, { type: 'move', soldier: Number(soldier), to, mode: 'run' })).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
  const leaver = squadIds(c)[0] ?? never('merc');
  expect(await order(c, { type: 'exitSector', soldier: leaver, direction: 'east', who: 'squad' })).toMatchObject({
    ok: true,
    data: { load: true, target: NEXT_EAST },
  });
}

function traverse(c: Campaign): { before: readonly SimEvent[]; after: readonly SimEvent[] } {
  const loading = c.live.advance({ ticks: TRAVERSAL_TICKS, events: ['sectorLoaded'] }).events;
  const loaded = loading.findIndex((e) => e.type === 'sectorLoaded');
  expect(loading[loaded]).toMatchObject({ type: 'sectorLoaded', sector: NEXT_EAST });
  const walkIn = c.live.advance({ ticks: WALK_IN_TICKS, events: ['mercQuote'] }).events;
  return { before: loading.slice(0, loaded), after: [...loading.slice(loaded), ...walkIn] };
}

describe('the enemy-presence line before the pre-battle interface (Strategic_Movement.cc HandleImportantPBIQuote)', () => {
  it('opens the preBattle prompt only once a merc of the group has said the line (Dialogue_Control.cc:414-419)', async () => {
    const c = await landedInA9(31, 'pre-battle-line');
    enemiesIn(c.session, ENEMY_SECTOR, TWO_TROOPS);
    await squadToB9(c);
    const line = untilTheEnemyPresenceLine(c);
    expect(squadIds(c)).toContain(line.soldier);
    const campaign = c.session.campaign;
    expect(campaign.state.battle.prompt).toBeNull();
    expect(campaign.state.clock).toMatchObject({ paused: true, pauseLocked: true });
    const face = campaign.talk?.talk.face ?? never('talking face');
    expect(face.speaker).toBe(line.profile);
    const report = c.live.advance({ idle: true });
    expect(report.reason).toBe('decision');
    const opened = report.events.find((e) => e.type === 'preBattle') ?? never('preBattle event');
    expect(opened.tick).toBeGreaterThanOrEqual(face.busyUntil);
    expect(c.session.campaign.state.battle.prompt?.kind).toBe('preBattle');
  });

  it('names the line whose end opened the prompt on its preBattle event, for a viewer still saying it', async () => {
    const c = await landedInA9(31, 'pre-battle-line-named');
    enemiesIn(c.session, ENEMY_SECTOR, TWO_TROOPS);
    await squadToB9(c);
    const line = untilTheEnemyPresenceLine(c);
    const opened = c.live.advance({ idle: true }).events.find((e) => e.type === 'preBattle') ?? never('preBattle event');
    expect(opened).toMatchObject({
      autoStart: false,
      prompt: c.session.campaign.state.battle.prompt?.id,
      line: { profile: line.profile, saidAt: line.tick },
    });
  });

  it('puts a sleeping speaker back to sleep as the panel opens, after the panel woke everyone involved (Strategic_Movement.cc:592-599, PreBattle_Interface.cc:303)', async () => {
    const c = await landedInA9(35, 'pre-battle-line-asleep');
    expect(await order(c, { type: 'mapScreen' })).toEqual({ ok: true });
    for (const m of c.session.campaign.battle?.roster.all() ?? []) m.asleep = true;
    enemiesArriveInA9(c);
    const line = untilTheEnemyPresenceLine(c);
    expect(c.session.campaign.battle?.roster.get(line.soldier)?.asleep).toBe(false);
    expect(c.live.advance({ idle: true }).reason).toBe('decision');
    const roster = c.session.campaign.battle?.roster ?? never('roster');
    expect(c.session.campaign.state.battle.prompt?.kind).toBe('preBattle');
    expect(roster.all().map((m) => [m.id, m.asleep])).toEqual(squadIds(c).map((id) => [id, id === line.soldier]));
  });

  it('ignores the map-area orders while the line plays, as the map screen ignores its clicks (MapScreen.cc:3303-3309, :3358-3364)', async () => {
    const c = await landedInA9(31, 'pre-battle-line-map-area');
    enemiesIn(c.session, ENEMY_SECTOR, TWO_TROOPS);
    expect(await order(c, { type: 'mapScreen' })).toEqual({ ok: true });
    const [scout, stayer] = squadIds(c);
    if (scout === undefined || stayer === undefined) return never('two mercs');
    expect(await order(c, { type: 'assignSquad', soldier: stayer, squad: 'new' })).toMatchObject({ ok: true });
    expect(await order(c, { type: 'route', soldier: scout, to: ENEMY_SECTOR })).toMatchObject({ ok: true });
    untilTheEnemyPresenceLine(c);
    expect(strategicView(c.session.campaign)?.mapInterfaceDisabled).toBe(true);
    for (const cmd of [
      { type: 'route', soldier: stayer, to: NEXT_EAST },
      { type: 'regroupForMove', soldiers: [stayer] },
      { type: 'setLandingZone', sector: NEXT_EAST },
      { type: 'showBattle' },
      { type: 'endPlot', soldier: stayer, steps: [{ to: NEXT_EAST }], outcome: 'confirm' },
      { type: 'endPlot', soldier: stayer, outcome: 'cancel' },
    ])
      expect(await order(c, cmd), cmd.type).toMatchObject({ ok: false, data: { refusal: 'battlePending' } });
    expect(await order(c, { type: 'endPlot', soldier: stayer, outcome: 'abort', selected: [stayer] })).toMatchObject({ ok: true });
    expect(await order(c, { type: 'cancelRoute', soldier: stayer })).toEqual({ ok: true });
    expect(c.live.advance({ idle: true }).reason).toBe('decision');
    const prompt = c.session.campaign.state.battle.prompt ?? never('preBattle prompt');
    expect(await order(c, { type: 'answer', prompt: prompt.id, choice: 'retreat' })).toMatchObject({ ok: true });
    expect(strategicView(c.session.campaign)?.mapInterfaceDisabled).toBeUndefined();
    const routed = await order(c, { type: 'route', soldier: stayer, to: NEXT_EAST });
    expect(routed, routed.reason).toMatchObject({ ok: true });
  });

  it('refuses a save, quick or not, while the line plays on the tactical screen, as the save keys skip it (Turn_Based_Input.cc:1805, :1930)', async () => {
    const c = await landedInA9(35, 'pre-battle-line-save');
    expect(saveRefusal(c.session)).toBeNull();
    enemiesArriveInA9(c);
    untilTheEnemyPresenceLine(c);
    expect(c.session.campaign.state.flow).toBe('tactical');
    expect([saveRefusal(c.session), saveRefusal(c.session, 'quick')]).toEqual(['battlePending', 'battlePending']);
    expect(c.live.advance({ idle: true }).reason).toBe('decision');
    expect(c.session.campaign.state.movement.disableMapInterfaceDueToBattle).toBe(false);
    expect(saveRefusal(c.session)).toBe('promptOpen');
  });

  it('opens the prompt with the skipLine that cuts the line short', async () => {
    const c = await landedInA9(34, 'pre-battle-line-cut');
    enemiesIn(c.session, ENEMY_SECTOR, TWO_TROOPS);
    await squadToB9(c);
    const line = untilTheEnemyPresenceLine(c);
    expect(await order(c, { type: 'skipLine', profile: line.profile, tick: line.tick })).toEqual({ ok: true, data: { skipped: true } });
    expect(c.session.campaign.state.battle.prompt?.kind).toBe('preBattle');
  });
});

describe('the enemy-presence line after a tactical traversal (StrategicMap.cc DoneFadeOutAdjacentSector)', () => {
  it('has the traversal speaker say it as the sector holding enemies loads, and nobody before the load', async () => {
    const c = await landedInA9(32, 'traversal-line');
    enemiesIn(c.session, NEXT_EAST, ONE_ADMIN);
    await exitEast(c);
    const { before, after } = traverse(c);
    expect(enemyPresenceLines(before)).toEqual([]);
    expect(c.session.campaign.state.battle.prompt).toBeNull();
    const lines = enemyPresenceLines(after);
    expect(lines.length).toBe(1);
    expect(squadIds(c)).toContain(lines[0]?.soldier);
    expect(c.session.campaign.state.movement.tacticalTraversal).toMatchObject({ active: false, chosenSoldier: -1 });
  });

  it('says nothing when the sector holds no enemies', async () => {
    const c = await landedInA9(32, 'traversal-no-line');
    await exitEast(c);
    const { before, after } = traverse(c);
    expect(enemyPresenceLines([...before, ...after])).toEqual([]);
  });
});
