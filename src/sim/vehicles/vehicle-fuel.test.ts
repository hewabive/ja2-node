import { describe, expect, it } from 'vitest';
import { addFuelToVehicle, FULL_VEHICLE_FUEL, type GasCan, isGasCanEmpty, spendVehicleFuel, type VehicleFuel } from './vehicle-fuel.ts';

const LEG_OF_30_MINUTES = 180;

function tank(breathRed: number): VehicleFuel {
  return { breathRed, breath: 0 };
}

function gasCan(status: number): GasCan {
  return { status: [status] };
}

function poured(vs: VehicleFuel, can: GasCan): readonly [boolean, VehicleFuel, number] {
  const took = addFuelToVehicle(vs, can);
  return [took, { ...vs }, can.status[0] ?? -1];
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

describe('the gas can (Strategic_Movement.cc AddFuelToVehicle)', () => {
  it('pours 50 fuel per point of status into an empty tank and empties a can of odd status, the percentage rounded down', () => {
    const can = gasCan(33);
    expect(poured(tank(0), can)).toEqual([true, { breathRed: 1650, breath: 16 }, 0]);
    expect(isGasCanEmpty(can)).toBe(true);
  });

  it('fills a tank one leg short and takes only whole fifties off the can: 180 fuel cost it 3 points of status (quirk)', () => {
    const vs = tank(FULL_VEHICLE_FUEL);
    spendVehicleFuel(vs, LEG_OF_30_MINUTES);
    expect(poured(vs, gasCan(100))).toEqual([true, { breathRed: FULL_VEHICLE_FUEL, breath: 100 }, 97]);
  });

  it('tops up 49 fuel from a can of status 1 and leaves the can as it was', () => {
    expect(poured(tank(9951), gasCan(1))).toEqual([true, { breathRed: FULL_VEHICLE_FUEL, breath: 100 }, 1]);
  });

  it('takes nothing into a full tank', () => {
    const vs = { breathRed: FULL_VEHICLE_FUEL, breath: 100 };
    expect(poured(vs, gasCan(57))).toEqual([false, { breathRed: FULL_VEHICLE_FUEL, breath: 100 }, 57]);
  });

  it('shows 0 for the 50 fuel of a status 1 can in an empty tank, where the strategic map would round the same fuel up to 1 (quirk)', () => {
    const vs = tank(0);
    expect(poured(vs, gasCan(1))).toEqual([true, { breathRed: 50, breath: 0 }, 0]);
    spendVehicleFuel(vs, 0);
    expect(vs).toEqual({ breathRed: 50, breath: 1 });
  });
});
