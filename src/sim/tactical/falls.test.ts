import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { animName } from './anim-states.ts';
import { AnimHeight, endHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath } from './movement.ts';
import { type Soldier, Team, Visible } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, itemsAt, Visibility } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const FALL_DIE = 5;
const TRYING_TO_FALL_DIE = 50;
const DRUNK_EFFECT = 40;
const MAX_TICKS = 2000;

interface Draw {
  readonly range: number;
  readonly value: number;
}

interface Walker {
  readonly sim: TacticalSim;
  readonly s: Soldier;
  readonly draws: Draw[];
  readonly fallRolls: number[];
}

function walker(options: { team?: number; others?: readonly number[] } = {}): Walker {
  const sim = newCombatSim(content);
  sim.state.inCombat = true;
  const s = spawnSoldier(sim, options.team === Team.ENEMY ? 20 : 0, options.team ?? Team.OUR, ORIGIN, Direction.EAST);
  for (const [k, at] of (options.others ?? []).entries()) spawnSoldier(sim, k + 1, Team.OUR, at, Direction.NORTH);
  const draws: Draw[] = [];
  const fallRolls: number[] = [];
  const rng = sim.state.rng as unknown as { int(n: number): number };
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    const value = n === FALL_DIE ? (fallRolls.shift() ?? 1) : real(n);
    draws.push({ range: n, value });
    return value;
  };
  return { sim, s, draws, fallRolls };
}

function drunk(w: Walker, effect = DRUNK_EFFECT): Walker {
  w.s.drugs.alcohol.effect = effect;
  return w;
}

function blinded(w: Walker): Walker {
  w.s.blindedCounter = 3;
  return w;
}

function go(w: Walker, to: number, mode: 'walk' | 'run' = 'walk'): SimEvent[] {
  expect(w.sim.dispatch({ type: 'move', soldier: w.s.id, to, mode }).ok).toBe(true);
  return runUntilIdle(w.sim);
}

function walkUntilFall(w: Walker, to: number): SimEvent[] {
  expect(w.sim.dispatch({ type: 'move', soldier: w.s.id, to, mode: 'walk' }).ok).toBe(true);
  return stepUntilFall(w);
}

function stepUntilFall(w: Walker): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < MAX_TICKS && !w.s.collapsed; tick++) {
    w.sim.step();
    events.push(...w.sim.drainEvents());
  }
  return events;
}

const ranges = (w: Walker) => w.draws.map((d) => d.range);
const fallRollsDrawn = (w: Walker) => ranges(w).filter((n) => n === FALL_DIE).length;
const fellDown = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'fellDown');

