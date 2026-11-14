import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { parseDetailedPlacement } from '../../content/formats/placement.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { loadTacticalWorld } from '../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { addSoldierInitListTeamToWorld, buildSoldierInitList, NEUTRAL_POPULATION } from './init-list.ts';
import { loadTacticalContent } from './load-content.ts';
import { NO_PROFILE, Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';

const UNINITIALISED_FILL = String.fromCharCode(0xcdcd).repeat(10);
const NO_PRESENTATION = { frames: new Int16Array(0), sounds: new Uint16Array(0) };
const D13_FILLED_PLACEMENTS = 11;

describe.skipIf(!ORIGINAL_DATA_DIR)('the civilians of the original D13', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it("hold the 0xCDCD fill as the name of their detailed placements, and show no name of their own but the civilians' default", async () => {
    const [content, world] = await Promise.all([loadTacticalContent(read), loadTacticalWorld(read, 'maps/d13.dat')]);
    const filled = world.map.placements.filter((p) => {
      const detail = p.detailedRaw ? parseDetailedPlacement(p.detailedRaw) : null;
      return detail?.profile === NO_PROFILE && detail.name === UNINITIALISED_FILL;
    });
    expect(filled).toHaveLength(D13_FILLED_PLACEMENTS);
    const sim = new TacticalSim(world, content, 1);
    sim.state.initList = buildSoldierInitList(sim.world.map);
    addSoldierInitListTeamToWorld(sim.state, Team.CIV, NEUTRAL_POPULATION);
    const unprofiled = (id: number) => sim.state.soldiers[id]?.profile === NO_PROFILE;
    const civilians = sim.snapshot(NO_PRESENTATION).filter((s) => s.team === Team.CIV && unprofiled(s.id));
    expect(civilians.length).toBeGreaterThanOrEqual(D13_FILLED_PLACEMENTS);
    expect(civilians.every((s) => s.name === '' && s.defaultName === 'civilian')).toBe(true);
  });
});
