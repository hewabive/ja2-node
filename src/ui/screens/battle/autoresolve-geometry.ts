// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc CalculateRowsAndColumns (columns and rows per side, the panel width, height and
// @src centre column), CalculateSoldierCells (the cell positions, the gap row of a partly filled column, the time modifier
// @src of big battles), BuildInterfaceBuffer (the panel rectangle, the texture, edges, corners and centre pieces),
// @src CreateAutoResolveInterface (the button positions and the vertical offset), RenderAutoResolve (the title, result and
// @src elapsed time positions).

import { idiv, u8, u16 } from '../../../core/int.ts';

export const CELL_PITCH_X = 55;
export const CELL_PITCH_Y = 47;
export const CELL_WIDTH = 50;
export const CELL_HEIGHT = 44;
const ROW_HEIGHT = 48;
const PANEL_STEP_Y = 40;
const TEXTURE_WIDTH = 50;
const TEXTURE_HEIGHT = 40;
const EDGE = 3;
const CORNER_WIDTH = 10;
const CORNER_HEIGHT = 9;
const CENTER_WIDTH = 146;
const CENTER_OFFSET = 323;
const FULL_WIDTH_COLUMNS = 9;
const MIN_COLUMNS = 2;
const MIN_ROWS = 3;
const MAX_COLUMNS = 5;
const MAX_PLAYER_ROWS = 9;
const SQUARE_ROWS = 4;
const HIGH_TOP = 120;
const BUMP_UP = 40;
const ROWS_GAP = 7;
const MERC_START_DY = 6;
const CIV_START_DY = 5;
const ENEMY_START_DY = 5;
const PLAYER_CELL_DX = 3;
const ENEMY_CELL_DX = 141;
const BIG_BATTLE = 12;
const TIME_MODIFIER_BASE = 118;
const TIME_MODIFIER_PER_SOLDIER = 1.5;
const FULL_SPEED = 100;

export const ArPiece = {
  TL_BORDER: 0,
  T_BORDER: 1,
  TR_BORDER: 2,
  L_BORDER: 3,
  C_TEXTURE: 4,
  R_BORDER: 5,
  BL_BORDER: 6,
  B_BORDER: 7,
  BR_BORDER: 8,
  TOP_MIDDLE: 9,
  AUTO_MIDDLE: 10,
  BOT_MIDDLE: 11,
  MERC_PANEL: 12,
  OTHER_PANEL: 13,
} as const;

export interface TeamSizes {
  readonly mercs: number;
  readonly civs: number;
  readonly enemies: number;
}

export interface Grid {
  readonly cols: number;
  readonly rows: number;
}

