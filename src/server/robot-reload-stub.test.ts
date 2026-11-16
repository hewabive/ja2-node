import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armSquadWithPistols } from '../../tests/support/pistol-kit.ts';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { MercKind } from '../sim/campaign/roster.ts';
import { createItem, createMoney, type ItemObject } from '../sim/items/object.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { Body, type Soldier } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const POCKET = InvSlot.SMALLPOCK1;
const MAGAZINES = 2;
const FULL_CLIP = 15;
const PART_CLIP = 10;
const FULL_45 = 7;
const PART_45 = 5;
const LOW_45 = 2;
const POCKET_MONEY = 500;
const GIVEN_MONEY = 100;

interface Scene {
  readonly session: CampaignSession;
  readonly live: ReloadingSession;
  readonly merc: number;
  readonly robot: number;
}

function item(name: string): number {
  return kit.content.items.byName.get(name)?.index ?? -1;
}

function soldier(session: CampaignSession, id: number): Soldier {
  const s = session.campaign.tactical?.state.soldiers[id];
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function magazines(s: Soldier, name = 'CLIP9_15'): number {
  return s.inv.filter((o) => o.item === item(name)).reduce((n, o) => n + o.count, 0);
}

async function withRobot(seed: number, mode?: RunMode): Promise<Scene> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs: 2, land: false });
  armSquadWithPistols(created, kit.content.items);
  const robotMerc = created.campaign.battle?.roster.all()[1];
  if (!robotMerc) throw new Error('no second merc');
  Object.assign(robotMerc.record, { kind: MercKind.EPC });
  robotMerc.soldier.bodyType = Body.ROBOTNOWEAPON;
  (robotMerc.soldier.inv[InvSlot.HAND] as ItemObject).gunShotsLeft = 0;
  const session = drivenSession(created, stubSessionSources(kit), mode);
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
  const live = new ReloadingSession('robot', session);
  live.advance({ idle: true });
  return { session, live, merc: robotMerc.id === 0 ? 1 : 0, robot: robotMerc.id };
}

function giveMagazineToRobot({ session, live, merc, robot }: Scene): void {
  const reply = live.dispatch({ type: 'give', soldier: merc, target: robot, slot: POCKET, count: 1 });
  expect(reply).toMatchObject({ ok: true, data: { reload: true } });
  expect(magazines(soldier(session, merc))).toBe(MAGAZINES - 1);
  expect(live.advance({ idle: true }).events).toContainEqual(expect.objectContaining({ type: 'reloaded', soldier: robot }));
}

async function reloadScenario(mode: RunMode): Promise<CampaignSession> {
  const scene = await withRobot(31, mode);
  giveMagazineToRobot(scene);
  return scene.session;
}

