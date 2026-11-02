import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { anim, animName } from './anim-states.ts';
import { adjustNoAPToFinishMove, initNewSoldierAnim, states } from './animation.ts';
import { internalReduceAttackBusyCount } from './combat/barrier.ts';
import { type Corpse, handleSoldierDeath } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { crowOpcode, crowsFlyAway, handleRottingCorpses } from './crows.ts';
import { handleNextTile } from './movement.ts';
import { makeNoise, NoiseKind } from './perception/noise.ts';
import { Opp } from './perception/opp.ts';
import { setSoldierHeight } from './roofs.ts';
import { addRottingCorpse, handleCrowLeave, ROTTING_STAGE2, removeRottingCorpse } from './rotting-corpses.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import { type TacticalState, teamMembers } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { handleTacticalEndTurn } from './turns/turns.ts';

const NO_PRESENTATION = { frames: new Int16Array(0), sounds: new Uint16Array(0) };

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CORPSE_AT = gridNo(80, 80);
const NOON = 12 * 3600;
const NIGHT = 22 * 3600;
const POSSIBLE = 5;
const SLOT_PICK = 1;
const STAT_RANGE = 50;
const EXP_RANGE = 4;
const ATTITUDES = 6;
const LANDING_SPAN = 5;
const FLIGHT_SPAN = 11;
const FLIGHT_HEIGHT = 100;
const RANDOMIZED_STATS = [STAT_RANGE, STAT_RANGE, STAT_RANGE, EXP_RANGE, ...Array(7).fill(STAT_RANGE), ATTITUDES];
const BUDGET_TICKS = 20_000;
const SETTLE_TICKS = 4000;
const STAMP_HOLD_SECONDS = 1200;
const ADJUST_TO_TARGET_HEIGHT = 466;
const BATTLE_SOUNDS = 3;
const STANDING_FRAMES = 10;

function recordDraws(t: TacticalState): number[] {
  const ranges: number[] = [];
  const rng = t.rng as unknown as { int(n: number): number };
  const int = rng.int.bind(rng);
  rng.int = (n: number) => {
    ranges.push(n);
    return int(n);
  };
  return ranges;
}

function corpse(at: number, type = ROTTING_STAGE2, bodyType: number = Body.REGMALE): Corpse {
  return {
    gridNo: at,
    level: 0,
    bodyType,
    direction: Direction.NORTH,
    state: 0,
    profile: 200,
    type,
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows: 0,
  };
}

function sector(seconds = NOON): { sim: TacticalSim; t: TacticalState; world: { seconds: number } } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const world = { seconds };
  t.worldClock = world;
  t.crows.possible = POSSIBLE;
  return { sim, t, world };
}

function withCorpse(seconds = NOON, rotting = corpse(CORPSE_AT)): { sim: TacticalSim; t: TacticalState; world: { seconds: number } } {
  const s = sector(seconds);
  addRottingCorpse(s.t, rotting, { nowMinute: 0, loadingSave: true });
  return s;
}

const crows = (t: TacticalState) => teamMembers(t, Team.CIV).filter((s) => s.bodyType === Body.CROW);
const within = (g: number, center: number, apothem: number) =>
  Math.abs((g % WORLD_COLS) - (center % WORLD_COLS)) <= apothem &&
  Math.abs(Math.trunc(g / WORLD_COLS) - Math.trunc(center / WORLD_COLS)) <= apothem;

function flock(): { sim: TacticalSim; t: TacticalState; birds: Soldier[] } {
  const { sim, t } = withCorpse();
  handleRottingCorpses(t);
  return { sim, t, birds: crows(t) };
}

function settledFlock(): { sim: TacticalSim; t: TacticalState; birds: Soldier[] } {
  const settled = flock();
  settled.t.crows.possible = settled.birds.length;
  for (let tick = 0; tick < SETTLE_TICKS; tick++) settled.sim.step();
  return settled;
}

function indexOfRun(draws: readonly number[], run: readonly number[], from: number): number {
  for (let i = from; i + run.length <= draws.length; i++) if (run.every((n, k) => draws[i + k] === n)) return i;
  return -1;
}