describe('falls on the way (Overhead.cc HandleGotoNewGridNo, after the gas check)', () => {
  it('trips a drunk walker at the tile he reached: CURSE1 and the message through fellDown, the forward fall, and Random(AP) + 1 APs lost', () => {
    const w = drunk(walker());
    w.fallRolls.push(0);
    expect(fellDown(walkUntilFall(w, ORIGIN + 3 * EAST))).toEqual([
      expect.objectContaining({ type: 'fellDown', soldier: 0, cause: 'drunk' }),
    ]);
    expect([w.s.gridNo, w.s.collapsed, animName(content, w.s.state)]).toEqual([ORIGIN + EAST, true, 'FALLFORWARD_FROMHIT_STAND']);
    const fall = ranges(w).indexOf(FALL_DIE);
    expect(ranges(w).slice(fall, fall + 2)).toEqual([FALL_DIE, TRYING_TO_FALL_DIE]);
    const lost = w.draws[fall + 2] as Draw;
    expect(w.s.actionPoints).toBe(lost.range - (lost.value + 1));
  });

  it('ends the move where he fell: he gets up there once the fall is over', () => {
    const w = drunk(walker());
    w.fallRolls.push(0);
    walkUntilFall(w, ORIGIN + 3 * EAST);
    runUntilIdle(w.sim);
    expect([w.s.gridNo, w.s.collapsed, endHeight(content, w.s.state)]).toEqual([ORIGIN + EAST, false, AnimHeight.CROUCH]);
  });

  it('rolls for neither fall on the first step of a move: a drunk merc rolls once a tile after the first, a borderline one never', () => {
    const w = drunk(walker());
    go(w, ORIGIN + 3 * EAST);
    expect(w.s.gridNo).toBe(ORIGIN + 3 * EAST);
    expect(fallRollsDrawn(w)).toBe(2);
    const borderline = drunk(walker(), DRUNK_EFFECT - 1);
    go(borderline, ORIGIN + 3 * EAST);
    expect(fallRollsDrawn(borderline)).toBe(0);
  });

  it('trips a blinded merc only while he runs', () => {
    const walking = blinded(walker());
    go(walking, ORIGIN + 3 * EAST);
    expect(fallRollsDrawn(walking)).toBe(0);
    const running = blinded(walker());
    running.fallRolls.push(0);
    expect(fellDown(go(running, ORIGIN + 3 * EAST, 'run'))).toEqual([expect.objectContaining({ soldier: 0, cause: 'blind' })]);
    expect(running.s.gridNo).toBe(ORIGIN + EAST);
  });

  it('takes the blind fall first and rolls the drunk die only after a blind roll that missed', () => {
    const blindFall = drunk(blinded(walker()));
    blindFall.fallRolls.push(0);
    expect(fellDown(go(blindFall, ORIGIN + 3 * EAST, 'run'))).toEqual([expect.objectContaining({ cause: 'blind' })]);
    const drunkFall = drunk(blinded(walker()));
    drunkFall.fallRolls.push(1, 0);
    expect(fellDown(go(drunkFall, ORIGIN + 3 * EAST, 'run'))).toEqual([expect.objectContaining({ cause: 'drunk' })]);
    const rollsBeforeTheFall = (w: Walker) => ranges(w).slice(ranges(w).indexOf(FALL_DIE), ranges(w).indexOf(TRYING_TO_FALL_DIE) + 1);
    expect(rollsBeforeTheFall(blindFall)).toEqual([FALL_DIE, TRYING_TO_FALL_DIE]);
    expect(rollsBeforeTheFall(drunkFall)).toEqual([FALL_DIE, FALL_DIE, TRYING_TO_FALL_DIE]);
  });

  it('trips a drunk merc in any stance: swatting he falls from his crouch, crawling he only lies down again', () => {
    const swatting = drunk(walker());
    swatting.fallRolls.push(0);
    expect(swatting.sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN + 3 * EAST, mode: 'swat' }).ok).toBe(true);
    expect(fellDown(stepUntilFall(swatting))).toEqual([expect.objectContaining({ cause: 'drunk' })]);
    expect(animName(content, swatting.s.state)).toBe('FALLFORWARD_FROMHIT_CROUCH');
    const crawling = drunk(walker());
    crawling.fallRolls.push(0);
    expect(crawling.sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN + 3 * EAST, mode: 'crawl' }).ok).toBe(true);
    expect(fellDown(stepUntilFall(crawling))).toEqual([expect.objectContaining({ cause: 'drunk' })]);
    expect(animName(content, crawling.s.state)).toBe('PRONE_LAY_FROMHIT');
  });

  it('tests for room to fall after the roll, on the tile he faces, not the next of his path: a merc there where the path turns keeps him up', () => {
    const turning = (others: readonly number[]) => {
      const w = drunk(walker({ others }));
      w.fallRolls.push(0);
      expect(w.sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN + EAST + 2 * SOUTH, mode: 'walk' }).ok).toBe(true);
      expect(w.s.path.slice(0, w.s.pathSize)).toEqual([Direction.SOUTHEAST, Direction.SOUTH]);
      return { w, events: runUntilIdle(w.sim) };
    };
    expect(fellDown(turning([]).events)).toHaveLength(1);
    const kept = turning([ORIGIN + 2 * (EAST + SOUTH)]);
    expect(fellDown(kept.events)).toEqual([]);
    expect(kept.w.s.gridNo).toBe(ORIGIN + EAST + 2 * SOUTH);
    expect(fallRollsDrawn(kept.w)).toBe(1);
  });

  it("tells the trip of an unseen enemy by his team's default or his name, with his curse's voice and no id, tile or cause (D16)", () => {
    const trip = (prepare: (s: Soldier) => void) => {
      const w = drunk(walker({ team: Team.ENEMY }));
      prepare(w.s);
      w.fallRolls.push(0);
      getNewSoldierPath(w.sim.state, w.s, ORIGIN + 3 * EAST, states(content.animations).WALKING);
      const events = stepUntilFall(w);
      expect([w.s.collapsed, w.s.visible]).toEqual([true, Visible.HIDDEN]);
      return fellDown(events);
    };
    const curse = { voice: expect.any(String), bodyType: 0 };
    expect(trip((s) => Object.assign(s, { name: '' }))).toEqual([
      { type: 'fellDown', tick: expect.any(Number), defaultName: 'enemy', unseen: curse },
    ]);
    expect(trip(() => {})).toEqual([{ type: 'fellDown', tick: expect.any(Number), name: 'S20', unseen: curse }]);
    expect(trip((s) => Object.assign(s, { muted: true }))).toEqual([{ type: 'fellDown', tick: expect.any(Number), name: 'S20' }]);
  });
});

