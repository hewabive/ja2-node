import { describe, expect, it } from 'vitest';
import { HI_RES_DIRECTIONS, type SheetLayout } from '../../content/anim/soldier-sprite.ts';
import type { AnimationTables } from '../../content/anim/tables.ts';
import type { IndexedFrame, IndexedPicture } from '../../content/picture/picture.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { SoldierSprite } from '../../render/world/dynamic-scene.ts';
import type { WorldSprites } from '../../render/world/world-sprites.ts';
import type { SoldierAssets } from './soldier-assets.ts';
import { SoldierScene, type SoldierSceneInput } from './soldier-scene.ts';

const SOLDIER = 3;
const UNSEEN = 4;
const NORTH = 0;
const NORTHEAST = 1;
const FRAMES_PER_DIRECTION = 3;
const DIRECTIONS = 8;
const FIRST_FRAME = 0;
const HUMVEE = 22;

function sheetFrame(index: number): IndexedFrame {
  return { width: 10 + index, height: 30 + index, offsetX: -5, offsetY: -30 - index, pixels: new Uint8Array((10 + index) * (30 + index)) };
}

const layout: SheetLayout = { directions: DIRECTIONS, framesPerDirection: FRAMES_PER_DIRECTION, noFrames: false, frameCount: 24 };
const picture: IndexedPicture = {
  kind: 'indexed',
  palette: new Uint8Array(768),
  frames: Array.from({ length: DIRECTIONS * FRAMES_PER_DIRECTION }, (_, i) => sheetFrame(i)),
};
const request = { id: 'standing', surface: 1 };

const assets = {
  tables: {
    stateIndex: new Map([
      ['CHARIOTS_OF_FIRE', 90],
      ['BODYEXPLODING', 91],
    ]),
  } as unknown as AnimationTables,
  sheetFor: () => request,
  ready: () => ({ picture, layout }),
  paletteFor: () => ({ key: 'standing', compose: () => new Uint8Array(768) }),
  structureDef: () => null,
} as unknown as SoldierAssets;

const sprites = {
  addSheet: (_id: string, loaded: IndexedPicture) => ({ picture: loaded, regions: [] }),
  soldierFrame: (loaded: { picture: IndexedPicture }, index: number): SoldierSprite | null => {
    const f = loaded.picture.frames[index];
    return f ? { layer: 0, x: 0, y: 0, width: f.width, height: f.height, offsetX: f.offsetX, offsetY: f.offsetY, pixels: f.pixels } : null;
  },
  soldierPaletteBase: () => 0,
} as unknown as WorldSprites;

function soldier(over: Partial<SoldierView>): SoldierView {
  return {
    id: SOLDIER,
    team: 0,
    name: '',
    bodyType: 0,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: NORTH,
    animation: 1,
    frame: FIRST_FRAME,
    palettes: ['', '', '', ''],
    hand: '',
    surface: 0,
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...over,
  };
}

function input(soldiers: readonly SoldierView[]): SoldierSceneInput {
  return {
    soldiers,
    clockMs: 0,
    hour: 12,
    shade: { version: 0, ambient: 0, natural: 0, land: new Uint8Array(1), roof: new Uint8Array(1) },
    hasRoof: () => false,
    glow: { ourTurn: false, frame: 0, hovered: null, hoveredHostile: false, selectedSees: () => null, underAiControl: () => false },
    lights: { mercCastsLight: false, mercAlwaysLit: false },
    frameOf: (s) => s.frame,
    firstFrameOf: () => FIRST_FRAME,
  };
}

const sheetIndex = (frame: number, direction: number) => frame + FRAMES_PER_DIRECTION * ((direction + 1) % DIRECTIONS);
const dims = (f: { offsetX: number; offsetY: number; width: number; height: number } | null) =>
  f && { offsetX: f.offsetX, offsetY: f.offsetY, width: f.width, height: f.height };

describe('the bounding box of a shown soldier (GetActualSoldierAnimDims)', () => {
  it('measures the sheet frame of his bounding frame and facing, not the frame drawn', () => {
    const scene = new SoldierScene(assets);
    scene.setSprites(sprites);
    scene.build(input([soldier({ frame: 2 })]));
    expect(dims(scene.shownSprite(SOLDIER))).toEqual(dims(sheetFrame(sheetIndex(2, NORTH))));
    expect(dims(scene.shownBoundingBox(SOLDIER))).toEqual(dims(sheetFrame(sheetIndex(FIRST_FRAME, NORTH))));
    scene.build(input([soldier({ frame: 1, direction: NORTHEAST })]));
    expect(dims(scene.shownSprite(SOLDIER))).toEqual(dims(sheetFrame(sheetIndex(1, NORTHEAST))));
    expect(dims(scene.shownBoundingBox(SOLDIER))).toEqual(dims(sheetFrame(sheetIndex(1, NORTH))));
  });

  it("draws a vehicle's 32-direction sheet at its 32-step facing, four steps a direction and the steps between while it turns, one octant clockwise (ConvertAniCodeToAniFrame)", () => {
    const hiResLayout: SheetLayout = {
      directions: HI_RES_DIRECTIONS,
      framesPerDirection: 1,
      noFrames: true,
      frameCount: HI_RES_DIRECTIONS,
    };
    const hiResPicture: IndexedPicture = { ...picture, frames: Array.from({ length: HI_RES_DIRECTIONS }, (_, i) => sheetFrame(i)) };
    const scene = new SoldierScene({
      ...assets,
      ready: () => ({ picture: hiResPicture, layout: hiResLayout }),
    } as unknown as SoldierAssets);
    scene.setSprites(sprites);
    const shown = Array.from({ length: DIRECTIONS }, (_, direction) => {
      scene.build(input([soldier({ bodyType: HUMVEE, direction, frame: 2 })]));
      return dims(scene.shownSprite(SOLDIER));
    });
    expect(shown).toEqual([4, 8, 12, 16, 20, 24, 28, 0].map((i) => dims(sheetFrame(i))));
    const turning = [1, 2, 3, 31].map((hiResDirection) => {
      scene.build(input([soldier({ bodyType: HUMVEE, direction: 0, hiResDirection, frame: 2 })]));
      return dims(scene.shownSprite(SOLDIER));
    });
    expect(turning).toEqual([5, 6, 7, 3].map((i) => dims(sheetFrame(i))));
  });

  it('has none for a soldier not shown', () => {
    const scene = new SoldierScene(assets);
    scene.setSprites(sprites);
    scene.build(input([soldier({})]));
    expect(scene.shownBoundingBox(UNSEEN)).toBeNull();
  });
});