describe('ammo given to the robot reloads its gun (HandleItemPointerClick, the robot branch)', () => {
  it('takes one magazine off the pocket at once and loads the robot’s gun during advance', async () => {
    const scene = await withRobot(31);
    giveMagazineToRobot(scene);
    const { session, merc, robot } = scene;
    expect(soldier(session, robot).inv[InvSlot.HAND]).toMatchObject({ gunShotsLeft: FULL_CLIP, gunAmmoItem: item('CLIP9_15') });
    expect(magazines(soldier(session, merc))).toBe(MAGAZINES - 1);
    expect(soldier(session, merc).tempObject).toBeNull();
  });

  it('reloads the robot the same way when the session is saved and restored after every input', async () => {
    await expectReloadsInvisible(reloadScenario);
  });

  it('loads one magazine of a stack from the first while the pocket loses the second, as the put-back and RemoveObjs do', async () => {
    const scene = await withRobot(34);
    const pocket = soldier(scene.session, scene.merc).inv[POCKET] as ItemObject;
    pocket.status = [FULL_CLIP, PART_CLIP];
    giveMagazineToRobot(scene);
    expect(soldier(scene.session, scene.robot).inv[InvSlot.HAND]?.gunShotsLeft).toBe(FULL_CLIP);
    const left = soldier(scene.session, scene.merc).inv[POCKET] as ItemObject;
    expect(left.status.slice(0, left.count)).toEqual([FULL_CLIP]);
  });

  it('refuses ammo of another calibre with the calibre the robot needs and leaves the pocket alone', async () => {
    const { session, live, merc, robot } = await withRobot(32);
    Object.assign(soldier(session, merc).inv[POCKET] as object, createItem(kit.content.items, item('CLIP45_7'), 100));
    const calibre = kit.content.items.byIndex.get(soldier(session, robot).inv[InvSlot.HAND]?.item ?? 0)?.weapon?.calibre;
    expect(live.dispatch({ type: 'give', soldier: merc, target: robot, slot: POCKET })).toEqual({
      ok: false,
      reason: "robotNeedsCalibre: the robot's gun takes ammo of another calibre",
      data: { refusal: 'robotNeedsCalibre', calibre },
    });
    expect(magazines(soldier(session, merc), 'CLIP45_7')).toBe(1);
    expect(soldier(session, merc).tempObject).toBeNull();
  });

  it('puts one magazine of a stack the robot refuses back at the end of the stack, as the put-back before the calibre check does, and a whole stack back as it was', async () => {
    const { session, live, merc, robot } = await withRobot(35);
    const stack = (status: readonly number[]) =>
      Object.assign(soldier(session, merc).inv[POCKET] as object, {
        ...createItem(kit.content.items, item('CLIP45_7'), 100),
        count: status.length,
        status: [...status],
      });
    const pocketStatus = () => {
      const o = soldier(session, merc).inv[POCKET] as ItemObject;
      return o.status.slice(0, o.count);
    };
    stack([FULL_45, PART_45, LOW_45]);
    expect(live.dispatch({ type: 'give', soldier: merc, target: robot, slot: POCKET, count: 1 })).toMatchObject({
      ok: false,
      data: { refusal: 'robotNeedsCalibre' },
    });
    expect(pocketStatus()).toEqual([PART_45, LOW_45, FULL_45]);
    expect(live.dispatch({ type: 'give', soldier: merc, target: robot, slot: POCKET })).toMatchObject({
      ok: false,
      data: { refusal: 'robotNeedsCalibre' },
    });
    expect(pocketStatus()).toEqual([PART_45, LOW_45, FULL_45]);
  });

  it('keeps keys off the key ring the robot refuses on the ring, which the original puts into the slot numbered like their ring position, losing them at 0–4 and the swapped-out item at 5–18 (original-bugs "Key ring keys given to the robot")', async () => {
    const { session, live, merc, robot } = await withRobot(36);
    const ring = soldier(session, merc).keyRing ?? [];
    ring[InvSlot.VEST] = { keyId: 1, count: 2 };
    ring[POCKET] = { keyId: 2, count: 1 };
    const inventoryBefore = JSON.stringify(soldier(session, merc).inv);
    for (const position of [InvSlot.VEST, POCKET])
      expect(live.dispatch({ type: 'give', soldier: merc, target: robot, slot: { ring: position }, count: 1 })).toMatchObject({
        ok: false,
        data: { refusal: 'robotNeedsCalibre' },
      });
    const after = soldier(session, merc);
    expect([after.keyRing?.[InvSlot.VEST], after.keyRing?.[POCKET]]).toEqual([
      { keyId: 1, count: 2 },
      { keyId: 2, count: 1 },
    ]);
    expect(JSON.stringify(after.inv)).toBe(inventoryBefore);
    expect(magazines(after)).toBe(MAGAZINES);
  });

  it('refuses money for the robot, withdrawn from the account or split off a pocket, which the original loses with its cursor of no source slot (original-bugs "Money given to the robot")', async () => {
    const { session, live, merc, robot } = await withRobot(33);
    Object.assign(soldier(session, merc).inv[POCKET] as object, createMoney(kit.content.items, POCKET_MONEY));
    const calibre = kit.content.items.byIndex.get(soldier(session, robot).inv[InvSlot.HAND]?.item ?? 0)?.weapon?.calibre;
    const refused = {
      ok: false,
      reason: "robotNeedsCalibre: the robot's gun takes ammo of another calibre",
      data: { refusal: 'robotNeedsCalibre', calibre },
    };
    const balance = session.campaign.state.finances.balance;
    session.drainEvents();
    expect(live.dispatch({ type: 'withdrawCash', soldier: merc, amount: GIVEN_MONEY, to: 'give', target: robot })).toEqual(refused);
    expect(live.dispatch({ type: 'give', soldier: merc, target: robot, money: GIVEN_MONEY, slot: POCKET })).toEqual(refused);
    expect(session.campaign.state.finances.balance).toBe(balance);
    expect(soldier(session, merc).inv[POCKET]?.money).toBe(POCKET_MONEY);
    expect(session.drainEvents().some((e) => e.type === 'cashWithdrawn' || e.type === 'moneyChanged')).toBe(false);
  });
});
