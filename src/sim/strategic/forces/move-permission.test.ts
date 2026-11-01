import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { spawnCreature } from '../../../../tests/support/creatures.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { CampaignSim } from '../../campaign/campaign-sim.ts';
import { MercKind, type Roster } from '../../campaign/roster.ts';
import { createItem } from '../../items/object.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { Body, TEAM_FIRST_ID, Team } from '../../tactical/soldier.ts';
import { sectorMapOf } from '../../tactical/state.ts';
import { Npc } from '../narrative/npc-ids.ts';
import { Assignment, EncounterCode } from './constants.ts';
import { canCharacterMoveInStrategic, canEntireMovementGroupMove, MoveRefusal } from './move-permission.ts';
import type { StrategicContext } from './ports.ts';
import { addCharacterToUniqueSquad } from './squads.ts';

let kit: CampaignKit;
let content: StrategicContent;

beforeAll(async () => {
  const [sectors, economy, army, strategicContent] = await Promise.all([
    loadStubSectorKit(),
    loadEconomyTestContent(),
    loadArmyTestContent(),
    loadStrategicTestContent(),
  ]);
  kit = { sectors, economy, army };
  content = strategicContent;
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const EMPTY = { admins: 0, troops: 0, elites: 0 };
const ROBOT = 62;
const MARIA = 88;
const PEACE = { inCombat: false };
const CAT_TILE = gridNo(80, 80);
const NO_ROOM = 0;
const MUSEUM = parseSectorString('L12');
const B9 = parseSectorString('B9');
const MUSEUM_ROOMS = { BEFORE: 21, FIRST: 22, LAST: 41, AFTER: 42 } as const;
const VEHICLE = 2;
const VEHICLE_GROUP = 7;
const VEHICLE_SOLDIER = 10;
const ESCORT = 11;

function landed(garrison = EMPTY): { campaign: CampaignSim; roster: Roster } {
  const test = createTestCampaign(kit, { seed: 5, mercs: 2, garrison });
  landFirstSquad(test.campaign);
  return test;
}

function strategic(c: CampaignSim) {
  if (!c.strategic) throw new Error('no strategic layer');
  return c.strategic;
}

describe('strategic movement permission', () => {
  it('keeps a squad in a sector that still holds enemies, as the start sector does', () => {
    const { campaign } = landed({ admins: 0, troops: 3, elites: 0 });
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toEqual({ refusal: MoveRefusal.ENEMY, soldier: 0 });
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: enemiesPresent',
      data: { refusal: 'enemiesPresent', soldier: 0 },
    });
  });

  it('refuses during combat in the loaded sector and lets a cleared sector go', () => {
    const { campaign } = landed();
    expect(canEntireMovementGroupMove(strategic(campaign), 0, { inCombat: true })?.refusal).toBe(MoveRefusal.COMBAT);
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBeNull();
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toMatchObject({ ok: true });
  });

  it('checks every merc travelling in the same group and names the one who cannot move, as the custom errors print s.name', () => {
    const { campaign, roster } = landed();
    const other = roster.get(1);
    if (!other) throw new Error('no second merc');
    other.soldier.life = 5;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toEqual({ refusal: MoveRefusal.TOO_INJURED, soldier: 1 });
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toMatchObject({
      ok: false,
      data: { refusal: MoveRefusal.TOO_INJURED, soldier: 1 },
    });
    other.soldier.life = 80;
    other.assignment = Assignment.IN_TRANSIT;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toEqual({ refusal: MoveRefusal.TRANSIT, soldier: 1 });
  });

  it('keeps the robot back without a controller in its squad (ME_ROBOT_ALONE)', () => {
    const { campaign, roster } = landed();
    const robot = roster.get(1);
    const merc = roster.get(0);
    if (!robot || !merc) throw new Error('no squad');
    Object.assign(robot.record, { kind: MercKind.EPC });
    Object.assign(robot.soldier, { profile: ROBOT, bodyType: Body.ROBOTNOWEAPON });
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)?.refusal).toBe(MoveRefusal.ROBOT_ALONE);
    const head = merc.soldier.inv[InvSlot.HEAD1];
    if (head) head.item = campaign.battle?.content.items.byName.get('ROBOT_REMOTE_CONTROL')?.index ?? 0;
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)).toBeNull();
  });

  it('keeps an escort back without a merc in his squad and names him, also when another member asked (ME_CUSTOM, pMapErrorString 6 or 7)', () => {
    const { campaign, roster } = landed();
    const escort = roster.get(1);
    if (!escort) throw new Error('no squad');
    Object.assign(escort.record, { kind: MercKind.EPC });
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)).toBeNull();
    addCharacterToUniqueSquad(strategic(campaign), 1);
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)).toEqual({ refusal: MoveRefusal.EPC_ALONE, soldier: 1 });
    expect(campaign.dispatch({ type: 'route', soldier: 1, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: escortAlone',
      data: { refusal: 'escortAlone', soldier: 1 },
    });
  });

  it('names the escort riding alone in a vehicle when the vehicle is asked to move', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs });
    const vehicle = mercs.add({ id: VEHICLE_SOLDIER, sector: B9, isVehicle: true, assignment: Assignment.VEHICLE });
    const escort = mercs.add({ id: ESCORT, sector: B9, isEpc: true, assignment: Assignment.VEHICLE });
    for (const m of [vehicle, escort]) Object.assign(m, { vehicleId: VEHICLE, groupId: VEHICLE_GROUP });
    expect(canEntireMovementGroupMove(ctx, VEHICLE_SOLDIER, PEACE)).toEqual({ refusal: MoveRefusal.EPC_ALONE, soldier: ESCORT });
  });

  it('keeps Maria in C5', () => {
    const { campaign, roster } = landed();
    const maria = roster.get(1);
    if (!maria) throw new Error('no squad');
    Object.assign(maria.soldier, { profile: MARIA });
    maria.sector = { x: 5, y: 3, z: 0 };
    expect(canCharacterMoveInStrategic(strategic(campaign), maria, PEACE)).toBe(MoveRefusal.CANNOT_LEAVE);
  });
});

