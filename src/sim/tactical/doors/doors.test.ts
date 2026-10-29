import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { runUntilIdle as runSimUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { ItemClass } from '../../../content/items/items.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import type { SimEvent } from '../../events.ts';
import { createItem } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { swapStructureForPartner, toggleDoorAt } from '../doors.ts';
import { InvSlot } from '../inventory.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { doorApCost, doorMenu, handleOpenableStruct } from './door-actions.ts';
import { DoorTrap, findDoorInfo, HandleDoor, PerceivedLock, PerceivedTrap, removeDoorInfo, updateDoor } from './door-table.ts';
import { keyRingView } from './door-view.ts';
import { newKeyRing } from './key-ring.ts';
import { attemptToCrowbarLock, attemptToSmashDoor, damageLock } from './lock-attempts.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const DOOR = 11429;
const OUTSIDE = DOOR + 160;
const FAR = OUTSIDE + 160 * 4;
const NORTH = 0;
const MERC_PROFILE = 5;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function village(seed = 5): TacticalSim {
  return new TacticalSim(kit.world(VILLAGE), kit.content, seed);
}

function scripted(
  sim: TacticalSim,
  pre: readonly number[],
  main: readonly number[] = [],
  fallback: number | null = null,
): { pre: ScriptedStream; main: ScriptedStream } {
  const streams = { pre: new ScriptedStream(pre, fallback), main: new ScriptedStream(main, fallback) };
  Object.assign(sim.state, { pre: streams.pre, rng: streams.main });
  return streams;
}

function resultsOf(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'doorResult' ? [`${e.action}:${e.result}`] : []));
}

function doorStructure(sim: TacticalSim) {
  const structure = sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR);
  if (!structure) throw new Error('no stub door');
  return structure;
}

describe('a door the map holds open', () => {
  it('is open in the view before anybody touches it, and leaves it once closed', () => {
    const sim = village();
    expect(swapStructureForPartner(sim.state, doorStructure(sim))).not.toBeNull();
    expect(sim.state.doorStatus.has(DOOR)).toBe(false);
    expect(sim.openDoors()).toEqual([DOOR]);
    expect(toggleDoorAt(sim.state, DOOR)).toBe(true);
    expect(sim.openDoors()).toEqual([]);
  });
});

