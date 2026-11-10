import { describe, expect, it } from 'vitest';
import type { AnimationTables } from '../../content/anim/tables.ts';
import { gridNo, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import type { LevelLayer } from '../../content/world/level.ts';
import type { PlayerView, SoldierView } from '../../protocol/view.ts';
import type { SoldierSprite } from '../../render/world/dynamic-scene.ts';
import type { WorldRenderer } from '../../render/world/world-renderer.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import type { BoundingBox } from '../world/soldier-bounding-boxes.ts';
import type { TacticalWorldView } from '../world/tactical-world-view.ts';
import type { LoadedWorld } from '../world/world-loader.ts';
import { OverheadTiles } from './overhead-map.ts';
import { type PresenterSources, TacticalWorldPresenter } from './world-presenter.ts';

const MAP_CENTRE = gridNo(80, 80);
const ONE_TILE_RIGHT_PX = 40;
const POINTER = { x: 320, y: 170 };
const MAP_CENTRE_POSITION = 805;
const SOLDIER = 9;
const HALL_SCENE_TILE = gridNo(88, 76);
const HALL_THRONE = gridNo(88, 72);

function unrenderedPresenter(): TacticalWorldPresenter {
  const world = { world: { map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } } } } as unknown as TacticalWorldView;
  return new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, {} as PresenterSources, null);
}

function figure(width: number, height: number, pixels: readonly number[]): SoldierSprite {
  return { layer: 0, x: 0, y: 0, width, height, offsetX: -10, offsetY: -40, pixels: Uint8Array.from(pixels) };
}

function presenterWithSoldier(sprite: SoldierSprite, bounds: BoundingBox = sprite): TacticalWorldPresenter {
  const shown = { id: SOLDIER, gridNo: MAP_CENTRE, x: MAP_CENTRE_POSITION, y: MAP_CENTRE_POSITION, level: 0 };
  const view = { soldiers: [shown as SoldierView] } as unknown as PlayerView;
  const world = {
    world: {
      map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } },
      level: { heights: [] },
      prepared: { renderHeight: 0 },
    },
    soldierSprite: (id: number) => (id === SOLDIER ? sprite : null),
    soldierBoundingBox: (id: number) => (id === SOLDIER ? bounds : null),
  } as unknown as TacticalWorldView;
  const sources = { view: () => view } as unknown as PresenterSources;
  return new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, sources, null);
}

describe('the exit grids the cursor finds (ExitGridAtGridNo)', () => {
  it("finds the map's own and those the view adds while the sector runs, which AddExitGridToWorld puts into the world at once", () => {
    const mapExit = gridNo(72, 71);
    const added = gridNo(100, 100);
    const view = { soldiers: [], addedExitGrids: [{ gridNo: added, sector: 'A9-1' }] } as unknown as PlayerView;
    const world = {
      world: { map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } }, tactical: { exitGrids: new Set([mapExit]) } },
    } as unknown as TacticalWorldView;
    const sources = { view: () => view } as unknown as PresenterSources;
    const presenter = new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, sources, null);
    expect([mapExit, added, added + 1].map((g) => presenter.exitGridAt(g))).toEqual([true, true, false]);
  });
});

describe('the tile under the pointer (GetMouseWorldCoords)', () => {
  it('is picked against the render centre the next frame draws, so a scroll or a centring moves it at once', () => {
    const presenter = unrenderedPresenter();
    const before = presenter.gridNoAt(POINTER.x, POINTER.y);
    if (before === null) throw new Error('no tile under the pointer');
    expect(presenter.scrollBy(ONE_TILE_RIGHT_PX, 0)).toBe(true);
    expect(presenter.gridNoAt(POINTER.x, POINTER.y)).toBe(before + 1 - WORLD_COLS);
    presenter.centerOn(MAP_CENTRE);
    expect(presenter.gridNoAt(POINTER.x, POINTER.y)).toBe(before);
  });
});

