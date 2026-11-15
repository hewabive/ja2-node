import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import type { Placement } from '../../content/formats/map.ts';
import { OBJECT_FLAGS_OFFSET, OBJECT_RECORD_BYTES } from '../../content/formats/object.ts';
import { writeProfileDetailedPlacement } from '../../content/formats/placement.ts';
import { NOTHING } from '../../content/items/items.ts';
import { ObjectFlags } from '../items/object.ts';
import {
  addSoldierInitListEnemyDefenceSoldiers,
  addSoldierInitListMilitia,
  buildSoldierInitList,
  evaluateDeathEffectsToSoldierInitList,
  freeSoldierSlots,
  NEUTRAL_POPULATION,
  type PopulationEnv,
  randomizeRelativeLevel,
  sortInitList,
  stripEnemyDetailedPlacements,
} from './init-list.ts';
import { InvSlot } from './inventory.ts';
import { NO_PROFILE, Orders, SoldierClass, Team } from './soldier.ts';
import { teamMembers } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const ENV: PopulationEnv = { ...NEUTRAL_POPULATION, difficultyModifier: () => 11 };

function a9(): TacticalSim {
  const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 4);
  sim.state.initList = buildSoldierInitList(sim.world.map);
  return sim;
}

const INVENTORY_OFFSET = 32;

interface SlotRecord {
  readonly item: number;
  readonly flags: number;
}

function detailedEnemyPlacement(sim: TacticalSim, slots: ReadonlyMap<number, SlotRecord>): Placement {
  const template = sim.world.map.placements[0];
  if (!template) throw new Error('no placement');
  const raw = writeProfileDetailedPlacement({
    profile: NO_PROFILE,
    direction: template.basic.direction,
    insertionGridNo: template.basic.startingGridNo,
    team: Team.ENEMY,
    attitude: template.basic.attitude,
    orders: Orders.STATIONARY,
    soldierClass: SoldierClass.ARMY,
  });
  const v = new DataView(raw.buffer);
  for (const [slot, record] of slots) {
    const at = INVENTORY_OFFSET + slot * OBJECT_RECORD_BYTES;
    v.setUint16(at, record.item, true);
    raw[at + OBJECT_FLAGS_OFFSET] = record.flags;
  }
  return { basic: { ...template.basic, detailed: true, priorityExistence: false }, detailedRaw: raw };
}