describe('HandleRottingCorpses (Rotting_Corpses.cc)', () => {
  it('lands two crows by day on the ground around a rotting corpse, eating, with the original draws in order', () => {
    const { t } = withCorpse();
    const draws = recordDraws(t);
    handleRottingCorpses(t);
    const birds = crows(t);
    expect(birds.map((s) => s.id)).toEqual([TEAM_FIRST_ID[Team.CIV], (TEAM_FIRST_ID[Team.CIV] ?? 0) + 1]);
    for (const bird of birds) {
      expect(within(bird.gridNo, CORPSE_AT, 2)).toBe(true);
      expect(bird).toMatchObject({ level: 0, neutral: true, monsterOrAnimal: true, targetHeightAdjustment: 0 });
      expect(animName(content, bird.state)).toBe('CROW_EAT');
    }
    expect(draws.slice(0, 1 + RANDOMIZED_STATS.length)).toEqual([SLOT_PICK, ...RANDOMIZED_STATS]);
    const firstLanding = indexOfRun(draws, [BATTLE_SOUNDS, STANDING_FRAMES, LANDING_SPAN, LANDING_SPAN], 1);
    const secondCrow = indexOfRun(draws, RANDOMIZED_STATS, firstLanding);
    expect(firstLanding).toBeGreaterThan(RANDOMIZED_STATS.length);
    expect(secondCrow).toBeGreaterThan(firstLanding);
    expect(indexOfRun(draws, [BATTLE_SOUNDS, STANDING_FRAMES, LANDING_SPAN, LANDING_SPAN], secondCrow)).toBeGreaterThan(secondCrow);
  });

  it('sends none by night or underground, and draws nothing there', () => {
    const night = withCorpse(NIGHT);
    const nightDraws = recordDraws(night.t);
    handleRottingCorpses(night.t);
    const below = withCorpse();
    below.t.sector = { x: 9, y: 10, z: 1 };
    const belowDraws = recordDraws(below.t);
    handleRottingCorpses(below.t);
    expect([crows(night.t), nightDraws, crows(below.t), belowDraws]).toEqual([[], [], [], []]);
  });

  it('draws the corpse but sends none to a fresh corpse, a wreck or a corpse inside a room', () => {
    const fresh = withCorpse(NOON, corpse(CORPSE_AT, 1));
    const wreck = withCorpse(NOON, corpse(CORPSE_AT, ROTTING_STAGE2, Body.JEEP));
    const indoors = withCorpse();
    indoors.t.world.level.rooms[CORPSE_AT] = 1;
    for (const { t } of [fresh, wreck, indoors]) {
      const draws = recordDraws(t);
      handleRottingCorpses(t);
      expect([crows(t), draws]).toEqual([[], [SLOT_PICK]]);
    }
  });

  it('waits while creatures are in the sector, before the corpse draw', () => {
    const { sim, t } = withCorpse();
    spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE] ?? 0, Team.CREATURE, gridNo(60, 60), Direction.NORTH);
    const draws = recordDraws(t);
    handleRottingCorpses(t);
    expect([crows(t), draws]).toEqual([[], []]);
  });

  it('stops at the possible count until the flock is gone, then sends crows again', () => {
    const { sim, t } = withCorpse();
    t.crows.possible = 2;
    handleRottingCorpses(t);
    expect(crows(t)).toHaveLength(2);
    handleRottingCorpses(t);
    expect(t.crows.dontAddNew).toBe(true);
    for (const bird of crows(t)) bird.life = 0;
    t.crows.possible = POSSIBLE;
    const draws = recordDraws(t);
    handleRottingCorpses(t);
    expect([t.crows.dontAddNew, draws[0]]).toEqual([false, SLOT_PICK]);
    expect(sim.state.soldiers.filter((s) => s?.placed && s.bodyType === Body.CROW && s.life > 0)).toHaveLength(2);
  });

  it('counts the slot a corpse too old to lie took in the draw, so the pick can land on no corpse', () => {
    const { t } = sector();
    for (const at of [CORPSE_AT, CORPSE_AT + 6, CORPSE_AT + 12]) addRottingCorpse(t, corpse(at, 1), { nowMinute: 0, loadingSave: true });
    addRottingCorpse(t, corpse(CORPSE_AT + 18, 1), { nowMinute: 5000, loadingSave: false });
    const draws = recordDraws(t);
    handleRottingCorpses(t);
    expect(draws).toEqual([4]);
  });

  it('runs at a real-time turn whenever the world clock moved, through the UINT32 stamp that holds it 1200 s past a later stamp', () => {
    const { t, world } = withCorpse();
    t.crows.possible = 9;
    const clock = t.realtimeClock;
    const draws = recordDraws(t);
    handleTacticalEndTurn(t, clock);
    const first = draws.length;
    handleTacticalEndTurn(t, clock);
    expect(draws.length).toBe(first);
    world.seconds += 1;
    handleTacticalEndTurn(t, clock);
    expect(draws[first]).toBe(SLOT_PICK);
    expect(clock.lastRottingCorpsesSeconds).toBe(world.seconds);
    const held = draws.length;
    clock.lastRottingCorpsesSeconds = world.seconds + STAMP_HOLD_SECONDS;
    handleTacticalEndTurn(t, clock);
    expect(draws.length).toBe(held);
    clock.lastRottingCorpsesSeconds = world.seconds + STAMP_HOLD_SECONDS + 1;
    handleTacticalEndTurn(t, clock);
    expect(draws[held]).toBe(SLOT_PICK);
  });
});

