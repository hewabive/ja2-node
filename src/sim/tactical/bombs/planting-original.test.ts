import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Team } from '../soldier.ts';
import { worldBombItems } from './world-bombs.ts';

const ORIGIN = gridNo(80, 80);
const MAX_TICKS = 2_000;

describe.skipIf(!ORIGINAL_DATA_DIR)('planting and the remote with the original scripts (Soldier_Ani.cc codes 483 and 484)', () => {
  let data: DataVfs;
  let content: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    content = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  it('buries the mine at the drop code of PLANT_BOMB', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'MINE' });
    expect(sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: ORIGIN })).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('PLANT_BOMB');
    runUntilIdle(sim);
    expect(worldBombItems(sim.state).map((wi) => [wi.gridNo, content.items.byIndex.get(wi.object.item)?.name])).toEqual([[ORIGIN, 'MINE']]);
    expect(animName(content, merc.state)).toBe('STANDING');
  });

  it('asks for the frequency at the remote code of USE_REMOTE', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'REMOTEBOMBTRIGGER' });
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toEqual({ ok: true });
    expect(animName(content, merc.state)).toBe('USE_REMOTE');
    for (let tick = 0; tick < MAX_TICKS && !sim.state.prompt; tick++) sim.step();
    expect(sim.state.prompt).toMatchObject({ kind: 'remoteFrequency', soldier: merc });
  });
});
