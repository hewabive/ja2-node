import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../tests/support/explosives.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { addStubTank } from '../../../tests/support/vehicles.ts';
import { AmmoType } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { NO_VEHICLE } from '../strategic/forces/constants.ts';
import type { VehicleRecord } from '../vehicles/vehicle-list.ts';
import { totalArmourProtection } from './combat/armour.ts';
import { eventSoldierGotHit, soldierTakeDamage } from './combat/hit.ts';
import { bulletImpact } from './combat/impact.ts';
import { AimShot, DamageReason, Special } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { newSoldierCreate, tacticalCreateSoldier } from './creation.ts';
import { igniteExplosion } from './explosions/explosion.ts';
import { NEUTRAL_POPULATION } from './init-list.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { MercStatus, profileProgress } from './profiles.ts';
import { Body, OKLIFE, type Soldier, TEAM_FIRST_ID, Team, Visible } from './soldier.ts';
import { registerSoldier, type TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { PRIVATE_VEHICLE_LIST } from './vehicle-soldiers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const LIFE = 100;
const STURDY_LIFE = 120;
const NPC164 = 164;
const VEHICLE_AT = gridNo(80, 80);
const ATTACKER_AT = gridNo(80, 66);
const SHOOTER_PROFILE = 3;
const WEAK_TANK_LIFE = OKLIFE + 5;
const SPECTRA_VEST_PROTECTION = 30;
const KEVLAR_VEST_PROTECTION = 15;
const FLUKE_OF_ZERO = 25;

function vehicle(t: TacticalState, team: number, body: number, k = 0, life = LIFE): Soldier {
  const at = VEHICLE_AT + 8 * k;
  const create = { ...newSoldierCreate(team, body, Direction.EAST, at), life, lifeMax: life };
  const s = tacticalCreateSoldier(t, create, (TEAM_FIRST_ID[team] ?? 0) + k, NEUTRAL_POPULATION);
  if (!s) throw new Error(`no vehicle of body ${body}`);
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  s.placed = true;
  return s;
}

function fight(): { sim: TacticalSim; t: TacticalState; attacker: Soldier } {
  const sim = newCombatSim(content);
  const attacker = spawnSoldier(sim, 0, Team.OUR, ATTACKER_AT, Direction.SOUTH);
  return { sim, t: sim.state, attacker };
}

function hit(t: TacticalState, s: Soldier, damage: number, reason: number, attacker: Soldier | null): number {
  return soldierTakeDamage(t, s, damage, 0, reason, attacker);
}

describe('damage to a vehicle (Soldier_Control.cc SoldierTakeDamage, Vehicles.cc VehicleTakeDamage)', () => {
  it('takes a third of gunfire and twice an explosion over 50 when it is not a tank, which takes both whole (quirk)', () => {
    const { t, attacker } = fight();
    const hummer = vehicle(t, Team.CIV, Body.HUMVEE);
    expect(hit(t, hummer, 32, DamageReason.GUNFIRE, attacker)).toBe(0);
    expect(hummer.life).toBe(LIFE - 10);
    hit(t, hummer, 50, DamageReason.EXPLOSION, attacker);
    expect(hummer.life).toBe(LIFE - 10 - 50);
    const jeep = vehicle(t, Team.CIV, Body.JEEP, 1);
    hit(t, jeep, 51, DamageReason.EXPLOSION, attacker);
    expect(jeep.life).toBe(0);
    const truck = vehicle(t, Team.CIV, Body.ICECREAMTRUCK, 2, STURDY_LIFE);
    hit(t, truck, 60, DamageReason.STRUCTURE_EXPLOSION, attacker);
    expect(truck.life).toBe(STURDY_LIFE - 60);
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NW, 3);
    hit(t, tank, 32, DamageReason.GUNFIRE, attacker);
    hit(t, tank, 51, DamageReason.EXPLOSION, attacker);
    expect(tank.life).toBe(LIFE - 32 - 51);
  });

  it('takes nothing from fists, gas, blades, falls or bleeding', () => {
    const { t, attacker } = fight();
    const hummer = vehicle(t, Team.CIV, Body.HUMVEE);
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NE, 1);
    for (const reason of [DamageReason.HANDTOHAND, DamageReason.GAS, DamageReason.BLADE, DamageReason.FALLROOF, DamageReason.BLOODLOSS])
      for (const s of [hummer, tank]) expect(hit(t, s, 60, reason, attacker)).toBe(0);
    expect([hummer.life, tank.life, hummer.damageWindow, tank.damageWindow]).toEqual([LIFE, LIFE, 0, 0]);
  });

  it('takes nothing when its soldier has no place in the vehicle list', () => {
    const { t, attacker } = fight();
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NW);
    tank.vehicleId = NO_VEHICLE;
    hit(t, tank, 60, DamageReason.EXPLOSION, attacker);
    expect(tank.life).toBe(LIFE);
  });

  it('drops a vehicle left below OKLIFE to 0, and shows the damage only while the squad sees it', () => {
    const { t, attacker } = fight();
    const seen = vehicle(t, Team.ENEMY, Body.TANK_NW);
    const unseen = vehicle(t, Team.ENEMY, Body.TANK_NE, 1);
    seen.visible = Visible.SEEN;
    unseen.visible = Visible.HIDDEN;
    for (const s of [seen, unseen]) hit(t, s, 30, DamageReason.GUNFIRE, attacker);
    expect([seen.damageWindow, unseen.damageWindow]).toEqual([30, 30]);
    expect([seen.displayDamage, unseen.displayDamage]).toEqual([true, false]);
    expect(t.events.filter((e) => e.type === 'lifeLost')).toMatchObject([{ soldier: seen.id, amount: 30 }]);
    const toJustBelowOkLife = seen.life - OKLIFE + 1;
    hit(t, seen, toJustBelowOkLife, DamageReason.GUNFIRE, attacker);
    expect(seen.life).toBe(0);
  });
});