describe('crows flying away (OppList.cc HearNoise, Soldier_Control.cc CrowsFlyAway)', () => {
  it('sends the whole flock up at a noise one crow hears, drawing again for every crow that hears it before they take off', () => {
    const { t, birds } = flock();
    const draws = recordDraws(t);
    makeNoise(t, null, gridNo(84, 70), 0, 20, NoiseKind.EXPLOSION);
    const flights = t.gameEvents.filter((e) => e.kind === 'getNewPath');
    expect(flights.map((e) => e.soldier)).toEqual([...birds, ...birds].map((s) => s.id));
    expect(draws.filter((n) => n === FLIGHT_SPAN).length).toBeGreaterThanOrEqual(8);
    expect(birds.map((s) => s.targetHeightAdjustment)).toEqual([FLIGHT_HEIGHT, FLIGHT_HEIGHT]);
  });

  it('leaves out a crow already flying', () => {
    const { sim, t, birds } = flock();
    crowsFlyAway(t, Team.CIV);
    sim.step();
    expect(birds.map((s) => animName(content, s.state))).toEqual(['CROW_FLY', 'CROW_FLY']);
    t.gameEvents.length = 0;
    crowsFlyAway(t, Team.CIV);
    expect(t.gameEvents).toEqual([]);
  });

  it('climbs two pixels per code 466 to 100, counting as on the roof level once off the ground, then leaves the map', () => {
    const { sim, t, birds } = settledFlock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    crowsFlyAway(t, Team.CIV);
    const heights = new Set<number>();
    for (let tick = 0; tick < BUDGET_TICKS && bird.placed; tick++) {
      sim.step();
      if (bird.placed) heights.add(Math.trunc(bird.heightAdjustment));
      if (bird.placed && bird.heightAdjustment > 0) expect(bird.level).toBe(1);
    }
    expect(bird.placed).toBe(false);
    expect(t.mercSlots.includes(bird)).toBe(false);
    expect(t.occupant.some((layer) => layer.includes(bird.id))).toBe(false);
    expect(bird.structure).toBeNull();
    expect([...heights].sort((a, b) => a - b)).toEqual([...Array.from({ length: 49 }, (_, i) => i * 2), FLIGHT_HEIGHT]);
  });

  it('shows the flight height of a crow in the view, from two pixels up to 100, and none on the ground', () => {
    const { sim, t, birds } = settledFlock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    const shown = () => sim.snapshot(NO_PRESENTATION).find((s) => s.id === bird.id);
    expect(shown()?.heightAdjustment).toBeUndefined();
    crowsFlyAway(t, Team.CIV);
    const heights = new Set<number>();
    for (let tick = 0; tick < BUDGET_TICKS && bird.placed; tick++) {
      sim.step();
      const height = shown()?.heightAdjustment;
      if (height !== undefined) heights.add(height);
    }
    expect([...heights].sort((a, b) => a - b)).toEqual([...Array.from({ length: 48 }, (_, i) => (i + 1) * 2), FLIGHT_HEIGHT]);
  });

  it('takes a crow reaching 100 off the map in the middle of its path, leaving nothing of it behind', () => {
    const { sim, t, birds } = settledFlock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    bird.targetHeightAdjustment = FLIGHT_HEIGHT;
    bird.uiMovementMode = anim(content, 'CROW_FLY');
    const far = bird.gridNo + 6 * WORLD_COLS;
    t.gameEvents.push({ kind: 'getNewPath', soldier: bird.id, destination: far, mode: bird.uiMovementMode });
    for (let tick = 0; tick < BUDGET_TICKS && t.mercSlots.includes(bird); tick++) sim.step();
    expect(bird.gridNo).not.toBe(far);
    expect([bird.placed, t.mercSlots.includes(bird), t.occupant.some((layer) => layer.includes(bird.id))]).toEqual([false, false, false]);
  });

  it('keeps flying a crow that arrives in the air and climbs on until it leaves', () => {
    const { sim, t, birds } = settledFlock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    bird.targetHeightAdjustment = FLIGHT_HEIGHT;
    bird.uiMovementMode = anim(content, 'CROW_FLY');
    t.gameEvents.push({ kind: 'getNewPath', soldier: bird.id, destination: bird.gridNo + 1, mode: bird.uiMovementMode });
    let arrivedAt: number | null = null;
    for (let tick = 0; tick < BUDGET_TICKS && bird.placed; tick++) {
      sim.step();
      if (arrivedAt === null && bird.gridNo === bird.finalDestination && bird.pathSize === 0) arrivedAt = Math.trunc(bird.heightAdjustment);
      if (bird.placed) expect(animName(content, bird.state)).toBe('CROW_FLY');
    }
    expect(arrivedAt).toBeGreaterThan(0);
    expect(arrivedAt).toBeLessThan(FLIGHT_HEIGHT);
    expect(bird.placed).toBe(false);
  });

  it('brings a crow aiming for the ground down two pixels per code 466, judged on the truncated height, and lets it eat on landing', () => {
    const { t, birds } = flock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    bird.state = anim(content, 'CROW_FLY');
    setSoldierHeight(t, bird, 9.5);
    const heights: number[] = [];
    for (let code = 0; code < 6 && animName(content, bird.state) === 'CROW_FLY'; code++) {
      crowOpcode(t, bird, ADJUST_TO_TARGET_HEIGHT);
      heights.push(bird.heightAdjustment);
    }
    expect(heights).toEqual([7.5, 5.5, 3.5, 0, 0]);
    expect([animName(content, bird.state), bird.level]).toEqual(['CROW_EAT', 0]);
  });

  it('puts an eating crow on the ground and never holds a crow for want of action points', () => {
    const { t, birds } = flock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    bird.state = anim(content, 'CROW_FLY');
    setSoldierHeight(t, bird, 40);
    initNewSoldierAnim(t, bird, states(content.animations).STANDING, 0, true);
    adjustNoAPToFinishMove(bird, true);
    expect([animName(content, bird.state), bird.heightAdjustment, bird.level, bird.noAPToFinishMove]).toEqual(['CROW_EAT', 0, 0, false]);
  });

  it('lets a flying crow through a tile someone stands on (Soldier_Tile.cc HandleNextTile)', () => {
    const { sim, t, birds } = flock();
    const [bird] = birds;
    if (!bird) throw new Error('no crow');
    const next = bird.gridNo + 1;
    spawnSoldier(sim, 0, Team.OUR, next, Direction.WEST);
    const passes = (state: string) => {
      bird.state = anim(content, state);
      return handleNextTile(t, bird, Direction.EAST, next, next + 3);
    };
    expect([passes('CROW_FLY'), passes('CROW_WALK')]).toEqual([true, false]);
  });

  it('sends up the crows that see whoever attacked a crow, without starting combat', () => {
    const { sim, t, birds } = flock();
    const [seen, blind] = birds;
    if (!seen || !blind) throw new Error('no flock');
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(70, 80), Direction.EAST, { gun: 'NOTHING' });
    seen.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    blind.oppList[merc.id] = Opp.NOT_HEARD_OR_SEEN;
    merc.attackNoticed = true;
    merc.target = blind;
    t.turn.attackBusyCount = 1;
    internalReduceAttackBusyCount(t, merc, false, blind);
    expect(t.gameEvents.filter((e) => e.kind === 'getNewPath').map((e) => e.soldier)).toEqual([seen.id]);
    expect(t.inCombat).toBe(false);
  });
});

