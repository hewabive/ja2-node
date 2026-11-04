import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { objectOf } from '../../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { emptyObject, type ItemObject, ObjectFlags } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { DoorTrap, findDoorInfo } from '../doors/door-table.ts';
import { isDoorOpenAt } from '../doors.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, type WorldItem, WorldItemFlags } from '../world-items.ts';
import { Detonator, ItemAction, setActionValue, setDetonator, setFrequency } from './bomb-object.ts';
import { handleExplosionQueue, setOffBombsInGridNo } from './bomb-queue.ts';
import { performItemAction } from './item-action.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const DOOR = gridNo(80, 79);
const SPOT = gridNo(90, 90);
const ROOM = 7;
const MUSEUM_SWITCH_FREQUENCY = 52;

function action(value: number): ItemObject {
  const o = emptyObject();
  setActionValue(o, value);
  return o;
}

function simWithDoor(): TacticalSim {
  const closed = {
    ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE, Orientation.INSIDE_LEFT),
    number: 0,
    partnerDelta: 1,
  };
  const open = {
    ...syntheticStructure(StructureFlags.DOOR | StructureFlags.OPENABLE | StructureFlags.OPEN, Orientation.INSIDE_LEFT),
    number: 1,
    partnerDelta: -1,
  };
  const file = { structureCount: 2, auxData: null, tileLocations: [], structures: [closed, open] };
  const base = syntheticWorld(testDoorCosts(), (w) => w.add(DOOR, 0, closed, undefined, file));
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