class MuseumMercs extends FakeMercs {
  readonly rooms = new Map<number, number>();
  readonly chaliceCarriers = new Set<number>();

  roomOf(id: number): number {
    return this.rooms.get(id) ?? NO_ROOM;
  }

  carries(id: number, itemName: string): boolean {
    return itemName === 'CHALICE' && this.chaliceCarriers.has(id);
  }
}

function museum(): { ctx: StrategicContext; mercs: MuseumMercs } {
  const mercs = new MuseumMercs();
  const ctx = testContext({ content, mercs });
  mercs.add({ id: 0, sector: MUSEUM, assignment: Assignment.SQUAD_1 });
  mercs.add({ id: 1, sector: B9, assignment: Assignment.ON_DUTY });
  mercs.rooms.set(0, MUSEUM_ROOMS.FIRST);
  mercs.chaliceCarriers.add(1);
  return { ctx, mercs };
}

function refusalOf(ctx: StrategicContext, mercs: MuseumMercs, id = 0): string | null {
  const m = mercs.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return canCharacterMoveInStrategic(ctx, m, PEACE);
}

describe('the bloodcat ambush and the museum chalice (CanCharacterMoveInStrategic)', () => {
  it('refuses a move from the loaded sector as combat during a bloodcat ambush while a bloodcat lives', () => {
    const { campaign } = landed();
    const tactical = campaign.tactical;
    if (!tactical) throw new Error('no loaded sector');
    campaign.state.encounter.code = EncounterCode.BLOODCAT_AMBUSH;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBeNull();
    const cat = spawnCreature(tactical, TEAM_FIRST_ID[Team.CREATURE], Body.BLOODCAT, CAT_TILE, Direction.NORTH);
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)?.refusal).toBe(MoveRefusal.COMBAT);
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: inCombat',
      data: { refusal: 'inCombat', soldier: 0 },
    });
    campaign.state.encounter.code = EncounterCode.ENEMY_AMBUSH;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBeNull();
    campaign.state.encounter.code = EncounterCode.BLOODCAT_AMBUSH;
    cat.life = 0;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBeNull();
  });

  it('keeps a merc in the museum rooms of L12, alarm or not, while any merc anywhere carries the chalice, before his assignment (ME_MUSEUM)', () => {
    const { ctx, mercs } = museum();
    expect(refusalOf(ctx, mercs)).toBe(MoveRefusal.MUSEUM);
    const m = mercs.get(0);
    if (!m) throw new Error('no merc');
    m.assignment = Assignment.ON_DUTY;
    expect(refusalOf(ctx, mercs)).toBe(MoveRefusal.MUSEUM);
    mercs.chaliceCarriers.clear();
    expect(refusalOf(ctx, mercs)).toBe(MoveRefusal.BUSY);
  });

  it('lets him go from rooms outside 22 to 41, between sectors and after Eldin died', () => {
    const { ctx, mercs } = museum();
    for (const [room, refusal] of [
      [MUSEUM_ROOMS.BEFORE, null],
      [MUSEUM_ROOMS.FIRST, MoveRefusal.MUSEUM],
      [MUSEUM_ROOMS.LAST, MoveRefusal.MUSEUM],
      [MUSEUM_ROOMS.AFTER, null],
    ] as const) {
      mercs.rooms.set(0, room);
      expect(refusalOf(ctx, mercs), `room ${room}`).toBe(refusal);
    }
    mercs.rooms.set(0, MUSEUM_ROOMS.FIRST);
    ctx.state.profiles.set(Npc.ELDIN, testProfile(Npc.ELDIN));
    expect(refusalOf(ctx, mercs)).toBe(MoveRefusal.MUSEUM);
    ctx.state.profiles.set(Npc.ELDIN, testProfile(Npc.ELDIN, { mercStatus: MercStatus.IS_DEAD }));
    expect(refusalOf(ctx, mercs)).toBeNull();
    ctx.state.profiles.delete(Npc.ELDIN);
    const m = mercs.get(0);
    if (m) m.betweenSectors = true;
    expect(refusalOf(ctx, mercs)).toBeNull();
  });

  it("reads the room under a merc's tile in whatever map is loaded, also for a merc in another sector (GetRoom)", () => {
    const before = createTestCampaign(kit, { seed: 5, mercs: 2, garrison: EMPTY });
    expect(before.roster.roomOf(0)).toBe(NO_ROOM);
    const { campaign, roster } = landed();
    const t = campaign.tactical?.state;
    const merc = roster.get(1);
    if (!t || !merc) throw new Error('no loaded sector');
    const rooms = sectorMapOf(t).rooms;
    const roomTile = rooms.findIndex((room) => room !== NO_ROOM);
    merc.sector = MUSEUM;
    merc.soldier.gridNo = roomTile;
    expect(roster.roomOf(1)).toBe(rooms[roomTile]);
    expect(roster.roomOf(1)).not.toBe(NO_ROOM);
  });

  it('finds the chalice in any pocket of a merc', () => {
    const { roster } = landed();
    const merc = roster.get(1);
    const chalice = kit.sectors.content.items.byName.get('CHALICE');
    if (!merc || !chalice) throw new Error('no merc or chalice');
    expect(roster.carries(1, 'CHALICE')).toBe(false);
    merc.soldier.inv[InvSlot.SMALLPOCK8] = createItem(kit.sectors.content.items, chalice.index, 100);
    expect(roster.carries(1, 'CHALICE')).toBe(true);
    expect(roster.carries(0, 'CHALICE')).toBe(false);
  });
});