describe('a destroyed vehicle (Vehicles.cc HandleCriticalHitForVehicleInLocation, KillAllInVehicle)', () => {
  it('blows up at its own tile with a GREAT_BIG_EXPLOSION credited to the attacker, dies at once and leaves the list with its corpse (quirk)', () => {
    const { t, attacker } = fight();
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NW);
    const record = t.vehicles[tank.vehicleId] as VehicleRecord;
    const busy = t.turn.attackBusyCount;
    eventSoldierGotHit(t, tank, itemId(t, 'GLOCK_17'), LIFE, 0, Direction.NORTH, 0, attacker, Special.NONE, AimShot.TORSO);
    expect(t.events.filter((e) => ['vehicleDestroyed', 'explosion', 'soldierDied'].includes(e.type))).toMatchObject([
      { type: 'vehicleDestroyed', soldier: tank.id, vehicle: tank.vehicleId, killer: attacker.id },
      { type: 'explosion', item: itemId(t, 'GREAT_BIG_EXPLOSION'), gridNo: VEHICLE_AT, level: 0, owner: attacker.id },
      { type: 'soldierDied', soldier: tank.id, killer: attacker.id },
    ]);
    expect(t.turn.attackBusyCount).toBe(busy + 1);
    expect([tank.dead, tank.placed, t.mercSlots.includes(tank)]).toEqual([true, false, false]);
    expect(record).toMatchObject({ destroyed: true, valid: false });
    expect(t.corpses.map((c) => c.gridNo)).toEqual([VEHICLE_AT]);
  });

  it('stays destroyed: our vehicle keeps its place in the list, and a second blow sets nothing off', () => {
    const { t, attacker } = fight();
    const hummer = vehicle(t, Team.OUR, Body.HUMVEE, 0);
    hit(t, hummer, 3 * LIFE, DamageReason.GUNFIRE, attacker);
    expect(t.vehicles[hummer.vehicleId]).toMatchObject({ destroyed: true, valid: true });
    const explosions = t.events.filter((e) => e.type === 'explosion').length;
    hummer.life = LIFE;
    hit(t, hummer, 3 * LIFE, DamageReason.GUNFIRE, attacker);
    expect([hummer.life, t.events.filter((e) => e.type === 'explosion').length]).toEqual([LIFE, explosions]);
  });

  it('kills its passengers after its own death, once, through the vehicle hooks', () => {
    const { t, attacker } = fight();
    const truck = vehicle(t, Team.CIV, Body.ICECREAMTRUCK);
    const wrecks: { readonly record: VehicleRecord; readonly deadBefore: boolean }[] = [];
    t.vehicleHooks = { ...PRIVATE_VEHICLE_LIST, killAllInVehicle: (v) => wrecks.push({ record: v, deadBefore: truck.dead }) };
    hit(t, truck, 3 * LIFE, DamageReason.GUNFIRE, attacker);
    hit(t, truck, 3 * LIFE, DamageReason.GUNFIRE, attacker);
    expect(wrecks).toEqual([{ record: t.vehicles[truck.vehicleId], deadBefore: true }]);
  });

  it("marks a tank's NPC164 profile dead, and writes no history entry for it (quirk)", () => {
    const { t, attacker } = fight();
    t.profiles.set(NPC164, testProfile(NPC164));
    const history: number[] = [];
    t.narrative = { ...t.narrative, addHistory: (_code, profile) => history.push(profile) };
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NE);
    expect(tank.profile).toBe(NPC164);
    hit(t, tank, LIFE, DamageReason.EXPLOSION, attacker);
    expect(profileProgress(t, NPC164)).toMatchObject({ mercStatus: MercStatus.IS_DEAD, life: 0 });
    expect(history).toEqual([]);
  });
});

