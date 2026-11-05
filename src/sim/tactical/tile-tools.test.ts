import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { addStubVehicle } from '../../../tests/support/vehicles.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { SimEvent } from '../events.ts';
import { answerHint } from '../hints/answer.ts';
import { type PreviewAction, vehicleToolPreviewGridNo } from '../hints/preview-action.ts';
import { createItems } from '../items/object.ts';
import { knowledgeRules, knowledgeWorld } from '../knowledge/knowledge-world.ts';
import { knowledgeViewOf } from '../knowledge/sim-view.ts';
import { animName } from './anim-states.ts';
import { addCorpseStructure } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { loadDoorStatusArray, storedDoorStatuses } from './doors/door-status.ts';
import { InvSlot } from './inventory.ts';
import { doorOpeningNoise } from './perception/noise.ts';
import { AP } from './points.ts';
import { Body, NO_PROFILE, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';
import { apsToCutFence, apsToUseJar, isCuttableWireFenceAtGridNo, vehicleToolTarget, walkCostTo } from './tile-tools.ts';
import { enterCombatMode } from './turns/turns.ts';
import { PRIVATE_VEHICLE_LIST } from './vehicle-soldiers.ts';
import { tileChangeViews } from './world-view.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const FENCE = gridNo(108, 74);
const BESIDE_FENCE = gridNo(108, 73);
const UP_THE_YARD = gridNo(108, 70);
const OPEN_GROUND = gridNo(108, 69);
const DOOR = 11429;
const BESIDE_DOOR = DOOR + WORLD_COLS;
const OUTSIDE_DOOR = DOOR + 2 * WORLD_COLS;
const INSIDE_BY_THE_DOOR = DOOR + 1;
const JEEP_BY_THE_DOOR = DOOR - 2;
const FAR_ENEMY = gridNo(60, 130);
const FLAT_MERC = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const CORPSE_AT = FLAT_MERC + EAST;
const FAR_CORPSE = FLAT_MERC + 4 * EAST;
const DOOR_NOISE_VOLUME = 2;
const TIN_CAN_FACTOR = 3;
const ALWAYS_HEARD = 99;
const NO_DOOR = -1;

let kit: StubSectorKit;
let content: TacticalContent;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  content = kit.content;
});

afterAll(async () => {
  await kit.dispose();
});

function village(): TacticalSim {
  return new TacticalSim(kit.world(VILLAGE), kit.content, 5);
}

function intoCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, FAR_ENEMY, Direction.SOUTH);
  enterCombatMode(sim.state, Team.OUR);
  expect(sim.state.inCombat).toBe(true);
}

function holding(sim: TacticalSim, at: number, direction: number, tool: string, count = 1): Soldier {
  const merc = spawnSoldier(sim, 0, Team.OUR, at, direction);
  merc.inv[InvSlot.HAND] = createItems(sim.state.content.items, itemId(sim.state, tool), 100, count);
  return merc;
}

function order(sim: TacticalSim, type: string, at: number): SimEvent[] {
  expect(sim.dispatch({ type, soldier: 0, gridNo: at })).toEqual({ ok: true });
  return [...sim.drainEvents(), ...runUntilIdle(sim)];
}

function refusalOf(sim: TacticalSim, type: string, at: number): unknown {
  const result = sim.dispatch({ type, soldier: 0, gridNo: at });
  expect(result.ok).toBe(false);
  return (result.data as { refusal?: string } | undefined)?.refusal;
}

function previewOn(sim: TacticalSim, world: string, kind: string, at: number): PreviewAction {
  const rules = knowledgeRules(sim.state.content, { world: () => kit.world(world) });
  const answer = answerHint(knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }), {
    type: 'previewAction',
    soldier: 0,
    kind,
    gridNo: at,
  });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as PreviewAction;
}

const handItem = (s: Soldier) => s.inv[InvSlot.HAND]?.item;

