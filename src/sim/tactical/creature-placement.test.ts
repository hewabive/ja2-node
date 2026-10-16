import { describe, expect, it } from 'vitest';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { type CreatureCounts, placeBloodcatsFromInitList, placeCreaturesFromInitList, type SoldierInitNode } from './init-list.ts';
import { Body, SoldierClass, Team } from './soldier.ts';

function node(index: number, team: number, bodyType: number, priority = false): SoldierInitNode {
  return {
    index,
    team,
    soldierClass: team === Team.CREATURE ? SoldierClass.CREATURE : SoldierClass.NONE,
    priorityExistence: priority,
    detailed: false,
    hasSoldier: false,
    soldierId: -1,
    basic: {
      startingGridNo: 1000 + index,
      relativeAttributeLevel: 2,
      relativeEquipmentLevel: 2,
      direction: 0,
      orders: 0,
      attitude: 0,
      bodyType,
      patrolGrid: [],
      patrolCount: 0,
      onRoof: false,
      civilianGroup: 0,
      hasKeys: false,
    },
    detail: null,
  };
}

const counts = (o: Partial<CreatureCounts>): CreatureCounts => ({
  larvae: 0,
  infants: 0,
  youngMales: 0,
  youngFemales: 0,
  adultMales: 0,
  adultFemales: 0,
  ...o,
});

function placer(placed: number[]) {
  return (n: SoldierInitNode) => {
    placed.push(n.index);
    n.hasSoldier = true;
    return true;
  };
}

describe('AddSoldierInitListCreatures (docs/16 §5.13)', () => {
  it('places the queen first, then priority nodes of matching bodies, then random free creature slots', () => {
    const list = [
      node(0, Team.CREATURE, Body.QUEENMONSTER, true),
      node(1, Team.CREATURE, Body.AM_MONSTER, true),
      node(2, Team.CREATURE, Body.LARVAE_MONSTER, true),
      node(3, Team.CREATURE, -1),
      node(4, Team.CIV, -1),
      node(5, Team.CREATURE, -1),
      node(6, Team.CREATURE, -1),
    ];
    const placed: number[] = [];
    const rolls = new ScriptedStream([0, 1, 1, 0, 0]);
    placeCreaturesFromInitList(list, true, counts({ adultMales: 1, infants: 2 }), rolls, placer(placed));
    expect(placed).toEqual([0, 1, 2, 5]);
    expect(rolls.requested).toEqual([4, 2, 3, 2, 1]);
    expect(list.map((n) => n.basic.bodyType)).toEqual([
      Body.QUEENMONSTER,
      Body.AM_MONSTER,
      Body.INFANT_MONSTER,
      -1,
      -1,
      Body.INFANT_MONSTER,
      -1,
    ]);
  });

  it('stops at the first placement that fails', () => {
    const list = [node(0, Team.CREATURE, -1), node(1, Team.CREATURE, -1)];
    const offered: number[] = [];
    placeCreaturesFromInitList(list, false, counts({ youngFemales: 2 }), new ScriptedStream([0, 0]), (n) => {
      offered.push(n.index);
      return false;
    });
    expect(offered).toEqual([0]);
  });
});

describe('AddSoldierInitListBloodcats (docs/16 §5.13)', () => {
  it('recounts the placements of a sector without spawns and waits for the next visit when they changed', () => {
    const list = [node(0, Team.CREATURE, Body.BLOODCAT), node(1, Team.CREATURE, Body.BLOODCAT)];
    const sector = { bloodCats: 5, bloodCatPlacements: 7 };
    placeBloodcatsFromInitList(list, sector, false, new ScriptedStream([]), placer([]));
    expect(sector).toEqual({ bloodCats: -1, bloodCatPlacements: 2 });
  });

  it('fills priority bloodcat nodes first and samples the basic ones for the rest', () => {
    const list = [
      node(0, Team.CREATURE, Body.BLOODCAT),
      node(1, Team.CREATURE, Body.BLOODCAT, true),
      node(2, Team.CREATURE, Body.BLOODCAT),
      node(3, Team.CREATURE, Body.BLOODCAT),
    ];
    const placed: number[] = [];
    const rolls = new ScriptedStream([0]);
    const sorted = placeBloodcatsFromInitList(list, { bloodCats: 2, bloodCatPlacements: 4 }, false, rolls, placer(placed));
    expect(placed).toEqual([1, 0]);
    expect(rolls.requested).toEqual([3]);
    expect(sorted.map((n) => n.index)).toEqual([1, 0, 2, 3]);
  });
});
