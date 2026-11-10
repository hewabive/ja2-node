import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knowledgeOf, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { objectOf } from '../../../tests/support/explosives.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import type { CommandResult } from '../command.ts';
import { answerHint } from '../hints/answer.ts';
import type { PreviewAction } from '../hints/preview-action.ts';
import type { PreviewMove } from '../hints/preview-move.ts';
import { openPit, SMALL_PIT } from '../tactical/bombs/pits.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { isDoorOpenAt, swapStructureForPartner } from '../tactical/doors.ts';
import { explosiveDamageGridNo } from '../tactical/explosions/structure-damage.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { findBestPath } from '../tactical/pathfinding.ts';
import { calcActionPoints } from '../tactical/points.ts';
import { exitGridAt } from '../tactical/sector-exit.ts';
import { Body, Personality, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { type KnowledgeRules, knowledgeRules, knowledgeWorld } from './knowledge-world.ts';
import { knowledgeViewOf } from './sim-view.ts';
import type { KnowledgeStrategic, KnowledgeView } from './view.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const MERC_ID = 0;
const CREATURE_ID = 30;

function phobicMerc(sim: TacticalSim, trait: number): Soldier {
  const merc = spawnSoldier(sim, MERC_ID, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  merc.personalityTrait = trait;
  return merc;
}

function projectedTurnAPs(sim: TacticalSim, strategic?: Partial<KnowledgeStrategic>): number {
  const tactical = knowledgeOf(sim, strategic ? { strategic: strategic as KnowledgeStrategic } : {}).tactical;
  const merc = tactical?.ownSoldier(MERC_ID);
  if (!tactical || !merc) throw new Error('no projected merc');
  return calcActionPoints(tactical.state, merc);
}

describe('the tactical projection of the hints', () => {
  it("takes the loaded sector from the strategic view, so a claustrophobe's turn APs match the server's underground", () => {
    const sim = newCombatSim(content);
    sim.state.sector = { x: 9, y: 1, z: 1 };
    const merc = phobicMerc(sim, Personality.CLAUSTROPHOBIC);
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: sim.state.soldiers }, merc));
    expect(projectedTurnAPs(sim, { worldSector: 'A9-1' })).toBe(server);
  });

  it("takes an own merc's seen opponents from the view, so an insect-phobic merc's turn APs match the server's", () => {
    const sim = newCombatSim(content);
    const merc = phobicMerc(sim, Personality.FEAR_OF_INSECTS);
    spawnCreature(sim, CREATURE_ID, Body.YAM_MONSTER, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: [] }, merc));
    expect(projectedTurnAPs(sim)).toBe(server);
  });
});

describe("the view's structure changes in the projection of the hints", () => {
  const VILLAGE = 'stubs/world/maps/village.dat';
  const FENCE = gridNo(108, 74);
  const BESIDE_FENCE = gridNo(108, 73);
  const PAST_THE_FENCE = gridNo(108, 75);
  const WALL = gridNo(123, 72);
  const SOUTH_OF_THE_WALL = gridNo(123, 74);
  const NORTH_OF_THE_WALL = gridNo(123, 71);
  const DOOR = 11429;
  const CUTTER = 0;
  const WALKER = 1;
  const WOUND = 200;
  const BLAST_CENTRE = 0;
  const NO_MULTI_FLAG = -1;

  let kit: StubSectorKit;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  function village(): TacticalSim {
    const sim = new TacticalSim(kit.world(VILLAGE), kit.content, 5);
    const cutter = spawnSoldier(sim, CUTTER, Team.OUR, BESIDE_FENCE, Direction.SOUTH);
    cutter.inv[InvSlot.HAND] = objectOf(sim.state, 'WIRECUTTERS');
    spawnSoldier(sim, WALKER, Team.OUR, SOUTH_OF_THE_WALL, Direction.NORTH);
    return sim;
  }

  function rulesOverVillage(): KnowledgeRules {
    return knowledgeRules(kit.content, { world: () => kit.world(VILLAGE) });
  }

  function hint(sim: TacticalSim, rules: KnowledgeRules, type: string, cmd: Readonly<Record<string, unknown>>): CommandResult {
    return answerHint(knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }), { type, ...cmd });
  }

  function cutterHint(sim: TacticalSim, rules: KnowledgeRules): PreviewAction {
    return hint(sim, rules, 'previewAction', { soldier: CUTTER, kind: 'cutFence', gridNo: FENCE }).data as PreviewAction;
  }

  function walk(sim: TacticalSim, rules: KnowledgeRules, soldier: number, to: number): number[] {
    return (hint(sim, rules, 'previewMove', { soldier, to }).data as PreviewMove).steps.map((step) => step.gridNo);
  }

  function blast(sim: TacticalSim, g: number): void {
    explosiveDamageGridNo(sim.state, g, WOUND, BLAST_CENTRE, false, NO_MULTI_FLAG, null, 0, { gridNos: new Set() });
  }

  it('sees a cut fence: the wire cutter hint refuses noFence and the walk goes through, in the projection that saw the fence and in a fresh one', () => {
    const sim = village();
    const rules = rulesOverVillage();
    expect(cutterHint(sim, rules)).toMatchObject({ ok: true });
    expect(walk(sim, rules, CUTTER, PAST_THE_FENCE)).not.toContain(FENCE);
    expect(sim.dispatch({ type: 'cutFence', soldier: CUTTER, gridNo: FENCE })).toEqual({ ok: true });
    runUntilIdle(sim);
    for (const seen of [rules, rulesOverVillage()]) {
      expect(cutterHint(sim, seen)).toMatchObject({ ok: false, refusal: 'noFence' });
      expect(walk(sim, seen, CUTTER, PAST_THE_FENCE)).toContain(FENCE);
    }
  });

  it('sees a blown wall: the walk goes through the gap', () => {
    const sim = village();
    const rules = rulesOverVillage();
    expect(walk(sim, rules, WALKER, NORTH_OF_THE_WALL)).not.toContain(WALL);
    blast(sim, WALL);
    expect(sim.state.world.structures.find(WALL, StructureFlags.WALL)).toBeNull();
    for (const seen of [rules, rulesOverVillage()]) expect(walk(sim, seen, WALKER, NORTH_OF_THE_WALL)).toContain(WALL);
  });

  it('takes out a door blown while the view showed it open, whose removal names the door as the map placed it', () => {
    const sim = village();
    const rules = rulesOverVillage();
    const door = sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR);
    if (!door) throw new Error('no stub door');
    swapStructureForPartner(sim.state, door);
    const opened = knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }).tactical;
    expect(opened && isDoorOpenAt(opened.state, DOOR)).toBe(true);
    blast(sim, DOOR);
    expect(sim.state.world.structures.find(DOOR, StructureFlags.ANYDOOR)).toBeNull();
    const blown = knowledgeWorld(knowledgeViewOf(sim), rules, { strict: true }).tactical;
    expect(blown?.state.world.structures.find(DOOR, StructureFlags.ANYDOOR)).toBeNull();
  });

  it("starts a fresh projection when the view's structure changes do not extend those it replayed, as at a new entry to the sector", () => {
    const cut = village();
    const rules = rulesOverVillage();
    expect(cut.dispatch({ type: 'cutFence', soldier: CUTTER, gridNo: FENCE })).toEqual({ ok: true });
    runUntilIdle(cut);
    expect(cutterHint(cut, rules)).toMatchObject({ ok: false, refusal: 'noFence' });
    expect(cutterHint(village(), rules)).toMatchObject({ ok: true });
  });
});