export interface Screen {
  readonly width: number;
  readonly height: number;
  readonly stdX: number;
  readonly stdY: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ArGeometry {
  readonly rect: Rect;
  readonly centerX: number;
  readonly verticalOffset: number;
  readonly mercs: Grid;
  readonly civs: Grid;
  readonly enemies: Grid;
  readonly mercCells: readonly Point[];
  readonly civCells: readonly Point[];
  readonly enemyCells: readonly Point[];
}

function gridFor(count: number): Grid {
  if (count === 0) return { cols: 0, rows: 0 };
  if (count < 5) return { cols: 1, rows: count };
  if (count < 9 || count === 10) return { cols: 2, rows: idiv(count + 1, 2) };
  if (count < 16) return { cols: 3, rows: idiv(count + 2, 3) };
  return { cols: 4, rows: idiv(count + 3, 4) };
}

function withCols(count: number, cols: number): Grid {
  return { cols, rows: idiv(count + cols - 1, cols) };
}

interface Grids {
  mercs: Grid;
  civs: Grid;
  enemies: Grid;
}

function balancePlayerGrids(t: TeamSizes, g: Grids): void {
  if (t.mercs && t.civs && g.mercs.cols !== g.civs.cols) {
    if (g.mercs.cols < g.civs.cols) g.mercs = withCols(t.mercs, g.civs.cols);
    else g.civs = withCols(t.civs, g.mercs.cols);
  }
  if (t.mercs && t.civs && g.mercs.rows + g.civs.rows > SQUARE_ROWS && g.mercs.cols * 2 < g.mercs.rows + g.civs.rows) {
    g.mercs = withCols(t.mercs, g.mercs.cols + 1);
    g.civs = withCols(t.civs, g.civs.cols + 1);
  }
  if (g.mercs.rows + g.civs.rows > MAX_PLAYER_ROWS) {
    if (g.mercs.cols < MAX_COLUMNS) g.mercs = withCols(t.mercs, g.mercs.cols + 1);
    if (g.civs.cols < MAX_COLUMNS) g.civs = withCols(t.civs, g.mercs.cols);
  }
}

function retractSparseColumns(t: TeamSizes, g: Grids): void {
  if (!t.mercs || !t.civs) return;
  if (g.mercs.rows * g.mercs.cols > t.mercs + g.mercs.rows) g.mercs = { cols: g.mercs.cols - 1, rows: g.mercs.rows };
  if (g.civs.rows * g.civs.cols > t.civs + g.civs.rows) g.civs = { cols: g.civs.cols - 1, rows: g.civs.rows };
}

export function panelHeight(g: Grids): number {
  const height = ROW_HEIGHT * Math.max(MIN_ROWS, Math.max(g.mercs.rows + g.civs.rows, g.enemies.rows));
  return idiv(height + PANEL_STEP_Y - 1, PANEL_STEP_Y) * PANEL_STEP_Y;
}

function bumpedTop(screenHeight: number, height: number): number {
  const top = idiv(screenHeight - height, 2);
  return top > HIGH_TOP ? top - BUMP_UP : top;
}

function playerCells(count: number, grid: Grid, centerX: number, startY: number): Point[] {
  const cells: Point[] = new Array(count);
  const gapStartRow = grid.rows - grid.rows * grid.cols + count;
  let left = count;
  for (let x = 0; x < grid.cols; x++)
    for (let y = 0; left && y < grid.rows; y++, left--) {
      let index = y * grid.cols + grid.cols - x - 1;
      if (y >= gapStartRow) index -= y - gapStartRow + 1;
      cells[index] = { x: centerX + PLAYER_CELL_DX - CELL_PITCH_X * (x + 1), y: startY + y * CELL_PITCH_Y };
    }
  return cells;
}

function enemyCells(count: number, grid: Grid, centerX: number, startY: number): Point[] {
  const cells: Point[] = new Array(count);
  const gapStartRow = grid.rows - grid.rows * grid.cols + count;
  let left = count;
  for (let x = 0; x < grid.cols; x++)
    for (let y = 0; left && y < grid.rows; y++, left--) {
      let index = y * grid.cols + x;
      if (y > gapStartRow) index -= y - gapStartRow;
      cells[index] = { x: u16(centerX + ENEMY_CELL_DX + CELL_PITCH_X * x), y: startY + y * CELL_PITCH_Y };
    }
  return cells;
}

export function autoresolveGeometry(t: TeamSizes, screen: Screen): ArGeometry {
  const g: Grids = { mercs: gridFor(t.mercs), civs: gridFor(t.civs), enemies: gridFor(t.enemies) };
  balancePlayerGrids(t, g);
  const width =
    g.mercs.cols + g.enemies.cols === FULL_WIDTH_COLUMNS
      ? screen.width
      : CENTER_WIDTH + CELL_PITCH_X * (Math.max(Math.max(g.mercs.cols, g.civs.cols), MIN_COLUMNS) + Math.max(g.enemies.cols, MIN_COLUMNS));
  const playerColumns = Math.max(Math.max(g.mercs.cols, MIN_COLUMNS), Math.max(g.civs.cols, MIN_COLUMNS));
  const centerX = screen.stdX + CENTER_OFFSET - idiv(width, 2) + playerColumns * CELL_PITCH_X;
  const height = panelHeight(g);
  retractSparseColumns(t, g);
  const rect = { x: idiv(screen.width - width, 2), y: bumpedTop(screen.height, height), width, height };
  const top = rect.y;
  const playerBlock = idiv(height - ((g.mercs.rows + g.civs.rows) * CELL_PITCH_Y + ROWS_GAP), 2);
  return {
    rect,
    centerX,
    verticalOffset: idiv(screen.height - height, 2) > HIGH_TOP ? -BUMP_UP : 0,
    mercs: g.mercs,
    civs: g.civs,
    enemies: g.enemies,
    mercCells: playerCells(t.mercs, g.mercs, centerX, top + playerBlock + MERC_START_DY),
    civCells: playerCells(t.civs, g.civs, centerX, top + playerBlock + g.mercs.rows * CELL_PITCH_Y + CIV_START_DY),
    enemyCells: enemyCells(
      t.enemies,
      g.enemies,
      centerX,
      top + idiv(height - (g.enemies.rows * CELL_PITCH_Y + ROWS_GAP), 2) + ENEMY_START_DY,
    ),
  };
}

export function timeModifierPercentage(t: TeamSizes): number {
  const largest = Math.max(t.mercs + t.civs, t.enemies);
  return largest > BIG_BATTLE ? u8(Math.trunc(TIME_MODIFIER_BASE - largest * TIME_MODIFIER_PER_SOLDIER)) : FULL_SPEED;
}

export interface PlacedPiece {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

const PIECE_SIZES: Readonly<Record<number, readonly [number, number]>> = {
  [ArPiece.TL_BORDER]: [CORNER_WIDTH, CORNER_HEIGHT],
  [ArPiece.T_BORDER]: [TEXTURE_WIDTH, EDGE],
  [ArPiece.TR_BORDER]: [CORNER_WIDTH, CORNER_HEIGHT],
  [ArPiece.L_BORDER]: [EDGE, TEXTURE_HEIGHT],
  [ArPiece.C_TEXTURE]: [TEXTURE_WIDTH, TEXTURE_HEIGHT],
  [ArPiece.R_BORDER]: [EDGE, TEXTURE_HEIGHT],
  [ArPiece.BL_BORDER]: [CORNER_WIDTH, CORNER_HEIGHT],
  [ArPiece.B_BORDER]: [TEXTURE_WIDTH, EDGE],
  [ArPiece.BR_BORDER]: [CORNER_WIDTH, CORNER_HEIGHT],
  [ArPiece.TOP_MIDDLE]: [CENTER_WIDTH, PANEL_STEP_Y],
  [ArPiece.AUTO_MIDDLE]: [CENTER_WIDTH, PANEL_STEP_Y],
  [ArPiece.BOT_MIDDLE]: [CENTER_WIDTH, PANEL_STEP_Y],
};

export function piecesTouching(pieces: readonly PlacedPiece[], clip: Rect): PlacedPiece[] {
  return pieces.filter((p) => {
    const [w, h] = PIECE_SIZES[p.frame] ?? [0, 0];
    return p.x < clip.x + clip.width && p.x + w > clip.x && p.y < clip.y + clip.height && p.y + h > clip.y;
  });
}

export function panelPieces(geometry: ArGeometry): PlacedPiece[] {
  const { rect, centerX } = geometry;
  const pieces: PlacedPiece[] = [];
  const at = (frame: number, x: number, y: number) => pieces.push({ frame, x: rect.x + x, y: rect.y + y });
  for (let y = 0; y < rect.height; y += TEXTURE_HEIGHT) for (let x = 0; x < rect.width; x += TEXTURE_WIDTH) at(ArPiece.C_TEXTURE, x, y);
  for (let y = 0; y < rect.height; y += TEXTURE_HEIGHT) {
    at(ArPiece.L_BORDER, 0, y);
    at(ArPiece.R_BORDER, rect.width - EDGE, y);
  }
  for (let x = 0; x < rect.width; x += TEXTURE_WIDTH) {
    at(ArPiece.T_BORDER, x, 0);
    at(ArPiece.B_BORDER, x, rect.height - EDGE);
  }
  at(ArPiece.TL_BORDER, 0, 0);
  at(ArPiece.TR_BORDER, rect.width - CORNER_WIDTH, 0);
  at(ArPiece.BL_BORDER, 0, rect.height - CORNER_HEIGHT);
  at(ArPiece.BR_BORDER, rect.width - CORNER_WIDTH, rect.height - CORNER_HEIGHT);
  const middle = centerX - rect.x;
  at(ArPiece.TOP_MIDDLE, middle, 0);
  for (let y = PANEL_STEP_Y; y < rect.height - PANEL_STEP_Y; y += PANEL_STEP_Y) at(ArPiece.AUTO_MIDDLE, middle, y);
  at(ArPiece.BOT_MIDDLE, middle, rect.height - PANEL_STEP_Y);
  return pieces;
}

export const ArButton = {
  PAUSE: 'pause',
  PLAY: 'play',
  FAST: 'fast',
  FINISH: 'finish',
  YES: 'yes',
  NO: 'no',
  BANDAGE: 'bandage',
  RETREAT: 'retreat',
  DONE_WIN: 'doneWin',
  DONE_LOSE: 'doneLose',
} as const;
export type ArButton = (typeof ArButton)[keyof typeof ArButton];

const BUTTON_OFFSETS: Readonly<Record<ArButton, readonly [number, number]>> = {
  play: [11, 0],
  fast: [51, 0],
  finish: [91, 0],
  pause: [11, 34],
  retreat: [51, 34],
  bandage: [11, 5],
  doneWin: [51, 5],
  doneLose: [25, 5],
  yes: [21, 17],
  no: [81, 17],
};

export function buttonPositions(geometry: ArGeometry, screenHeight: number): Readonly<Record<ArButton, Point>> {
  const dy = geometry.verticalOffset + idiv(screenHeight, 2);
  const entries = (Object.entries(BUTTON_OFFSETS) as [ArButton, readonly [number, number]][]).map(
    ([button, [x, y]]) => [button, { x: geometry.centerX + x, y: dy + y }] as const,
  );
  return Object.fromEntries(entries) as Record<ArButton, Point>;
}

const TITLE_DX = 70;
const TITLE_DY = 15;
const LINE_DY = 11;
const OFFER_DX = 16;
const OFFER_Y = 230;
const OFFER_WIDTH = 108;
const CAPTURED_Y = 310;
const INDENT_DX = 12;
const INDENT_Y = 218;
const RESULT_Y = 227;
const ELAPSED_Y = 290;

export interface TextAnchors {
  readonly titleCenterX: number;
  readonly titleY: number;
  readonly sectorY: number;
  readonly ratioY: number;
  readonly offer: Point;
  readonly offerWidth: number;
  readonly captured: Point;
  readonly indent: Point;
  readonly resultY: number;
  readonly elapsedY: number;
}

export function textAnchors(geometry: ArGeometry, stdY: number): TextAnchors {
  const cx = geometry.centerX;
  const offset = geometry.verticalOffset;
  const titleY = geometry.rect.y + TITLE_DY;
  return {
    titleCenterX: cx + TITLE_DX,
    titleY,
    sectorY: titleY + LINE_DY,
    ratioY: titleY + 2 * LINE_DY,
    offer: { x: cx + OFFER_DX, y: OFFER_Y + offset },
    offerWidth: OFFER_WIDTH,
    captured: { x: cx + OFFER_DX, y: CAPTURED_Y },
    indent: { x: cx + INDENT_DX, y: stdY + INDENT_Y + offset },
    resultY: stdY + RESULT_Y + offset,
    elapsedY: stdY + ELAPSED_Y + offset,
  };
}

export function openingRect(rect: Rect, progress: number): Rect {
  return {
    x: u16(Math.trunc(rect.x * progress)),
    y: u16(Math.trunc(rect.y * progress)),
    width: u16(Math.trunc(Math.max(rect.width * progress, 1))),
    height: u16(Math.trunc(Math.max(rect.height * progress, 1))),
  };
}

const HALF = 0.5;
const CUBIC_IN = 4;

export function easeInOutCubic(startMs: number, endMs: number, nowMs: number): number {
  const t = Math.fround((nowMs - startMs) / (endMs - startMs));
  if (t < HALF) return Math.fround(CUBIC_IN * t * t * t);
  return Math.fround((t - 1) * (2 * t - 2) * (2 * t - 2) + 1);
}
