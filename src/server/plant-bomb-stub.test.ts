import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { DIRECTION_INCREMENT, Direction } from '../content/world/grid.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem, emptyObject, type ItemObject } from '../sim/items/object.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Detonator, detonatorOf, frequencyOf } from '../sim/tactical/bombs/bomb-object.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import type { Soldier } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const SURE_SKILL = 100;
const FREQUENCY = '2';
const TILES_EAST = 2;
const TRIGGER_POCKET = InvSlot.SMALLPOCK1;
const BLAST_TICKS = 3000;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
  readonly merc: number;
}

function item(name: string): number {
  return kit.content.items.byName.get(name)?.index ?? -1;
}

function remoteBomb(): ItemObject {
  const o = createItem(kit.content.items, item('TNT'), 100);
  o.attachments[0] = { item: item('REMDETONATOR'), status: 100 };
  return o;
}

async function kestrelInA9(seed: number, mode?: RunMode): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL], land: false });
  const merc = created.campaign.battle?.roster.all()[0]?.soldier;
  if (!merc) throw new Error('no merc');
  Object.assign(merc.stats, { explosives: SURE_SKILL, wisdom: SURE_SKILL });
  for (let slot = 0; slot < merc.inv.length; slot++) merc.inv[slot] = emptyObject();
  merc.inv[InvSlot.HAND] = remoteBomb();
  merc.inv[TRIGGER_POCKET] = createItem(kit.content.items, item('REMOTEBOMBTRIGGER'), 100);
  const session = drivenSession(created, stubSessionSources(kit), mode);
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
  const live = new ReloadingSession('plant bomb', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live, merc: merc.id };
}

function tactical(c: Campaign): TacticalState {
  const t = c.session.campaign.tactical?.state;
  if (!t) throw new Error('no sector is loaded');
  return t;
}

function soldier(c: Campaign): Soldier {
  const s = tactical(c).soldiers[c.merc];
  if (!s) throw new Error('the merc is not in the sector');
  return s;
}

async function order(c: Campaign, cmd: Readonly<Record<string, unknown>>): Promise<void> {
  const envelope = { ...cmd, type: String(cmd.type) };
  await c.session.prepare(envelope);
  expect(c.live.dispatch(envelope)).toMatchObject({ ok: true });
}

async function plantRemoteBomb(c: Campaign): Promise<number> {
  const at = soldier(c).gridNo + TILES_EAST * (DIRECTION_INCREMENT[Direction.EAST] ?? 0);
  await order(c, { type: 'plantBomb', soldier: c.merc, gridNo: at });
  expect(soldier(c).pendingDropBomb).toBe(true);
  expect(c.live.advance({ idle: true }).reason).toBe('decision');
  expect(c.session.view().prompt).toEqual({
    id: expect.stringMatching(/^bombSetting-\d+-1$/),
    kind: 'bombSetting',
    soldier: c.merc,
    gridNo: at,
    item: 'TNT',
    detonator: 'remote',
    choices: ['1', '2', '3', '4'],
  });
  expect(c.live.dispatch({ type: 'answer', choice: FREQUENCY })).toMatchObject({ ok: true });
  return at;
}

async function setItOff(c: Campaign): Promise<SimEvent[]> {
  await order(c, { type: 'moveItem', soldier: c.merc, from: TRIGGER_POCKET, to: 'hand' });
  await order(c, { type: 'useRemote', soldier: c.merc });
  expect(c.live.advance({ idle: true }).reason).toBe('decision');
  expect(c.session.view().prompt).toMatchObject({ kind: 'remoteFrequency', soldier: c.merc });
  expect(c.live.dispatch({ type: 'answer', choice: FREQUENCY })).toMatchObject({ ok: true });
  return [...c.live.advance({ events: ['explosion'], ticks: BLAST_TICKS }).events];
}

async function scenario(mode: RunMode): Promise<CampaignSession> {
  const c = await kestrelInA9(93, mode);
  await plantRemoteBomb(c);
  await setItOff(c);
  return c.session;
}

describe('a remote bomb planted and set off in a campaign (HandleItem, BombMessageBoxCallBack)', () => {
  it('walks to the tile, asks for the frequency, arms the bomb there, and the trigger on that frequency blows it up', async () => {
    const c = await kestrelInA9(93);
    const at = await plantRemoteBomb(c);
    const bomb = tactical(c).worldItems.find((wi) => wi.gridNo === at && wi.object.item === item('TNT'));
    expect(bomb && [detonatorOf(bomb.object), frequencyOf(bomb.object)]).toEqual([Detonator.REMOTE, Number(FREQUENCY)]);
    expect(soldier(c).gridNo).toBe(at);
    const events = await setItOff(c);
    expect(events).toContainEqual(expect.objectContaining({ type: 'explosion', gridNo: at, item: item('TNT') }));
  });

  it('plays the same when the session is saved and restored after every input', async () => {
    await expectReloadsInvisible(scenario);
  });
});
