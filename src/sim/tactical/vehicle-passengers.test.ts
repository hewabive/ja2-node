import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { initNewSoldierAnim, setSoldierDirection, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { newSoldierCreate, tacticalCreateSoldier } from './creation.ts';
import { newSmokeEffect } from './explosions/smoke.ts';
import { NEUTRAL_POPULATION } from './init-list.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import { registerSoldier, type TacticalState, whoIsThere } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { seatAtVehicle } from './vehicle-passengers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const OUR_VEHICLE_SLOT = 18;
const PARKED_AT = gridNo(80, 70);
const MOVED_TO = gridNo(90, 70);
const STANDING_AT = gridNo(80, 76);
const NEXT_TO_HIM = gridNo(81, 76);
const NOBODY = -1;
const HUMAN_SMELL = 5;
const NO_SMELL = 0;

function ourHummer(t: TacticalState, at = PARKED_AT): Soldier {
  const create = { ...newSoldierCreate(Team.OUR, Body.HUMVEE, Direction.WEST, at), life: 100, lifeMax: 100 };
  const s = tacticalCreateSoldier(t, create, OUR_VEHICLE_SLOT, NEUTRAL_POPULATION);
  if (!s) throw new Error('no Hummer');
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  return s;
}

function board(t: TacticalState, merc: Soldier, hummer: Soldier, seat: number): void {
  const v = t.vehicles[hummer.vehicleId];
  if (!v) throw new Error('the Hummer has no vehicle');
  v.passengers[v.passengers.indexOf(NOBODY)] = merc.id;
  merc.vehicleSeat = seat;
  seatAtVehicle(t, merc, hummer);
}

function aboard(): { readonly sim: TacticalSim; readonly t: TacticalState; readonly hummer: Soldier; readonly merc: Soldier } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const hummer = ourHummer(t);
  const merc = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH, { life: 100 });
  board(t, merc, hummer, VehicleSeat.DRIVER);
  return { sim, t, hummer, merc };
}

describe('a merc seated in a ground vehicle in the loaded sector (Vehicles.cc AddSoldierToVehicle, Soldier_Control.cc SetSoldierGridNo)', () => {
  it("stays in the sector at the vehicle's tile with no occupant entry and no structure, the tile he left free", () => {
    const { t, hummer, merc } = aboard();
    expect([merc.placed, merc.gridNo, merc.x, merc.y]).toEqual([true, PARKED_AT, hummer.x, hummer.y]);
    expect(merc.structure).toBeNull();
    expect(whoIsThere(t, PARKED_AT, 0)).toBe(hummer);
    expect(whoIsThere(t, STANDING_AT, 0)).toBeNull();
    expect(t.occupant[0][STANDING_AT]).toBe(NOBODY);
    expect(t.world.structures.at(STANDING_AT).some((piece) => piece.id === merc.id)).toBe(false);
  });

  it('keeps no structure through an animation or a turn, which build one for a soldier on the grid', () => {
    const { t, merc } = aboard();
    initNewSoldierAnim(t, merc, states(t.content.animations).CROUCHING, 0, true);
    setSoldierDirection(t, merc, Direction.SOUTH);
    setSoldierPosition(t, merc, merc.gridNo);
    expect(merc.structure).toBeNull();
    expect(t.world.structures.at(PARKED_AT).some((piece) => piece.id === merc.id)).toBe(false);
  });

  it('follows the vehicle wherever it is put, every passenger to its exact position', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const hummer = ourHummer(t);
    const driver = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH);
    const passenger = spawnSoldier(sim, 1, Team.OUR, NEXT_TO_HIM, Direction.NORTH);
    board(t, driver, hummer, VehicleSeat.DRIVER);
    board(t, passenger, hummer, VehicleSeat.PASSENGER);
    setSoldierPosition(t, hummer, MOVED_TO);
    expect([driver, passenger].map((s) => [s.gridNo, s.x, s.y, s.structure])).toEqual([
      [MOVED_TO, hummer.x, hummer.y, null],
      [MOVED_TO, hummer.x, hummer.y, null],
    ]);
    expect(whoIsThere(t, MOVED_TO, 0)).toBe(hummer);
  });

  it("takes no step when the vehicle carries him: no tile counted, so no mine, noise or ground check of a tile's arrival", () => {
    const { t, hummer, merc } = aboard();
    setSoldierPosition(t, hummer, MOVED_TO);
    expect([merc.gridNo, merc.tilesMoved, merc.tilesMovedPerRTBreathUpdate]).toEqual([MOVED_TO, 0, 0]);
  });

  it('leaves no smell on the tile, which a merc on the grid marks at every tile he takes', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const hummer = ourHummer(t);
    const merc = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH);
    merc.normalSmell = HUMAN_SMELL;
    board(t, merc, hummer, VehicleSeat.DRIVER);
    setSoldierPosition(t, hummer, MOVED_TO);
    expect([t.smell.smell[PARKED_AT], t.smell.smell[MOVED_TO]]).toEqual([NO_SMELL, NO_SMELL]);
  });

  it("tests his tile's gas again whenever the vehicle is put back on its own tile, since he has no tile to stay on (quirk)", () => {
    const { t, hummer, merc } = aboard();
    newSmokeEffect(t, PARKED_AT, itemId(t, 'SMOKE_GRENADE'), 0, null);
    expect(merc.gassed).toBe(false);
    setSoldierPosition(t, hummer, PARKED_AT);
    expect(merc.gassed).toBe(true);
  });

  it("is gassed on the vehicle's tile, whose smoke he breathes without a mask (quirk)", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const hummer = ourHummer(t);
    const bare = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH);
    const masked = spawnSoldier(sim, 1, Team.OUR, NEXT_TO_HIM, Direction.NORTH);
    masked.inv[InvSlot.HEAD1] = objectOf(t, 'GASMASK');
    newSmokeEffect(t, PARKED_AT, itemId(t, 'SMOKE_GRENADE'), 0, null);
    expect([bare.gassed, masked.gassed]).toEqual([false, false]);
    board(t, bare, hummer, VehicleSeat.DRIVER);
    board(t, masked, hummer, VehicleSeat.PASSENGER);
    expect([bare.gassed, masked.gassed]).toEqual([true, false]);
  });
});
