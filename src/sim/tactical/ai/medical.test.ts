import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { ourHummerOnTheMap, seatInVehicle } from '../../../../tests/support/vehicles.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, gridNo, gridSquare } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { type SyntheticWorld, syntheticStructure } from '../../../content/world/synthetic.ts';
import { createItem } from '../../items/object.ts';
import { VehicleSeat } from '../../strategic/forces/constants.ts';
import { anim } from '../anim-states.ts';
import { states } from '../animation.ts';
import { findClosestClimbPoint } from '../buildings.ts';
import { findAdjacentGridEx } from '../combat/melee-reach.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn, NO_SLOT } from '../inventory.ts';
import { setSoldierPosition } from '../movement.ts';
import { removeMercStructure } from '../person-structure.ts';
import { setSoldierHeight } from '../roofs.ts';
import { NOBODY, NOWHERE, OKLIFE, type Soldier, Team, Visible } from '../soldier.ts';
import { setAutoBandageMode } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { AiAction } from './actions.ts';
import {
  canAutoBandage,
  canCharacterAutoBandageTeammate,
  canCharacterBeAutoBandagedByTeammate,
  decideAutoBandage,
  findAutobandageClimbPoint,
  findBestPatient,
  fullPatientCheck,
} from './medical.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SHADOW = 0;
const SIDNEY = 1;
const IRA = 2;
const BYSTANDER = 30;
const WOUNDED = 60;
const BADLY_WOUNDED = 20;
const DYING = 10;
const BLEEDING = 5;
const FULL_KIT = 100;
const NEARLY_EMPTY_KIT = 1;
const ON_THE_ROOF = 50;
const BUILDING = 1;
const CLIMB_UP_AT = gridNo(84, 80);
const CLIMB_DOWN_AT = gridNo(85, 80);
const ROOF_TILE = gridNo(88, 80);
const FAR_AWAY = gridNo(60, 60);

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const SOUTH_STEP = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const EAST_STEP = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const north = (g: number) => g - SOUTH_STEP;
const south = (g: number) => g + SOUTH_STEP;
const east = (g: number) => g + EAST_STEP;
const west = (g: number) => g - EAST_STEP;

function roofTiles(): Set<number> {
  const roofs = new Set<number>();
  for (let x = 85; x <= 90; x++) for (let y = 78; y <= 82; y++) roofs.add(gridNo(x, y));
  return roofs;
}

function scene(shape: (world: SyntheticWorld) => void = () => undefined): TacticalSim {
  const roofs = roofTiles();
  const sim = newCombatSim(content, [], 3, roofs, shape);
  const t = sim.state;
  for (const g of roofs) t.buildings.info[g] = BUILDING;
  t.buildings.list.push({ upClimbSpots: [CLIMB_UP_AT], downClimbSpots: [CLIMB_DOWN_AT] });
  return sim;
}

function walledIn(centre: number): (world: SyntheticWorld) => void {
  return (world) => {
    for (const g of gridSquare(centre, 1)) {
      if (g === centre) continue;
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
    }
  };
}

function medic(sim: TacticalSim, id: number, at: number, kitSlot: number = InvSlot.BIGPOCK1, kitStatus = FULL_KIT): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH);
  s.inv[kitSlot] = createItem(content.items, item('FIRSTAIDKIT'), kitStatus);
  return s;
}

function patient(sim: TacticalSim, id: number, at: number, life = WOUNDED): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH, { life });
  s.bleeding = BLEEDING;
  return s;
}

function bystander(sim: TacticalSim, id: number, at: number): Soldier {
  const s = spawnSoldier(sim, id, Team.CIV, at, Direction.NORTH);
  s.visible = Visible.SEEN;
  return s;
}

function onTheRoof(sim: TacticalSim, s: Soldier, at: number = s.gridNo): Soldier {
  setSoldierPosition(sim.state, s, at);
  setSoldierHeight(sim.state, s, ON_THE_ROOF);
  return s;
}

function proneOverTheTileEast(sim: TacticalSim, s: Soldier): void {
  const t = sim.state;
  s.state = states(content.animations).PRONE;
  removeMercStructure(t, s);
  const body = syntheticStructure(StructureFlags.MOBILE, undefined, {
    tiles: [
      [0, 0],
      [1, 0],
    ],
  });
  s.structure = t.world.structures.add(s.gridNo, 0, body, { kind: 'soldier', id: s.id });
  s.multiTile = true;
}