describe('vehicle armour (Weapons.cc TotalArmourProtection, Vehicles.cc GetVehicleArmour)', () => {
  it("protects a vehicle with its type's armour at status 100 wherever it is hit, with one PreRandom(100) each time and no wear", () => {
    const { t } = fight();
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: VEHICLE_AT, direction: Direction.NORTH });
    const truck = vehicle(t, Team.CIV, Body.ICECREAMTRUCK, 3);
    const helmet = tank.inv[InvSlot.HELMET]?.status[0];
    const pre = new ScriptedStream([99, 99, 99]);
    const c = { content: t.content, pre, vehicles: t.vehicles };
    expect(totalArmourProtection(c, tank, AimShot.HEAD, LIFE, AmmoType.REGULAR)).toBe(SPECTRA_VEST_PROTECTION);
    expect(totalArmourProtection(c, tank, AimShot.HEAD, LIFE, AmmoType.REGULAR)).toBe(SPECTRA_VEST_PROTECTION);
    expect(totalArmourProtection(c, truck, AimShot.LEGS, LIFE, AmmoType.REGULAR)).toBe(KEVLAR_VEST_PROTECTION);
    expect(pre.requested).toEqual([100, 100, 100]);
    expect(tank.inv[InvSlot.HELMET]?.status[0]).toBe(helmet);
  });

  it('draws the fluke and then the vehicle armour for a HEAT round on a tank, and nothing for any other round', () => {
    const { sim, t } = fight();
    const tank = vehicle(t, Team.ENEMY, Body.TANK_NW);
    const firer = spawnSoldier(sim, 1, Team.OUR, ATTACKER_AT + 2, Direction.SOUTH, { gun: 'ROCKET_RIFLE' });
    const rifle = firer.inv[InvSlot.HAND];
    if (!rifle) throw new Error('no rifle');
    const pre = new ScriptedStream([FLUKE_OF_ZERO, 0]);
    Object.assign(t, { pre });
    rifle.gunAmmoType = AmmoType.REGULAR;
    expect(bulletImpact(t, firer, tank, AimShot.TORSO, 40, 0, Special.NONE).damage).toBe(0);
    expect(pre.requested).toEqual([]);
    rifle.gunAmmoType = AmmoType.HEAT;
    const halvedHeat = Math.trunc(Math.trunc((40 * 4) / 3) / 2);
    const heatArmour = Math.trunc((SPECTRA_VEST_PROTECTION * 3) / 4);
    expect(bulletImpact(t, firer, tank, AimShot.TORSO, 40, 0, Special.NONE).damage).toBe(halvedHeat - heatArmour);
    expect(pre.requested).toEqual([51, 100]);
  });
});

describe('a tank in a fight', () => {
  function tankAndShooter(life: number) {
    const sim = newCombatSim(content);
    const t = sim.state;
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: VEHICLE_AT, direction: Direction.NORTH });
    tank.life = life;
    const shooter = spawnSoldier(sim, 0, Team.OUR, ATTACKER_AT, Direction.SOUTH, {
      gun: 'ROCKET_RIFLE',
      profile: SHOOTER_PROFILE,
      marksmanship: 100,
    });
    const rifle = shooter.inv[InvSlot.HAND];
    if (!rifle) throw new Error('no rifle');
    rifle.gunAmmoType = AmmoType.HEAT;
    rifle.imprintId = SHOOTER_PROFILE;
    sim.lookAround();
    sim.drainEvents();
    return { sim, t, tank, shooter };
  }

  it("is destroyed by a HEAT rocket of a rocket rifle, and its wreck explodes as the shooter's", () => {
    const { sim, tank, shooter } = tankAndShooter(WEAK_TANK_LIFE);
    expect(sim.dispatch({ type: 'attack', soldier: shooter.id, target: tank.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.filter((e) => e.type === 'vehicleDestroyed')).toMatchObject([{ soldier: tank.id, killer: shooter.id }]);
    expect(events.filter((e) => e.type === 'explosion')).toMatchObject([
      { item: itemId(sim.state, 'GREAT_BIG_EXPLOSION'), gridNo: tank.gridNo, owner: shooter.id },
    ]);
    expect(tank.life).toBe(0);
  });

  it("is destroyed by the blast of an explosion beside it, and its wreck explodes as the bomber's", () => {
    const { sim, t, tank, shooter } = tankAndShooter(WEAK_TANK_LIFE);
    igniteExplosion(t, shooter, 0, tank.gridNo, itemId(t, 'C4'), 0);
    const events = runExplosivesUntilIdle(sim);
    expect(events.filter((e) => e.type === 'vehicleDestroyed')).toMatchObject([{ soldier: tank.id, killer: shooter.id }]);
    expect(events.filter((e) => e.type === 'explosion')).toMatchObject([
      { item: itemId(t, 'C4'), owner: shooter.id },
      { item: itemId(t, 'GREAT_BIG_EXPLOSION'), gridNo: tank.gridNo, owner: shooter.id },
    ]);
  });

  it('shrugs off a rocket that is not HEAT', () => {
    const { sim, tank, shooter } = tankAndShooter(WEAK_TANK_LIFE);
    const rifle = shooter.inv[InvSlot.HAND];
    if (rifle) rifle.gunAmmoType = AmmoType.AP;
    expect(sim.dispatch({ type: 'attack', soldier: shooter.id, target: tank.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'soldierHit' && e.soldier === tank.id)).toBe(true);
    expect(tank.life).toBe(WEAK_TANK_LIFE);
  });
});