function openingNoise(t: TacticalState, s: Soldier): number {
  const pre = t.pre as unknown as { int(n: number): number };
  const draw = pre.int;
  pre.int = () => ALWAYS_HEARD;
  s.pendingDoorGridNo = DOOR;
  s.stealthMode = true;
  try {
    return doorOpeningNoise(t, s);
  } finally {
    pre.int = draw;
    s.pendingDoorGridNo = NO_DOOR;
    s.stealthMode = false;
  }
}
const corpseType = (name: string) => content.corpses.table.types.indexOf(name);

function corpseAtTile(t: TacticalState, at: number, type: string): void {
  const corpse = { gridNo: at, level: 0, heightAdjustment: 0, bodyType: 0, direction: Direction.NORTH, state: 0, profile: NO_PROFILE };
  t.corpses.push({ ...corpse, type: corpseType(type), timeOfDeath: 0, headTaken: false, servicingCrows: 0 });
  addCorpseStructure(t, at, 0, corpseType(type), Direction.NORTH);
}

describe('wire cutters (Handle_Items.cc HandleItem, EVENT_SoldierBeginCutFence, CutWireFence)', () => {
  it('crouches beside the fence, pays AP_USEWIRECUTTERS as CUTTING_FENCE starts and swaps the fence for its cut partner at code 481, a map change', () => {
    const sim = village();
    const t = sim.state;
    intoCombat(sim);
    const merc = holding(sim, BESIDE_FENCE, Direction.SOUTH, 'WIRECUTTERS');
    const before = merc.actionPoints;
    expect(t.world.costs.get(FENCE, Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
    expect(sim.dispatch({ type: 'cutFence', soldier: 0, gridNo: FENCE })).toEqual({ ok: true });
    expect(animName(t.content, merc.state)).toBe('KNEEL_DOWN');
    const events = runUntilIdle(sim);
    expect(before - merc.actionPoints).toBe(AP.CROUCH + AP.USEWIRECUTTERS);
    expect(isCuttableWireFenceAtGridNo(t, FENCE)).toBe(false);
    expect(((t.world.structures.find(FENCE, StructureFlags.WIREFENCE)?.flags ?? 0) & StructureFlags.OPEN) !== 0).toBe(true);
    expect(t.world.costs.get(FENCE, Direction.NORTH, 0)).toBe(TravelCost.NOT_STANDING);
    expect(tileChangeViews(t).map((c) => [c.kind, c.gridNo])).toEqual([
      ['remove', FENCE],
      ['swap', FENCE],
    ]);
    expect(events.filter((e) => e.type === 'fenceCut')).toEqual([expect.objectContaining({ soldier: merc.id, gridNo: FENCE })]);
    expect(handItem(merc)).toBe(itemId(t, 'WIRECUTTERS'));
  });

  it('walks beside the fence first and cuts it on arrival (MERC_CUTFFENCE)', () => {
    const sim = village();
    const merc = holding(sim, UP_THE_YARD, Direction.SOUTH, 'WIRECUTTERS');
    expect(sim.dispatch({ type: 'cutFence', soldier: 0, gridNo: FENCE })).toEqual({ ok: true });
    expect(merc.pendingTileTool).toMatchObject({ tool: 'cutFence', gridNo: FENCE });
    runUntilIdle(sim);
    expect([merc.gridNo, merc.pendingTileTool]).toEqual([BESIDE_FENCE, null]);
    expect(isCuttableWireFenceAtGridNo(sim.state, FENCE)).toBe(false);
  });

  it('refuses a tile without a fence it could cut, a cut one included, and a hand without wire cutters (UIMouseOnValidAttackLocation)', () => {
    const sim = village();
    const merc = holding(sim, BESIDE_FENCE, Direction.SOUTH, 'GLOCK_17');
    expect(refusalOf(sim, 'cutFence', FENCE)).toBe('noWireCutters');
    merc.inv[InvSlot.HAND] = objectOf(sim.state, 'WIRECUTTERS');
    expect(refusalOf(sim, 'cutFence', OPEN_GROUND)).toBe('noFence');
    order(sim, 'cutFence', FENCE);
    expect(refusalOf(sim, 'cutFence', FENCE)).toBe('noFence');
  });

  it('refuses in combat the walk and the cut he cannot pay together', () => {
    const sim = village();
    intoCombat(sim);
    const merc = holding(sim, UP_THE_YARD, Direction.SOUTH, 'WIRECUTTERS');
    const needed = apsToCutFence(sim.state, merc) + walkCostTo(sim.state, merc, BESIDE_FENCE);
    merc.actionPoints = needed - 1;
    expect(refusalOf(sim, 'cutFence', FENCE)).toBe('notEnoughAP');
    merc.actionPoints = needed;
    expect(sim.dispatch({ type: 'cutFence', soldier: 0, gridNo: FENCE })).toEqual({ ok: true });
  });

  it('previews the walk beside the fence with the cut, and refuses noFence where the cursor turns bad (HandleWirecutterCursor)', () => {
    const sim = village();
    const merc = holding(sim, UP_THE_YARD, Direction.SOUTH, 'WIRECUTTERS');
    const preview = previewOn(sim, VILLAGE, 'cutFence', FENCE);
    expect(preview).toMatchObject({
      ok: true,
      actionGridNo: BESIDE_FENCE,
      apCost: apsToCutFence(sim.state, merc) + walkCostTo(sim.state, merc, BESIDE_FENCE),
    });
    expect(preview.steps.length).toBeGreaterThan(0);
    expect(previewOn(sim, VILLAGE, 'cutFence', OPEN_GROUND)).toMatchObject({ ok: false, refusal: 'noFence' });
  });
});

describe('the jar (HandleItem, EVENT_SoldierBeginTakeBlood, GetBloodFromCorpse)', () => {
  it.each([
    ['ADULTMONSTER_DEAD', 'JAR_CREATURE_BLOOD'],
    ['INFANTMONSTER_DEAD', 'JAR_CREATURE_BLOOD'],
    ['QUEEN_MONSTER_DEAD', 'JAR_QUEEN_CREATURE_BLOOD'],
    ['M_DEAD1', 'JAR_HUMAN_BLOOD'],
  ])('fills the jar beside a %s corpse with %s at code 760', (corpse, blood) => {
    const sim = newCombatSim(content);
    corpseAtTile(sim.state, CORPSE_AT, corpse);
    const merc = holding(sim, FLAT_MERC, Direction.EAST, 'JAR');
    const events = order(sim, 'fillJar', CORPSE_AT);
    expect(handItem(merc)).toBe(itemId(sim.state, blood));
    expect(merc.inv[InvSlot.HAND]).toMatchObject({ count: 1, status: [100] });
    expect(events.filter((e) => e.type === 'jarFilled')).toEqual([expect.objectContaining({ soldier: merc.id, item: blood })]);
  });

  it('costs nothing but the crouch from beside the corpse, and turns a stack of two empty jars into one jar of blood (quirk)', () => {
    const sim = newCombatSim(content);
    intoCombat(sim);
    corpseAtTile(sim.state, CORPSE_AT, 'ADULTMONSTER_DEAD');
    const merc = holding(sim, FLAT_MERC, Direction.EAST, 'JAR', 2);
    const before = merc.actionPoints;
    order(sim, 'fillJar', CORPSE_AT);
    expect(before - merc.actionPoints).toBe(AP.CROUCH);
    expect(merc.inv[InvSlot.HAND]).toMatchObject({ item: itemId(sim.state, 'JAR_CREATURE_BLOOD'), count: 1 });
  });

  it('asks for the walk twice plus AP_TAKE_BLOOD before a walk, yet charges only the walk and the crouch (GetAPsToUseJar)', () => {
    const sim = newCombatSim(content);
    intoCombat(sim);
    corpseAtTile(sim.state, FAR_CORPSE, 'ADULTMONSTER_DEAD');
    const merc = holding(sim, FLAT_MERC, Direction.EAST, 'JAR');
    const beside = FAR_CORPSE - EAST;
    const walk = walkCostTo(sim.state, merc, beside);
    expect(apsToUseJar(sim.state, merc, beside)).toBe(walk + AP.TAKE_BLOOD);
    merc.actionPoints = 2 * walk + AP.TAKE_BLOOD - 1;
    expect(refusalOf(sim, 'fillJar', FAR_CORPSE)).toBe('notEnoughAP');
    merc.actionPoints = 2 * walk + AP.TAKE_BLOOD;
    order(sim, 'fillJar', FAR_CORPSE);
    expect([merc.gridNo, merc.actionPoints]).toEqual([beside, walk + AP.TAKE_BLOOD - AP.CROUCH]);
    expect(handItem(merc)).toBe(itemId(sim.state, 'JAR_CREATURE_BLOOD'));
  });

  it('says NOTHING where no corpse lies and keeps the jar empty', () => {
    const sim = newCombatSim(content);
    const merc = holding(sim, FLAT_MERC, Direction.EAST, 'JAR');
    const events = order(sim, 'fillJar', CORPSE_AT);
    expect(handItem(merc)).toBe(itemId(sim.state, 'JAR'));
    expect(events.filter((e) => e.type === 'nothingFound')).toEqual([expect.objectContaining({ soldier: merc.id, gridNo: CORPSE_AT })]);
  });

  it('previews twice the walk plus AP_TAKE_BLOOD and turns good only over a corpse the view shows (HandleJarCursor)', () => {
    const sim = newCombatSim(content);
    const merc = holding(sim, FLAT_MERC, Direction.EAST, 'JAR');
    const beside = FAR_CORPSE - EAST;
    const walk = walkCostTo(sim.state, merc, beside);
    const jar = () => hintAnswer(sim, 'previewAction', { soldier: 0, kind: 'jar', gridNo: FAR_CORPSE }).data;
    expect(jar()).toMatchObject({ ok: false, refusal: 'noCorpse', actionGridNo: beside, apCost: 2 * walk + AP.TAKE_BLOOD });
    corpseAtTile(sim.state, FAR_CORPSE, 'ADULTMONSTER_DEAD');
    expect(jar()).toMatchObject({ ok: true, actionGridNo: beside, apCost: 2 * walk + AP.TAKE_BLOOD });
  });
});

describe('the tin can on a string (HandleItem, EVENT_SoldierBeginAttachCan, DoorOpeningNoise)', () => {
  it('walks beside the door, records the can in its door status as seen, plays ATTACH_CAN_TO_STRING and loses the can, for no AP but the walk and the crouch', () => {
    const sim = village();
    const t = sim.state;
    intoCombat(sim);
    const merc = holding(sim, OUTSIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    const walk = walkCostTo(t, merc, BESIDE_DOOR);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attachCan', soldier: 0, gridNo: DOOR })).toEqual({ ok: true });
    const states = new Set<string>();
    const events: SimEvent[] = [];
    for (let k = 0; k < 5_000 && !sim.isIdle(); k++) {
      sim.step();
      states.add(animName(t.content, merc.state));
      events.push(...sim.drainEvents());
    }
    expect(states.has('ATTACH_CAN_TO_STRING')).toBe(true);
    expect([merc.gridNo, before - merc.actionPoints]).toEqual([BESIDE_DOOR, walk + AP.CROUCH]);
    expect(handItem(merc)).toBe(0);
    expect(t.doorStatus.get(DOOR)).toMatchObject({ open: false, perceivedOpen: false, perceivedNotSet: false, hasTinCan: true });
    expect(events.filter((e) => e.type === 'canAttached')).toEqual([expect.objectContaining({ soldier: merc.id, gridNo: DOOR })]);
  });

  it('ties nothing when he already stands where he would tie it: the take-blood path says NOTHING (quirk)', () => {
    const sim = village();
    const merc = holding(sim, BESIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    const events = order(sim, 'attachCan', DOOR);
    expect(handItem(merc)).toBe(itemId(sim.state, 'STRING_TIED_TO_TIN_CAN'));
    expect(sim.state.doorStatus.get(DOOR)?.hasTinCan ?? false).toBe(false);
    expect(events.map((e) => e.type)).toContain('nothingFound');
  });

  it('refuses a tile with nothing to tie it to', () => {
    const sim = village();
    holding(sim, OUTSIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    expect(refusalOf(sim, 'attachCan', OUTSIDE_DOOR + 3)).toBe('noInteractiveTile');
  });

  it('triples the noise of opening the door it hangs on', () => {
    const sim = village();
    const merc = holding(sim, OUTSIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    expect(openingNoise(sim.state, merc)).toBe(DOOR_NOISE_VOLUME);
    order(sim, 'attachCan', DOOR);
    expect(openingNoise(sim.state, merc)).toBe(DOOR_NOISE_VOLUME * TIN_CAN_FACTOR);
  });

  it('keeps the can with the door status when the sector is stored and loaded again', () => {
    const sim = village();
    holding(sim, OUTSIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    order(sim, 'attachCan', DOOR);
    const stored = storedDoorStatuses(sim.state);
    expect(stored).toEqual([expect.objectContaining({ gridNo: DOOR, hasTinCan: true })]);
    const later = village();
    loadDoorStatusArray(later.state, stored);
    expect(later.state.doorStatus.get(DOOR)?.hasTinCan).toBe(true);
  });

  it('previews AP_ATTACH_CAN with the walk beside a door and refuses noDoor over any other tile (HandleTinCanCursor)', () => {
    const sim = village();
    const merc = holding(sim, OUTSIDE_DOOR, Direction.NORTH, 'STRING_TIED_TO_TIN_CAN');
    expect(previewOn(sim, VILLAGE, 'can', DOOR)).toMatchObject({
      ok: true,
      actionGridNo: BESIDE_DOOR,
      apCost: AP.ATTACH_CAN + walkCostTo(sim.state, merc, BESIDE_DOOR),
    });
    expect(previewOn(sim, VILLAGE, 'can', OUTSIDE_DOOR + 3)).toMatchObject({ ok: false, refusal: 'noDoor' });
  });
});

describe('the gas can by a door (Handle_UI.cc DrawUIMovementPath, Handle_Items.cc HandleItem)', () => {
  it("shows a step onto the door tile that is the jeep's sweet spot, while the order from beside it does nothing: the cursor takes the door rules of the walk-up search, the order not (quirk)", () => {
    const sim = village();
    const t = sim.state;
    const jeep = addStubVehicle(t, { body: Body.JEEP, team: Team.CIV, gridNo: JEEP_BY_THE_DOOR, direction: Direction.WEST });
    Object.assign(jeep, { breathRed: 0, breath: 0 });
    const merc = holding(sim, INSIDE_BY_THE_DOOR, Direction.WEST, 'GAS_CAN');
    t.vehicleHooks = {
      ...PRIVATE_VEHICLE_LIST,
      boarding: { okUseVehicle: () => true, putSoldierInVehicle: () => null, exitVehicle: () => {}, setAssignmentRepair: () => {} },
    };
    expect(vehicleToolTarget(t, merc, JEEP_BY_THE_DOOR).gridNo).toBe(DOOR);
    expect(vehicleToolPreviewGridNo(t, merc, JEEP_BY_THE_DOOR)).toBe(DOOR);
    const events = order(sim, 'refuel', JEEP_BY_THE_DOOR);
    expect([merc.gridNo, jeep.breathRed, events.filter((e) => e.type === 'vehicleRefuelled')]).toEqual([INSIDE_BY_THE_DOOR, 0, []]);
  });
});