describe('medics and patients (Medical.cc CanCharacterAutoBandageTeammate, CanCharacterBeAutoBandagedByTeammate)', () => {
  it('takes as a medic a merc in the sector with OKLIFE, not collapsed, some medical skill and a kit of any status anywhere', () => {
    const sim = scene();
    const t = sim.state;
    const s = medic(sim, IRA, gridNo(70, 70), InvSlot.SMALLPOCK8, NEARLY_EMPTY_KIT);
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(true);
    s.life = OKLIFE;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(true);
    s.life = OKLIFE - 1;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(false);
    s.life = WOUNDED;
    s.collapsed = true;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(false);
    s.collapsed = false;
    s.stats.medical = 0;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(false);
    s.stats.medical = 1;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(true);
    s.placed = false;
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(false);
    s.placed = true;
    s.inv[InvSlot.SMALLPOCK8] = createItem(content.items, item('GLOCK_17'), FULL_KIT);
    expect(canCharacterAutoBandageTeammate(t, s)).toBe(false);
  });

  it('takes as a patient anyone of ours in the sector who bleeds and lives, the dying included', () => {
    const sim = scene();
    const s = patient(sim, SHADOW, gridNo(70, 70), DYING);
    expect(canCharacterBeAutoBandagedByTeammate(s)).toBe(true);
    s.bleeding = 0;
    expect(canCharacterBeAutoBandagedByTeammate(s)).toBe(false);
    s.bleeding = BLEEDING;
    s.life = 0;
    expect(canCharacterBeAutoBandagedByTeammate(s)).toBe(false);
  });

  it('counts neither a vehicle nor a merc aboard one, as medic or patient', () => {
    const sim = scene();
    const t = sim.state;
    const hummer = ourHummerOnTheMap(t, gridNo(100, 70));
    const aboard = medic(sim, IRA, gridNo(100, 76));
    aboard.bleeding = BLEEDING;
    seatInVehicle(t, aboard, hummer, VehicleSeat.PASSENGER);
    hummer.bleeding = BLEEDING;
    expect([canCharacterAutoBandageTeammate(t, aboard), canCharacterBeAutoBandagedByTeammate(aboard)]).toEqual([false, false]);
    expect([canCharacterAutoBandageTeammate(t, hummer), canCharacterBeAutoBandagedByTeammate(hummer)]).toEqual([false, false]);
    expect(canAutoBandage(t, false)).toBe(false);
  });
});

