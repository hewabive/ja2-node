import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction } from '../../content/world/grid.ts';
import { states } from './animation.ts';
import { Insertion } from './insertion.ts';
import { setSoldierPosition } from './movement.ts';
import {
  absoluteScreenXY,
  adjustSoldierPathToGoOffEdge,
  checkMercsWaiting,
  ExitDirection,
  gridNoOnVisibleWorldTile,
  mapPosFromAbsoluteScreenXY,
  mirrorGridNo,
  pickGridNoNearestEdge,
  pickGridNoToWalkIn,
  renderBounds,
  setActionToDoOnceMercsGetToLocation,
  soldierOKForSectorExit,
} from './sector-exit.ts';
import { createSoldier, type Soldier, Team } from './soldier.ts';
import { registerSoldier, WaitForMercs } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function merc(sim: TacticalSim, gridNo: number, id = 0): Soldier {
  const t = sim.state;
  const palettes = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
  const s = createSoldier({
    id,
    team: Team.OUR,
    name: 'M',
    bodyType: 0,
    palettes,
    stats: STATS,
    life: 80,
    gridNo: -1,
    direction: 0,
    state: states(t.content.animations).STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, gridNo);
  return s;
}

describe('screen-space exit thresholds', () => {
  it('match the render bounds of the default and the basement maps', () => {
    expect(renderBounds(0)).toEqual({ leftX: -1580, topY: 860, rightX: 1600, bottomY: 2400 });
    expect(renderBounds(1)).toEqual({ leftX: -640, topY: 1330, rightX: 640, bottomY: 1920 });
  });

  it('allow an east exit only within 160 screen pixels of the edge', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const near = merc(sim, 75 * 160 + 147);
    expect(absoluteScreenXY(sim.state, near.gridNo).x).toBe(3020);
    expect(soldierOKForSectorExit(sim.state, near, ExitDirection.EAST, 0)).toBe(true);
    const far = merc(sim, 75 * 160 + 146, 1);
    expect(soldierOKForSectorExit(sim.state, far, ExitDirection.EAST, 0)).toBe(false);
    expect(soldierOKForSectorExit(sim.state, near, ExitDirection.WEST, 0)).toBe(false);
  });

  it('use the smaller visible area of a basement', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a10_b1.dat'), kit.content, 1);
    expect(gridNoOnVisibleWorldTile(sim.state, 80 * 160 + 80)).toBe(true);
    expect(gridNoOnVisibleWorldTile(sim.state, 80 * 160 + 112)).toBe(false);
    const a9 = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    expect(gridNoOnVisibleWorldTile(a9.state, 80 * 160 + 112)).toBe(true);
  });

  it('maps screen positions back to grid numbers', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const g = 70 * 160 + 90;
    const { x, y } = absoluteScreenXY(sim.state, g);
    expect(mapPosFromAbsoluteScreenXY(sim.state, x, y)).toBe(g);
  });
});

describe('walking off and on', () => {
  it('picks the last reachable tile toward the edge and mirrors the position to the far side', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const s = merc(sim, 75 * 160 + 140);
    const edge = pickGridNoNearestEdge(sim.state, s, Direction.EAST);
    expect(gridNoOnVisibleWorldTile(sim.state, edge)).toBe(true);
    expect(absoluteScreenXY(sim.state, edge).x).toBeGreaterThan(3020);
    const mirror = mirrorGridNo(sim.state, s, Direction.EAST);
    expect(absoluteScreenXY(sim.state, mirror).x).toBeLessThanOrEqual(4);
    const walkIn = pickGridNoToWalkIn(sim.state, s, Insertion.WEST);
    expect(walkIn.attempts).toBe(1);
    expect(absoluteScreenXY(sim.state, walkIn.gridNo).x).toBeLessThan(80);
  });

  it('adds two steps beyond the edge to the path', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const s = merc(sim, 75 * 160 + 150);
    s.pathSize = 0;
    adjustSoldierPathToGoOffEdge(s, s.gridNo, Direction.EAST);
    expect(s.path.slice(0, 2)).toEqual([Direction.NORTHEAST, Direction.NORTHEAST]);
    expect(s.finalDestination).toBe(s.gridNo - 2 * 159);
  });

  it('releases the wait after 2500 ms even if nobody arrived', () => {
    const sim = new TacticalSim(kit.world('stubs/world/maps/a9.dat'), kit.content, 1);
    const t = sim.state;
    let over = -1;
    t.sectorHooks = { ...t.sectorHooks, mercsWaitOver: (_t, code) => (over = code) };
    setActionToDoOnceMercsGetToLocation(t, WaitForMercs.WALKOFF_SCREEN, 2);
    expect(t.perception.disallowSight).toBe(true);
    t.clockMs += 2500;
    checkMercsWaiting(t);
    expect(over).toBe(-1);
    t.clockMs += 5;
    checkMercsWaiting(t);
    expect(over).toBe(WaitForMercs.WALKOFF_SCREEN);
    expect(t.perception.disallowSight).toBe(false);
    expect(t.mercsWaiting).toBeNull();
  });
});
