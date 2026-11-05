import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { objectOf } from '../../../tests/support/explosives.ts';
import { loadTestContent, loadTestTimelines } from '../../../tests/support/tactical.ts';
import { addStubTank, ourHummerOnTheMap, seatInVehicle } from '../../../tests/support/vehicles.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { SimEvent } from '../events.ts';
import { talkableRefusal } from '../narrative/talkable.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { AiAction } from './ai/actions.ts';
import { noticeUnseenAttacker } from './combat/barrier.ts';
import { findSoldierAtGridNo } from './combat/melee-reach.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { Opp } from './perception/opp.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;
let presentation: PresentationTimeline;

beforeAll(async () => {
  content = await loadTestContent();
  presentation = (await loadTestTimelines()).presentation;
});

const PARKED_AT = gridNo(80, 70);
const BESIDE_IT = gridNo(82, 72);
const AHEAD_OF_IT = gridNo(80, 63);
const DRIVER = 0;
const PASSENGER = 1;
const ON_FOOT = 2;
const ENEMY = 20;
const VEHICLE_APS = 42;
const BLEEDING = 5;
const NOT_TALKABLE_RULES = { isNpcOrRpc: () => false, recruited: () => false, isEpc: () => false };

interface Aboard {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly hummer: Soldier;
  readonly driver: Soldier;
  readonly passenger: Soldier;
  readonly onFoot: Soldier;
}

function aboard(): Aboard {
  const sim = newCombatSim(content);
  const t = sim.state;
  const driver = spawnSoldier(sim, DRIVER, Team.OUR, gridNo(79, 74), Direction.NORTH, { life: 100 });
  const passenger = spawnSoldier(sim, PASSENGER, Team.OUR, gridNo(80, 74), Direction.NORTH, { life: 100 });
  const onFoot = spawnSoldier(sim, ON_FOOT, Team.OUR, BESIDE_IT, Direction.NORTH, { life: 100 });
  const hummer = ourHummerOnTheMap(t, PARKED_AT);
  seatInVehicle(t, driver, hummer, VehicleSeat.DRIVER);
  seatInVehicle(t, passenger, hummer, VehicleSeat.PASSENGER);
  return { sim, t, hummer, driver, passenger, onFoot };
}

function refusalOf(sim: TacticalSim, cmd: Record<string, unknown> & { readonly type: string }): unknown {
  const result = sim.dispatch(cmd);
  return result.ok ? 'ok' : result.data?.refusal;
}

function eventsOf<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('the mercs aboard a vehicle of ours as targets (Soldier_Find.cc FindSoldier skips SOLDIER_PASSENGER | SOLDIER_DRIVER)', () => {
  it("are never found on the vehicle's tile, though their merc slots come first: a punch, a blade or a first draw finds the vehicle", () => {
    const { t, hummer, driver } = aboard();
    expect(t.mercSlots.indexOf(driver)).toBeLessThan(t.mercSlots.indexOf(hummer));
    expect(findSoldierAtGridNo(t, PARKED_AT, 0)).toBe(hummer);
  });

  it('are no target of an order that names a soldier: give, steal, swap places, bandage or talk', () => {
    const { sim, t, passenger, onFoot } = aboard();
    onFoot.stats.medical = 50;
    onFoot.inv[InvSlot.HAND] = objectOf(t, 'FIRSTAIDKIT');
    passenger.bleeding = BLEEDING;
    expect(refusalOf(sim, { type: 'pass', soldier: ON_FOOT, slot: 'hand', target: PASSENGER })).toBe('noSuchTarget');
    expect(refusalOf(sim, { type: 'steal', soldier: ON_FOOT, target: PASSENGER })).toBe('noSuchTarget');
    expect(refusalOf(sim, { type: 'swapPlaces', soldier: ON_FOOT, with: PASSENGER })).toBe('noSuchTarget');
    expect(refusalOf(sim, { type: 'bandage', soldier: ON_FOOT, target: PASSENGER })).toBe('noTarget');
    const talk = { give: false, mercs: true, collapsed: false };
    expect(talkableRefusal(t, NOT_TALKABLE_RULES, onFoot, passenger, talk)).toBe('noSuchTarget');
  });

  it('are no member of an inventory command: nothing goes into their pockets from the team panel', () => {
    const { sim } = aboard();
    expect(refusalOf(sim, { type: 'moveItem', soldier: ON_FOOT, from: 'hand', toSoldier: PASSENGER, to: 'bigPocket1' })).toBe('inVehicle');
  });
});

describe('the mercs aboard a vehicle of ours under orders (Soldier_Macros.h OK_CONTROLLABLE_MERC: the VEHICLE assignment)', () => {
  it('refuse every order as inVehicle, the driver and a passenger alike', () => {
    const { sim } = aboard();
    for (const soldier of [DRIVER, PASSENGER]) {
      const orders = [
        { type: 'select', soldier },
        { type: 'move', soldier, to: gridNo(70, 70) },
        { type: 'turn', soldier, direction: Direction.EAST },
        { type: 'stance', soldier, stance: 'crouch' },
        { type: 'attack', soldier, target: gridNo(70, 70) },
        { type: 'pickUp', soldier },
        { type: 'climb', soldier },
        { type: 'swapHands', soldier },
        { type: 'stealth', soldiers: [soldier] },
        { type: 'mute', soldier },
        { type: 'stop', soldier },
      ];
      expect(orders.map((cmd) => [cmd.type, refusalOf(sim, cmd)])).toEqual(orders.map((cmd) => [cmd.type, 'inVehicle']));
    }
  });

  it('leave the vehicle selectable with them aboard, and keep both out of a group selection', () => {
    const { sim, hummer } = aboard();
    expect(refusalOf(sim, { type: 'select', soldier: hummer.id })).toBe('ok');
    expect(refusalOf(sim, { type: 'select', soldier: ON_FOOT, group: [hummer.id] })).toBe('badGroup');
    expect(refusalOf(sim, { type: 'select', soldier: ON_FOOT, group: [PASSENGER] })).toBe('badGroup');
    expect(refusalOf(sim, { type: 'select', soldier: hummer.id, group: [ON_FOOT] })).toBe('badGroup');
  });
});

