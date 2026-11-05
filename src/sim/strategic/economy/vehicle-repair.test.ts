import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, kit, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { VehicleTypeId } from '../../vehicles/vehicle-list.ts';
import { FACT_OK_USE_HUMMER } from '../forces/helicopter.ts';
import { initSquads, initVehicles } from '../forces/squads.ts';
import { addVehicleToList } from '../forces/vehicles.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { Assignment, StatAmt } from './constants.ts';
import { Slot } from './kits.ts';
import { handleRepairBySoldier } from './repair.ts';
import { canCharacterRepairVehicle } from './repair-rules.ts';
import { doesVehicleNeedAnyRepairs, repairVehicle } from './vehicle-repair.ts';

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const D13 = parseSectorString('D13');
const VEHICLE_SOLDIER = 18;
const MECHANIC = 0;
const FULL = 100;
const SKILLED = { mechanical: 80, dexterity: 80, expLevel: 4 };
const UNSKILLED = { mechanical: 40, dexterity: 40, expLevel: 1 };

function garage(life: number, skill = SKILLED) {
  const facts = new Set<number>([FACT_OK_USE_HUMMER]);
  const made = economyTestContext({ content, helicopter: { fact: (id) => facts.has(id) }, random: { int: () => 0, chance: () => true } });
  const { ctx, crew } = made;
  initializeMapStructure(ctx);
  initStrategicMovementCosts(ctx);
  initSquads(ctx);
  initVehicles(ctx);
  const vid = addVehicleToList(ctx, D13, VehicleTypeId.HUMMER);
  const v = ctx.state.forces.vehicles[vid];
  if (!v) throw new Error('no vehicle');
  const hummer = crew.add({ id: VEHICLE_SOLDIER, sector: D13, isVehicle: true, life, lifeMax: FULL, assignment: Assignment.SQUAD_1 });
  hummer.vehicleId = vid;
  v.soldierId = VEHICLE_SOLDIER;
  const mechanic = crew.add({ id: MECHANIC, sector: D13, assignment: Assignment.REPAIR, stats: skill });
  mechanic.inv[Slot.HAND] = kit(content.items, 'TOOLKIT', [FULL]);
  mechanic.vehicleUnderRepair = vid;
  return { ...made, v, vid, hummer, mechanic, facts };
}

describe('vehicle repair (Vehicles.cc DoesVehicleNeedAnyRepairs, RepairVehicle)', () => {
  it('gives a point of condition for every 10 repair points, up to the maximum, and uses only the points it turned into condition', () => {
    const { ctx, v, hummer } = garage(50);
    expect(repairVehicle(ctx, v, 27)).toBe(20);
    expect(hummer.life).toBe(52);
    hummer.life = 99;
    expect(repairVehicle(ctx, v, 27)).toBe(10);
    expect(hummer.life).toBe(FULL);
    expect(doesVehicleNeedAnyRepairs(ctx, v)).toBe(false);
    expect(repairVehicle(ctx, v, 27)).toBe(0);
    expect(hummer.life).toBe(FULL);
  });

  it('never repairs the helicopter, whatever its soldier', () => {
    const { ctx, v, vid, hummer } = garage(50);
    ctx.state.forces.helicopterVehicleId = vid;
    expect(doesVehicleNeedAnyRepairs(ctx, v)).toBe(false);
    expect(repairVehicle(ctx, v, 27)).toBe(0);
    expect(hummer.life).toBe(50);
  });

  it('reads the soldier of a vehicle not of ours from the loaded sector', () => {
    const { ctx, v, crew } = garage(50);
    crew.mercs.delete(VEHICLE_SOLDIER);
    expect(doesVehicleNeedAnyRepairs(ctx, v)).toBe(false);
    const civilian = { life: 30, lifeMax: FULL };
    const withSector = { ...ctx, hooks: { ...ctx.hooks, loadedSectorSoldier: (id: number) => (id === VEHICLE_SOLDIER ? civilian : null) } };
    expect(repairVehicle(withSector, v, 27)).toBe(20);
    expect(civilian.life).toBe(32);
  });
});

describe('a mechanic on a vehicle (Assignments.cc CanCharacterRepairVehicle, HandleRepairBySoldier)', () => {
  it('can repair it only while it is damaged, not destroyed, and usable in his sector', () => {
    const { ctx, v, vid, hummer, mechanic, facts } = garage(50);
    expect(canCharacterRepairVehicle(ctx, mechanic, vid)).toBe(true);
    v.destroyed = true;
    expect(canCharacterRepairVehicle(ctx, mechanic, vid)).toBe(false);
    v.destroyed = false;
    facts.clear();
    expect(canCharacterRepairVehicle(ctx, mechanic, vid)).toBe(false);
    facts.add(FACT_OK_USE_HUMMER);
    mechanic.sector = parseSectorString('D14');
    expect(canCharacterRepairVehicle(ctx, mechanic, vid)).toBe(false);
    mechanic.sector = D13;
    hummer.life = FULL;
    expect(canCharacterRepairVehicle(ctx, mechanic, vid)).toBe(false);
    hummer.life = 50;
    expect(canCharacterRepairVehicle(ctx, mechanic, vid + 1)).toBe(false);
  });

  it('spends an hour on the vehicle alone, leaves the points short of 10 unused, and is done once it is whole (quirk)', () => {
    const { ctx, crew, hummer, mechanic } = garage(98);
    handleRepairBySoldier(ctx, mechanic);
    expect(hummer.life).toBe(99);
    expect(crew.statChanges.map((c) => [c.stat, c.chances])).toEqual([
      [StatAmt.MECHANICAL, 5],
      [StatAmt.DEXTERITY, 5],
    ]);
    expect(ctx.events.filter((e) => e.type === 'assignmentDone')).toEqual([]);
    handleRepairBySoldier(ctx, mechanic);
    expect(hummer.life).toBe(FULL);
    expect(ctx.events.filter((e) => e.type === 'assignmentDone' && e.soldier === MECHANIC).length).toBe(1);
  });

  it('repairs nothing with fewer than 10 points an hour and stops as not skilled enough (quirk)', () => {
    const { ctx, hummer, mechanic } = garage(50, UNSKILLED);
    handleRepairBySoldier(ctx, mechanic);
    expect(hummer.life).toBe(50);
    expect(ctx.events).toContainEqual({ type: 'assignmentAborted', soldier: MECHANIC, reason: 'insufficientRepairSkill' });
  });
});