describe('the soldier init list', () => {
  it('is built from the map placements with node ids in map order', () => {
    const t = a9().state;
    expect(t.initList.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.initList.map((n) => n.priorityExistence)).toEqual([true, true, true, false, false, false]);
  });

  it("recalculates the no-overwrite flag of a detailed placement's items: an item and a droppable empty slot are locked, an undroppable empty slot stays open", () => {
    const sim = a9();
    const kit = sim.state.content.items.byName.get('TOOLKIT')?.index ?? NOTHING;
    const slots = new Map<number, SlotRecord>([
      [InvSlot.BIGPOCK1, { item: kit, flags: 0 }],
      [InvSlot.BIGPOCK2, { item: kit, flags: ObjectFlags.UNDROPPABLE }],
      [InvSlot.HAND, { item: NOTHING, flags: 0 }],
      [InvSlot.HELMET, { item: NOTHING, flags: ObjectFlags.UNDROPPABLE }],
      [InvSlot.VEST, { item: NOTHING, flags: ObjectFlags.UNDROPPABLE | ObjectFlags.NO_OVERWRITE }],
    ]);
    const [node] = buildSoldierInitList({ placements: [detailedEnemyPlacement(sim, slots)] });
    const flags = [...slots.keys()].map((slot) => node?.detail?.inventory[slot]?.flags);
    expect(flags).toEqual([
      ObjectFlags.NO_OVERWRITE,
      ObjectFlags.UNDROPPABLE | ObjectFlags.NO_OVERWRITE,
      ObjectFlags.NO_OVERWRITE,
      ObjectFlags.UNDROPPABLE,
      ObjectFlags.UNDROPPABLE | ObjectFlags.NO_OVERWRITE,
    ]);
  });

  it('places an enemy with the item his map placement stores without the no-overwrite flag, and leaves his droppable empty hand without a gun', () => {
    const sim = a9();
    const t = sim.state;
    const kit = t.content.items.byName.get('TOOLKIT')?.index ?? NOTHING;
    expect(kit).not.toBe(NOTHING);
    const slots = new Map<number, SlotRecord>([
      [InvSlot.BIGPOCK1, { item: kit, flags: 0 }],
      [InvSlot.HAND, { item: NOTHING, flags: 0 }],
    ]);
    t.initList = buildSoldierInitList({ placements: [detailedEnemyPlacement(sim, slots)] });
    addSoldierInitListEnemyDefenceSoldiers(t, { admins: 0, troops: 1, elites: 0 }, ENV);
    const [enemy] = teamMembers(t, Team.ENEMY);
    expect([enemy?.inv[InvSlot.BIGPOCK1]?.item, enemy?.inv[InvSlot.HAND]?.item]).toEqual([kit, NOTHING]);
  });

  it('sorts priority placements to the front in reverse map order', () => {
    const t = a9().state;
    expect(sortInitList(t).map((n) => n.index)).toEqual([2, 1, 0, 3, 4, 5]);
  });

  it('places the strategic class counts on the enemy placements', () => {
    const sim = a9();
    const t = sim.state;
    addSoldierInitListEnemyDefenceSoldiers(t, { admins: 1, troops: 2, elites: 1 }, ENV);
    const placed = teamMembers(t, Team.ENEMY)
      .map((s) => s.soldierClass)
      .sort();
    expect(placed).toEqual([SoldierClass.ADMINISTRATOR, SoldierClass.ELITE, SoldierClass.ARMY, SoldierClass.ARMY].sort());
    expect(t.initList.filter((n) => n.hasSoldier)).toHaveLength(4);
    expect(freeSoldierSlots(t, Team.ENEMY)).toBe(28);
  });

  it('turns enemy placements into militia of the requested ranks', () => {
    const t = a9().state;
    addSoldierInitListMilitia(t, 1, 1, 1, ENV);
    const militia = teamMembers(t, Team.MILITIA);
    expect(militia.map((s) => s.soldierClass).sort()).toEqual(
      [SoldierClass.GREEN_MILITIA, SoldierClass.REG_MILITIA, SoldierClass.ELITE_MILITIA].sort(),
    );
    expect(militia.every((s) => s.ai.orders === 0)).toBe(true);
  });

  it('forgets the detailed placement of a dead soldier and strips enemy details after liberation', () => {
    const t = a9().state;
    addSoldierInitListEnemyDefenceSoldiers(t, { admins: 0, troops: 1, elites: 0 }, ENV);
    const node = t.initList.find((n) => n.hasSoldier);
    const victim = node ? t.soldiers[node.soldierId] : undefined;
    if (!node || !victim) throw new Error('nobody placed');
    node.detail = { profile: 200 } as never;
    evaluateDeathEffectsToSoldierInitList(t, victim);
    expect(node.detail).toBeNull();
    expect(node.hasSoldier).toBe(false);
    const other = t.initList[3];
    if (!other) throw new Error('no node');
    other.detail = { profile: 200 } as never;
    other.detailed = true;
    other.priorityExistence = true;
    stripEnemyDetailedPlacements(t, ENV);
    expect([other.detail, other.detailed, other.priorityExistence, other.basic.bodyType]).toEqual([null, false, false, -1]);
  });

  it('randomizes relative levels by the location and keeps militia between poor and good', () => {
    const t = a9().state;
    const levels = Array.from({ length: 200 }, () => randomizeRelativeLevel(t, SoldierClass.ARMY, { ...ENV, locationModifier: 30 }));
    expect(Math.min(...levels)).toBe(2);
    expect(Math.max(...levels)).toBe(4);
    const militia = Array.from({ length: 200 }, () =>
      randomizeRelativeLevel(t, SoldierClass.GREEN_MILITIA, { ...ENV, locationModifier: 0 }),
    );
    expect(Math.min(...militia)).toBe(1);
    expect(Math.max(...militia)).toBe(2);
  });
});
