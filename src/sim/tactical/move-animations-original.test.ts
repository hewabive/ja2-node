import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { anim, animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { loadTacticalContent } from './load-content.ts';
import { handleGotoNewGridNo } from './movement.ts';
import { executeOverhead } from './overhead.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const WEST = DIRECTION_INCREMENT[Direction.WEST] ?? 0;
const NORTH = DIRECTION_INCREMENT[Direction.NORTH] ?? 0;
const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const MAX_TICKS = 5_000;
const RAISED = 1;
const CORRIDOR_HALF_LENGTH = 4;

describe.skipIf(!ORIGINAL_DATA_DIR)('move animations with the original scripts and structures', () => {
  let data: DataVfs;
  let content: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    content = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  function statesPlayed(sim: TacticalSim, s: Soldier): string[] {
    const played = [animName(content, s.state)];
    for (let tick = 0; tick < MAX_TICKS && !sim.isIdle(); tick++) {
      sim.step();
      const name = animName(content, s.state);
      if (played.at(-1) !== name) played.push(name);
    }
    return played;
  }

  it('kneels a big merc with a rifle through BIGMERC_CROUCH_TRANS_INTO to CROUCHING and back through BIGMERC_CROUCH_TRANS_OUTOF', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { body: Body.BIGMALE, gun: 'M14' });
    sim.state.inCombat = true;
    expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'crouch' }).ok).toBe(true);
    expect(statesPlayed(sim, merc)).toEqual(['BIGMERC_CROUCH_TRANS_INTO', 'CROUCHING']);
    expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'stand' }).ok).toBe(true);
    expect(statesPlayed(sim, merc)).toEqual(['BIGMERC_CROUCH_TRANS_OUTOF', 'STANDING']);
  });

  it('walks, swats and side-steps a reverse move to its end in the backward states', () => {
    const moves: [number, number, string, string, string][] = [
      [Direction.EAST, ORIGIN - 3 * EAST, 'walk', 'stand', 'WALK_BACKWARDS'],
      [Direction.EAST, ORIGIN - 3 * EAST, 'swat', 'crouch', 'SWAT_BACKWARDS'],
      [Direction.NORTH, ORIGIN + 3 * EAST, 'walk', 'stand', 'SIDE_STEP'],
    ];
    for (const [facing, to, mode, stance, backwards] of moves) {
      const sim = newCombatSim(content);
      const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, facing);
      sim.state.inCombat = true;
      if (stance !== 'stand') {
        sim.dispatch({ type: 'stance', soldier: 0, stance });
        runUntilIdle(sim);
      }
      expect(sim.dispatch({ type: 'move', soldier: 0, to, mode, reverse: true }).ok).toBe(true);
      expect(statesPlayed(sim, s)).toContain(backwards);
      expect([s.gridNo, s.direction]).toEqual([to, facing]);
    }
  });

  it('steps an adult monster that cannot turn in a corridor backwards in MONSTER_WALK_BACKWARDS to its destination', () => {
    const corridor = Array.from({ length: 2 * CORRIDOR_HALF_LENGTH + 1 }, (_, k) => ORIGIN + (k - CORRIDOR_HALF_LENGTH) * EAST);
    const walls = corridor.flatMap((g) => [g + NORTH, g + SOUTH]);
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      for (const g of walls) world.level.heights[g] = RAISED;
    });
    const t = sim.state;
    const monster = spawnSoldier(sim, 0, Team.CREATURE, ORIGIN, Direction.EAST, { body: Body.AM_MONSTER });
    expect(monster.multiTile).toBe(true);
    monster.state = anim(content, 'ADULTMONSTER_WALKING');
    monster.path = [Direction.WEST, Direction.WEST];
    monster.pathIndex = 0;
    monster.pathSize = monster.path.length;
    monster.finalDestination = ORIGIN + 2 * WEST;
    expect(handleGotoNewGridNo(t, monster, false, monster.state).ok).toBe(true);
    const walked = new Set<string>();
    for (let pass = 0; pass < MAX_TICKS && monster.gridNo !== monster.finalDestination; pass++) {
      executeOverhead(t);
      walked.add(`${animName(content, monster.state)} facing ${monster.direction}`);
    }
    expect(monster.gridNo).toBe(ORIGIN + 2 * WEST);
    expect([...walked]).toEqual([`MONSTER_WALK_BACKWARDS facing ${Direction.EAST}`]);
  });
});
