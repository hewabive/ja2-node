import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { isVisibleTile } from '../../content/world/grid.ts';
import { Rng } from '../../core/rng.ts';
import {
  beginMapEdgepointSearch,
  calcMapEdgepointClassInsertionCode,
  chooseMapEdgepoints,
  EdgeInsertion,
  EdgeSide,
  endMapEdgepointSearch,
  generateMapEdgepoints,
  gridNoOnEdgeOfMap,
  SIDES,
  savedMapEdgepoints,
  searchForClosestPrimaryMapEdgepoint,
} from './edgepoints.ts';
import { TacticalSim } from './tactical-sim.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };

function sim(path = 'stubs/world/maps/a9.dat'): TacticalSim {
  return new TacticalSim(kit.world(path), kit.content, 1);
}

describe('map edgepoints', () => {
  it('are generated for every side with an entry point, outdoors, reachable and two rows deep', () => {
    const s = sim();
    const t = s.state;
    const e = generateMapEdgepoints(t, A9);
    for (const side of SIDES) {
      const list = e.primary[side];
      if (!list) throw new Error('missing side');
      expect(list.gridNos.length).toBeGreaterThan(10);
      expect(list.middle).toBeGreaterThan(0);
      expect(list.middle).toBeLessThan(list.gridNos.length);
      for (const g of list.gridNos) {
        expect(isVisibleTile(g)).toBe(true);
        expect(s.world.map.rooms[g]).toBe(0);
      }
      expect(e.secondary[side]?.gridNos).toEqual([]);
    }
    expect(e.primary[EdgeSide.NORTH]?.gridNos[0]).toBe(13286);
    expect(e.primary[EdgeSide.EAST]?.gridNos[0]).toBe(1043);
    expect(e.primary[EdgeSide.WEST]?.gridNos[0]).toBe(13286);
  });

  it('keeps only points with a reachable edge-of-map tile within five tiles', () => {
    const t = sim().state;
    const e = generateMapEdgepoints(t, A9);
    const g = e.primary[EdgeSide.EAST]?.gridNos[0] ?? -1;
    expect(gridNoOnEdgeOfMap(t, g) || gridNoOnEdgeOfMap(t, g - 159) || gridNoOnEdgeOfMap(t, g + 161)).toBe(true);
  });

  it('are not taken from maps without the saved flag or older than version 22', () => {
    const map = kit.world('stubs/world/maps/a9.dat').map;
    expect(savedMapEdgepoints(map)).toBeNull();
    const lists = [0, 1, 2, 3].map((k) => ({ middle: 1, gridNos: [k + 100, k + 200] }));
    const saved = { edgepoints: { primary: lists, secondary: lists }, info: { ...map.info, mapVersion: 22 } };
    expect(savedMapEdgepoints(saved)?.primary[EdgeSide.SOUTH]?.gridNos).toEqual([102, 202]);
    expect(savedMapEdgepoints({ ...saved, info: { ...map.info, mapVersion: 21 } })).toBeNull();
  });

  it('chooses points by selection sampling in list order and all of them when too few', () => {
    const t = sim().state;
    t.edgepoints = generateMapEdgepoints(t, A9);
    const all = t.edgepoints.primary[EdgeSide.WEST]?.gridNos ?? [];
    const picked = chooseMapEdgepoints(t, EdgeInsertion.WEST, 4, Rng.fromSeed(3));
    expect(picked).toHaveLength(4);
    expect(picked.map((g) => all.indexOf(g))).toEqual([...picked.map((g) => all.indexOf(g))].sort((a, b) => a - b));
    expect(chooseMapEdgepoints(t, EdgeInsertion.WEST, all.length + 5, Rng.fromSeed(3))).toEqual(all);
  });

  it('searches the closest free point in a square spiral and reserves it', () => {
    const t = sim().state;
    t.edgepoints = generateMapEdgepoints(t, A9);
    const list = t.edgepoints.primary[EdgeSide.NORTH]?.gridNos ?? [];
    const first = list[5] ?? -1;
    beginMapEdgepointSearch(t);
    expect(searchForClosestPrimaryMapEdgepoint(t, first, EdgeInsertion.NORTH, false)).toBe(first);
    const second = searchForClosestPrimaryMapEdgepoint(t, first, EdgeInsertion.NORTH, false);
    expect(second).not.toBe(first);
    expect(list).toContain(second);
    endMapEdgepointSearch(t);
    expect(t.edgepointReservations).toBeNull();
  });

  it('classifies every traversal as primary on maps without an isolated area', () => {
    const t = sim().state;
    t.edgepoints = generateMapEdgepoints(t, A9);
    expect(calcMapEdgepointClassInsertionCode(t, 12000, 2)).toBe(EdgeInsertion.PRIMARY_EDGEINDEX);
  });
});
