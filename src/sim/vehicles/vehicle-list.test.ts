import { describe, expect, it } from 'vitest';
import { Body } from '../../content/anim/body-types.ts';
import {
  fillVehicleSlot,
  findSoldierType,
  NO_MOVEMENT_GROUP,
  removeVehicleFromList,
  type VehicleRecord,
  VehicleTypeId,
  validVehicle,
} from './vehicle-list.ts';

const D13 = { x: 13, y: 4, z: 0 };
const L10 = { x: 10, y: 12, z: 0 };
const MOVEMENT_GROUPS = [41, 42, 43, 44];

function listOf(...sectors: (typeof D13)[]): VehicleRecord[] {
  const list: VehicleRecord[] = [];
  for (const s of sectors) fillVehicleSlot(list, s, VehicleTypeId.HUMMER, MOVEMENT_GROUPS);
  return list;
}

describe('the vehicle list (Vehicles.cc AddVehicleToList, RemoveVehicleFromList)', () => {
  it('takes the first free slot, or appends one, with the movement group of that slot', () => {
    const list = listOf(D13, D13, D13);
    const second = list[1];
    if (second) removeVehicleFromList(second);
    expect(fillVehicleSlot(list, D13, VehicleTypeId.TANK_CAR, MOVEMENT_GROUPS)).toBe(1);
    expect(list[1]).toMatchObject({ valid: true, destroyed: false, type: VehicleTypeId.TANK_CAR, sector: D13, movementGroup: 42 });
    expect(fillVehicleSlot(list, D13, VehicleTypeId.JEEP_CAR, MOVEMENT_GROUPS)).toBe(3);
    expect(fillVehicleSlot(list, D13, VehicleTypeId.JEEP_CAR, [])).toBe(4);
    expect(list[4]?.movementGroup).toBe(NO_MOVEMENT_GROUP);
  });

  it('collects destroyed vehicles of other sectors only at the next registration, so a destroyed one here keeps its slot (Stracciatella garbage collection)', () => {
    const list = listOf(L10, D13);
    for (const v of list) v.destroyed = true;
    expect(list.map((v) => v.valid)).toEqual([true, true]);
    expect(fillVehicleSlot(list, D13, VehicleTypeId.HUMMER, MOVEMENT_GROUPS)).toBe(0);
    expect(list.map((v) => [v.valid, v.destroyed])).toEqual([
      [true, false],
      [true, true],
    ]);
  });

  it('removes a vehicle by marking its slot invalid and clearing its path', () => {
    const [v] = listOf(D13);
    if (!v) throw new Error('no vehicle');
    v.path = [12, 13];
    removeVehicleFromList(v);
    expect([v.valid, v.path]).toEqual([false, []]);
    expect(validVehicle([v], 0)).toBeNull();
  });

  it('finds the soldier of a vehicle by his vehicle id among the vehicle bodies only (Vehicles.cc FindSoldierType)', () => {
    const soldiers = [
      { id: 3, bodyType: Body.REGMALE, vehicleId: 1 },
      undefined,
      { id: 18, bodyType: Body.HUMVEE, vehicleId: 1 },
      { id: 19, bodyType: Body.TANK_NE, vehicleId: 1 },
    ];
    expect(findSoldierType(soldiers, 1)?.id).toBe(18);
    expect(findSoldierType(soldiers, 2)).toBeNull();
  });
});