describe('the best patient (Medical.cc FindBestPatient)', () => {
  it('gives a tie in priority and path to the later patient in team order, on either side', () => {
    for (const [first, second] of [
      [gridNo(80, 84), gridNo(80, 76)],
      [gridNo(80, 76), gridNo(80, 84)],
    ] as const) {
      const sim = scene();
      const ira = medic(sim, IRA, gridNo(80, 80));
      const shadow = patient(sim, SHADOW, first);
      const sidney = patient(sim, SIDNEY, second);
      expect(findBestPatient(sim.state, ira)).toBe(AiAction.GET_CLOSER);
      expect([shadow.autoBandagingMedic, sidney.autoBandagingMedic]).toEqual([NOBODY, IRA]);
      expect(ira.ai.actionData).toBe(second > ira.gridNo ? north(second) : south(second));
    }
  });

  it('takes the cheaper path at equal priority, then priority 2 over a shorter path and priority 3 over 2', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    const shadow = patient(sim, SHADOW, gridNo(80, 84));
    const sidney = patient(sim, SIDNEY, gridNo(80, 70));
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, north(shadow.gridNo)]);
    sidney.life = BADLY_WOUNDED;
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, south(sidney.gridNo)]);
    shadow.life = DYING;
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, north(shadow.gridNo)]);
  });

  it('gives aid on the patient tile from one cardinal step away, and from a diagonal gets closer to a tile beside him', () => {
    const beside = scene();
    const ira = medic(beside, IRA, gridNo(80, 80));
    const shadow = patient(beside, SHADOW, south(ira.gridNo));
    expect([findBestPatient(beside.state, ira), ira.ai.actionData]).toEqual([AiAction.GIVE_AID, shadow.gridNo]);
    const diagonal = scene();
    const medicThere = medic(diagonal, IRA, gridNo(80, 80));
    patient(diagonal, SHADOW, south(east(medicThere.gridNo)));
    expect([findBestPatient(diagonal.state, medicThere), medicThere.ai.actionData]).toEqual([AiAction.GET_CLOSER, east(medicThere.gridNo)]);
  });

  it('reaches a prone patient by another tile his body covers when no tile beside his own is free', () => {
    const sim = scene();
    const t = sim.state;
    const shadow = patient(sim, SHADOW, gridNo(80, 84));
    proneOverTheTileEast(sim, shadow);
    const body = east(shadow.gridNo);
    for (const [k, g] of [north(shadow.gridNo), south(shadow.gridNo), west(shadow.gridNo)].entries()) bystander(sim, BYSTANDER + k, g);
    const ira = medic(sim, IRA, east(body));
    expect(findAdjacentGridEx(t, ira, shadow.gridNo, false)).toBeNull();
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GIVE_AID, body]);
    shadow.state = states(content.animations).STANDING;
    expect(findBestPatient(t, ira)).toBe(AiAction.NONE);
  });

  it('plots every path of the search through people, the global flag down again after it', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    const around = gridSquare(ira.gridNo, 1).filter((g) => g !== ira.gridNo);
    for (const [k, g] of around.entries()) bystander(sim, BYSTANDER + k, g);
    const shadow = patient(sim, SHADOW, gridNo(80, 86));
    expect(findAdjacentGridEx(t, ira, shadow.gridNo, false)).toBeNull();
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, north(shadow.gridNo)]);
    expect(t.pathEnv.globalFlags).toBe(0);
    expect(findAdjacentGridEx(t, ira, shadow.gridNo, false)).toBeNull();
  });

  it('prefers any reachable patient on his level to one behind a climb, whatever the priorities; alone, the roof patient sends him to the climb spot', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(78, 80));
    const shadow = onTheRoof(sim, patient(sim, SHADOW, ROOF_TILE, DYING));
    const sidney = patient(sim, SIDNEY, gridNo(70, 80));
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, east(sidney.gridNo)]);
    sidney.bleeding = 0;
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.MOVE_TO_CLIMB, CLIMB_UP_AT]);
    expect(shadow.autoBandagingMedic).toBe(NOBODY);
  });

  it('lets a medic take over another medic’s patient only when strictly closer, cancelling the other’s action', () => {
    const sim = scene();
    const t = sim.state;
    const shadow = patient(sim, SHADOW, gridNo(80, 80));
    const ira = medic(sim, IRA, gridNo(80, 90));
    const sidney = medic(sim, SIDNEY, gridNo(80, 75));
    expect(decideAutoBandage(t, ira)).toBe(AiAction.GET_CLOSER);
    expect([shadow.autoBandagingMedic, ira.ai.action]).toEqual([IRA, AiAction.GET_CLOSER]);
    expect(decideAutoBandage(t, sidney)).toBe(AiAction.GET_CLOSER);
    expect([shadow.autoBandagingMedic, ira.ai.action, ira.ai.actionData]).toEqual([SIDNEY, AiAction.NONE, NOWHERE]);
    expect(decideAutoBandage(t, ira)).toBe(AiAction.NONE);
    expect(shadow.autoBandagingMedic).toBe(SIDNEY);
  });

  it('leaves the patient to his medic when the newcomer is as far or farther', () => {
    for (const newcomerAt of [gridNo(80, 85), gridNo(80, 90)]) {
      const sim = scene();
      const t = sim.state;
      const shadow = patient(sim, SHADOW, gridNo(80, 80));
      const ira = medic(sim, IRA, gridNo(80, 75));
      const sidney = medic(sim, SIDNEY, newcomerAt);
      expect(decideAutoBandage(t, ira)).toBe(AiAction.GET_CLOSER);
      expect(decideAutoBandage(t, sidney)).toBe(AiAction.NONE);
      expect([shadow.autoBandagingMedic, ira.ai.action]).toEqual([IRA, AiAction.GET_CLOSER]);
    }
  });

  it('takes the patient from a medic who finds no tile beside him to go to, however far the newcomer is', () => {
    const sim = scene();
    const t = sim.state;
    const shadow = patient(sim, SHADOW, gridNo(80, 80));
    const ira = medic(sim, IRA, gridNo(80, 75));
    const sidney = medic(sim, SIDNEY, gridNo(80, 95));
    expect(decideAutoBandage(t, ira)).toBe(AiAction.GET_CLOSER);
    onTheRoof(sim, ira, ROOF_TILE);
    expect(findAdjacentGridEx(t, ira, shadow.gridNo, false)).toBeNull();
    expect(decideAutoBandage(t, sidney)).toBe(AiAction.GET_CLOSER);
    expect([shadow.autoBandagingMedic, ira.ai.action]).toEqual([SIDNEY, AiAction.NONE]);
  });

  it('keeps a merc aboard a vehicle as a candidate, finds no free tile beside the vehicle and drops him silently', () => {
    const sim = scene();
    const t = sim.state;
    const hummer = ourHummerOnTheMap(t, gridNo(100, 70));
    const aboard = patient(sim, SHADOW, gridNo(100, 76), DYING);
    seatInVehicle(t, aboard, hummer, VehicleSeat.PASSENGER);
    const sidney = patient(sim, SIDNEY, gridNo(100, 84));
    const ira = medic(sim, IRA, gridNo(100, 80));
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.GET_CLOSER, north(sidney.gridNo)]);
    sidney.bleeding = 0;
    expect(canAutoBandage(t, false)).toBe(false);
    expect(findBestPatient(t, ira)).toBe(AiAction.NONE);
    expect([aboard.autoBandagingMedic, aboard.bleeding]).toEqual([NOBODY, BLEEDING]);
    onTheRoof(sim, ira, ROOF_TILE);
    expect([findBestPatient(t, ira), ira.ai.actionData]).toEqual([AiAction.MOVE_TO_CLIMB, CLIMB_DOWN_AT]);
  });
});

