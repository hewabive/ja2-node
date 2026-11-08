import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { ourHummerOnTheMap, seatInVehicle } from '../../../tests/support/vehicles.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { VehicleSeat } from '../strategic/forces/constants.ts';
import { Fact, Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../strategic/narrative/facts.ts';
import { initNewSoldierAnim, setSoldierDirection, states } from './animation.ts';
import { handleAnyStatChangesAfterAttack, processUpdateStats } from './combat/experience.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { newSmokeEffect } from './explosions/smoke.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { makeCivHostile } from './narrative/civ-hostility.ts';
import { closestPc } from './narrative/closest-pc.ts';
import { Profile } from './narrative/constants.ts';
import { playerTeamDeathRules } from './narrative/death-rules.ts';
import { clearTacticalStuffDueToTimeCompression } from './overhead.ts';
import { Opp } from './perception/opp.ts';
import { validForSightings } from './perception/sight.ts';
import { calcActionPoints } from './points.ts';
import { removeSoldierFromTacticalSector } from './sector-presence.ts';
import { deathSuccessor, selectAfterPlayerTeamMemberDeath } from './selection.ts';
import { CivilianGroup, NOWHERE, OKLIFE, type Soldier, Team } from './soldier.ts';
import { mercs, type TacticalState, teamMembers, whoIsThere } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import {
  beginMercTurn,
  checkForEndOfBattle,
  checkForEndOfCombatMode,
  endTurn,
  enterCombatMode,
  exitCombatMode,
  handleForcedRealtimeTurn,
  isTeamActive,
} from './turns/turns.ts';
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

  const ENEMY_ID = 20;
  const CIV_ID = 120;
  const ONE_ATTRIBUTE_POINT = 50;
  const ENEMY_AT = gridNo(80, 100);
  const DOWN = OKLIFE - 1;
  const PROFILE = 7;

  function withAnEnemy(t: TacticalState, sim: TacticalSim): Soldier {
    const enemy = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
    t.turn.enemyInSector = true;
    return enemy;
  }

  it("keeps his opplist at boarding, which the real-time decay then ages as it ages every merc slot's (Vehicles.cc:261, OppList.cc:4540)", () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
    const merc = spawnSoldier(sim, 0, Team.OUR, STANDING_AT, Direction.NORTH, { life: 100 });
    merc.oppList[enemy.id] = Opp.SEEN_THIS_TURN;
    merc.vehicleSeat = VehicleSeat.PASSENGER;
    seatWithNoVehicleOnTheMap(t, merc);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_THIS_TURN);
    t.turn.forceRealtimeTurn = true;
    handleForcedRealtimeTurn(t, t.realtimeClock, t.clockMs);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_LAST_TURN);
  });

  it('keeps combat going with the enemy he saw this turn, as anyone in the sector who saw one does (CheckForEndOfCombatMode, Overhead.cc:4162, :4273)', () => {
    const { sim, t, merc } = flying();
    const enemy = withAnEnemy(t, sim);
    enterCombatMode(t, Team.OUR);
    merc.oppList[enemy.id] = Opp.SEEN_THIS_TURN;
    merc.ai.oppCount = 1;
    expect(checkForEndOfCombatMode(t, true)).toBe(false);
    expect(t.inCombat).toBe(true);
  });

  it('gets up at his turn start and has his opplist decayed in combat, as a merc in the sector does (EVENT_BeginMercTurn, Soldier_Control.cc:4077)', () => {
    const { sim, t, merc } = flying();
    const enemy = withAnEnemy(t, sim);
    merc.collapsed = true;
    merc.oppList[enemy.id] = Opp.SEEN_THIS_TURN;
    t.inCombat = true;
    beginMercTurn(t, merc);
    expect([merc.collapsed, merc.oppList[enemy.id]]).toEqual([false, Opp.SEEN_LAST_TURN]);
  });

  it('keeps our team active with nobody of ours on the map, as bMenInSector counts every soldier made for our team wherever he is (IsTeamActive, Overhead.h:178, Soldier_Create.cc:453, quirk)', () => {
    const { t, merc, walker } = flying();
    removeSoldierFromTacticalSector(t, walker);
    expect(teamMembers(t, Team.OUR)).toEqual([]);
    expect(isTeamActive(t, Team.OUR)).toBe(true);
    removeSoldierFromTacticalSector(t, merc);
    expect(isTeamActive(t, Team.OUR)).toBe(true);
  });

  it('keeps the battle from being lost while he is conscious above it, and counts it lost once he is down too (CheckForLosingEndOfBattle, Overhead.cc:4959)', () => {
    const { sim, t, merc, walker } = flying();
    withAnEnemy(t, sim);
    walker.life = DOWN;
    expect(checkForEndOfBattle(t)).toBe(false);
    merc.life = DOWN;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'lost' }));
  });

  it('is the one a death picks to select next while he is conscious, and the selection, which refuses a merc aboard, stays on the dead (HandlePlayerTeamMemberDeath, Overhead.cc:2192, quirk)', () => {
    const { t, merc, walker } = flying();
    t.turn.selected = walker.id;
    walker.life = 0;
    const successor = deathSuccessor(t, walker);
    expect(successor).toBe(merc);
    selectAfterPlayerTeamMemberDeath(t, walker, successor);
    expect(t.turn.selected).toBe(walker.id);
  });

  it('is somebody left for the rules of a death of ours, which mark our robot destroyed only with a conscious merc in the sector (HandlePlayerTeamMemberDeath, Overhead.cc:2192)', () => {
    const { t, merc, walker } = flying();
    const set: number[] = [];
    t.narrative = { ...t.narrative, fact: () => false, setFactTrue: (id) => set.push(id), setFactFalse: () => {} };
    walker.profile = Profile.ROBOT;
    walker.life = 0;
    playerTeamDeathRules(t, walker);
    expect(set).toEqual([Fact.FIRST_ROBOT_DESTROYED]);
    merc.life = OKLIFE - 1;
    playerTeamDeathRules(t, walker);
    expect(set).toEqual([Fact.FIRST_ROBOT_DESTROYED]);
  });

  it('bleeds to death through the death of a soldier in the sector, never the death of one off the map (HandleTakeDamageDeath, Soldier_Control.cc:5366, :5401)', () => {
    const { t, merc } = flying();
    const offTheMap: Soldier[] = [];
    t.sectorHooks = { ...t.sectorHooks, mercDiedOffTheMap: (_t, dead) => offTheMap.push(dead) };
    soldierTakeDamage(t, merc, merc.life, 0, DamageReason.BLOODLOSS, null);
    expect([merc.life, merc.dead, offTheMap]).toEqual([0, true, []]);
    expect(t.pendingSkullReleases.map((r) => r.soldier)).toEqual([merc]);
  });

  it('never dies when shot down to life 0 above the sector: only a hit animation, which he never plays, turns a gunshot into a death (quirk)', () => {
    const { sim, t, merc } = flying();
    soldierTakeDamage(t, merc, merc.life, 0, DamageReason.GUNFIRE, null);
    for (let tick = 0; tick < FIRST_FRAME_TICKS; tick++) sim.step();
    expect([merc.life, merc.dead, t.pendingSkullReleases]).toEqual([0, false, []]);
  });

  it('gets a new turn of APs, his unused ones carried, when combat begins and loses his walk when time compression begins, as every soldier in the sector does (CommonEnterCombatModeCode, CencelAllActionsForTimeCompression, Overhead.cc:3913, :5871)', () => {
    const { sim, t, merc } = flying();
    withAnEnemy(t, sim);
    merc.actionPoints = SAVED_APS;
    enterCombatMode(t, Team.OUR);
    expect(merc.actionPoints).toBe(calcActionPoints(t, merc) + SAVED_APS);
    exitCombatMode(t);
    merc.pathSize = SAVED_PATH_STEPS;
    clearTacticalStuffDueToTimeCompression(t);
    expect([merc.pathSize, merc.placed, merc.offMap, merc.gridNo]).toEqual([0, false, true, NOWHERE]);
  });

  it('counts the battle won for him among those who fought it (CheckForEndOfBattle, Overhead.cc:4557)', () => {
    const { t, merc } = flying();
    merc.profile = PROFILE;
    t.profiles.set(PROFILE, progressFor(PROFILE));
    t.turn.enemyInSector = true;
    t.turn.numFoughtInBattle[Team.ENEMY] = 1;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(t.profiles.get(PROFILE)?.battlesFought).toBe(1);
  });

  it('is marked moved with every merc in the sector when our turn ends (EndTurn, TeamTurns.cc:213)', () => {
    const { sim, t, merc, walker } = flying();
    withAnEnemy(t, sim);
    enterCombatMode(t, Team.OUR);
    merc.moved = false;
    walker.moved = false;
    endTurn(t, Team.ENEMY);
    expect([merc.moved, walker.moved]).toEqual([true, true]);
  });

  const SOUTH_WEST_EDGE = gridNo(41, 119);
  const UNSEEN_DISTANCE_TO_ORIGINAL_NOWHERE = 67;

  it("is an NPC's closest merc measured from the original's NOWHERE one row past the map, which every caller then takes for nobody near (ClosestPC, AIUtils.cc:1150)", () => {
    const { sim, t } = flying();
    const npc = spawnSoldier(sim, CIV_ID, Team.CIV, SOUTH_WEST_EDGE, Direction.NORTH);
    expect(closestPc(t, npc)).toEqual({ gridNo: NOWHERE, distance: UNSEEN_DISTANCE_TO_ORIGINAL_NOWHERE });
  });

  function kingpinsManWithMariaAboard(): {
    readonly sim: TacticalSim;
    readonly t: TacticalState;
    readonly goon: Soldier;
    readonly facts: number[];
  } {
    const { sim, t, merc } = flying();
    merc.profile = Profile.MARIA;
    const facts: number[] = [];
    t.narrative = {
      ...t.narrative,
      questStatus: (q) => (q === Quest.RESCUE_MARIA ? QuestStatus.IN_PROGRESS : QuestStatus.NOT_STARTED),
      setFactTrue: (f) => facts.push(f),
    };
    const goon = spawnSoldier(sim, CIV_ID, Team.CIV, SOUTH_WEST_EDGE, Direction.NORTH, { life: 100 });
    goon.civilianGroup = CivilianGroup.KINGPIN;
    return { sim, t, goon, facts };
  }

  it("has Maria's escape noticed when one of Kingpin's men is hurt with her aboard above the sector (SoldierTakeDamage, Soldier_Control.cc:5466)", () => {
    const { t, goon, facts } = kingpinsManWithMariaAboard();
    soldierTakeDamage(t, goon, 1, 0, DamageReason.GUNFIRE, null);
    expect(facts).toContain(Fact.MARIA_ESCAPE_NOTICED);
  });

  it("has Maria's escape noticed when one of Kingpin's men turns hostile with her aboard above the sector (MakeCivHostile, Overhead.cc:2652)", () => {
    const { t, goon, facts } = kingpinsManWithMariaAboard();
    makeCivHostile(t, goon);
    expect(facts).toContain(Fact.MARIA_ESCAPE_NOTICED);
  });

  it('has his stat gains held back during an attack in combat and made after it, as a merc in the sector has (ProcessUpdateStats, Campaign.cc:762, HandleAnyStatChangesAfterAttack)', () => {
    const { sim, t, merc } = flying();
    withAnEnemy(t, sim);
    merc.profile = PROFILE;
    const p = progressFor(PROFILE);
    t.profiles.set(PROFILE, p);
    const strength = p.stats.strength;
    p.gains.strength = ONE_ATTRIBUTE_POINT;
    t.inCombat = true;
    t.turn.attackBusyCount = 1;
    processUpdateStats(t, merc);
    expect([p.stats.strength, p.gains.strength]).toEqual([strength, ONE_ATTRIBUTE_POINT]);
    t.turn.attackBusyCount = 0;
    handleAnyStatChangesAfterAttack(t);
    expect(p.stats.strength).toBe(strength + 1);
  });
});
