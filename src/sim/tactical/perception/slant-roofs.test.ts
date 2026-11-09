import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { StructureFlags, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { setSoldierPosition } from '../movement.ts';
import { createSoldier, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { RevealedFlags, revealedAtLoadRuns, revealedTileRuns, revealRoofsAndItems, setMapRevealedStatus } from './fov.ts';
import { slantRoofCeilingTiles } from './slant-roofs.ts';
import { perceptionHooks } from './wiring.ts';

const doorCosts = testDoorCosts();
const ROOF_LEVEL = 1;
const ROOM = 5;
const VIEWER = gridNo(80, 80);
const ROOM_TILE_IN_VIEW = gridNo(80, 83);
const ROOF_BASE = gridNo(100, 100);
const ROOF_LENGTH = 21;
const SECOND_VIEWER = gridNo(100, 97);

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function slantedRoofRunningSouth(length: number) {
  return syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE, {
    tiles: Array.from({ length }, (_, dy) => [0, dy] as const),
  });
}

const roofTiles = (length = ROOF_LENGTH) => Array.from({ length }, (_, dy) => ROOF_BASE + gridNo(0, dy));

function tactical(place: (s: WorldStructures) => void): TacticalState {
  const w = syntheticWorld(doorCosts, place);
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(11));
  t.perceptionHooks = perceptionHooks(t, { checkForChangingOrders: () => {}, setNewSituation: () => {} });
  return t;
}

function look(t: TacticalState, at: number, direction: number): Soldier {
  const s = createSoldier({
    id: t.soldiers.length,
    team: Team.OUR,
    name: '',
    bodyType: 0,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: {
      agility: 60,
      dexterity: 60,
      strength: 60,
      wisdom: 60,
      leadership: 50,
      marksmanship: 60,
      mechanical: 30,
      explosives: 30,
      medical: 30,
      experience: 3,
    },
    life: 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  revealRoofsAndItems(t, s, true);
  return s;
}

function markRoom(t: TacticalState, tiles: readonly number[]): void {
  for (const g of tiles) t.world.level.rooms[g] = ROOM;
}

const groundRevealed = (t: TacticalState, g: number) => ((t.fog.revealed[g] ?? 0) & RevealedFlags.GROUND) !== 0;

function roofOverAFarRoom(): TacticalState {
  const t = tactical((w) => w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(ROOF_LENGTH)));
  markRoom(t, [ROOM_TILE_IN_VIEW, ...roofTiles(2)]);
  return t;
}

describe('slanted roof ceilings (Render_Fun.cc ExamineGridNoForSlantRoofExtraGraphic)', () => {
  it('covers the tiles no merc has seen of a slanted roof that a revealed room took off with its ceiling', () => {
    const t = roofOverAFarRoom();
    look(t, VIEWER, Direction.SOUTH);
    expect(slantRoofCeilingTiles(t)).toEqual(roofTiles().slice(2));
  });

  it('gives a slanted roof no ceiling while no revealed room lies under it', () => {
    const t = tactical((w) => w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(ROOF_LENGTH)));
    markRoom(t, [ROOM_TILE_IN_VIEW]);
    look(t, VIEWER, Direction.SOUTH);
    expect(slantRoofCeilingTiles(t)).toEqual([]);
  });

  it('takes the ceiling off each tile sight reveals, outside any room too', () => {
    const t = roofOverAFarRoom();
    look(t, VIEWER, Direction.SOUTH);
    look(t, SECOND_VIEWER, Direction.SOUTH);
    const ceilings = slantRoofCeilingTiles(t);
    const seen = roofTiles().filter((g) => groundRevealed(t, g));
    expect(seen.length).toBeGreaterThan(2);
    expect(ceilings.length).toBeGreaterThan(0);
    expect(ceilings).toEqual(roofTiles().filter((g) => !groundRevealed(t, g)));
  });

  it('examines only the first slanted roof on a slot tile, so a roof based under another gets its ceiling once a tile of its own is seen', () => {
    const t = tactical((w) => {
      w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(1));
      w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(ROOF_LENGTH));
    });
    markRoom(t, [ROOM_TILE_IN_VIEW, ROOF_BASE + gridNo(0, 1)]);
    look(t, VIEWER, Direction.SOUTH);
    expect(slantRoofCeilingTiles(t)).toEqual([]);
    look(t, SECOND_VIEWER, Direction.SOUTH);
    const ceilings = slantRoofCeilingTiles(t);
    expect(ceilings.length).toBeGreaterThan(0);
    expect(ceilings).toEqual(roofTiles().filter((g) => !groundRevealed(t, g)));
  });

  it('takes off a slanted roof over a tile a load revealed outside any room and covers its unseen tiles with the ceiling (SetGridNoRevealedFlag)', () => {
    const t = tactical((w) => w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(ROOF_LENGTH)));
    setMapRevealedStatus(t, (g) => roofTiles(2).includes(g));
    expect(slantRoofCeilingTiles(t)).toEqual(roofTiles().slice(2));
  });

  it('keeps a slanted roof a load took off hidden for the looks of the stay', () => {
    const t = tactical((w) => w.add(ROOF_BASE, ROOF_LEVEL, slantedRoofRunningSouth(ROOF_LENGTH)));
    setMapRevealedStatus(t, (g) => roofTiles(2).includes(g));
    look(t, SECOND_VIEWER, Direction.SOUTH);
    const ceilings = slantRoofCeilingTiles(t);
    expect(ceilings.length).toBeGreaterThan(0);
    expect(ceilings).toEqual(roofTiles().filter((g) => !groundRevealed(t, g)));
  });

  it('builds the ceilings from the revealed tiles as the load of a native save does (SaveLoadMap.cc SetMapRevealedStatus)', () => {
    const played = roofOverAFarRoom();
    look(played, VIEWER, Direction.SOUTH);
    const loaded = roofOverAFarRoom();
    loaded.fog.slantRoofCeilings.fill(1);
    setMapRevealedStatus(loaded, (g) => groundRevealed(played, g));
    expect(slantRoofCeilingTiles(loaded)).toEqual(roofTiles().slice(2));
  });
});

describe('the tiles a load reveals (SaveLoadMap.cc SetMapRevealedStatus)', () => {
  it('are every tile the load reveals, in runs, outside rooms too, and no tile sight reveals during the stay', () => {
    const t = roofOverAFarRoom();
    setMapRevealedStatus(t, (g) => g === ROOM_TILE_IN_VIEW || roofTiles(3).includes(g));
    look(t, VIEWER, Direction.SOUTH);
    expect(groundRevealed(t, VIEWER + gridNo(0, 1))).toBe(true);
    expect(revealedAtLoadRuns(t)).toEqual([[ROOM_TILE_IN_VIEW, 1], ...roofTiles(3).map((g) => [g, 1])]);
  });
});

describe('the tiles revealed so far (FOV.cc MAPELEMENT_REVEALED)', () => {
  it('are every tile a load, a room reveal or sight revealed, in runs, outside rooms too', () => {
    const t = roofOverAFarRoom();
    setMapRevealedStatus(t, (g) => roofTiles(3).includes(g));
    look(t, VIEWER, Direction.SOUTH);
    const tiles = revealedTileRuns(t).flatMap(([first, count]) => Array.from({ length: count }, (_, k) => first + k));
    const revealed = Array.from({ length: WORLD_MAX }, (_, g) => g).filter((g) => groundRevealed(t, g));
    expect(tiles).toEqual(revealed);
    expect(tiles).toEqual(expect.arrayContaining([VIEWER + gridNo(0, 1), ROOM_TILE_IN_VIEW, ...roofTiles(3)]));
  });
});