describe('the crows feeding on a corpse (Rotting_Corpses.cc AddCrowToCorpse, HandleCrowLeave)', () => {
  const servicing = (t: TacticalState) => t.corpses.map((c) => c.servicingCrows);

  function pickSlot(t: TacticalState, slot: number): void {
    const rng = t.rng as unknown as { int(n: number): number };
    const int = rng.int.bind(rng);
    rng.int = (n: number) => {
      rng.int = int;
      expect(slot).toBeLessThan(n);
      return slot;
    };
  }

  it('links each crow to the slot and tile of its corpse and counts it there', () => {
    const { t } = sector();
    addRottingCorpse(t, corpse(CORPSE_AT - 6, 1), { nowMinute: 0, loadingSave: true });
    addRottingCorpse(t, corpse(CORPSE_AT), { nowMinute: 0, loadingSave: true });
    const [fresh] = t.corpses;
    if (!fresh) throw new Error('no corpse');
    removeRottingCorpse(t, fresh, structureBase(t, fresh.gridNo));
    pickSlot(t, 1);
    handleRottingCorpses(t);
    expect(crows(t).map((s) => [s.pendingActionData1, s.pendingActionData2])).toEqual([
      [1, CORPSE_AT],
      [1, CORPSE_AT],
    ]);
    expect(servicing(t)).toEqual([2]);
  });

  it('takes a crow off the count when it flies off the map and when it dies', () => {
    const { sim, t, birds } = settledFlock();
    const [flier, victim] = birds;
    if (!flier || !victim) throw new Error('no flock');
    flier.targetHeightAdjustment = FLIGHT_HEIGHT;
    flier.uiMovementMode = anim(content, 'CROW_FLY');
    t.gameEvents.push({ kind: 'getNewPath', soldier: flier.id, destination: flier.gridNo + 1, mode: flier.uiMovementMode });
    for (let tick = 0; tick < BUDGET_TICKS && flier.placed; tick++) sim.step();
    expect([flier.placed, servicing(t)]).toEqual([false, [1]]);
    victim.life = 0;
    handleSoldierDeath(t, victim);
    expect([victim.placed, servicing(t)]).toEqual([false, [0]]);
  });

  it('never counts below 0, and leaves alone a corpse that took the slot of its own on another tile', () => {
    const { t, birds } = flock();
    const [first, second] = birds;
    if (!first || !second) throw new Error('no flock');
    handleCrowLeave(t, first);
    handleCrowLeave(t, first);
    handleCrowLeave(t, second);
    expect(servicing(t)).toEqual([0]);
    const [eaten] = t.corpses;
    if (!eaten) throw new Error('no corpse');
    removeRottingCorpse(t, eaten, structureBase(t, CORPSE_AT));
    addRottingCorpse(t, { ...corpse(CORPSE_AT + 6), servicingCrows: 1 }, { nowMinute: 0, loadingSave: true });
    handleCrowLeave(t, first);
    expect(servicing(t)).toEqual([1]);
  });
});

function structureBase(t: TacticalState, at: number): StructureInstance {
  const found = t.world.structures.find(at, StructureFlags.CORPSE);
  if (!found) throw new Error('no corpse structure');
  return t.world.structures.findBase(found) ?? found;
}