describe("the AI's medical decision (Medical.cc DecideAutoBandage)", () => {
  it('dresses a bleeding medic first on his own tile, the kit swapped into the hand and the gait left alone', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    ira.bleeding = BLEEDING;
    patient(sim, SHADOW, south(ira.gridNo), DYING);
    const gait = ira.uiMovementMode;
    expect(decideAutoBandage(t, ira)).toBe(AiAction.GIVE_AID);
    expect([ira.ai.actionData, ira.slotItemTakenFrom, ira.uiMovementMode]).toEqual([ira.gridNo, InvSlot.BIGPOCK1, gait]);
    expect([itemIn(ira.inv, InvSlot.HAND), itemIn(ira.inv, InvSlot.BIGPOCK1)]).toEqual([item('FIRSTAIDKIT'), item('GLOCK_17')]);
  });

  it('runs to his patient with the kit in the hand, and swaps nothing for a kit already there', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    patient(sim, SHADOW, gridNo(80, 86));
    expect(decideAutoBandage(t, ira)).toBe(AiAction.GET_CLOSER);
    expect([ira.ai.action, ira.uiMovementMode, ira.slotItemTakenFrom]).toEqual([
      AiAction.GET_CLOSER,
      anim(content, 'RUNNING'),
      InvSlot.BIGPOCK1,
    ]);
    expect([itemIn(ira.inv, InvSlot.HAND), itemIn(ira.inv, InvSlot.BIGPOCK1)]).toEqual([item('FIRSTAIDKIT'), item('GLOCK_17')]);
    const sidney = medic(sim, SIDNEY, gridNo(60, 80), InvSlot.HAND);
    patient(sim, BYSTANDER, gridNo(60, 86));
    expect(decideAutoBandage(t, sidney)).toBe(AiAction.GET_CLOSER);
    expect([sidney.slotItemTakenFrom, itemIn(sidney.inv, InvSlot.HAND)]).toEqual([NO_SLOT, item('FIRSTAIDKIT')]);
  });

  it('decides nothing for a medic serving someone, one without medical skill and one without a kit', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    ira.bleeding = BLEEDING;
    ira.servicePartner = SHADOW;
    expect(decideAutoBandage(t, ira)).toBe(AiAction.NONE);
    ira.servicePartner = NOBODY;
    ira.stats.medical = 0;
    expect(decideAutoBandage(t, ira)).toBe(AiAction.NONE);
    const sidney = spawnSoldier(sim, SIDNEY, Team.OUR, gridNo(70, 70), Direction.NORTH);
    sidney.bleeding = BLEEDING;
    expect(decideAutoBandage(t, sidney)).toBe(AiAction.NONE);
    expect([ira.slotItemTakenFrom, sidney.slotItemTakenFrom, itemIn(ira.inv, InvSlot.HAND)]).toEqual([NO_SLOT, NO_SLOT, item('GLOCK_17')]);
  });
});

