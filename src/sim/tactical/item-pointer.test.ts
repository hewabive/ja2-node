import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_COUNT, Direction, gridNo } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { createItem, createItems } from '../items/object.ts';
import { animName } from './anim-states.ts';
import { changeSoldierStance } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, itemIn, NUM_INV_SLOTS } from './inventory.ts';
import { AP_PASS_ITEM } from './item-pointer.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { enterCombatMode } from './turns/turns.ts';
import { addItemToPool, Visibility } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const KIT = 'FIRSTAIDKIT';
const MERC_AT = gridNo(80, 80);
const EAST_OF_HIM = gridNo(81, 80);
const TWO_EAST = gridNo(82, 80);
const PASS_RANGE_EDGE = gridNo(83, 80);
const BEYOND_PASS_RANGE = gridNo(84, 80);
const CROUCH = 3;
const PASS_TICKS = 400;

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const kitsAt = (sim: TacticalSim) => sim.state.worldItems.filter((wi) => wi.object.item === item(KIT)).map((wi) => wi.gridNo);
const carries = (s: Soldier) => s.inv.some((o) => o?.item === item(KIT));

function holder(sim: TacticalSim, direction: number = Direction.SOUTH): Soldier {
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, direction);
  merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item(KIT), 100);
  return merc;
}

function inCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 110), Direction.NORTH);
  enterCombatMode(sim.state, Team.OUR);
  expect(sim.state.inCombat).toBe(true);
}

function drop(sim: TacticalSim, at: number) {
  return sim.dispatch({ type: 'drop', soldier: 0, slot: 'bigPocket1', gridNo: at });
}

function pass(sim: TacticalSim, target: number) {
  return sim.dispatch({ type: 'pass', soldier: 0, slot: 'bigPocket1', target });
}

function statesSeen(sim: TacticalSim, soldiers: readonly Soldier[]): Set<string>[] {
  const seen = soldiers.map(() => new Set<string>());
  for (let tick = 0; tick < PASS_TICKS; tick++) {
    sim.step();
    soldiers.forEach((s, k) => {
      seen[k]?.add(animName(content, s.state));
    });
  }
  return seen;
}

describe('dropping from the item cursor next to the merc (Interface_Items.cc HandleItemPointerClick)', () => {
  it('drops beside him with DROP_ADJACENT_OBJECT turned to the tile, the item landing there at code 763', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim);
    expect(drop(sim, EAST_OF_HIM)).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('DROP_ADJACENT_OBJECT');
    expect([merc.desiredDirection, kitsAt(sim)]).toEqual([Direction.EAST, []]);
    const events = runUntilIdle(sim);
    expect(kitsAt(sim)).toEqual([EAST_OF_HIM]);
    expect(events.filter((e) => e.type === 'itemDropped')).toMatchObject([{ soldier: 0, gridNo: EAST_OF_HIM, beside: true }]);
    expect([carries(merc), merc.direction]).toEqual([false, Direction.EAST]);
  });

  it('puts it beside him at once when crouched and has every merc look for items', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim);
    const other = spawnSoldier(sim, 1, Team.OUR, gridNo(90, 90), Direction.SOUTH);
    changeSoldierStance(sim.state, merc, CROUCH);
    runUntilIdle(sim);
    expect(drop(sim, EAST_OF_HIM)).toEqual({ ok: true });
    expect([kitsAt(sim), merc.lookForItems, other.lookForItems]).toEqual([[EAST_OF_HIM], true, true]);
    expect(sim.drainEvents().filter((e) => e.type === 'itemDropped')).toMatchObject([{ gridNo: EAST_OF_HIM, beside: true }]);
  });

  it('drops onto a structure next to him that is no place to stand on, as NewOKDestination fails', () => {
    const sim = newCombatSim(content);
    sim.state.world.structures.add(EAST_OF_HIM, 0, syntheticStructure(StructureFlags.GENERIC));
    holder(sim);
    expect(drop(sim, EAST_OF_HIM)).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(kitsAt(sim)).toEqual([EAST_OF_HIM]);
  });

  it('drops at his feet for a tile next to him that no single step reaches', () => {
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(EAST_OF_HIM, direction, 0, TravelCost.OBSTACLE);
    });
    const merc = holder(sim);
    expect(drop(sim, EAST_OF_HIM)).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('DROP_ITEM');
    const events = runUntilIdle(sim);
    expect(kitsAt(sim)).toEqual([MERC_AT]);
    expect(events.find((e) => e.type === 'itemDropped')).toEqual({
      type: 'itemDropped',
      soldier: 0,
      gridNo: MERC_AT,
      tick: expect.any(Number),
    });
  });

  it('charges AP_PICKUP_ITEM in combat and refuses a tile farther than one step', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim, Direction.EAST);
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(drop(sim, TWO_EAST)).toMatchObject({ ok: false, data: { refusal: 'tooFar' } });
    expect(drop(sim, EAST_OF_HIM)).toEqual({ ok: true });
    expect(merc.actionPoints).toBe(ap - AP.PICKUP_ITEM);
  });
});

