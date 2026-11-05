import { describe, expect, it } from 'vitest';
import { FULL_VEHICLE_FUEL, spendVehicleFuel, type VehicleFuel } from './vehicle-fuel.ts';

const LEG_OF_30_MINUTES = 180;

function tank(breathRed: number): VehicleFuel {
  return { breathRed, breath: 0 };
}

describe('fuel spent on the strategic map (Strategic_Movement.cc SpendVehicleFuel)', () => {
  it('takes the fuel off sBreathRed and rounds the percentage the map shows up, not down (quirk)', () => {
    const vs = tank(FULL_VEHICLE_FUEL);
    spendVehicleFuel(vs, LEG_OF_30_MINUTES);
    expect(vs).toEqual({ breathRed: 9820, breath: 99 });
    spendVehicleFuel(vs, 9819);
    expect(vs).toEqual({ breathRed: 1, breath: 1 });
  });

  it('stops at an empty tank, which shows 0', () => {
    const vs = tank(100);
    spendVehicleFuel(vs, LEG_OF_30_MINUTES);
    expect(vs).toEqual({ breathRed: 0, breath: 0 });
    spendVehicleFuel(vs, LEG_OF_30_MINUTES);
    expect(vs).toEqual({ breathRed: 0, breath: 0 });
  });
});