const slipped = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'slippedOnMarbles');

function marblesAt(w: Walker, g: number, visibility: number = Visibility.VISIBLE, level = 0): void {
  const marbles = content.items.byName.get('MARBLES')?.index ?? 0;
  addItemToPool(w.sim.state, g, createItem(content.items, marbles, 100), visibility, level);
}

function floorAt(w: Walker, ...tiles: number[]): void {
  for (const g of tiles) w.sim.state.world.terrain[g] = Terrain.FLAT_FLOOR;
}

const marblesLeft = (w: Walker, g: number) =>
  itemsAt(w.sim.state, g, 0).filter((wi) => wi.object.item === content.items.byName.get('MARBLES')?.index).length;

describe('marbles on the way (Overhead.cc HandleGotoNewGridNo, before the falls)', () => {
  it('slips a merc on marbles on a floor tile he reached: slippedOnMarbles, the marbles gone, the collapse and Random(AP) + 1 APs lost, no fall die rolled', () => {
    const w = drunk(walker());
    floorAt(w, ORIGIN + EAST);
    marblesAt(w, ORIGIN + EAST);
    expect(slipped(walkUntilFall(w, ORIGIN + 3 * EAST))).toEqual([expect.objectContaining({ type: 'slippedOnMarbles', soldier: 0 })]);
    expect([w.s.gridNo, w.s.collapsed, animName(content, w.s.state)]).toEqual([ORIGIN + EAST, true, 'FALLFORWARD_FROMHIT_STAND']);
    expect(marblesLeft(w, ORIGIN + EAST)).toBe(0);
    expect(fallRollsDrawn(w)).toBe(0);
    const lost = w.draws[ranges(w).indexOf(TRYING_TO_FALL_DIE) + 1] as Draw;
    expect(w.s.actionPoints).toBe(lost.range - (lost.value + 1));
  });

  it('slips on hidden marbles too: the pool is searched whatever the items are shown', () => {
    const w = walker();
    floorAt(w, ORIGIN + EAST);
    marblesAt(w, ORIGIN + EAST, Visibility.HIDDEN_ITEM);
    expect(slipped(walkUntilFall(w, ORIGIN + 3 * EAST))).toHaveLength(1);
    expect(w.s.gridNo).toBe(ORIGIN + EAST);
  });

  it('slips only from the second step of a move and on a floor or a road: never on the marbles he sets out from, never on grass', () => {
    const fromTheMarbles = walker();
    floorAt(fromTheMarbles, ORIGIN);
    marblesAt(fromTheMarbles, ORIGIN);
    go(fromTheMarbles, ORIGIN + 3 * EAST);
    expect([fromTheMarbles.s.gridNo, marblesLeft(fromTheMarbles, ORIGIN)]).toEqual([ORIGIN + 3 * EAST, 1]);
    const onGrass = walker();
    marblesAt(onGrass, ORIGIN + EAST);
    expect(slipped(go(onGrass, ORIGIN + 3 * EAST))).toEqual([]);
    expect(onGrass.s.gridNo).toBe(ORIGIN + 3 * EAST);
    const onRoad = walker();
    onRoad.sim.state.world.terrain[ORIGIN + EAST] = Terrain.PAVED_ROAD;
    marblesAt(onRoad, ORIGIN + EAST);
    expect(slipped(go(onRoad, ORIGIN + 3 * EAST))).toHaveLength(1);
  });

  it('tells the slip of an unseen enemy by his name, with his curse and no id or tile (D16)', () => {
    const w = walker({ team: Team.ENEMY });
    floorAt(w, ORIGIN + EAST);
    marblesAt(w, ORIGIN + EAST);
    getNewSoldierPath(w.sim.state, w.s, ORIGIN + 3 * EAST, states(content.animations).WALKING);
    const events = stepUntilFall(w);
    expect([w.s.collapsed, w.s.visible, marblesLeft(w, ORIGIN + EAST)]).toEqual([true, Visible.HIDDEN, 0]);
    expect(slipped(events)).toEqual([
      { type: 'slippedOnMarbles', tick: expect.any(Number), name: 'S20', unseen: { voice: expect.any(String), bodyType: 0 } },
    ]);
  });
});
