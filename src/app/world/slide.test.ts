import { describe, expect, it } from 'vitest';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import { ScrollFlag } from '../../ui/screens/tactical/environment.ts';
import { slideView } from './slide.ts';

const ON_MAP_CENTRE = { width: 640, height: 360, camera: { centerX: 805, centerY: 805 } };
const CENTRE_TILE = gridNo(80, 80);

describe('where a slide target lies from the view (SoldierLocationRelativeToScreen)', () => {
  it('heads for a tile off screen in its map direction from the render centre', () => {
    expect(slideView(RestrictedScroll.NONE, gridNo(80, 40), ON_MAP_CENTRE, false)).toMatchObject({
      onScreen: false,
      inView: false,
      visibleTile: true,
      direction: Direction.NORTH,
    });
    expect(slideView(RestrictedScroll.NONE, gridNo(120, 120), ON_MAP_CENTRE, false).direction).toBe(Direction.SOUTHEAST);
  });

  it('reads a target at the screen centre as up and right of it: the centre leaves out the map edges the target includes', () => {
    expect(slideView(RestrictedScroll.NONE, CENTRE_TILE, ON_MAP_CENTRE, false)).toEqual({
      onScreen: true,
      inView: true,
      visibleTile: true,
      direction: Direction.EAST,
      centreFlags: ScrollFlag.UP | ScrollFlag.RIGHT,
    });
  });
});