describe('the stub village door', () => {
  it('is a locked, electrically trapped door with lock 1', () => {
    const sim = village();
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ locked: true, lockId: 1, trapId: DoorTrap.ELECTRIC, trapLevel: 3 });
    expect(sim.state.content.locks[1]).toMatchObject({ pickDifficulty: 20, smashDifficulty: 30 });
    expect(doorStructure(sim).flags & StructureFlags.OPEN).toBe(0);
  });

  it('returns the menu as data when a merc tries to open it, after walking there', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, FAR, NORTH);
    sim.lookAround();
    const walk = sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'open' });
    expect(walk).toMatchObject({ ok: true, data: { walking: true, to: OUTSIDE } });
    const events = runSimUntilIdle(sim);
    expect(s.gridNo).toBe(OUTSIDE);
    const menu = events.find((e) => e.type === 'doorMenu');
    expect(menu?.type === 'doorMenu' ? menu.options.map((o) => `${o.action}:${o.enabled ? 'on' : (o.reason ?? 'off')}`) : []).toEqual([
      'openManually:on',
      'unlock:noKey',
      'crowbar:noCrowbar',
      'pickLock:noLockpickKit',
      'explode:noShapedCharge',
      'examine:on',
      'force:on',
      'untrap:on',
    ]);
    const again = sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'open' });
    expect(again).toMatchObject({ ok: true, data: { opened: false, locked: true } });
  });

  it('asks with the closing menu before our merc closes an open door, as vanilla does', () => {
    const sim = village();
    updateDoor(sim.state, DOOR, { locked: false, trapId: DoorTrap.NONE });
    expect(toggleDoorAt(sim.state, DOOR)).toBe(true);
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    sim.lookAround();
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'close' })).toMatchObject({
      ok: true,
      data: { closed: false },
    });
    const menu = sim.drainEvents().find((e) => e.type === 'doorMenu');
    expect(menu).toMatchObject({ closing: true });
    expect(menu?.type === 'doorMenu' ? menu.options.map((o) => `${o.action}:${o.enabled ? 'on' : (o.reason ?? 'off')}`) : []).toEqual([
      'closeManually:on',
      'unlock:doorOpen',
      'crowbar:doorOpen',
      'pickLock:doorOpen',
      'explode:doorOpen',
      'examine:doorOpen',
      'force:doorOpen',
      'untrap:doorOpen',
    ]);
    expect(doorStructure(sim).flags & StructureFlags.OPEN).not.toBe(0);
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'closeManually' })).toMatchObject({
      ok: true,
      data: { started: 'closeManually' },
    });
    expect(runSimUntilIdle(sim).some((e) => e.type === 'doorChanged' && !e.open)).toBe(true);
    expect(doorStructure(sim).flags & StructureFlags.OPEN).toBe(0);
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'closeManually' }).data).toEqual({ refusal: 'alreadyClosed' });
  });

  it('examines the trap, untraps it and unlocks the door with the stub key', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    sim.lookAround();
    const noise = 0;
    scripted(sim, [noise, 1], [], 0);
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'examine' }).ok).toBe(true);
    const examined = runSimUntilIdle(sim);
    expect(resultsOf(examined)).toEqual(['examine:trapFound']);
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ perceivedTrapped: PerceivedTrap.PROVED_TRAPPED });
    expect(sim.doors()).toEqual([{ gridNo: DOOR, locked: 'locked', trap: 'electric' }]);
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'examine' })).toMatchObject({
      ok: false,
      data: { refusal: 'alreadyKnown' },
    });
    s.stats.explosives = 90;
    s.stats.mechanical = 90;
    scripted(sim, [noise, 0], [], 0);
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'untrap' }).ok).toBe(true);
    expect(resultsOf(runSimUntilIdle(sim))).toEqual(['untrap:untrapped']);
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ trapId: DoorTrap.NONE, perceivedTrapped: PerceivedTrap.PROVED_UNTRAPPED });
    const key = createItem(sim.state.content.items, sim.state.content.items.byName.get('KEY_1')?.index ?? 0, 100);
    key.keyId = 1;
    s.inv[InvSlot.BIGPOCK2] = key;
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'unlock' }).ok).toBe(true);
    const unlocked = runSimUntilIdle(sim);
    expect(resultsOf(unlocked)).toEqual(['unlock:opened']);
    expect(unlocked.some((e) => e.type === 'doorChanged' && e.open)).toBe(true);
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ locked: false, perceivedLocked: PerceivedLock.UNLOCKED });
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'closeManually' }).ok).toBe(true);
    expect(runSimUntilIdle(sim).some((e) => e.type === 'doorChanged' && !e.open)).toBe(true);
  });

  it('tries the handle of the locked door with open manually (HANDLE_DOOR_OPEN from the menu)', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    sim.lookAround();
    updateDoor(sim.state, DOOR, { trapId: DoorTrap.NONE });
    sim.state.inCombat = true;
    const before = s.actionPoints;
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'openManually' })).toMatchObject({
      ok: true,
      data: { started: 'openManually' },
    });
    expect(s.doorHandleCode).toBe(HandleDoor.OPEN);
    const events = runSimUntilIdle(sim);
    expect(resultsOf(events)).toEqual(['open:locked']);
    expect(doorStructure(sim).flags & StructureFlags.OPEN).toBe(0);
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ locked: true, perceivedLocked: PerceivedLock.LOCKED });
    expect(s.actionPoints).toBe(before);
    updateDoor(sim.state, DOOR, { locked: false });
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'openManually' }).data).toEqual({ refusal: 'notLocked' });
  });

  it('lets our merc open a door with a lock entry for free: only a door without one costs the opening APs', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    updateDoor(sim.state, DOOR, { locked: false, trapId: DoorTrap.NONE });
    sim.state.inCombat = true;
    const full = s.actionPoints;
    s.doorHandleCode = HandleDoor.OPEN;
    expect(handleOpenableStruct(sim.state, s, DOOR, doorStructure(sim))).toBe(true);
    expect(s.actionPoints).toBe(full);
    toggleDoorAt(sim.state, DOOR);
    removeDoorInfo(sim.state, DOOR);
    expect(handleOpenableStruct(sim.state, s, DOOR, doorStructure(sim))).toBe(true);
    expect(s.actionPoints).toBe(full - doorApCost(HandleDoor.OPEN));
  });

  it('names the key item of each lock on the key ring (LockTable[keyID].usKeyItem)', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    s.keyRing = newKeyRing();
    s.keyRing[0] = { keyId: 1, count: 2 };
    s.keyRing[1] = { keyId: 2, count: 1 };
    const items = sim.state.content.items;
    const keyOfClass = (classIndex: number) => items.ordered.find((d) => d.itemClass === ItemClass.KEY && d.classIndex === classIndex);
    const first = keyOfClass(0);
    const second = keyOfClass(1);
    expect(first?.name).toBe('KEY_1');
    expect(second?.name).toBeDefined();
    expect(keyRingView(sim.state, s)).toEqual([
      { keyId: 1, count: 2, item: first?.name, index: first?.index },
      { keyId: 2, count: 1, item: second?.name, index: second?.index },
    ]);
  });

  it('refuses menu actions on unlocked doors and what the soldier cannot do', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    const refusal = (action: string) => sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action }).data;
    expect(refusal('close')).toEqual({ refusal: 'alreadyClosed' });
    expect(refusal('crowbar')).toEqual({ refusal: 'noCrowbar' });
    expect(refusal('lock')).toEqual({ refusal: 'alreadyLocked' });
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: OUTSIDE, action: 'open' }).data).toEqual({ refusal: 'noDoor' });
    sim.state.narrative = { ...NO_NARRATIVE_PORT, isEpc: () => true };
    expect(refusal('force')).toEqual({ refusal: 'escortCannot' });
    expect(sim.dispatch({ type: 'door', soldier: s.id, gridNo: DOOR, action: 'untrap' }).ok).toBe(true);
    updateDoor(sim.state, DOOR, { locked: false });
    sim.state.narrative = NO_NARRATIVE_PORT;
    expect(refusal('force')).toEqual({ refusal: 'notLocked' });
  });

  it('springs an unnoticed electric trap with breath 3 + 1000 x PreRandom(3), drawn before the life roll', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    s.stats.wisdom = 30;
    const life = s.life;
    const { pre } = scripted(sim, [2, 4], [99, 0, 0, 0, 0, 0]);
    s.doorHandleCode = HandleDoor.FORCE;
    expect(handleOpenableStruct(sim.state, s, DOOR, doorStructure(sim))).toBe(false);
    expect(pre.requested).toEqual([3, 10]);
    expect(s.life).toBe(life - 14);
    expect(findDoorInfo(sim.state, DOOR)).toMatchObject({ trapId: DoorTrap.ELECTRIC, perceivedTrapped: PerceivedTrap.PROVED_TRAPPED });
  });
});