describe('the render centre while scrolling is ignored (gfIgnoreScrolling)', () => {
  it('moves neither by a scroll nor by a centring or a locate, as SetRenderCenter and ScrollWorld return, and moves again once it is lifted', () => {
    const presenter = unrenderedPresenter();
    const centre = presenter.camera;
    presenter.ignoreScrolling(true);
    expect(presenter.scrollBy(ONE_TILE_RIGHT_PX, 0)).toBe(false);
    presenter.centerOn(gridNo(20, 20));
    presenter.locate(gridNo(150, 150));
    presenter.centerFromRadar(0, 0);
    expect(presenter.camera).toEqual(centre);
    presenter.ignoreScrolling(false);
    expect(presenter.scrollBy(ONE_TILE_RIGHT_PX, 0)).toBe(true);
  });
});

describe('a locate without force (LocateSoldier(…, FALSE), InternalLocateGridNo(…, FALSE))', () => {
  it("leaves the view where it shows the tile, so the Queen on the stub hall's throne after the scene's tile moves nothing, and centres a tile off screen", () => {
    const presenter = unrenderedPresenter();
    presenter.centerOn(HALL_SCENE_TILE);
    const scene = presenter.camera;
    presenter.locate(HALL_THRONE);
    expect(presenter.camera).toEqual(scene);
    presenter.locate(gridNo(20, 20));
    const away = presenter.camera;
    expect(away).not.toEqual(scene);
    presenter.centerOn(gridNo(20, 20));
    expect(presenter.camera).toEqual(away);
  });
});

describe('the soldier under the pointer (FindSoldier, GetSoldierScreenRect)', () => {
  it('puts his screen rectangle at the render centre the next frame draws, so a scroll or a centring moves it at once', () => {
    const presenter = presenterWithSoldier(figure(20, 40, Array(800).fill(1)));
    const before = presenter.soldierBox(SOLDIER);
    if (!before) throw new Error('no rectangle for the soldier');
    const middle = { x: before.x + 10, y: before.y + 20 };
    expect(presenter.soldierAt(middle.x, middle.y)).toBe(SOLDIER);
    expect(presenter.scrollBy(ONE_TILE_RIGHT_PX, 0)).toBe(true);
    expect(presenter.soldierBox(SOLDIER)).toEqual({ ...before, x: before.x - ONE_TILE_RIGHT_PX });
    expect(presenter.soldierAt(middle.x, middle.y)).toBeNull();
    expect(presenter.soldierAt(middle.x - ONE_TILE_RIGHT_PX, middle.y)).toBe(SOLDIER);
    presenter.centerOn(MAP_CENTRE);
    expect(presenter.soldierBox(SOLDIER)).toEqual(before);
  });

  it("tests a vehicle's picture one pixel left of the pointer, the last pixel of the row above at the left edge (CheckVideoObjectScreenCoordinateInData)", () => {
    const presenter = presenterWithSoldier(figure(4, 2, [0, 0, 7, 9, 0, 0, 0, 0]));
    const box = presenter.soldierBox(SOLDIER);
    if (!box) throw new Error('no rectangle for the soldier');
    expect([1, 2, 3, 4].map((dx) => presenter.soldierPictureAt(SOLDIER, box.x + dx, box.y))).toEqual([false, false, true, true]);
    expect(presenter.soldierPictureAt(SOLDIER, box.x, box.y + 1)).toBe(true);
    expect(presenter.soldierPictureAt(SOLDIER, box.x + 1, box.y + 1)).toBe(false);
  });

  it('takes his rectangle from his bounding box, not from the frame shown (sBoundingBox*)', () => {
    const shown = figure(20, 40, Array(800).fill(1));
    const bounds = { offsetX: -14, offsetY: -30, width: 28, height: 30 };
    const box = presenterWithSoldier(shown, bounds).soldierBox(SOLDIER);
    const drawn = presenterWithSoldier(shown).soldierBox(SOLDIER);
    if (!box || !drawn) throw new Error('no rectangle for the soldier');
    expect(box).toEqual({ x: drawn.x - 4, y: drawn.y + 10, width: 28, height: 30 });
  });

  it("tests a vehicle's current frame from the bottom of his rectangle up when the frame is shorter than his bounding box", () => {
    const shown = figure(4, 2, [0, 0, 7, 9, 0, 0, 0, 0]);
    const presenter = presenterWithSoldier(shown, { offsetX: -10, offsetY: -43, width: 4, height: 5 });
    const box = presenter.soldierBox(SOLDIER);
    if (!box) throw new Error('no rectangle for the soldier');
    const topRowOfTheFrame = box.y + box.height - 2;
    expect(presenter.soldierPictureAt(SOLDIER, box.x + 3, box.y)).toBe(false);
    expect([1, 2, 3, 4].map((dx) => presenter.soldierPictureAt(SOLDIER, box.x + dx, topRowOfTheFrame))).toEqual([false, false, true, true]);
  });
});

