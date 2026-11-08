import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { ItemClass } from '../../content/items/items.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { type ItemObject, swapObjects } from '../items/object.ts';
import { tacticalCharacterDialogue } from '../narrative/dialogue-queue.ts';
import { dialogueQueueIsEmptyAndNobodyIsTalking, type TalkState } from '../narrative/talk-state.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { addStrategicEventUsingSeconds } from '../strategic/time/event-queue.ts';
import type { WorldClock } from '../strategic/time/world-clock.ts';
import { anim, animName } from '../tactical/anim-states.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { findObjClass } from '../tactical/combat/reload.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { NOWHERE, OKLIFE, type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { RT_TURN_MS, STRATEGIC_OVERHEAD_MS } from '../tactical/turns/turns.ts';
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
const WOUNDED = { life: 60, bleeding: 8 };
const FAR_FROM_THE_SQUAD = gridNo(120, 80);
const OUT_OF_SIGHT = gridNo(20, 80);
const KILLING_BLOW = 100;
const COLLAPSED_LIFE = OKLIFE - 1;
const COLLAPSE_TICKS = { ticks: 400 };
const WARP_CAP_SECONDS = 125;
const FRAMES_PAST_THE_CAP = 40;
const SECONDS_INTO_THE_WARP = 60;
const LINE_SLICE = { ticks: 100 };
const LINE_BUDGET = 200;
const ONE_TICK = { ticks: 1 };
const A_FEW_FRAMES = { ticks: 10 };
const UNTIL_THE_FIRST_TURN = { ticks: (STRATEGIC_OVERHEAD_MS + TICK_MS) / TICK_MS };
const PAST_TWO_TURNS = { ticks: (2 * (RT_TURN_MS + STRATEGIC_OVERHEAD_MS + TICK_MS)) / TICK_MS };
const ONE_WORLD_SECOND = { ticks: 1000 / TICK_MS };
const ANNOYED_PROFILE = 99;

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

async function refusal(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<unknown> {
  await c.session.prepare(cmd);
  const result = c.session.dispatch(cmd);
  return result.ok ? null : result.data?.refusal;
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
  const c = { session, live: new ReloadingSession('auto-bandage-flow', session) };
  await order(c, { type: 'compressTime', mode: 2 });
  await order(c, { type: 'skipHelicopterDrop' });
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

function talk(c: Campaign): TalkState {
  return c.session.campaign.talk?.talk ?? never('talk flow');
}

function clock(c: Campaign): WorldClock {
  return c.session.campaign.state.clock;
}

function pending(c: Campaign): boolean {
  return c.session.campaign.state.sectorFlow.autoBandage.pending;
}

function promptKind(c: Campaign): string | null {
  return c.session.campaign.tactical?.state.prompt?.kind ?? null;
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function wound(c: Campaign, profile: number): void {
  Object.assign(merc(c, profile).soldier, WOUNDED);
}

async function sendAway(c: Campaign, profile: number): Promise<void> {
  await order(c, { type: 'move', soldier: merc(c, profile).id, to: FAR_FROM_THE_SQUAD, mode: 'run' });
  c.live.advance({ idle: true });
  expect(merc(c, profile).soldier.gridNo).toBe(FAR_FROM_THE_SQUAD);
}

function enemyOutOfSight(c: Campaign): Soldier {
  const sim = c.session.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.ENEMY];
  while (sim.state.soldiers[id]) id++;
  return spawnSoldier(sim, id, Team.ENEMY, OUT_OF_SIGHT, Direction.NORTH);
}

function collapsedEnemy(c: Campaign): Soldier {
  const enemy = enemyOutOfSight(c);
  soldierTakeDamage(tactical(c), enemy, enemy.life - COLLAPSED_LIFE, 0, DamageReason.BLOODLOSS, null);
  c.live.advance(COLLAPSE_TICKS);
  const collapsed = tactical(c).soldiers[enemy.id] ?? never('collapsed enemy');
  expect([collapsed.collapsed, collapsed.life]).toEqual([true, COLLAPSED_LIFE]);
  return collapsed;
}

function bleedOutAsTheLastEnemy(c: Campaign, enemy: Soldier): void {
  const t = tactical(c);
  t.turn.enemyInSector = true;
  t.turn.numFoughtInBattle[Team.ENEMY] = 1;
  soldierTakeDamage(t, t.soldiers[enemy.id] ?? never('enemy'), KILLING_BLOW, KILLING_BLOW, DamageReason.BLOODLOSS, null);
}

function winTheBattle(c: Campaign): readonly SimEvent[] {
  bleedOutAsTheLastEnemy(c, enemyOutOfSight(c));
  const report = c.live.advance({ events: ['combatEnded'] });
  expect(ofType(report.events, 'combatEnded')).toMatchObject([{ reason: 'won', fought: true }]);
  return report.events;
}

function kitInHand(c: Campaign, profile: number): void {
  const s = merc(c, profile).soldier;
  const slot = findObjClass(tactical(c).content.items, s, ItemClass.MEDKIT);
  swapObjects(s.inv[InvSlot.HAND] as ItemObject, s.inv[slot] as ItemObject);
}

function lineOver(c: Campaign): boolean {
  return dialogueQueueIsEmptyAndNobodyIsTalking(talk(c));
}

function playOutTheLine(c: Campaign): readonly SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < LINE_BUDGET && !lineOver(c); k++) events.push(...c.live.advance(LINE_SLICE).events);
  expect(lineOver(c)).toBe(true);
  return events;
}

async function startTheMode(c: Campaign): Promise<void> {
  await order(c, { type: 'autoBandage' });
  expect(promptKind(c)).toBe('beginAutoBandage');
  await order(c, { type: 'answer', choice: 'yes' });
  expect(tactical(c).pathEnv.autoBandage).toBe(true);
}

async function endTheMode(c: Campaign): Promise<readonly SimEvent[]> {
  await order(c, { type: 'endAutoBandage' });
  const events = c.live.advance(ONE_TICK).events;
  expect(tactical(c).pathEnv.autoBandage).toBe(false);
  return events;
}

describe('the question after a won battle (Overhead.cc CheckForEndOfBattle, Auto_Bandage.cc HandleAutoBandagePending)', () => {
  it('waits for the victory line and for a merc walking up to bandage, then asks', async () => {
    const c = await landedInA9(61);
    wound(c, VANT);
    await sendAway(c, VANT);
    const won = winTheBattle(c);
    expect([pending(c), promptKind(c), lineOver(c)]).toEqual([true, null, false]);
    kitInHand(c, MORAGA);
    await order(c, { type: 'bandage', soldier: merc(c, MORAGA).id, target: merc(c, VANT).id });
    const line = [...won, ...playOutTheLine(c)];
    expect(ofType(line, 'mercQuote').map((e) => e.id)).toContain(MercQuote.SECTOR_SAFE);
    expect([pending(c), promptKind(c), merc(c, MORAGA).soldier.pendingAid !== null]).toEqual([true, null, true]);
    const asked = c.live.advance({ idle: true });
    expect(asked.reason).toBe('decision');
    expect(c.session.view().prompt).toMatchObject({ kind: 'beginAutoBandage', choices: ['yes', 'no'] });
    expect([pending(c), promptKind(c), merc(c, MORAGA).soldier.pendingAid]).toEqual([false, 'beginAutoBandage', null]);
  });

  it('is dropped when the map screen opens, so the way back asks nothing', async () => {
    const c = await landedInA9(62);
    wound(c, VANT);
    winTheBattle(c);
    expect(pending(c)).toBe(true);
    await order(c, { type: 'mapScreen' });
    expect(pending(c)).toBe(false);
    c.live.advance({ idle: true });
    await order(c, { type: 'tacticalScreen' });
    const back = c.live.advance({ idle: true });
    expect([back.reason, promptKind(c)]).toEqual(['idle', null]);
  });
});

describe('the question in the Deidranna endgame (Auto_Bandage.cc ShouldBeginAutoBandage, IN_DEIDRANNA_ENDGAME)', () => {
  it('is never set by the battle her death ends', async () => {
    const c = await landedInA9(69);
    wound(c, VANT);
    c.session.campaign.state.ending.inDeidrannaEndgame = true;
    winTheBattle(c);
    expect(pending(c)).toBe(false);
  });
});

describe('a battle won while the map screen is up (Soldier_Control.cc HandleTakeDamageDeath on the map)', () => {
  it('sets nothing with blood on, as the death waits for its animation in the frames of tactical', async () => {
    const c = await landedInA9(63);
    wound(c, VANT);
    const enemy = collapsedEnemy(c);
    await order(c, { type: 'mapScreen' });
    bleedOutAsTheLastEnemy(c, enemy);
    c.live.advance({ idle: true });
    const t = tactical(c);
    const dying = t.soldiers[enemy.id] ?? never('enemy');
    expect([animName(t.content, dying.state), t.turn.enemyInSector, pending(c)]).toEqual(['GENERIC_HIT_DEATH', true, false]);
  });

  it('with blood off ends the battle on the map and keeps the question for the way back (quirk)', async () => {
    const c = await landedInA9(64);
    await order(c, { type: 'setOption', bloodAndGore: false });
    wound(c, VANT);
    const enemy = collapsedEnemy(c);
    await order(c, { type: 'mapScreen' });
    bleedOutAsTheLastEnemy(c, enemy);
    expect([tactical(c).turn.enemyInSector, pending(c)]).toEqual([false, true]);
    c.live.advance({ idle: true });
    expect(pending(c)).toBe(true);
    await order(c, { type: 'tacticalScreen' });
    const back = c.live.advance({ idle: true });
    expect([back.reason, promptKind(c), pending(c)]).toEqual(['decision', 'beginAutoBandage', false]);
  });
});

describe('the mode in a campaign (Auto_Bandage.cc AutoBandage, HandleAutoBandage; GameScreen.cc:283)', () => {
  it('pauses the world clock and jumps it at the end, leaving the events inside the jump to the next advance', async () => {
    const c = await landedInA9(65);
    wound(c, VANT);
    await sendAway(c, VANT);
    const startedAt = clock(c).seconds;
    await startTheMode(c);
    expect(clock(c).paused).toBe(true);
    const insideTheJump = startedAt + SECONDS_INTO_THE_WARP;
    addStrategicEventUsingSeconds(c.session.campaign.state.queue, EventKind.AIM_RESET_MERC_ANNOYANCE, insideTheJump, ANNOYED_PROFILE);
    c.live.advance({ ticks: FRAMES_PAST_THE_CAP });
    expect(clock(c).seconds).toBe(startedAt);
    await endTheMode(c);
    const queued = () => c.session.campaign.state.queue.events.some((e) => e.stamp === insideTheJump);
    expect([clock(c).seconds, clock(c).paused, queued()]).toEqual([startedAt + WARP_CAP_SECONDS, false, true]);
    c.live.advance(ONE_WORLD_SECOND);
    expect(queued()).toBe(false);
  });

  it('bleeds nobody and runs no real-time turn while it runs; the first turn comes at once after it', async () => {
    const c = await landedInA9(66);
    wound(c, VANT);
    await sendAway(c, VANT);
    const lastTurnMs = tactical(c).realtimeClock.lastTurnMs;
    await startTheMode(c);
    c.live.advance(PAST_TWO_TURNS);
    expect([tactical(c).realtimeClock.lastTurnMs, merc(c, VANT).soldier.life]).toEqual([lastTurnMs, WOUNDED.life]);
    await endTheMode(c);
    c.live.advance(UNTIL_THE_FIRST_TURN);
    expect(tactical(c).realtimeClock.lastTurnMs).toBeGreaterThan(lastTurnMs);
  });

  it('keeps the dialogue standing: a line queued in the mode waits, the mode is idle at completion, the line plays after the end', async () => {
    const c = await landedInA9(67);
    wound(c, VANT);
    await startTheMode(c);
    const host = c.session.campaign.talk?.host ?? never('narrative host');
    expect(tacticalCharacterDialogue(host, merc(c, KESTREL).soldier, MercQuote.SECTOR_SAFE)).toBe(true);
    const done = c.live.advance({ idle: true });
    expect(done.reason).toBe('idle');
    expect(ofType(done.events, 'autoBandageComplete')).toHaveLength(1);
    expect([talk(c).queue.length, talk(c).face, ofType(done.events, 'mercQuote')]).toEqual([1, null, []]);
    await endTheMode(c);
    const after = c.live.advance(A_FEW_FRAMES);
    expect(ofType(after.events, 'mercQuote')).toMatchObject([{ soldier: merc(c, KESTREL).id, id: MercQuote.SECTOR_SAFE }]);
  });

  it('refuses the map screen and the other campaign orders but endAutoBandage and skipLine', async () => {
    const c = await landedInA9(70);
    wound(c, VANT);
    await sendAway(c, VANT);
    await startTheMode(c);
    const orders = [{ type: 'mapScreen' }, { type: 'compressTime', mode: 2 }, { type: 'autoBandage' }, { type: 'openShop', soldier: 0 }];
    const refused: unknown[] = [];
    for (const cmd of orders) refused.push(await refusal(c, cmd));
    expect(refused).toEqual(orders.map(() => 'autoBandaging'));
    expect(await refusal(c, { type: 'skipLine' })).toBeNull();
    expect(c.session.campaign.state.flow).toBe('tactical');
    await endTheMode(c);
  });

  it('stands up a merc of ours in another sector at the end, a big merc with a rifle stuck in his transition off the map', async () => {
    const c = await landedInA9(71);
    await order(c, { type: 'mapScreen' });
    const vant = merc(c, VANT).id;
    await order(c, { type: 'assignSquad', soldier: vant, squad: 'new' });
    await order(c, { type: 'route', soldier: vant, to: ELSEWHERE });
    const arrived = () => sameSector(merc(c, VANT).sector, parseSectorString(ELSEWHERE)) && !merc(c, VANT).betweenSectors;
    for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) c.live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
    expect(arrived()).toBe(true);
    await order(c, { type: 'tacticalScreen' });
    const t = tactical(c);
    merc(c, VANT).soldier.state = anim(t.content, 'CROUCHING');
    wound(c, KESTREL);
    await startTheMode(c);
    c.live.advance(A_FEW_FRAMES);
    await endTheMode(c);
    const away = merc(c, VANT).soldier;
    expect([animName(tactical(c).content, away.state), away.gridNo, away.placed]).toEqual(['BIGMERC_CROUCH_TRANS_OUTOF', NOWHERE, false]);
    expect(tactical(c).occupant.some((level) => level.includes(away.id))).toBe(false);
  });
});