describe('a vehicle of ours with nobody aboard (Soldier_Find.cc IsOwnedMerc)', () => {
  it('is not ours to select or order: noDriver (quirk)', () => {
    const sim = newCombatSim(content);
    const hummer = ourHummerOnTheMap(sim.state, PARKED_AT);
    spawnSoldier(sim, ON_FOOT, Team.OUR, BESIDE_IT, Direction.NORTH);
    expect(refusalOf(sim, { type: 'select', soldier: hummer.id })).toBe('noDriver');
    expect(refusalOf(sim, { type: 'turn', soldier: hummer.id, direction: Direction.EAST })).toBe('noDriver');
    expect(refusalOf(sim, { type: 'stop', soldier: hummer.id })).toBe('noDriver');
  });
});

describe('sight around a vehicle of ours (OppList.cc IsSoldierValidForSightings, ManLooksForMan, NoticeUnseenAttacker)', () => {
  function enemyAhead(a: Aboard): Soldier {
    const enemy = spawnSoldier(a.sim, ENEMY, Team.ENEMY, AHEAD_OF_IT, Direction.SOUTH);
    a.sim.lookAround();
    return enemy;
  }

  it('lets the mercs aboard look, while the vehicle itself never does (quirk)', () => {
    const a = aboard();
    const enemy = enemyAhead(a);
    expect([a.driver, a.passenger].map((s) => s.oppList[enemy.id])).toEqual([Opp.SEEN_CURRENTLY, Opp.SEEN_CURRENTLY]);
    expect(a.hummer.oppList[enemy.id]).toBe(Opp.NOT_HEARD_OR_SEEN);
  });

  it("lets enemies see the mercs aboard at the vehicle's tile, by the line of sight to that tile (inferred)", () => {
    const a = aboard();
    const enemy = enemyAhead(a);
    expect([enemy.oppList[DRIVER], enemy.oppList[PASSENGER], enemy.oppList[a.hummer.id]]).toEqual([
      Opp.SEEN_CURRENTLY,
      Opp.SEEN_CURRENTLY,
      Opp.SEEN_CURRENTLY,
    ]);
  });

  it('lets the vehicle notice no unseen attacker in combat, where a merc on foot turns to see him', () => {
    const a = aboard();
    const enemy = spawnSoldier(a.sim, ENEMY, Team.ENEMY, gridNo(86, 72), Direction.WEST);
    a.t.inCombat = true;
    noticeUnseenAttacker(a.t, enemy, a.onFoot);
    noticeUnseenAttacker(a.t, enemy, a.hummer);
    expect([a.onFoot.oppList[enemy.id], a.hummer.oppList[enemy.id]]).toEqual([Opp.SEEN_CURRENTLY, Opp.NOT_HEARD_OR_SEEN]);
  });
});

describe('the view of a vehicle of ours and the mercs aboard (Interface_Panels.cc GetUIApsToDisplay, CheckForAndAddMercToTeamPanel)', () => {
  it('lists each merc aboard with his seat and the vehicle, the vehicle with them in seat order, the driver with its APs', () => {
    const { sim, hummer, driver, passenger } = aboard();
    hummer.actionPoints = VEHICLE_APS;
    const listed = sim.snapshot(presentation, (s) => s.team === Team.OUR);
    const entry = (s: Soldier) => listed.find((v) => v.id === s.id);
    expect(entry(driver)).toMatchObject({ vehicle: { id: hummer.vehicleId, driver: true }, ap: VEHICLE_APS });
    expect(entry(passenger)).toMatchObject({ vehicle: { id: hummer.vehicleId, driver: false }, ap: passenger.actionPoints });
    expect(entry(hummer)).toMatchObject({ vehicle: null, passengers: [DRIVER, PASSENGER] });
    expect(entry(driver)?.gridNo).toBe(hummer.gridNo);
  });
});

describe('the turn of a vehicle with nobody aboard (AIMain.cc StartNPCAI)', () => {
  it("is not located: an enemy tank's turn shows no locator, the soldier's beside it does (quirk)", () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, ENEMY, Team.ENEMY, gridNo(84, 92), Direction.SOUTH);
    const tank = addStubTank(sim.state, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: gridNo(78, 92), direction: Direction.SOUTH });
    sim.lookAround();
    expect(sim.combatView()).toMatchObject({ team: Team.OUR, interrupt: false });
    expect(tank.visible).toBeGreaterThan(-1);
    sim.ai.green.decideActionBlack = () => AiAction.NONE;
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(eventsOf(events, 'enemyTurnProgress').length).toBeGreaterThan(0);
    expect(eventsOf(events, 'aiTurn').map((e) => e.soldier)).toEqual([ENEMY]);
  });
});
