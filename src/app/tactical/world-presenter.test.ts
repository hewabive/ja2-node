import { describe, expect, it } from 'vitest';
import type { AnimationTables } from '../../content/anim/tables.ts';
import { gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import type { PlayerView, SoldierView } from '../../protocol/view.ts';
import type { SoldierSprite } from '../../render/world/dynamic-scene.ts';
import type { WorldRenderer } from '../../render/world/world-renderer.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import type { TacticalWorldView } from '../world/tactical-world-view.ts';
import { type PresenterSources, TacticalWorldPresenter } from './world-presenter.ts';

const MAP_CENTRE = gridNo(80, 80);
const ONE_TILE_RIGHT_PX = 40;
const POINTER = { x: 320, y: 170 };
const MAP_CENTRE_POSITION = 805;
const SOLDIER = 9;

function unrenderedPresenter(): TacticalWorldPresenter {
  const world = { world: { map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } } } } as unknown as TacticalWorldView;
  return new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, {} as PresenterSources, null);
}

function figure(width: number, height: number, pixels: readonly number[]): SoldierSprite {
  return { layer: 0, x: 0, y: 0, width, height, offsetX: -10, offsetY: -40, pixels: Uint8Array.from(pixels) };
}

function presenterWithSoldier(sprite: SoldierSprite): TacticalWorldPresenter {
  const shown = { id: SOLDIER, gridNo: MAP_CENTRE, x: MAP_CENTRE_POSITION, y: MAP_CENTRE_POSITION, level: 0 };
  const view = { soldiers: [shown as SoldierView] } as unknown as PlayerView;
  const world = {
    world: {
      map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } },
      level: { heights: [] },
      prepared: { renderHeight: 0 },
    },
    soldierSprite: (id: number) => (id === SOLDIER ? sprite : null),
  } as unknown as TacticalWorldView;
  const sources = { view: () => view } as unknown as PresenterSources;
  return new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, sources, null);
}

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
});
