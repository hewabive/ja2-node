import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { objectOf } from '../../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { tileIndexFromTypeSubIndex, typeIndex } from '../../../content/world/tile-tables.ts';
import type { SimEvent } from '../../events.ts';
import { tacticalViewParts } from '../../knowledge/sim-view.ts';
import { anim } from '../anim-states.ts';
import { applyMapChanges, objectLayerAt, sectorTempFileChanges } from '../map-changes.ts';
import { exitGridAt } from '../sector-exit.ts';
import { Body, TEAM_FIRST_ID, Team, Visible } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../world-items.ts';
import { tileChangeViews } from '../world-view.ts';
import { Detonator, ItemAction, setActionValue, setDetonator } from './bomb-object.ts';
import { handleExplosionQueue, setOffBombsInGridNo } from './bomb-queue.ts';

const A9 = 'stubs/world/maps/a9.dat';
const A10 = 'stubs/world/maps/a10.dat';
const A10_BASEMENT = { x: 10, y: 1, z: 1 };
const A10_EXIT_GRID = gridNo(72, 71);
const A9_SECTOR = { x: 9, y: 1, z: 0 };
const A9_BASEMENT = { x: 9, y: 1, z: 1 };
const PIT = gridNo(100, 100);
const FALL_TICKS = 2_000;
const MERC = 0;
const SECOND_MERC = 1;
const ENEMY = TEAM_FIRST_ID[Team.ENEMY] ?? 0;
const CIVILIAN = TEAM_FIRST_ID[Team.CIV] ?? 0;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function a9(): TacticalSim {
  const sim = new TacticalSim(kit.world(A9), kit.content, 5);
  sim.state.sector = A9_SECTOR;
  return sim;
}

function placePit(t: TacticalState, centre: number, action: number): void {
  const o = objectOf(t, 'ACTION_ITEM');
  setDetonator(o, Detonator.PRESSURE);
  setActionValue(o, action);
  if (!addItemToPool(t, centre, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB)) throw new Error('cannot place the pit');
}

function stepOnPit(sim: TacticalSim, centre: number): void {
  const t = sim.state;
  const merc = t.soldiers[MERC];
  if (!merc) throw new Error('no merc');
  setOffBombsInGridNo(t, merc, centre, false, 0);
  handleExplosionQueue(t);
}

function pitTexture(t: TacticalState, subIndex: number): number {
  const tables = t.world.tables;
  if (!tables) throw new Error('no tile tables');
  return tileIndexFromTypeSubIndex(tables, typeIndex(tables, 'REGWATERTEXTURE'), subIndex);
}

const SMALL_PIT_OFFSETS = [159, -1, -161, 160, 0, -160, 161, 1, -159];
const LARGE_PIT_OFFSETS = [
  318, 158, -2, -162, -322, 319, 159, -1, -161, -321, 320, 160, 0, -160, -320, 321, 161, 1, -159, -319, 322, 162, 2, -158, -318,
];

function tilesOf(centre: number, offsets: readonly number[]): number[] {
  return offsets.map((offset) => centre + offset);
}

function lastObjectAt(t: TacticalState, g: number): number | undefined {
  return objectLayerAt(t, g).at(-1);
}