describe('passing an item from the item cursor (Interface_Items.cc HandleItemPointerClick, the pass)', () => {
  function pair(at = PASS_RANGE_EDGE): { sim: TacticalSim; merc: Soldier; buddy: Soldier } {
    const sim = newCombatSim(content);
    const merc = holder(sim, Direction.EAST);
    const buddy = spawnSoldier(sim, 1, Team.OUR, at, Direction.WEST);
    return { sim, merc, buddy };
  }

  it('hands the object to a merc of ours within 3 tiles for 3 AP each, both turning to each other into PASS_OBJECT', () => {
    const { sim, merc, buddy } = pair();
    inCombat(sim);
    const before = [merc.actionPoints, buddy.actionPoints];
    expect(pass(sim, buddy.id)).toEqual({ ok: true, data: { passed: true } });
    expect([carries(merc), carries(buddy)]).toEqual([false, true]);
    expect([merc.actionPoints, buddy.actionPoints]).toEqual(before.map((ap) => ap - AP_PASS_ITEM));
    expect(sim.drainEvents().filter((e) => e.type === 'itemPassed')).toMatchObject([{ soldier: 0, target: 1, item: item(KIT) }]);
    const [giverStates, catcherStates] = statesSeen(sim, [merc, buddy]);
    expect([giverStates?.has('PASS_OBJECT'), catcherStates?.has('PASS_OBJECT')]).toEqual([true, true]);
  });

  it('charges both and keeps what finds no room with the giver, as AutoPlaceObject fails after the APs are taken', () => {
    const { sim, merc, buddy } = pair();
    inCombat(sim);
    for (let slot = 0; slot < NUM_INV_SLOTS; slot++) buddy.inv[slot] = createItems(content.items, item('CROWBAR'), 90, 1);
    const before = [merc.actionPoints, buddy.actionPoints];
    expect(pass(sim, buddy.id)).toEqual({ ok: true, data: { passed: false } });
    expect(itemIn(merc.inv, InvSlot.BIGPOCK1)).toBe(item(KIT));
    expect([merc.actionPoints, buddy.actionPoints]).toEqual(before.map((ap) => ap - AP_PASS_ITEM));
    expect(sim.drainEvents().filter((e) => e.type === 'passFailed')).toMatchObject([{ soldier: 0, target: 1, item: item(KIT) }]);
  });

  it('refuses a merc beyond 3 tiles, an escort, and a catcher short of the 3 AP', () => {
    const far = pair(BEYOND_PASS_RANGE);
    expect(pass(far.sim, far.buddy.id)).toMatchObject({ ok: false, data: { refusal: 'tooFar' } });
    const escort = pair();
    escort.sim.state.narrative = { ...escort.sim.state.narrative, isEpc: (s) => s === escort.buddy };
    expect(pass(escort.sim, escort.buddy.id)).toMatchObject({ ok: false, data: { refusal: 'notACatcher' } });
    const tired = pair();
    inCombat(tired.sim);
    tired.buddy.actionPoints = AP_PASS_ITEM - 1;
    expect(pass(tired.sim, tired.buddy.id)).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    expect([carries(far.merc), carries(escort.merc), carries(tired.merc)]).toEqual([true, true, true]);
  });
});

describe('the item cursor on a merc on the move (HandleItemPointerClick checks no stop, only SelectedGuyInBusyAnimation)', () => {
  const WALK_AWAY = gridNo(80, 90);
  const TICKS_UNDER_WAY = 40;

  function underWay(sim: TacticalSim, merc: Soldier): void {
    expect(sim.dispatch({ type: 'move', soldier: merc.id, to: WALK_AWAY })).toEqual({ ok: true });
    for (let tick = 0; tick < TICKS_UNDER_WAY; tick++) sim.step();
    expect(animName(content, merc.state)).toBe('WALKING');
  }

  it('drops the item where he is with DROP_ITEM', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim);
    underWay(sim, merc);
    const there = merc.gridNo;
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: 'bigPocket1' })).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('DROP_ITEM');
    runUntilIdle(sim);
    expect([kitsAt(sim), carries(merc), merc.gridNo]).toEqual([[there], false, there]);
  });

  it('passes it to a merc of ours within 3 tiles', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim);
    const buddy = spawnSoldier(sim, 1, Team.OUR, gridNo(82, 81), Direction.WEST);
    underWay(sim, merc);
    expect(pass(sim, buddy.id)).toEqual({ ok: true, data: { passed: true } });
    expect([carries(merc), carries(buddy)]).toEqual([false, true]);
  });

  it('refuses the item cursor while he picks something up, as SelectedGuyInBusyAnimation ignores the click', () => {
    const sim = newCombatSim(content);
    const merc = holder(sim);
    addItemToPool(sim.state, MERC_AT, createItem(content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0 })).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('PICKUP_ITEM');
    const busy = { ok: false, data: { refusal: 'busyAnimation' } };
    expect(drop(sim, MERC_AT)).toMatchObject(busy);
    expect(pass(sim, spawnSoldier(sim, 1, Team.OUR, TWO_EAST, Direction.WEST).id)).toMatchObject(busy);
    expect(sim.dispatch({ type: 'toss', soldier: 0, slot: 'bigPocket1', gridNo: gridNo(80, 88) })).toMatchObject(busy);
    expect(carries(merc)).toBe(true);
  });
});