function emptyLayer(): LevelLayer {
  return { offsets: new Uint32Array(WORLD_MAX + 1), tiles: new Uint16Array(0) };
}

interface OverheadFixture {
  readonly presenter: TacticalWorldPresenter;
  readonly added: string[];
  readonly removed: string[];
  readonly reads: () => number;
}

function overheadPresenter(): OverheadFixture {
  const layers = {
    land: emptyLayer(),
    objects: emptyLayer(),
    shadows: emptyLayer(),
    structs: emptyLayer(),
    roofs: emptyLayer(),
    onRoof: emptyLayer(),
  };
  const level = { heights: new Uint8Array(WORLD_MAX), layers };
  const loaded = {
    mapPath: 'maps/test.dat',
    map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE }, lights: null },
    level,
    tiles: [],
    surfaces: [],
    prepared: { renderHeight: 0 },
  } as unknown as LoadedWorld;
  const shade = { land: new Uint8Array(WORLD_MAX), roof: new Uint8Array(WORLD_MAX) };
  const world = { world: loaded, shade } as unknown as TacticalWorldView;
  let reads = 0;
  const renderer = {
    get shownWorld() {
      reads++;
      const reveal = { nodeFlags: () => 0, ceilings: () => [] };
      return {
        level,
        prepared: { landStart: new Int8Array(WORLD_MAX).fill(-1), shadows: emptyLayer() },
        reveal,
        openStructures: new Set(),
      };
    },
  } as unknown as WorldRenderer;
  const added: string[] = [];
  const removed: string[] = [];
  const assets = { addRgb: (key: string) => added.push(key), remove: (key: string) => removed.push(key) } as unknown as UiAssets;
  const presenter = new TacticalWorldPresenter(world, renderer, assets, {} as AnimationTables, {} as PresenterSources, null);
  presenter.setOverheadTiles(async () => new OverheadTiles(loaded, []));
  return { presenter, added, removed, reads: () => reads };
}

describe('the overhead map picture (GoIntoOverheadMap, gfOverheadMapDirty)', () => {
  it('is composed again from the world as last drawn at every entry, and only then', async () => {
    const { presenter, added, removed, reads } = overheadPresenter();
    expect(presenter.overheadMap()).toBeNull();
    presenter.redrawOverheadMap();
    await Promise.resolve();
    const first = presenter.overheadMap();
    expect(first).not.toBeNull();
    expect(presenter.overheadMap()).toBe(first);
    presenter.redrawOverheadMap();
    const second = presenter.overheadMap();
    expect(second).not.toBe(first);
    expect([added, removed, reads()]).toEqual([['overhead:maps/test.dat:1', 'overhead:maps/test.dat:2'], ['overhead:maps/test.dat:1'], 2]);
  });
});

describe('the base light the frames show set again (LightSetBaseLevel)', () => {
  it('hands each set to the world view once, for the roof markers to take the roof shade', () => {
    let sets = 0;
    const world = {
      world: { map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } } },
      baseLightSet: () => sets++,
    } as unknown as TacticalWorldView;
    const presenter = new TacticalWorldPresenter(
      world,
      {} as WorldRenderer,
      {} as UiAssets,
      {} as AnimationTables,
      {} as PresenterSources,
      null,
    );
    presenter.followEvents([{ type: 'roomRevealed', tick: 1, room: 2 }]);
    presenter.followEvents([
      { type: 'ambientLightSet', tick: 2, level: 3 },
      { type: 'ambientLightSet', tick: 2, level: 3 },
    ]);
    expect(sets).toBe(1);
  });
});