describe('the full check (Medical.cc CanAutoBandage, FullPatientCheck)', () => {
  it('checks one patient per call, the first call only arming the pointer', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, gridNo(80, 80));
    patient(sim, SHADOW, gridNo(80, 84));
    patient(sim, SIDNEY, gridNo(80, 76));
    const pointers: number[] = [];
    for (let k = 0; k < 7; k++) {
      expect(canAutoBandage(t, true)).toBe(true);
      pointers.push(t.autoBandage.fullCheckSoldier);
    }
    expect(pointers).toEqual([SHADOW, SIDNEY, NOBODY, SHADOW, SIDNEY, NOBODY, SHADOW]);
    expect(t.autoBandage.failed).toBe(false);
  });

  it('fails on a patient no medic can reach, keeps the pointer on him and fails the next mode at its first call', () => {
    const shadowAt = gridNo(80, 90);
    const sim = scene(walledIn(shadowAt));
    const t = sim.state;
    medic(sim, IRA, gridNo(80, 80));
    patient(sim, SHADOW, shadowAt);
    setAutoBandageMode(t, true);
    expect(canAutoBandage(t, true)).toBe(true);
    expect(canAutoBandage(t, true)).toBe(false);
    expect([t.autoBandage.failed, t.autoBandage.fullCheckSoldier]).toEqual([true, SHADOW]);
    expect(canAutoBandage(t, false)).toBe(true);
    setAutoBandageMode(t, false);
    setAutoBandageMode(t, true);
    t.autoBandage.failed = false;
    expect(canAutoBandage(t, true)).toBe(false);
    expect(t.autoBandage.failed).toBe(true);
  });

  it('passes a patient who is a medic himself, and every ground patient once any medic stands on a roof', () => {
    const shadowAt = gridNo(80, 90);
    const sim = scene(walledIn(shadowAt));
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(80, 80));
    const shadow = patient(sim, SHADOW, shadowAt);
    expect(fullPatientCheck(t, shadow)).toBe(false);
    shadow.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('FIRSTAIDKIT'), FULL_KIT);
    expect(fullPatientCheck(t, shadow)).toBe(true);
    shadow.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('GLOCK_17'), FULL_KIT);
    expect(fullPatientCheck(t, shadow)).toBe(false);
    onTheRoof(sim, medic(sim, SIDNEY, gridNo(70, 70)), ROOF_TILE);
    expect(ira.level).toBe(0);
    expect(fullPatientCheck(t, shadow)).toBe(true);
  });

  it('passes a roof patient on any climb spot free or held by a medic, whether anyone can reach it or not', () => {
    const sim = scene(walledIn(CLIMB_UP_AT));
    const t = sim.state;
    medic(sim, IRA, gridNo(70, 70));
    const shadow = onTheRoof(sim, patient(sim, SHADOW, ROOF_TILE));
    expect(fullPatientCheck(t, shadow)).toBe(true);
    const underTheSpot = bystander(sim, BYSTANDER, CLIMB_DOWN_AT);
    expect(fullPatientCheck(t, shadow)).toBe(false);
    setSoldierPosition(t, underTheSpot, FAR_AWAY);
    medic(sim, SIDNEY, CLIMB_DOWN_AT);
    expect(fullPatientCheck(t, shadow)).toBe(true);
    expect(findAutobandageClimbPoint(t, FAR_AWAY)).toBe(false);
  });

  it('reads the climb spots at swapped levels: the ground-side spot on the roof, the roof-side spot on the ground floor', () => {
    const sim = scene();
    const t = sim.state;
    const shadow = onTheRoof(sim, patient(sim, SHADOW, ROOF_TILE));
    bystander(sim, BYSTANDER, CLIMB_UP_AT);
    onTheRoof(sim, bystander(sim, BYSTANDER + 1, CLIMB_DOWN_AT));
    expect(findClosestClimbPoint(t, CLIMB_UP_AT, shadow.gridNo, true)).toBe(NOWHERE);
    expect(findAutobandageClimbPoint(t, shadow.gridNo)).toBe(true);
  });
});
