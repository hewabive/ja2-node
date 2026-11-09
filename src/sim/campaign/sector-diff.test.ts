import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { MapModificationType } from '../../content/formats/savegame-temp-files.ts';
import { gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticMap, syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import type { Corpse } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { Direction } from '../tactical/directions.ts';
import { decaySmokeEffects, newSmokeEffect } from '../tactical/explosions/smoke.ts';
import { LightSpriteFlags } from '../tactical/lighting/lighting.ts';
import { createFogOfWar, RevealedFlags, revealedAtLoadRuns } from '../tactical/perception/fov.ts';
import { slantRoofCeilingTiles } from '../tactical/perception/slant-roofs.ts';
import { Team } from '../tactical/soldier.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import {
  captureSmoke,
  changeOpenableInUnloadedSector,
  emptySectorDiff,
  restoreCorpses,
  restoreRevealed,
  restoreSmoke,
} from './sector-diff.ts';

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
    map: syntheticMap({ info: { centerGridNo: blocked } }),
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
      map: syntheticMap({
        info: { centerGridNo: TWO_LAMPS },
        ambient: { basement: !caves, caves, lightLevel: 11 },
        lights: { colors: [[0, 0, 0]], sprites },
      }),
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

  it('covers the unseen tiles of a slanted roof over a revealed room with its ceiling again, as loading the revealed map does', () => {
    const ROOM = 5;
    const roofTiles = [gridNo(80, 84), gridNo(80, 85), gridNo(80, 86)];
    const roof = syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE, {
      tiles: [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
    });
    const world = syntheticWorld(testDoorCosts(), (structures) => structures.add(gridNo(80, 84), 1, roof));
    const t = new TacticalSim({ ...world, map: syntheticMap(), mapPath: 'synthetic' } as unknown as TacticalWorld, content, 1).state;
    t.world.level.rooms[gridNo(80, 84)] = ROOM;
    const fog = createFogOfWar();
    fog.revealed[gridNo(80, 84)] = RevealedFlags.GROUND;
    fog.roomHidden[ROOM] = 0;
    restoreRevealed(t, { revealed: fog.revealed, roomHidden: fog.roomHidden });
    expect(slantRoofCeilingTiles(t)).toEqual(roofTiles.slice(1));
  });

  it('reveals every revealed tile for the picture, outside rooms too, as loading the revealed map does', () => {
    const t = sectorWithLamps(false).state;
    const fog = createFogOfWar();
    for (const g of [TWO_LAMPS, TWO_LAMPS + 1, ONE_LAMP]) fog.revealed[g] = RevealedFlags.GROUND;
    fog.revealed[UNSEEN_LAMP] = RevealedFlags.ROOF;
    restoreRevealed(t, { revealed: fog.revealed, roomHidden: fog.roomHidden });
    expect(revealedAtLoadRuns(t)).toEqual([
      [TWO_LAMPS, 2],
      [ONE_LAMP, 1],
    ]);
  });
});

describe('a crate closed in a sector that is not loaded', () => {
  it("closes the first openable record of its tile in a native save's map modifications, the others as they were (SaveLoadMap.cc:744)", () => {
    const crate = gridNo(80, 84);
    const openable = (g: number, open: number) => ({
      type: MapModificationType.OPENABLE_STRUCT,
      gridNo: g,
      imageType: open,
      subImageIndex: 0,
      extra: 0,
    });
    const blood = { type: MapModificationType.BLOOD_SMELL, gridNo: crate, imageType: 1, subImageIndex: 0, extra: 0 };
    const diff = { ...emptySectorDiff(), savedMapModifications: [blood, openable(crate + 1, 1), openable(crate, 1), openable(crate, 1)] };
    changeOpenableInUnloadedSector(diff, crate, false);
    expect(diff.savedMapModifications.map((m) => [m.type, m.gridNo, m.imageType])).toEqual([
      [MapModificationType.BLOOD_SMELL, crate, 1],
      [MapModificationType.OPENABLE_STRUCT, crate + 1, 1],
      [MapModificationType.OPENABLE_STRUCT, crate, 0],
      [MapModificationType.OPENABLE_STRUCT, crate, 1],
    ]);
  });
});

describe('the smoke of a sector diff', () => {
  const CLOUD = gridNo(80, 84);
  const AWAY = gridNo(80, 100);
  const MERC_ID = 3;
  const CIVILIAN_ID = 120;

  function cloudLeftBy(ownerId: number): ReturnType<typeof captureSmoke> {
    const sim = newCombatSim(content);
    const thrower = spawnSoldier(sim, ownerId, Team.OUR, AWAY, Direction.NORTH, { life: 100 });
    newSmokeEffect(sim.state, CLOUD, itemId(sim.state, 'TEARGAS_GRENADE'), 0, thrower);
    return captureSmoke(sim.state);
  }

  it("keeps each cloud's owner by his soldier id (LoadSaveSmokeEffect.cc:23)", () => {
    expect(cloudLeftBy(MERC_ID).map((c) => [c.gridNo, c.ownerId])).toEqual([[CLOUD, MERC_ID]]);
  });

  it('spreads the cloud at the entry before anybody is in the sector and credits whoever holds the id when the gas hits: a neutral civilian gassed after the merc came in is his attack (SmokeEffects.cc:495, Explosion_Control.cc:850)', () => {
    const smoke = cloudLeftBy(MERC_ID);
    const sim = newCombatSim(content);
    const t = sim.state;
    restoreSmoke(t, smoke);
    spawnSoldier(sim, MERC_ID, Team.OUR, AWAY, Direction.NORTH, { life: 100 });
    const civilian = spawnSoldier(sim, CIVILIAN_ID, Team.CIV, CLOUD, Direction.NORTH, { life: 100 });
    t.inCombat = true;
    decaySmokeEffects(t);
    expect([civilian.breath < 100, t.hostileQuoteList]).toEqual([true, [civilian]]);
  });
});