describe('bashing locks', () => {
  it('accumulates lock damage on close calls and opens the lock past the smash difficulty', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    updateDoor(sim.state, DOOR, { trapId: DoorTrap.NONE });
    s.stats.strength = 80;
    const { pre } = scripted(sim, [54, 10]);
    expect(attemptToSmashDoor(sim.state, s, DOOR)).toBe(false);
    expect(findDoorInfo(sim.state, DOOR)?.lockDamage).toBe(6);
    expect(attemptToSmashDoor(sim.state, s, DOOR)).toBe(true);
    expect(findDoorInfo(sim.state, DOOR)).toBeNull();
    expect(pre.requested).toEqual([100, 100]);
  });

  it('never gives the token strength point for a bash that misses by 10 to 39: the failed check has just stored the merc’s own tile', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH, { profile: MERC_PROFILE });
    sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
    updateDoor(sim.state, DOOR, { trapId: DoorTrap.NONE });
    s.stats.strength = 80;
    const missByTwenty = 70;
    const { pre } = scripted(sim, [missByTwenty], [], 0);
    expect(attemptToSmashDoor(sim.state, s, DOOR)).toBe(false);
    expect(s.skillCheckGridNo).toBe(OUTSIDE);
    expect(pre.requested).toEqual([100]);
    expect(findDoorInfo(sim.state, DOOR)?.lockDamage).toBe(0);
  });

  it('wears the crowbar with PreRandom(min(strength, smash + 30) / 20) before the check', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    updateDoor(sim.state, DOOR, { trapId: DoorTrap.NONE });
    s.inv[InvSlot.BIGPOCK3] = createItem(sim.state.content.items, sim.state.content.items.byName.get('CROWBAR')?.index ?? 0, 90);
    const { pre } = scripted(sim, [2, 99]);
    expect(attemptToCrowbarLock(sim.state, s, DOOR)).toBe(false);
    expect(pre.requested.slice(0, 2)).toEqual([3, 100]);
    expect(s.inv[InvSlot.BIGPOCK3]?.status[0]).toBe(88);
  });

  it('destroys a lock only when the capped damage exceeds the smash difficulty', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    expect(damageLock(sim.state, s, DOOR, 30)).toBe(false);
    expect(findDoorInfo(sim.state, DOOR)?.lockDamage).toBe(30);
    expect(damageLock(sim.state, s, DOOR, 1)).toBe(true);
    expect(findDoorInfo(sim.state, DOOR)).toBeNull();
    expect(sim.drainEvents().some((e) => e.type === 'lockDestroyed')).toBe(true);
  });
});

describe('the door menu', () => {
  it('disables every action when facing diagonally, and actions without AP in combat', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    s.desiredDirection = 1;
    expect(
      doorMenu(sim.state, s, DOOR)
        .filter((o) => o.enabled)
        .map((o) => o.action),
    ).toEqual([]);
    s.desiredDirection = NORTH;
    sim.state.inCombat = true;
    s.actionPoints = 6;
    expect(
      doorMenu(sim.state, s, DOOR)
        .filter((o) => o.reason === 'notEnoughAp')
        .map((o) => o.action),
    ).toEqual(['force', 'untrap']);
  });

  it('lets an escort use a crowbar and untrap, as the original menu does', () => {
    const sim = village();
    const s = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    sim.state.narrative = { ...NO_NARRATIVE_PORT, isEpc: () => true };
    const reasons = Object.fromEntries(doorMenu(sim.state, s, DOOR).map((o) => [o.action, o.reason ?? 'on']));
    expect(reasons).toMatchObject({
      unlock: 'escortCannot',
      crowbar: 'noCrowbar',
      examine: 'escortCannot',
      force: 'escortCannot',
      untrap: 'on',
    });
  });
});
