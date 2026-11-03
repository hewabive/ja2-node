import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemId, runExplosivesUntilIdle } from '../../../tests/support/explosives.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { loadStrategicTestContent } from '../../../tests/support/strategic.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import type { StrategicContent } from '../../content/strategic/strategic-content.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { loadTacticalWorld } from '../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { createStrategicState } from '../strategic/state.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { igniteExplosion } from '../tactical/explosions/explosion.ts';
import { loadTacticalContent } from '../tactical/load-content.ts';
import { applyMapChanges, type MapChange, sectorTempFileChanges } from '../tactical/map-changes.ts';
import type { TacticalState } from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { tileChangeViews } from '../tactical/world-view.ts';
import { repairSamTerminalInLoadedWorld, repairSamTerminalInUnloadedSector, type SamTerminal, samTerminal } from './sam-repair.ts';
import { sectorDiffOf } from './sector-loot.ts';

const D2 = { x: 2, y: 4, z: 0 };
const D2_MAP = 'maps/d2.dat';

describe.skipIf(!ORIGINAL_DATA_DIR)('the SAM terminal of the original D2', () => {
  let data: DataVfs;
  let content: TacticalContent;
  let strategic: StrategicContent;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    [content, strategic] = await Promise.all([loadTacticalContent(read), loadStrategicTestContent()]);
  });
  afterAll(async () => {
    await data.close();
  });

  async function loadD2(): Promise<{ sim: TacticalSim; terminal: SamTerminal }> {
    const world = await loadTacticalWorld(read, D2_MAP);
    const site = strategic.samSites[0];
    if (!site) throw new Error('no SAM site');
    return { sim: new TacticalSim(world, content, 1), terminal: samTerminal(content.tileTables, site) };
  }

  function standing(t: TacticalState, gridNo: number, tile: number) {
    const def = t.world.tiles?.[tile]?.structure;
    return t.world.structures.at(gridNo).filter((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === def);
  }

  async function terminalsAfterLoadWith(changes: readonly MapChange[]): Promise<[number, number]> {
    const { sim, terminal } = await loadD2();
    applyMapChanges(sim.state, changes);
    return [standing(sim.state, terminal.gridNo, terminal.working).length, standing(sim.state, terminal.gridNo, terminal.damaged).length];
  }

  function blowUpTerminal(sim: TacticalSim, terminal: SamTerminal): void {
    igniteExplosion(sim.state, null, 0, terminal.gridNo, itemId(sim.state, 'HAND_GRENADE'), 0);
    runExplosivesUntilIdle(sim);
  }

  it('stands the working terminal again in its place, with its full hit points, after an explosion left the damaged one, and keeps it for the next load', async () => {
    const { sim, terminal } = await loadD2();
    const t = sim.state;
    blowUpTerminal(sim, terminal);
    expect(standing(t, terminal.gridNo, terminal.working)).toHaveLength(0);
    expect(standing(t, terminal.gridNo, terminal.damaged)).toHaveLength(1);
    repairSamTerminalInLoadedWorld(t, terminal);
    const [working] = standing(t, terminal.gridNo, terminal.working);
    expect(working?.hitPoints).toBe(working?.def.hitPoints);
    expect(standing(t, terminal.gridNo, terminal.damaged)).toHaveLength(0);
    expect(tileChangeViews(t).slice(-2)).toEqual([
      { kind: 'remove', gridNo: terminal.gridNo, level: 0, tile: terminal.damaged },
      { kind: 'add', gridNo: terminal.gridNo, level: 0, tile: terminal.working },
    ]);
    expect(await terminalsAfterLoadWith(sectorTempFileChanges(t.mapChanges))).toEqual([1, 0]);
  });

  it("brings the working terminal back at the next load of D2 when the repair went into the sector's stored changes", async () => {
    const { sim, terminal } = await loadD2();
    blowUpTerminal(sim, terminal);
    const left = sectorTempFileChanges(sim.state.mapChanges);
    expect(await terminalsAfterLoadWith(left)).toEqual([0, 1]);
    const state = createStrategicState({ seed: 1 });
    sectorDiffOf(state, D2).mapChanges = [...left];
    repairSamTerminalInUnloadedSector(state, terminal, D2);
    expect(await terminalsAfterLoadWith(sectorDiffOf(state, D2).mapChanges ?? [])).toEqual([1, 0]);
  });

  it('leaves a working terminal standing in the loaded map as it is, where the original fails to add a second one and ends the game', async () => {
    const { sim, terminal } = await loadD2();
    const t = sim.state;
    repairSamTerminalInLoadedWorld(t, terminal);
    expect(standing(t, terminal.gridNo, terminal.working)).toHaveLength(1);
    expect(t.mapChanges).toEqual([]);
  });
});
