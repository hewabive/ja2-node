import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { loadTacticalWorld, type TacticalWorld } from '../../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { TacticalContent } from '../content.ts';
import { LightSpriteFlags, lightTrueLevel } from '../lighting/lighting.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { revealRoofsAndItems } from './fov.ts';

const LAIR_LAMP = gridNo(55, 110);
const BELOW_THE_LAMP = gridNo(55, 107);
const REBEL_BASEMENT_POST = 8562;

describe.skipIf(!ORIGINAL_DATA_DIR)('the fog of war on original underground maps', () => {
  let data: DataVfs;
  let content: TacticalContent;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    content = await loadTacticalContent(read);
  });
  afterAll(async () => {
    await data.close();
  });

  function look(world: TacticalWorld, at: number, direction: number): TacticalSim {
    const sim = new TacticalSim(world, content, 1);
    revealRoofsAndItems(sim.state, spawnSoldier(sim, 0, Team.OUR, at, direction), true);
    return sim;
  }

  it('switches on the lamp of the D13 creature lair a merc sees, and no other, from ambient 11 to 5 at its tile', async () => {
    const world = await loadTacticalWorld(read, 'maps/d13_b1.dat');
    const sim = look(world, BELOW_THE_LAMP, Direction.SOUTH);
    const lamps = (world.map.lights?.sprites ?? []).map((l) => gridNo(l.x, l.y));
    const lit = sim.state.lighting.sprites.flatMap((l, slot) => (l && l.flags & LightSpriteFlags.ON ? [lamps[slot]] : []));
    expect(lamps).toHaveLength(49);
    expect(lit).toEqual([LAIR_LAMP]);
    expect(lightTrueLevel(sim.state, LAIR_LAMP, 0)).toBe(5);
  });

  it('reveals nothing under the roof of the A10 rebel basement, where the surface rule would reveal 21 tiles', async () => {
    const world = await loadTacticalWorld(read, 'maps/a10_b1.dat');
    const revealed = (w: TacticalWorld) => look(w, REBEL_BASEMENT_POST, Direction.NORTH).state.fog.revealed.filter((f) => f !== 0).length;
    expect(revealed(world)).toBe(0);
    expect(revealed({ ...world, map: { ...world.map, ambient: null } })).toBe(21);
  });
});
