import { describe, expect, it } from 'vitest';
import type { AnimationTables } from '../../content/anim/tables.ts';
import { gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import type { WorldRenderer } from '../../render/world/world-renderer.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import type { TacticalWorldView } from '../world/tactical-world-view.ts';
import { type PresenterSources, TacticalWorldPresenter } from './world-presenter.ts';

const MAP_CENTRE = gridNo(80, 80);
const ONE_TILE_RIGHT_PX = 40;
const POINTER = { x: 320, y: 170 };

function unrenderedPresenter(): TacticalWorldPresenter {
  const world = { world: { map: { info: { restrictedScrollId: 0, centerGridNo: MAP_CENTRE } } } } as unknown as TacticalWorldView;
  return new TacticalWorldPresenter(world, {} as WorldRenderer, {} as UiAssets, {} as AnimationTables, {} as PresenterSources, null);
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