function armed(t: TacticalState, g: number, name: string, detonator: number, frequency: number, value = 0): WorldItem {
  const o = objectOf(t, name);
  setDetonator(o, detonator);
  setFrequency(o, frequency);
  setActionValue(o, value);
  const item = addItemToPool(t, g, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
  if (!item) throw new Error(`cannot place ${name}`);
  return item;
}

const disabled = (item: WorldItem) => (item.object.flags & ObjectFlags.DISABLED_BOMB) !== 0;

describe('the action items (Explosion_Control.cc PerformItemAction)', () => {
  it('opens a closed door, closes an open one and toggles either, and says sight may have changed only when the door moved', () => {
    const t = simWithDoor().state;
    expect(performItemAction(t, DOOR, action(ItemAction.CLOSE_DOOR))).toBe(false);
    expect(performItemAction(t, DOOR, action(ItemAction.OPEN_DOOR))).toBe(true);
    expect(isDoorOpenAt(t, DOOR)).toBe(true);
    expect(performItemAction(t, DOOR, action(ItemAction.OPEN_DOOR))).toBe(false);
    expect(performItemAction(t, DOOR, action(ItemAction.TOGGLE_DOOR))).toBe(true);
    expect(isDoorOpenAt(t, DOOR)).toBe(false);
    expect(performItemAction(t, SPOT, action(ItemAction.TOGGLE_DOOR))).toBe(false);
  });

  it("unlocks, toggles the lock of and disarms the door table's door on the tile", () => {
    const t = newCombatSim(content).state;
    t.world.mapDoors.set(SPOT, {
      gridNo: SPOT,
      locked: true,
      trapLevel: 3,
      trapId: DoorTrap.EXPLOSION,
      lockId: 0,
      perceivedLocked: 0,
      perceivedTrapped: 0,
      lockDamage: 0,
    });
    performItemAction(t, SPOT, action(ItemAction.UNLOCK_DOOR));
    expect(findDoorInfo(t, SPOT)?.locked).toBe(false);
    performItemAction(t, SPOT, action(ItemAction.TOGGLE_LOCK));
    expect(findDoorInfo(t, SPOT)?.locked).toBe(true);
    performItemAction(t, SPOT, action(ItemAction.UNTRAP_DOOR));
    expect(findDoorInfo(t, SPOT)).toMatchObject({ trapLevel: 0, trapId: DoorTrap.NONE });
  });

  it('switches the remote bombs of frequency 51 to 54 on and off, one frequency per toggle', () => {
    const t = newCombatSim(content).state;
    const second = armed(t, SPOT, 'C4', Detonator.REMOTE, 52);
    const other = armed(t, SPOT + 1, 'C4', Detonator.REMOTE, 53);
    const pressure = armed(t, SPOT + 2, 'C4', Detonator.PRESSURE, 52);
    performItemAction(t, SPOT, action(ItemAction.TOGGLE_ACTION2));
    expect([disabled(second), disabled(other), disabled(pressure)]).toEqual([true, false, false]);
    performItemAction(t, SPOT, action(ItemAction.TOGGLE_ACTION2));
    expect(disabled(second)).toBe(false);
  });

  it("disarms the museum's alarm plates from its switch: the switch's remote item toggles the pressure items of its tile", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, SPOT, Direction.EAST);
    const plate = SPOT + 3;
    const alarm = armed(t, plate, 'ACTION_ITEM', Detonator.PRESSURE, 0, ItemAction.MUSEUM_ALARM);
    armed(t, plate, 'ACTION_ITEM', Detonator.REMOTE, MUSEUM_SWITCH_FREQUENCY, ItemAction.TOGGLE_PRESSURE_ITEMS);
    armed(t, SPOT, 'SWITCH', Detonator.PRESSURE, MUSEUM_SWITCH_FREQUENCY);
    setOffBombsInGridNo(t, merc, SPOT, false, 0);
    handleExplosionQueue(t);
    expect(disabled(alarm)).toBe(true);
    expect(setOffBombsInGridNo(t, merc, plate, false, 0)).toBe(false);
    expect(t.explosionQueue.entries).toEqual([]);
  });

  it('takes the roof off a hidden room, with no quote for the items it shows', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const rooms = new Uint8Array(WORLD_MAX);
    rooms[SPOT] = ROOM;
    rooms[SPOT + 1] = ROOM;
    (t.world.level as { rooms: Uint8Array }).rooms = rooms;
    const canteen = addItemToPool(t, SPOT + 1, objectOf(t, 'CANTEEN'), Visibility.INVISIBLE, 0);
    const quotes: number[] = [];
    t.narrative = { ...NO_NARRATIVE_PORT, sayQuote: (_, quote) => quotes.push(quote) };
    const rng = t.rng.state();
    performItemAction(t, SPOT, action(ItemAction.REVEAL_ROOM));
    expect([t.fog.roomHidden[ROOM], canteen?.visible]).toEqual([0, Visibility.VISIBLE]);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'roomRevealed', room: ROOM }));
    expect([quotes, t.rng.state()]).toEqual([[], rng]);
  });

  it('sounds a silent alarm the enemies hear, calls every enemy team or only the creatures, and rings a klaxon', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] ?? 0, Team.ENEMY, SPOT + 4, Direction.WEST);
    spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE] ?? 0, Team.CREATURE, SPOT + 8, Direction.WEST);
    performItemAction(t, SPOT, action(ItemAction.LOCAL_ALARM));
    expect(enemy.ai.noiseGridNo).toBe(SPOT);
    performItemAction(t, SPOT, action(ItemAction.BLOODCAT_ALARM));
    expect(t.perception.publicNoiseGridNo[Team.CREATURE]).toBe(SPOT);
    expect(t.perception.publicNoiseGridNo[Team.ENEMY]).not.toBe(SPOT);
    performItemAction(t, SPOT + 1, action(ItemAction.GLOBAL_ALARM));
    expect([t.perception.publicNoiseGridNo[Team.ENEMY], t.perception.publicNoiseGridNo[Team.CREATURE]]).toEqual([SPOT + 1, SPOT + 1]);
    sim.drainEvents();
    performItemAction(t, SPOT, action(ItemAction.KLAXON));
    performItemAction(t, SPOT, action(ItemAction.ENTER_BROTHEL));
    expect(sim.drainEvents()).toEqual([expect.objectContaining({ type: 'alarm', gridNo: SPOT, kind: 'klaxon' })]);
  });
});
