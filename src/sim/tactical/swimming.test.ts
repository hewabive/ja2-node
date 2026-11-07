import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { SkillTrait, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const MAX_TICKS = 4000;
const SOAK_DIE = 100;

function lake(sim: TacticalSim, deep: readonly number[], shallow: readonly number[] = []): void {
  for (const g of deep) sim.state.world.terrain[g] = Terrain.DEEP_WATER;
  for (const g of shallow) sim.state.world.terrain[g] = Terrain.LOW_WATER;
}

interface Swim {
  readonly states: string[];
  readonly tiles: number[];
}

function walkTo(sim: TacticalSim, s: Soldier, to: number, mode = 'walk'): Swim {
  expect(sim.dispatch({ type: 'move', soldier: s.id, to, mode }).ok).toBe(true);
  const states: string[] = [];
  const tiles: number[] = [];
  for (let tick = 0; tick < MAX_TICKS && !sim.isIdle(); tick++) {
    sim.step();
    const state = animName(content, s.state);
    if (states.at(-1) !== state) states.push(state);
    if (tiles.at(-1) !== s.gridNo) tiles.push(s.gridNo);
  }
  return { states, tiles };
}

const STRAIGHT_LAKE = [2, 3, 4].map((k) => ORIGIN + k * EAST);
const SHORES = [ORIGIN + EAST, ORIGIN + 5 * EAST];

describe('swimming (Soldier_Control.cc SetSoldierGridNo, EVENT_InternalGetNewSoldierPath, SoldierGotoStationaryStance)', () => {
  it('goes under walking into deep water, swims on, treads where he stops, and comes up into his walk on the way out', () => {
    const sim = newCombatSim(content);
    lake(sim, STRAIGHT_LAKE, SHORES);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const into = walkTo(sim, s, ORIGIN + 3 * EAST);
    expect(into.states).toEqual(['WALKING', 'LOW_TO_DEEP_WATER', 'DEEP_WATER_SWIM', 'DEEP_WATER_TRED']);
    expect(s.gridNo).toBe(ORIGIN + 3 * EAST);
    const out = walkTo(sim, s, ORIGIN + 6 * EAST);
    expect(out.states).toEqual(['DEEP_WATER_SWIM', 'DEEP_TO_LOW_WATER', 'WALKING', 'STANDING']);
  });

  it('stands a crawler or a swatter up at the step into water and walks him on in (Soldier_Tile.cc HandleNextTile)', () => {
    const wadeIn = (mode: string) => {
      const sim = newCombatSim(content);
      lake(sim, [], [ORIGIN + 2 * EAST, ORIGIN + 3 * EAST]);
      const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
      const wade = walkTo(sim, s, ORIGIN + 3 * EAST, mode);
      return [wade.states.slice(wade.states.indexOf(mode === 'crawl' ? 'CRAWLING' : 'SWATTING')), s.gridNo];
    };
    expect(wadeIn('crawl')).toEqual([['CRAWLING', 'PRONE_UP', 'KNEEL_UP', 'WALKING', 'STANDING'], ORIGIN + 3 * EAST]);
    expect(wadeIn('swat')).toEqual([['SWATTING', 'KNEEL_UP', 'WALKING', 'STANDING'], ORIGIN + 3 * EAST]);
  });

  it('takes the step he went under on again from the tile he entered: going under on a diagonal he swims a tile off his path, then plans again', () => {
    const sim = newCombatSim(content);
    lake(
      sim,
      [2, 3, 4].flatMap((k) => [0, 1, 2].map((south) => ORIGIN + k * EAST + south * SOUTH)),
      [ORIGIN + EAST + SOUTH],
    );
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTHEAST);
    const swim = walkTo(sim, s, ORIGIN + 3 * EAST + 2 * SOUTH);
    const overshot = ORIGIN + 3 * (EAST + SOUTH);
    expect(swim.tiles.slice(0, 4)).toEqual([ORIGIN, ORIGIN + EAST + SOUTH, ORIGIN + 2 * (EAST + SOUTH), overshot]);
    expect(swim.states.slice(0, 4)).toEqual(['WALKING', 'LOW_TO_DEEP_WATER', 'DEEP_WATER_SWIM', 'DEEP_TO_LOW_WATER']);
    expect(s.gridNo).toBe(ORIGIN + 3 * EAST + 2 * SOUTH);
  });
});

describe('water damage (Items.cc WaterDamage)', () => {
  function bather(): { sim: TacticalSim; s: Soldier; pre: ScriptedStream } {
    const sim = newCombatSim(content);
    lake(sim, [ORIGIN + EAST]);
    sim.state.world.terrain[ORIGIN + 2 * EAST] = Terrain.MED_WATER;
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const pre = new ScriptedStream([], SOAK_DIE - 1);
    Object.assign(sim.state, { pre });
    return { sim, s, pre };
  }

  it('rolls PreRandom(100) for every item water damages on each deep tile: below 10 the item loses 10 less the roll, down to 1', () => {
    const { sim, s, pre } = bather();
    s.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 5);
    s.inv[InvSlot.SECOND_HAND] = createItem(content.items, content.items.byName.get('BERETTA_92F')?.index ?? 0, 80);
    s.inv[InvSlot.HELMET] = createItem(content.items, content.items.byName.get('STEEL_HELMET')?.index ?? 0, 90);
    pre.push(3, 2);
    setSoldierPosition(sim.state, s, ORIGIN + EAST);
    expect(pre.requested).toEqual([SOAK_DIE, SOAK_DIE]);
    expect([s.inv[InvSlot.HAND]?.status[0], s.inv[InvSlot.SECOND_HAND]?.status[0], s.inv[InvSlot.HELMET]?.status[0]]).toEqual([1, 72, 90]);
    setSoldierPosition(sim.state, s, ORIGIN + 2 * EAST);
    expect(pre.requested).toHaveLength(2);
  });

  it('washes camouflage off, 2 a deep tile and 1 a medium one, telling the player when it is gone, but not off a camouflaged merc', () => {
    const { sim, s } = bather();
    s.camo = 3;
    setSoldierPosition(sim.state, s, ORIGIN + EAST);
    expect(s.camo).toBe(1);
    expect(sim.drainEvents().filter((e: SimEvent) => e.type === 'camoWashedOff')).toEqual([]);
    setSoldierPosition(sim.state, s, ORIGIN + 2 * EAST);
    expect(s.camo).toBe(0);
    expect(sim.drainEvents().filter((e: SimEvent) => e.type === 'camoWashedOff')).toEqual([expect.objectContaining({ soldier: 0 })]);
    const skilled = bather();
    skilled.s.skillTrait1 = SkillTrait.CAMOUFLAGED;
    skilled.s.camo = 3;
    setSoldierPosition(skilled.sim.state, skilled.s, ORIGIN + EAST);
    expect(skilled.s.camo).toBe(3);
  });

  it("rinses our merc's creature smell off on Random(10) == 0 in deep water and Random(20) == 0 in medium", () => {
    const { sim, s } = bather();
    s.monsterSmell = 2;
    const rng = sim.state.rng as unknown as { int(n: number): number };
    const ranges: number[] = [];
    rng.int = (n: number) => {
      ranges.push(n);
      return 0;
    };
    setSoldierPosition(sim.state, s, ORIGIN + EAST);
    setSoldierPosition(sim.state, s, ORIGIN + 2 * EAST);
    expect([ranges, s.monsterSmell]).toEqual([[10, 20], 0]);
  });
});
