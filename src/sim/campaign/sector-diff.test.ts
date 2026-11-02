import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import type { Corpse } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { Direction } from '../tactical/directions.ts';
import { LightSpriteFlags } from '../tactical/lighting/lighting.ts';
import { createFogOfWar, RevealedFlags } from '../tactical/perception/fov.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { restoreCorpses, restoreRevealed } from './sector-diff.ts';

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
      heightAdjustment: 0,
      bodyType: 0,
      direction: Direction.SOUTH,
      state: 0,
      profile: 200,
      type: SMERC_FWD,
      timeOfDeath: NOW_MINUTE,
      headTaken: false,
      servicingCrows: 0,
      findSweetSpot: true,
    };
    restoreCorpses(t, [dropped], { nowMinute: NOW_MINUTE, inTown: false, loadingSave: false });
    expect(t.corpses).toEqual([{ ...dropped, gridNo: gridNo(80, 83), direction: Direction.NORTH }]);
  });
});

describe('restoring the revealed tiles of a sector diff', () => {
  const TWO_LAMPS = gridNo(80, 84);
  const ONE_LAMP = gridNo(90, 84);
  const UNSEEN_LAMP = gridNo(100, 84);
  const lampsAt = [TWO_LAMPS, TWO_LAMPS, ONE_LAMP, UNSEEN_LAMP];

  function sectorWithLamps(caves: boolean): TacticalSim {
    const base = syntheticWorld(testDoorCosts());
    const sprites = lampsAt.map((g) => ({ x: g % 160, y: Math.trunc(g / 160), flags: 0, template: 'L-R03.LHT' }));
    const world = {
      ...base,
      map: {
        doors: [],
        placements: [],
        info: { centerGridNo: TWO_LAMPS },
        ambient: { basement: !caves, caves, lightLevel: 11 },
        lights: { colors: [[0, 0, 0]], sprites },
      },
      mapPath: 'synthetic',
    } as unknown as TacticalWorld;
    return new TacticalSim(world, content, 1);
  }

  function restoreSeen(sim: TacticalSim): boolean[] {
    const t = sim.state;
    for (const l of t.lighting.sprites) if (l) l.flags &= ~LightSpriteFlags.ON;
    const fog = createFogOfWar();
    for (const g of [TWO_LAMPS, ONE_LAMP]) fog.revealed[g] = RevealedFlags.GROUND;
    restoreRevealed(t, { revealed: fog.revealed, roomHidden: fog.roomHidden });
    return t.lighting.sprites.flatMap((l) => (l ? [(l.flags & LightSpriteFlags.ON) !== 0] : []));
  }

  it('switches on one cave light of each revealed tile, as loading the revealed map does (SaveLoadMap.cc SetMapRevealedStatus)', () => {
    expect(restoreSeen(sectorWithLamps(true))).toEqual([true, false, true, false]);
    expect(restoreSeen(sectorWithLamps(false))).toEqual([false, false, false, false]);
  });
});
