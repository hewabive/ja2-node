import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientAnswer, clientSide, type HintSources, serialisedView, withQueries } from '../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../../tests/support/session-reload.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import type { CommandEnvelope } from '../../protocol/messages.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { tacticalCharacterDialogue } from '../narrative/dialogue-queue.ts';
import { removeGroup } from '../strategic/forces/groups.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;
let sources: HintSources;
let client: ClientSide;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
  client = await clientSide(sources);
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const LANDING = 'A9';
const ELSEWHERE = 'B9';
const ROUTE_BUDGET = 24;
const LINE = MercQuote.OUT_OF_AMMO;
const LINE_STEPS = 4;
const LINE_TICKS = 3000;
const AN_HOUR = 3600;
const LAST_LIFE_POINT = 1;
const BLEEDING_NOW = { bleeding: 20, nextBleed: 0.5 };

const TO_TACTICAL = { type: 'tacticalScreen' };
const TO_THE_LOADED_SECTOR = { type: 'enterSector', sector: LANDING };
const TO_THE_LAPTOP = { type: 'openLaptop' };
const EXITS: readonly CommandEnvelope[] = [TO_TACTICAL, TO_THE_LOADED_SECTOR, TO_THE_LAPTOP];

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

function quiet(session: CampaignSession): void {
  const map = session.campaign.state.map;
  for (const name of [LANDING, ELSEWHERE])
    Object.assign(sectorInfo(map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = session.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

async function onTheMapOverA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  quiet(session);
  const c = { session, live: withQueries(new ReloadingSession('map-screen-exits', session), sources) as ReloadingSession };
  expect(await order(c, { type: 'compressTime', mode: CompressMode.MIN5 })).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
  expect(await order(c, TO_THE_LOADED_SECTOR)).toMatchObject({ ok: true });
  c.live.advance({ idle: true });
  expect(await order(c, { type: 'mapScreen' })).toEqual({ ok: true });
  return c;
}

function merc(c: Campaign, profile: number): RosterMerc {
  return c.session.campaign.battle?.roster.all().find((m) => m.profile === profile) ?? never(`merc with profile ${profile}`);
}

function queueLines(c: Campaign, profiles: readonly number[]): void {
  const host = c.session.campaign.talk?.host ?? never('talk flow');
  for (const profile of profiles) expect(tacticalCharacterDialogue(host, merc(c, profile).soldier, LINE)).toBe(true);
}

async function kestrelToB9(c: Campaign): Promise<void> {
  const kestrel = merc(c, KESTREL).id;
  expect(await order(c, { type: 'assignSquad', soldier: kestrel, squad: 'new' })).toMatchObject({ ok: true });
  expect(await order(c, { type: 'route', soldier: kestrel, to: ELSEWHERE })).toMatchObject({ ok: true });
  const arrived = () => sameSector(merc(c, KESTREL).sector, parseSectorString(ELSEWHERE)) && !merc(c, KESTREL).betweenSectors;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) c.live.advance({ worldSeconds: AN_HOUR });
  expect(arrived()).toBe(true);
}

function linesWaiting(c: Campaign): number {
  return c.session.campaign.talk?.talk.queue.length ?? 0;
}

function sayTheQueuedLines(c: Campaign): void {
  for (let k = 0; k < LINE_STEPS && linesWaiting(c) > 0; k++) c.live.advance({ events: ['mercQuote'], ticks: LINE_TICKS });
  expect(linesWaiting(c)).toBe(0);
}

async function refusals(c: Campaign, exits: readonly CommandEnvelope[] = EXITS): Promise<unknown[]> {
  const refused: unknown[] = [];
  for (const cmd of exits) refused.push((await order(c, cmd)).data);
  return refused;
}

function refusedWith(token: string, count = EXITS.length): unknown[] {
  return Array.from({ length: count }, () => ({ refusal: token }));
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

async function enterHint(c: Campaign): Promise<{ readonly server: unknown; readonly client: unknown }> {
  const q = { type: 'canEnterSector', sector: LANDING };
  const { tick: _tick, ...server } = await c.live.query(q);
  return { server: server.data, client: clientAnswer(client, serialisedView(c.live), q).data };
}

describe('the exits from the map screen (Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo)', () => {
  it('refuses tactical, a sector load and the laptop while a line waits in the queue, then while one is said, until the queue is idle', async () => {
    const c = await onTheMapOverA9(31);
    queueLines(c, [KESTREL, VANT]);
    expect(await refusals(c)).toEqual(refusedWith('dialogueQueued'));
    expect(c.session.campaign.state.clock).toMatchObject({ paused: true, pauseLocked: true });
    sayTheQueuedLines(c);
    expect(c.session.campaign.talk?.talk.face).not.toBeNull();
    expect(await refusals(c)).toEqual(refusedWith('pauseLocked'));
    expect(c.session.campaign.state.clock).toMatchObject({ paused: true, pauseLocked: true });
    c.live.advance({ idle: true });
    expect(await order(c, TO_TACTICAL)).toEqual({ ok: true });
    expect(c.session.campaign.state.flow).toBe('tactical');
  });

  it('tells the agent to advance, and the advance it asks for opens the way', async () => {
    const c = await onTheMapOverA9(32);
    queueLines(c, [KESTREL]);
    c.live.advance({ ticks: 1 });
    const refused = await order(c, TO_THE_LOADED_SECTOR);
    expect(refused).toMatchObject({ ok: false, data: { refusal: 'pauseLocked' } });
    expect(refused.reason).toMatch(/^pauseLocked: .*advance/);
    c.live.advance({ idle: true });
    expect(await order(c, TO_THE_LOADED_SECTOR)).toMatchObject({ ok: true, data: { sector: LANDING } });
  });

  it('refuses them while a meanwhile is trying to start, and during the contract renewal sequence', async () => {
    const c = await onTheMapOverA9(36);
    c.session.campaign.state.meanwhile.trying = true;
    expect(await refusals(c)).toEqual(refusedWith('meanwhileStarting'));
    c.session.campaign.state.meanwhile.trying = false;
    for (const cmd of EXITS) {
      const contracts = c.session.campaign.contracts?.contracts ?? never('contract flow');
      contracts.renewal.on = true;
      expect(await refusals(c, [cmd])).toEqual(refusedWith('renewalSequence', 1));
    }
    expect(await order(c, TO_TACTICAL)).toEqual({ ok: true });
  });

  it('keeps the canEnterSector hint with enterSector, on the server and on the client', async () => {
    const c = await onTheMapOverA9(34);
    expect(await enterHint(c)).toEqual({ server: { allowed: true }, client: { allowed: true } });
    queueLines(c, [KESTREL, VANT]);
    c.live.advance({ ticks: 1 });
    const waiting = { allowed: false, reason: 'dialogueQueued' };
    expect(await enterHint(c)).toEqual({ server: waiting, client: waiting });
    sayTheQueuedLines(c);
    const said = { allowed: false, reason: 'pauseLocked' };
    expect(await enterHint(c)).toEqual({ server: said, client: said });
    c.live.advance({ idle: true });
    expect(await enterHint(c)).toEqual({ server: { allowed: true }, client: { allowed: true } });
  });

  it('refuses the way back to tactical after an advance that stops at a death off the loaded map, until the lines it brought are said', async () => {
    const c = await onTheMapOverA9(35);
    await kestrelToB9(c);
    Object.assign(merc(c, KESTREL).soldier, { life: LAST_LIFE_POINT, ...BLEEDING_NOW });
    const report = c.live.advance({ worldSeconds: AN_HOUR, mode: CompressMode.MIN5 });
    expect([report.reason, ofType(report.events, 'compressionStopped')]).toMatchObject(['event', [{ reason: 'mercDied' }]]);
    expect(await order(c, TO_TACTICAL)).toMatchObject({ ok: false, data: { refusal: 'dialogueQueued' } });
    c.live.advance({ idle: true });
    expect(await order(c, TO_TACTICAL)).toEqual({ ok: true });
  });
});
