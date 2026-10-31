import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import type { Corpse } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { Direction } from '../tactical/directions.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { restoreCorpses } from './sector-diff.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SMERC_FWD = 3;
const NOW_MINUTE = 600;

function sectorBlockedAt(blocked: number): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), (structures) => structures.add(blocked, 0, syntheticStructure(StructureFlags.GENERIC)));
  const world = {
    ...base,
    map: { doors: [], placements: [], info: { centerGridNo: blocked } },
    mapPath: 'synthetic',
  } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 1);
}

describe('restoring the corpses of a sector diff', () => {
  it('searches again for a free tile for a corpse dropped while the sector was unloaded, at every load (Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile)', () => {
    const blocked = gridNo(80, 84);
    const t = sectorBlockedAt(blocked).state;
    const dropped: Corpse = {
      gridNo: blocked,
      level: 0,
      bodyType: 0,
      direction: Direction.SOUTH,
      state: 0,
      profile: 200,
      type: SMERC_FWD,
      timeOfDeath: NOW_MINUTE,
      headTaken: false,
      findSweetSpot: true,
    };
    restoreCorpses(t, [dropped], { nowMinute: NOW_MINUTE, inTown: false, loadingSave: false });
    expect(t.corpses).toEqual([{ ...dropped, gridNo: gridNo(80, 83), direction: Direction.NORTH }]);
  });
});
