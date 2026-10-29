import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../../tests/support/combat.ts';
import { fakeActionEnv } from '../../../../../tests/support/npc-actions.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../../tests/support/sectors.ts';
import { StructureFlags } from '../../../../content/world/structures.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../../ai/actions.ts';
import { animName } from '../../anim-states.ts';
import { findDoorInfo } from '../../doors/door-table.ts';
import { ITEM_IGNORE_Z_LEVEL } from '../../item-actions.ts';
import { NOWHERE, Team } from '../../soldier.ts';
import { TacticalSim } from '../../tactical-sim.ts';
import { NO_NARRATIVE_PORT } from '../port.ts';
import { findClosestDoor, findNearestOpenableNonDoor, getItemsFromClosestCabinet, npcOpenThing } from './open-thing.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const DOOR = 11429;
const OUTSIDE = DOOR + 160;
const FIVE_ROWS_SOUTH = DOOR + 160 * 5;
const SIX_ROWS_SOUTH = DOOR + 160 * 6;
const NORTH = 0;
const ARMAND_CABINET_GRIDNO = 6968;
const NPC_WALK_AND_OPEN_TICKS = 2000;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function village(): TacticalSim {
  return new TacticalSim(kit.world(VILLAGE), kit.content, 5);
}

function stepFor(sim: TacticalSim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function doorIsOpen(sim: TacticalSim): boolean {
  return ((sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR)?.flags ?? 0) & StructureFlags.OPEN) !== 0;
}

describe('NPCs opening the closest door or cabinet', () => {
  it('finds doors within five tiles only', () => {
    const sim = village();
    expect(findClosestDoor(sim.state, spawnSoldier(sim, 40, Team.CIV, FIVE_ROWS_SOUTH, NORTH))).toBe(DOOR);
    expect(findClosestDoor(sim.state, spawnSoldier(sim, 41, Team.CIV, SIX_ROWS_SOUTH, NORTH))).toBe(NOWHERE);
    expect(findNearestOpenableNonDoor(sim.state, OUTSIDE)).toBe(NOWHERE);
  });

  it('unlocks the door, walks next to it and opens it', () => {
    const sim = village();
    const npc = spawnSoldier(sim, 40, Team.CIV, FIVE_ROWS_SOUTH, NORTH);
    Object.assign(npc, { profile: Npc.ARMAND });
    expect(findDoorInfo(sim.state, DOOR)?.locked).toBe(true);
    expect(npcOpenThing(fakeActionEnv(), sim.state, npc, true)).toBe(true);
    expect(findDoorInfo(sim.state, DOOR)?.locked).toBe(false);
    expect(npc.ai.action).toBe(AiAction.PENDING_ACTION);
    expect(npc.pendingDoorAction).toMatchObject({ gridNo: DOOR, actionGridNo: OUTSIDE });
    stepFor(sim, NPC_WALK_AND_OPEN_TICKS);
    expect(npc.gridNo).toBe(OUTSIDE);
    expect(doorIsOpen(sim)).toBe(true);
    expect(npcOpenThing(fakeActionEnv(), sim.state, npc, true)).toBe(false);
  });

  it('drops the opening when it arrives while somebody is talking: the door stays shut and the NPC stands next to it', () => {
    const sim = village();
    sim.state.narrative = { ...NO_NARRATIVE_PORT, dialogueQueueIsEmptyAndNobodyIsTalking: () => false };
    const npc = spawnSoldier(sim, 40, Team.CIV, FIVE_ROWS_SOUTH, NORTH);
    Object.assign(npc, { profile: Npc.ARMAND });
    expect(npcOpenThing(fakeActionEnv(), sim.state, npc, true)).toBe(true);
    stepFor(sim, NPC_WALK_AND_OPEN_TICKS);
    expect(npc.gridNo).toBe(OUTSIDE);
    expect(npc.pendingDoorAction).toBeNull();
    expect(animName(sim.state.content, npc.state)).toBe('STANDING');
    expect(doorIsOpen(sim)).toBe(false);
  });

  it('sends Armand to his cabinet tile to pick up everything there, whatever its height', () => {
    const sim = village();
    const npc = spawnSoldier(sim, 40, Team.CIV, FIVE_ROWS_SOUTH, NORTH);
    Object.assign(npc, { profile: Npc.ARMAND });
    const fake = fakeActionEnv();
    const env = { ...fake, host: { ...fake.host, tactical: () => sim.state } };
    getItemsFromClosestCabinet(env, Npc.ARMAND);
    expect(npc.pendingPickup).toMatchObject({ gridNo: ARMAND_CABINET_GRIDNO, zLevel: ITEM_IGNORE_Z_LEVEL, selection: null });
  });
});
