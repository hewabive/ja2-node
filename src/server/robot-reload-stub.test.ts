import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armSquadWithPistols } from '../../tests/support/pistol-kit.ts';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { MercKind } from '../sim/campaign/roster.ts';
import { createItem, type ItemObject } from '../sim/items/object.ts';
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
});
