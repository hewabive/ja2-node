import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { ourHummerOnTheMap, seatInVehicle } from '../../../tests/support/vehicles.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { initNewSoldierAnim, setSoldierDirection, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { newSmokeEffect } from './explosions/smoke.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { validForSightings } from './perception/sight.ts';
import { removeSoldierFromTacticalSector } from './sector-presence.ts';
import { NOWHERE, type Soldier, Team } from './soldier.ts';
import { mercs, type TacticalState, teamMembers, whoIsThere } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { seatInTheHelicopterOnSectorEntry, seatWithNoVehicleOnTheMap } from './vehicle-passengers.ts';
import { notifySoldiersToLookForItems } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const PARKED_AT = gridNo(80, 70);
const MOVED_TO = gridNo(90, 70);
const STANDING_AT = gridNo(80, 76);
const NEXT_TO_HIM = gridNo(81, 76);
const NOBODY = -1;
const HUMAN_SMELL = 5;
const NO_SMELL = 0;

const ourHummer = (t: TacticalState, at = PARKED_AT) => ourHummerOnTheMap(t, at);
const board = seatInVehicle;

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

describe('a helicopter passenger over the loaded sector, in his merc slot with no tile (Soldier_Add.cc InternalAddSoldierToSector)', () => {
  const FIRST_FRAME_TICKS = 200;
  const SAVED_APS = 3;
  const SAVED_PATH_STEPS = 4;

  function flying(): { readonly sim: TacticalSim; readonly t: TacticalState; readonly merc: Soldier; readonly walker: Soldier } {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH, { life: 100 });
    const walker = spawnSoldier(sim, 1, Team.OUR, NEXT_TO_HIM, Direction.NORTH, { life: 100 });
    merc.vehicleSeat = VehicleSeat.PASSENGER;
    seatWithNoVehicleOnTheMap(t, merc);
    return { sim, t, merc, walker };
  }

  it('leaves his tile at boarding but keeps his merc slot, and every loop gated on a tile or a sighting passes him by (Vehicles.cc:261, OppList.cc:629)', () => {
    const { t, merc, walker } = flying();
    expect([merc.placed, merc.offMap, merc.gridNo, merc.structure]).toEqual([false, true, NOWHERE, null]);
    expect(t.mercSlots).toEqual([merc, walker]);
    expect(whoIsThere(t, STANDING_AT, 0)).toBeNull();
    expect([validForSightings(merc), mercs(t), teamMembers(t, Team.OUR)]).toEqual([false, [walker], [walker]]);
  });

  it('is handled by the overhead pass like every merc slot: his frames run and clear the order to look for items every slot gets (Overhead.cc ExecuteOverhead, Handle_Items.cc:1927)', () => {
    const { sim, t, merc } = flying();
    notifySoldiersToLookForItems(t);
    expect(merc.lookForItems).toBe(true);
    for (let tick = 0; tick < FIRST_FRAME_TICKS && merc.lookForItems; tick++) sim.step();
    expect(merc.lookForItems).toBe(false);
  });

  it('takes his merc slot at a sector entry with his APs and his walk as they were: no stop and no count, unlike the passenger of a ground vehicle (Vehicles.cc AddSoldierToVehicle with no vehicle soldier)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const walker = spawnSoldier(sim, 1, Team.OUR, NEXT_TO_HIM, Direction.NORTH, { life: 100 });
    const merc = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH, { life: 100 });
    removeSoldierFromTacticalSector(t, merc);
    merc.vehicleSeat = VehicleSeat.PASSENGER;
    merc.actionPoints = SAVED_APS;
    merc.pathSize = SAVED_PATH_STEPS;
    seatInTheHelicopterOnSectorEntry(t, merc);
    expect([merc.placed, merc.offMap, merc.gridNo, merc.actionPoints, merc.pathSize]).toEqual([
      false,
      true,
      NOWHERE,
      SAVED_APS,
      SAVED_PATH_STEPS,
    ]);
    expect([t.mercSlots, t.soldiers[merc.id]]).toEqual([[walker, merc], merc]);
  });
});
