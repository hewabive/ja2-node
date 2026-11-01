import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { tileIndex } from '../../../content/world/tile-tables.ts';
import { SectorFlag } from '../../strategic/forces/constants.ts';
import { getSectorFlagStatus } from '../../strategic/map/sectors.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { MapChangeKind } from '../../tactical/map-changes.ts';
import { NpcActionCode } from '../../tactical/narrative/npc-actions/codes.ts';
import { exitGridAt } from '../../tactical/sector-exit.ts';
import { tileChangeViews } from '../../tactical/world-view.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { sectorKey } from '../sector-diff.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const A10 = { x: 10, y: 1, z: 0 };
const BASEMENT = { x: 10, y: 1, z: 1 };
const TRAPDOOR = 7887;
const MOVED_CRATE = 8207;
const BASEMENT_LANDING = 12722;

async function inA10(seed: number): Promise<CampaignSim> {
  const { campaign } = await campaignInA10(kit, seed);
  await campaign.prepare({ type: 'talk' });
  return campaign.campaign;
}

function doAction(c: CampaignSim, code: number): void {
  const actions = c.talk?.npcActions;
  if (!actions) throw new Error('no NPC actions');
  actions.handle(Npc.FATIMA, code, 0);
}

function tile(c: CampaignSim, name: string): number {
  const tables = c.tactical?.world.tables;
  if (!tables) throw new Error('no sector');
  return tileIndex(tables, name);
}

describe('the rebel hideout', () => {
  it('opens the trapdoor in A10 and moves the crate off it, written into the left sector once the basement has loaded (DoneFadeOutActionBasement, Interface_Dialogue.cc:4510)', async () => {
    const c = await inA10(31);
    doAction(c, NpcActionCode.GOTO_HIDEOUT);
    expect(c.state.worldSector).toEqual(BASEMENT);
    const crate = tile(c, 'SECONDOSTRUCT1');
    const trapdoor = tile(c, 'DEBRIS2MISC1');
    const changes = c.state.sectorDiffs.get(sectorKey(A10))?.mapChanges ?? [];
    expect(changes.map((m) => [m.kind, m.gridNo, m.tile ?? m.exitGrid?.gridNo])).toEqual([
      [MapChangeKind.ADD_EXIT_GRID, TRAPDOOR, BASEMENT_LANDING],
      [MapChangeKind.REMOVE_STRUCT_TILE, TRAPDOOR, crate],
      [MapChangeKind.APPEND_STRUCT_TILE, MOVED_CRATE, crate],
      [MapChangeKind.APPEND_STRUCT_TILE, TRAPDOOR, trapdoor],
    ]);
    expect(getSectorFlagStatus(c.state.map, A10, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)).toBe(true);
  });

  it('shows the open trapdoor, the moved crate and the way down when the squad comes back up', async () => {
    const c = await inA10(32);
    doAction(c, NpcActionCode.GOTO_HIDEOUT);
    doAction(c, NpcActionCode.LEAVE_HIDEOUT);
    expect(c.state.worldSector).toEqual(A10);
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector');
    expect(exitGridAt(t, TRAPDOOR)).toEqual({ gridNo: BASEMENT_LANDING, sector: BASEMENT });
    expect(t.world.structures.at(MOVED_CRATE).filter((s) => has(s.flags, StructureFlags.BASE_TILE))).toHaveLength(1);
    expect(tileChangeViews(t).filter((v) => v.gridNo === TRAPDOOR || v.gridNo === MOVED_CRATE)).toEqual([
      { kind: 'append', gridNo: MOVED_CRATE, level: 0, tile: tile(c, 'SECONDOSTRUCT1') },
      { kind: 'append', gridNo: TRAPDOOR, level: 0, tile: tile(c, 'DEBRIS2MISC1') },
    ]);
  });
});