function runUntilFallen(sim: TacticalSim, ids: readonly number[]): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < FALL_TICKS && ids.some((id) => sim.state.soldiers[id]?.placed); tick++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('the pit action items (Explosion_Control.cc PerformItemAction, Pits.cc Add3X3Pit, Add5X5Pit)', () => {
  it('opens a small pit: the nine pit textures at the tail of the tiles in the order of Add3X3Pit, and exit grids down to the pit centre below', () => {
    const sim = a9();
    const t = sim.state;
    spawnSoldier(sim, MERC, Team.OUR, PIT - 2 * WORLD_COLS, Direction.SOUTH);
    placePit(t, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    const tiles = tilesOf(PIT, SMALL_PIT_OFFSETS);
    expect(tiles.map((g) => lastObjectAt(t, g))).toEqual(tiles.map((_, k) => pitTexture(t, 1 + k)));
    for (const g of tiles) expect(exitGridAt(t, g)).toEqual({ gridNo: PIT, sector: A9_BASEMENT });
    expect(tiles.every((g) => t.world.costs.get(g, Direction.NORTH, 0) === TravelCost.EXITGRID)).toBe(true);
    expect(t.world.costs.get(PIT + 2, Direction.NORTH, 0)).not.toBe(TravelCost.EXITGRID);
    expect(
      tileChangeViews(t)
        .filter((c) => c.kind === 'appendObject')
        .map((c) => c.gridNo),
    ).toEqual(tiles);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'pitOpened', gridNo: PIT }));
  });

  it('shows its exit grids in the view at once, where the cursor and the hints find them as AddExitGridToWorld puts them into the world', () => {
    const sim = a9();
    spawnSoldier(sim, MERC, Team.OUR, PIT - 2 * WORLD_COLS, Direction.SOUTH);
    expect(tacticalViewParts(sim).addedExitGrids).toEqual([]);
    placePit(sim.state, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    const shown = tilesOf(PIT, SMALL_PIT_OFFSETS).map((g) => ({ gridNo: g, sector: 'A9-1' }));
    expect(tacticalViewParts(sim).addedExitGrids).toEqual(shown);
    const entered = a9();
    applyMapChanges(entered.state, sectorTempFileChanges(sim.state.mapChanges));
    expect(tacticalViewParts(entered).addedExitGrids).toEqual(shown);
  });

  it('opens a large pit with the textures 10 to 34 in the order of Add5X5Pit', () => {
    const sim = a9();
    const t = sim.state;
    spawnSoldier(sim, MERC, Team.OUR, PIT - 3 * WORLD_COLS, Direction.SOUTH);
    placePit(t, PIT, ItemAction.LARGE_PIT);
    stepOnPit(sim, PIT);
    const tiles = tilesOf(PIT, LARGE_PIT_OFFSETS);
    expect(tiles.map((g) => lastObjectAt(t, g))).toEqual(tiles.map((_, k) => pitTexture(t, 10 + k)));
    for (const g of tiles) expect(exitGridAt(t, g)).toEqual({ gridNo: PIT, sector: A9_BASEMENT });
  });

  it('drops every soldier on the ground within the radius into the pit, whatever his team, leaves the ones beyond it and tells only the falls the squad sees', () => {
    const sim = a9();
    const t = sim.state;
    const merc = spawnSoldier(sim, MERC, Team.OUR, PIT, Direction.SOUTH);
    const seen = spawnSoldier(sim, ENEMY, Team.ENEMY, PIT + WORLD_COLS + 1, Direction.NORTH);
    const unseen = spawnSoldier(sim, ENEMY + 1, Team.ENEMY, PIT - WORLD_COLS - 1, Direction.SOUTH);
    const outside = spawnSoldier(sim, SECOND_MERC, Team.OUR, PIT + 2, Direction.WEST);
    seen.visible = Visible.SEEN;
    unseen.visible = Visible.HIDDEN;
    placePit(t, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    const fall = anim(t.content, 'FALL_INTO_PIT');
    expect([merc.state, seen.state, unseen.state, outside.state === fall]).toEqual([fall, fall, fall, false]);
    expect([merc.pendingActionData4, seen.pendingActionData4]).toEqual([PIT, PIT + WORLD_COLS + 1]);
    const events = runUntilFallen(sim, [MERC, seen.id, unseen.id]);
    expect(events.filter((e) => e.type === 'fellIntoPit')).toEqual([
      expect.objectContaining({ soldier: MERC, gridNo: PIT }),
      expect.objectContaining({ soldier: seen.id, gridNo: PIT + WORLD_COLS + 1 }),
    ]);
    expect([merc.placed, seen.placed, unseen.placed, outside.placed]).toEqual([false, false, false, true]);
    expect(mercs(t).map((s) => s.id)).toEqual([SECOND_MERC]);
    expect([merc.insertionData, merc.heightAdjustment, seen.insertionData]).toEqual([PIT, 0, PIT]);
  });

  it('sinks the soldier while he falls and hands the selection to the next merc when he is gone', () => {
    const sim = a9();
    const t = sim.state;
    const merc = spawnSoldier(sim, MERC, Team.OUR, PIT, Direction.SOUTH);
    const next = spawnSoldier(sim, SECOND_MERC, Team.OUR, PIT + 4, Direction.WEST);
    t.turn.selected = MERC;
    placePit(t, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    let lowest = 0;
    for (let tick = 0; tick < FALL_TICKS && merc.placed; tick++) {
      sim.step();
      lowest = Math.min(lowest, merc.heightAdjustment);
    }
    expect(lowest).toBeLessThan(0);
    expect(t.turn.selected).toBe(next.id);
  });

  it('lets a civilian whose body has no fall animation stand on the opened pit', () => {
    const sim = a9();
    const t = sim.state;
    const civilian = spawnSoldier(sim, CIVILIAN, Team.CIV, PIT - 1, Direction.EAST, { body: Body.MANCIV });
    spawnSoldier(sim, MERC, Team.OUR, PIT - 3 * WORLD_COLS, Direction.SOUTH);
    const standing = civilian.state;
    placePit(t, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    expect([civilian.state, civilian.placed, civilian.pendingActionData4]).toEqual([standing, true, PIT - 1]);
  });

  it('opens again at every step on its centre: the item stays armed, and a second set of textures goes on the tiles', () => {
    const sim = a9();
    const t = sim.state;
    spawnSoldier(sim, MERC, Team.OUR, PIT - 2 * WORLD_COLS, Direction.SOUTH);
    placePit(t, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    stepOnPit(sim, PIT);
    expect(objectLayerAt(t, PIT).filter((tile) => tile === pitTexture(t, 5))).toHaveLength(2);
  });

  it('replaces the exit grid the map holds under it, as AddExitGridToWorld overwrites it', () => {
    const sim = new TacticalSim(kit.world(A10), kit.content, 5);
    const t = sim.state;
    t.sector = { x: 10, y: 1, z: 0 };
    const centre = A10_EXIT_GRID + 1;
    spawnSoldier(sim, MERC, Team.OUR, centre - 3 * WORLD_COLS, Direction.SOUTH);
    expect(exitGridAt(t, A10_EXIT_GRID)?.gridNo).not.toBe(centre);
    placePit(t, centre, ItemAction.SMALL_PIT);
    stepOnPit(sim, centre);
    expect(exitGridAt(t, A10_EXIT_GRID)).toEqual({ gridNo: centre, sector: A10_BASEMENT });
    expect(tacticalViewParts(sim).addedExitGrids?.filter((e) => e.gridNo === A10_EXIT_GRID)).toEqual([
      { gridNo: A10_EXIT_GRID, sector: 'A10-1' },
    ]);
  });

  it('loses its textures at the next entry but keeps its exit grids: AddObjectToTail writes nothing to the temp file', () => {
    const sim = a9();
    const left = sim.state;
    spawnSoldier(sim, MERC, Team.OUR, PIT - 2 * WORLD_COLS, Direction.SOUTH);
    placePit(left, PIT, ItemAction.SMALL_PIT);
    stepOnPit(sim, PIT);
    const entered = a9().state;
    applyMapChanges(entered, sectorTempFileChanges(left.mapChanges));
    expect(objectLayerAt(entered, PIT)).not.toContain(pitTexture(entered, 5));
    expect(exitGridAt(entered, PIT - 1)).toEqual({ gridNo: PIT, sector: A9_BASEMENT });
    expect(entered.world.costs.get(PIT, Direction.NORTH, 0)).toBe(TravelCost.EXITGRID);
  });
});