describe("the view's added exit grids in the projection of the hints", () => {
  const A9 = 'stubs/world/maps/a9.dat';
  const A10 = 'stubs/world/maps/a10.dat';
  const A9_SECTOR = { x: 9, y: 1, z: 0 };
  const PIT = gridNo(100, 100);
  const WEST_OF_THE_PIT = PIT - 3;
  const EAST_OF_THE_PIT = PIT + 3;
  const MAP_EXIT_GRID = gridNo(72, 71);
  const OPEN_GROUND = gridNo(100, 100);
  const A10_BASEMENT = { x: 10, y: 1, z: 1 };
  const WALKER = 0;

  let kit: StubSectorKit;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  function rulesOver(mapPath: string): KnowledgeRules {
    return knowledgeRules(kit.content, { world: () => kit.world(mapPath) });
  }

  function projected(view: KnowledgeView, rules: KnowledgeRules): TacticalState {
    const tactical = knowledgeWorld(view, rules, { strict: true }).tactical;
    if (!tactical) throw new Error('no projection');
    return tactical.state;
  }

  it("walks around an opened pit's exit grids as the order does", () => {
    const sim = new TacticalSim(kit.world(A9), kit.content, 5);
    sim.state.sector = A9_SECTOR;
    const merc = spawnSoldier(sim, WALKER, Team.OUR, WEST_OF_THE_PIT, Direction.EAST);
    openPit(sim.state, PIT, SMALL_PIT);
    const preview = answerHint(knowledgeWorld(knowledgeViewOf(sim), rulesOver(A9), { strict: true }), {
      type: 'previewMove',
      soldier: WALKER,
      to: EAST_OF_THE_PIT,
    }).data as PreviewMove;
    const order = findBestPath(sim.state.pathEnv, merc, EAST_OF_THE_PIT, merc.level).steps;
    const tilesOf = (steps: readonly number[]) =>
      steps.map((_, k) => steps.slice(0, k + 1).reduce((g, d) => g + (DIRECTION_INCREMENT[d] ?? 0), merc.gridNo));
    expect(tilesOf(order)).not.toContain(PIT);
    expect(preview.steps.map((step) => step.gridNo)).toEqual(tilesOf(order).slice(0, -1));
  });

  it("puts an added exit grid over the map's own on its tile and gives the map's back to a view without it", () => {
    const sim = new TacticalSim(kit.world(A10), kit.content, 5);
    const rules = rulesOver(A10);
    const plain = knowledgeViewOf(sim);
    const mapExit = exitGridAt(sim.state, MAP_EXIT_GRID);
    if (!mapExit) throw new Error('no exit grid on the stub map');
    const added = {
      ...plain,
      addedExitGrids: [
        { gridNo: MAP_EXIT_GRID, sector: 'A10-1' },
        { gridNo: OPEN_GROUND, sector: 'A10-1' },
      ],
    };
    const opened = projected(added, rules);
    expect(exitGridAt(opened, MAP_EXIT_GRID)?.sector).toEqual(A10_BASEMENT);
    expect(exitGridAt(opened, OPEN_GROUND)?.sector).toEqual(A10_BASEMENT);
    expect(opened.world.costs.get(OPEN_GROUND, Direction.NORTH, 0)).toBe(TravelCost.EXITGRID);
    const closed = projected(plain, rules);
    expect(exitGridAt(closed, MAP_EXIT_GRID)?.sector).toEqual(mapExit.sector);
    expect(exitGridAt(closed, OPEN_GROUND)).toBeNull();
    expect(closed.world.costs.get(OPEN_GROUND, Direction.NORTH, 0)).toBe(sim.state.world.costs.get(OPEN_GROUND, Direction.NORTH, 0));
  });
});
