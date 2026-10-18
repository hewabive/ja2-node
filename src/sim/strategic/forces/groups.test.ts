import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { MAP_SIDE, parseSectorId, parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { Assignment, MoveType } from './constants.ts';
import {
  addPlayerToGroup,
  createNewEnemyGroupDepartingFromSector,
  createNewPlayerGroupDepartingFromSector,
  findPlayerMovementGroupInSector,
  getGroup,
  groupAtFinalDestination,
  numEnemiesInEverySurfaceSector,
  numEnemiesInSector,
  numHostilesInSector,
  playerMercsInSector,
  removeAllGroups,
  removeGroup,
  removePlayerFromGroup,
} from './groups.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const A9 = parseSectorString('A9');

describe('group list', () => {
  it('takes the lowest free id, appends to the list and reuses ids after removal', () => {
    const ctx = testContext({ content });
    const a = createNewEnemyGroupDepartingFromSector(ctx, 8, 0, 3, 1);
    const b = createNewPlayerGroupDepartingFromSector(ctx, A9);
    const c = createNewEnemyGroupDepartingFromSector(ctx, 9, 0, 2, 0);
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
    removeGroup(ctx, b);
    const d = createNewPlayerGroupDepartingFromSector(ctx, A9);
    expect(d.id).toBe(2);
    expect(ctx.state.forces.groups.map((g) => g.id)).toEqual([1, 3, 2]);
    expect(getGroup(ctx, 3)).toBe(c);
  });

  it('creates enemy groups as CIRCULAR with troops + elites as size and player groups as ONE_WAY on foot', () => {
    const ctx = testContext({ content });
    const enemy = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C5'), 4, 3, 2);
    expect(enemy).toMatchObject({ size: 5, moveType: MoveType.CIRCULAR, transportMask: 1, originalSector: parseSectorId('C5') });
    expect(enemy.next).toEqual({ x: 0, y: 0, z: 0 });
    const player = createNewPlayerGroupDepartingFromSector(ctx, A9);
    expect(player).toMatchObject({ moveType: MoveType.ONE_WAY, sector: A9, next: A9, sectorIdOfLastReassignment: 255 });
  });

  it('removes the arrival event with the group and only parks persistent groups', () => {
    const ctx = testContext({ content });
    const g = createNewPlayerGroupDepartingFromSector(ctx, A9);
    g.persistent = true;
    g.betweenSectors = true;
    g.waypoints = [{ x: 10, y: 1, z: 0 }];
    addStrategicEvent(ctx.state.queue, EventKind.GROUP_ARRIVAL, 2000, g.id);
    removeGroup(ctx, g);
    expect(ctx.state.forces.groups).toContain(g);
    expect(g).toMatchObject({ betweenSectors: false, waypoints: [], sector: { x: 0, y: 0, z: 0 } });
    expect(ctx.state.queue.events).toHaveLength(0);
    removeAllGroups(ctx);
    expect(ctx.state.forces.groups).toHaveLength(0);
  });
});

describe('player membership', () => {
  it('copies the first member position and previous sector into the group', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs });
    mercs.add({ id: 1, sector: A9, prevSectorId: parseSectorId('A8') });
    mercs.add({ id: 2, sector: A9 });
    const g = createNewPlayerGroupDepartingFromSector(ctx, parseSectorString('B2'));
    addPlayerToGroup(ctx, g, 1);
    addPlayerToGroup(ctx, g, 2);
    expect(g).toMatchObject({ size: 2, members: [1, 2], sector: A9, prev: parseSectorString('A8') });
    expect(mercs.get(2)?.groupId).toBe(g.id);
  });

  it('gives the group previous sector back on removal and removes an emptied non-persistent group', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs });
    mercs.add({ id: 1, sector: A9, prevSectorId: parseSectorId('A8') });
    const g = createNewPlayerGroupDepartingFromSector(ctx, A9);
    addPlayerToGroup(ctx, g, 1);
    g.prev = parseSectorString('B9');
    removePlayerFromGroup(ctx, 1);
    expect(mercs.get(1)).toMatchObject({ groupId: 0, prevSectorId: parseSectorId('B9') });
    expect(ctx.state.forces.groups).toHaveLength(0);
  });
});

describe('counting helpers', () => {
  it('counts departed enemy groups in their old sector and ignores z for the surface count', () => {
    const ctx = testContext({ content });
    const info = ctx.state.map.sectors[parseSectorId('C5')];
    if (info) Object.assign(info, { numTroops: 3, numAdmins: 1, numCreatures: 2 });
    const g = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C5'), 0, 4, 1);
    g.betweenSectors = true;
    g.next = parseSectorString('C6');
    expect(numEnemiesInSector(ctx, parseSectorString('C5'))).toBe(9);
    expect(numEnemiesInSector(ctx, { ...parseSectorString('C5'), z: 1 })).toBe(4);
    expect(numHostilesInSector(ctx, parseSectorString('C5'))).toBe(11);
  });

  it('counts every surface sector at once exactly as numEnemiesInSector does, wrapping at 256', () => {
    const ctx = testContext({ content });
    const c5 = ctx.state.map.sectors[parseSectorId('C5')];
    if (c5) Object.assign(c5, { numTroops: 200, numElites: 40 });
    const d7 = ctx.state.map.sectors[parseSectorId('D7')];
    if (d7) Object.assign(d7, { numAdmins: 3 });
    createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C5'), 0, 10, 10);
    createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('C5'), 1, 4, 1);
    createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('D7'), 0, 5, 0).betweenSectors = true;
    const below = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('E2'), 0, 6, 0);
    below.sector = { ...below.sector, z: 1 };
    createNewPlayerGroupDepartingFromSector(ctx, A9);
    const counts = numEnemiesInEverySurfaceSector(ctx);
    for (let y = 1; y <= MAP_SIDE; y++)
      for (let x = 1; x <= MAP_SIDE; x++) expect(counts[sectorId({ x, y })]).toBe(numEnemiesInSector(ctx, { x, y, z: 0 }));
    expect(counts[parseSectorId('C5')]).toBe((240 + 20 + 5) & 0xff);
  });

  it('finds involved player groups only on the surface and without in-transit members', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs });
    mercs.add({ id: 1, sector: A9 });
    mercs.add({ id: 2, sector: A9, life: 0 });
    const g = createNewPlayerGroupDepartingFromSector(ctx, A9);
    addPlayerToGroup(ctx, g, 1);
    addPlayerToGroup(ctx, g, 2);
    expect(findPlayerMovementGroupInSector(ctx, A9)).toBe(g);
    expect(playerMercsInSector(ctx, A9)).toBe(1);
    const m = mercs.get(1);
    if (m) m.assignment = Assignment.IN_TRANSIT;
    expect(findPlayerMovementGroupInSector(ctx, A9)).toBeUndefined();
  });

  it('treats a group without waypoints as being at its final destination', () => {
    const ctx = testContext({ content });
    const g = createNewPlayerGroupDepartingFromSector(ctx, A9);
    expect(groupAtFinalDestination(g)).toBe(true);
    g.waypoints = [{ x: 9, y: 3, z: 0 }];
    expect(groupAtFinalDestination(g)).toBe(false);
    g.moveType = MoveType.CIRCULAR;
    g.waypoints = [];
    expect(groupAtFinalDestination(g)).toBe(false);
  });
});
