import { describe, expect, it } from 'vitest';
import {
  ArPiece,
  autoresolveGeometry,
  buttonPositions,
  easeInOutCubic,
  openingRect,
  panelPieces,
  textAnchors,
  timeModifierPercentage,
} from './autoresolve-geometry.ts';

const SCREEN_640 = { width: 640, height: 480, stdX: 0, stdY: 0 };
const SCREEN_960 = { width: 960, height: 540, stdX: 160, stdY: 30 };

describe('the autoresolve geometry of CalculateRowsAndColumns and CalculateSoldierCells', () => {
  it('lays out 3 mercs against 6 enemies on 640×480 as the original computes it', () => {
    const g = autoresolveGeometry({ mercs: 3, civs: 0, enemies: 6 }, SCREEN_640);
    expect(g.mercs).toEqual({ cols: 1, rows: 3 });
    expect(g.enemies).toEqual({ cols: 2, rows: 3 });
    expect(g.rect).toEqual({ x: 137, y: 120, width: 366, height: 160 });
    expect(g.centerX).toBe(250);
    expect(g.verticalOffset).toBe(-40);
    expect(g.mercCells).toEqual([
      { x: 198, y: 132 },
      { x: 198, y: 179 },
      { x: 198, y: 226 },
    ]);
    expect(g.enemyCells).toEqual([
      { x: 391, y: 131 },
      { x: 446, y: 131 },
      { x: 391, y: 178 },
      { x: 446, y: 178 },
      { x: 391, y: 225 },
      { x: 446, y: 225 },
    ]);
  });

  it('equalises merc and militia columns, widens a tall player side and fills the gap row from the centre', () => {
    const g = autoresolveGeometry({ mercs: 6, civs: 7, enemies: 20 }, SCREEN_640);
    expect(g.mercs).toEqual({ cols: 3, rows: 2 });
    expect(g.civs).toEqual({ cols: 3, rows: 3 });
    expect(g.enemies).toEqual({ cols: 4, rows: 5 });
    expect(g.rect).toEqual({ x: 54, y: 120, width: 531, height: 240 });
    expect(g.centerX).toBe(223);
    expect(g.verticalOffset).toBe(0);
    expect(g.mercCells).toEqual([
      { x: 61, y: 125 },
      { x: 116, y: 125 },
      { x: 171, y: 125 },
      { x: 61, y: 172 },
      { x: 116, y: 172 },
      { x: 171, y: 172 },
    ]);
    expect(g.civCells).toEqual([
      { x: 61, y: 218 },
      { x: 116, y: 218 },
      { x: 171, y: 218 },
      { x: 116, y: 265 },
      { x: 171, y: 265 },
      { x: 116, y: 312 },
      { x: 171, y: 312 },
    ]);
    expect(g.enemyCells[0]).toEqual({ x: 364, y: 124 });
    expect(g.enemyCells[19]).toEqual({ x: 529, y: 312 });
  });

  it('retracts a merc column that the mercs leave mostly empty', () => {
    const g = autoresolveGeometry({ mercs: 1, civs: 9, enemies: 3 }, SCREEN_640);
    expect(g.civs).toEqual({ cols: 3, rows: 3 });
    expect(g.mercs).toEqual({ cols: 2, rows: 1 });
    expect(g.rect.width).toBe(146 + 55 * (3 + 2));
  });

  it('uses the full screen width at nine columns and measures from STD_SCREEN on a wide screen', () => {
    const full = autoresolveGeometry({ mercs: 20, civs: 20, enemies: 32 }, SCREEN_960);
    expect(full.mercs.cols + full.enemies.cols).toBe(9);
    expect(full.rect.width).toBe(960);
    expect(full.rect).toEqual({ x: 0, y: 70, width: 960, height: 400 });
    expect(full.centerX).toBe(160 + 323 - 480 + 5 * 55);
    const small = autoresolveGeometry({ mercs: 1, civs: 0, enemies: 1 }, SCREEN_960);
    expect(small.rect).toEqual({ x: 297, y: 150, width: 366, height: 160 });
    expect(small.verticalOffset).toBe(-40);
  });

  it('places the buttons around the centre column and the texts on the original rows', () => {
    const g = autoresolveGeometry({ mercs: 3, civs: 0, enemies: 6 }, SCREEN_640);
    expect(buttonPositions(g, 480)).toEqual({
      play: { x: 261, y: 200 },
      fast: { x: 301, y: 200 },
      finish: { x: 341, y: 200 },
      pause: { x: 261, y: 234 },
      retreat: { x: 301, y: 234 },
      bandage: { x: 261, y: 205 },
      doneWin: { x: 301, y: 205 },
      doneLose: { x: 275, y: 205 },
      yes: { x: 271, y: 217 },
      no: { x: 331, y: 217 },
    });
    expect(textAnchors(g, 0)).toEqual({
      titleCenterX: 320,
      titleY: 135,
      sectorY: 146,
      ratioY: 157,
      offer: { x: 266, y: 190 },
      offerWidth: 108,
      captured: { x: 266, y: 310 },
      indent: { x: 262, y: 178 },
      resultY: 187,
      elapsedY: 250,
    });
  });

  it('tiles the texture, the edges, the corners and the centre pieces of BuildInterfaceBuffer', () => {
    const g = autoresolveGeometry({ mercs: 3, civs: 0, enemies: 6 }, SCREEN_640);
    const pieces = panelPieces(g);
    const of = (frame: number) => pieces.filter((p) => p.frame === frame);
    expect(of(ArPiece.C_TEXTURE)).toHaveLength(8 * 4);
    expect(of(ArPiece.R_BORDER).map((p) => p.x)).toEqual([500, 500, 500, 500]);
    expect(of(ArPiece.BR_BORDER)).toEqual([{ frame: ArPiece.BR_BORDER, x: 493, y: 271 }]);
    expect(of(ArPiece.TOP_MIDDLE)).toEqual([{ frame: ArPiece.TOP_MIDDLE, x: 250, y: 120 }]);
    expect(of(ArPiece.AUTO_MIDDLE).map((p) => p.y)).toEqual([160, 200]);
    expect(of(ArPiece.BOT_MIDDLE)).toEqual([{ frame: ArPiece.BOT_MIDDLE, x: 250, y: 240 }]);
  });
});

describe('the Play speed of big battles and the opening', () => {
  it('slows Play from 13 soldiers a side as ubTimeModifierPercentage does', () => {
    expect(timeModifierPercentage({ mercs: 6, civs: 6, enemies: 12 })).toBe(100);
    expect(timeModifierPercentage({ mercs: 6, civs: 7, enemies: 2 })).toBe(98);
    expect(timeModifierPercentage({ mercs: 0, civs: 0, enemies: 32 })).toBe(70);
  });

  it('eases the growing panel in and out over the second and grows it from the screen corner', () => {
    expect(easeInOutCubic(0, 1000, 0)).toBe(0);
    expect(easeInOutCubic(0, 1000, 250)).toBeCloseTo(0.0625, 6);
    expect(easeInOutCubic(0, 1000, 500)).toBeCloseTo(0.5, 6);
    expect(easeInOutCubic(0, 1000, 1000)).toBe(1);
    expect(openingRect({ x: 137, y: 120, width: 366, height: 160 }, 0)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(openingRect({ x: 137, y: 120, width: 366, height: 160 }, 0.5)).toEqual({ x: 68, y: 60, width: 183, height: 80 });
  });
});
