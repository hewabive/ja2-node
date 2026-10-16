import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Assignment, NUMBER_OF_SQUADS } from './constants.ts';
import { addPlayerToGroup, createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector, getGroup } from './groups.ts';
import type { StrategicContext } from './ports.ts';
import {
  addCharacterToAnySquad,
  addCharacterToSquad,
  addCharacterToUniqueSquad,
  assignMercToAMovementGroup,
  initSquads,
  initVehicles,
  removeCharacterFromSquads,
  resetDeadSquadMemberList,
} from './squads.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const A9 = parseSectorString('A9');
const B9 = parseSectorString('B9');

function setup(): { ctx: StrategicContext; mercs: FakeMercs } {
  const mercs = new FakeMercs();
  const ctx = testContext({ content, mercs });
  createNewEnemyGroupDepartingFromSector(ctx, 8, 0, 3, 0);
  initSquads(ctx);
  initVehicles(ctx);
  return { ctx, mercs };
}

describe('squads', () => {
  it('creates 20 persistent squad groups and 10 vehicle groups after the existing groups', () => {
    const { ctx } = setup();
    const f = ctx.state.forces;
    expect(f.squadGroupIds).toEqual(Array.from({ length: NUMBER_OF_SQUADS }, (_, q) => q + 2));
    expect(f.vehicleGroupIds).toEqual(Array.from({ length: 10 }, (_, k) => k + 22));
    expect(getGroup(ctx, 22)).toMatchObject({ vehicle: true, persistent: true, transportMask: 2 });
    expect(f.deadSquadMembers[0]).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it('adds mercs in slot order, joins the squad group and sets the assignment', () => {
    const { ctx, mercs } = setup();
    mercs.add({ id: 0, sector: A9 });
    mercs.add({ id: 1, sector: A9 });
    expect(addCharacterToSquad(ctx, 0, 0)).toBe(true);
    expect(addCharacterToSquad(ctx, 1, 0)).toBe(true);
    expect(addCharacterToSquad(ctx, 1, 0)).toBe(true);
    const g = getGroup(ctx, ctx.state.forces.squadGroupIds[0] ?? -1);
    expect(ctx.state.forces.squads[0]).toEqual([0, 1]);
    expect(g).toMatchObject({ members: [0, 1], size: 2, sector: A9, next: A9 });
    expect(mercs.get(1)).toMatchObject({ assignment: 0, groupId: g?.id });
  });

  it('refuses a merc from another sector, a full squad and a squad on the move', () => {
    const { ctx, mercs } = setup();
    for (let id = 0; id < 7; id++) mercs.add({ id, sector: A9 });
    mercs.add({ id: 9, sector: B9 });
    expect(addCharacterToSquad(ctx, 0, 0)).toBe(true);
    expect(addCharacterToSquad(ctx, 9, 0)).toBe(false);
    for (let id = 1; id < 6; id++) addCharacterToSquad(ctx, id, 0);
    expect(addCharacterToSquad(ctx, 6, 0)).toBe(false);
    const first = mercs.get(0);
    if (first) first.betweenSectors = true;
    expect(addCharacterToSquad(ctx, 6, 0)).toBe(false);
  });

  it('compacts slots on removal, records dead members by profile and resets the list', () => {
    const { ctx, mercs } = setup();
    for (let id = 0; id < 3; id++) mercs.add({ id, sector: A9 });
    for (let id = 0; id < 3; id++) addCharacterToSquad(ctx, id, 0);
    mercs.mercs.set(1, { ...mercs.get(1)!, life: 0 });
    expect(removeCharacterFromSquads(ctx, 1)).toBe(true);
    expect(ctx.state.forces.squads[0]).toEqual([0, 2]);
    expect(ctx.state.forces.deadSquadMembers[0]?.[0]).toBe(mercs.get(1)?.profile);
    resetDeadSquadMemberList(ctx, 0);
    expect(ctx.state.forces.deadSquadMembers[0]?.[0]).toBe(-1);
  });

  it('prefers a compatible non-empty squad and otherwise the first empty one', () => {
    const { ctx, mercs } = setup();
    mercs.add({ id: 0, sector: A9 });
    mercs.add({ id: 1, sector: B9 });
    mercs.add({ id: 2, sector: A9 });
    expect(addCharacterToUniqueSquad(ctx, 0)).toBe(0);
    expect(addCharacterToAnySquad(ctx, 1)).toBe(1);
    expect(addCharacterToAnySquad(ctx, 2)).toBe(0);
    expect(addCharacterToUniqueSquad(ctx, 2)).toBe(2);
    expect(ctx.state.forces.squads[0]).toEqual([0]);
  });

  it('removes the own movement group of a merc with an assignment when he joins a squad', () => {
    const { ctx, mercs } = setup();
    mercs.add({ id: 4, sector: A9, assignment: Assignment.DOCTOR });
    expect(assignMercToAMovementGroup(ctx, 4)).toBe(true);
    const own = mercs.get(4)?.groupId ?? 0;
    expect(assignMercToAMovementGroup(ctx, 4)).toBe(false);
    addCharacterToSquad(ctx, 4, 3);
    expect(getGroup(ctx, own)).toBeUndefined();
    expect(mercs.get(4)?.groupId).toBe(ctx.state.forces.squadGroupIds[3]);
  });

  it('copies the squad path to a joining merc', () => {
    const { ctx, mercs } = setup();
    mercs.add({ id: 0, sector: A9 });
    mercs.add({ id: 1, sector: A9 });
    addCharacterToSquad(ctx, 0, 0);
    const first = mercs.get(0);
    if (first) first.path = [27, 45];
    addCharacterToSquad(ctx, 1, 0);
    expect(mercs.get(1)?.path).toEqual([27, 45]);
    const g = createNewPlayerGroupDepartingFromSector(ctx, A9);
    mercs.add({ id: 5, sector: A9 });
    addPlayerToGroup(ctx, g, 5);
    expect(g.members).toEqual([5]);
  });
});
