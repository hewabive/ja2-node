// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc TracePathRoute (the middle piece from the deltas to the previous and
// @src next node, the out-of-sector U-turns, the arrows at the north, east, south and west offsets, the green start X and
// @src the red end X, a node drawn only while MAP_VIEW_START_X < x < SCREEN_WIDTH - 2 * MAP_GRID_X and
// @src MAP_VIEW_START_Y < y < MAP_VIEW_START_Y + MAP_VIEW_HEIGHT), TraceCharAnimatedRoute (the white arrow running along
// @src the nodes every ARROW_DELAY, PAUSE_DELAY after the last node), the line and arrow frame defines of the map cursor.
// See docs/28 §7.6.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { strategicIndex } from '../../../content/strategic/sector-ids.ts';

const WORLD_MAP_X = 18;

export const PathFrame = {
  SOUTH_LINE: 0,
  NORTH_LINE: 1,
  EAST_LINE: 2,
  WEST_LINE: 3,
  N_TO_E_LINE: 4,
  E_TO_S_LINE: 5,
  W_TO_N_LINE: 6,
  S_TO_W_LINE: 7,
  W_TO_S_LINE: 8,
  N_TO_W_LINE: 9,
  S_TO_E_LINE: 10,
  E_TO_N_LINE: 11,
  W_TO_E_LINE: 12,
  N_TO_S_LINE: 13,
  E_TO_W_LINE: 14,
  S_TO_N_LINE: 15,
  W_NORTH_ARROW: 28,
  W_SOUTH_ARROW: 29,
  W_EAST_ARROW: 30,
  W_WEST_ARROW: 31,
  NORTH_ARROW: 32,
  SOUTH_ARROW: 33,
  EAST_ARROW: 34,
  WEST_ARROW: 35,
  GREEN_X_WEST: 36,
  GREEN_X_EAST: 37,
  GREEN_X_NORTH: 38,
  GREEN_X_SOUTH: 39,
  RED_X_WEST: 40,
  RED_X_EAST: 41,
  RED_X_NORTH: 42,
  RED_X_SOUTH: 43,
} as const;

const NORTH_OFFSET = { x: 9, y: -9 };
const EAST_OFFSET = { x: 11, y: 0 };
const SOUTH_OFFSET = { x: -9, y: 9 };
const WEST_OFFSET = { x: -11, y: 0 };
const WHITE_ARROW_OFFSET = PathFrame.W_NORTH_ARROW - PathFrame.NORTH_ARROW;

export interface PathGeometry {
  readonly startX: number;
  readonly startY: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly viewHeight: number;
  readonly screenWidth: number;
}

export interface PathPiece {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly arrow: { readonly frame: number; readonly x: number; readonly y: number } | null;
}

type Offset = { readonly x: number; readonly y: number };

interface Choice {
  readonly line: number;
  readonly arrow: number;
  readonly offset: Offset;
}

const NO_CHOICE: Choice = { line: -1, arrow: -1, offset: { x: 0, y: 0 } };

function choice(line: number, arrow: number, offset: Offset): Choice {
  return { line, arrow, offset };
}

function uTurn(deltaA: number, deltaB: number, deltaB1: number): boolean {
  const W = WORLD_MAP_X;
  return (
    (deltaB1 === -W && deltaA === -W && deltaB === -1) ||
    (deltaB1 === -W && deltaA === -W && deltaB === 1) ||
    (deltaB1 === W && deltaA === W && deltaB === -1) ||
    (deltaB1 === W && deltaA === W && deltaB === 1) ||
    (deltaB1 === -1 && deltaA === -1 && deltaB === -W) ||
    (deltaB1 === -1 && deltaA === -1 && deltaB === W) ||
    (deltaB1 === 1 && deltaA === 1 && deltaB === -W) ||
    (deltaB1 === 1 && deltaA === 1 && deltaB === W)
  );
}

function middleChoice(prev: number, node: number, next: number, deltaA: number, deltaB: number): Choice {
  const W = WORLD_MAP_X;
  if (prev === next) {
    if (prev + W === node) return choice(PathFrame.S_TO_N_LINE, PathFrame.NORTH_ARROW, NORTH_OFFSET);
    if (prev - W === node) return choice(PathFrame.N_TO_S_LINE, PathFrame.SOUTH_ARROW, SOUTH_OFFSET);
    if (prev + 1 === node) return choice(PathFrame.E_TO_W_LINE, PathFrame.WEST_ARROW, WEST_OFFSET);
    return choice(PathFrame.W_TO_E_LINE, PathFrame.EAST_ARROW, EAST_OFFSET);
  }
  if (deltaA === -1 && deltaB === 1) return choice(PathFrame.WEST_LINE, PathFrame.WEST_ARROW, WEST_OFFSET);
  if (deltaA === 1 && deltaB === -1) return choice(PathFrame.EAST_LINE, PathFrame.EAST_ARROW, EAST_OFFSET);
  if (deltaA === -W && deltaB === W) return choice(PathFrame.NORTH_LINE, PathFrame.NORTH_ARROW, NORTH_OFFSET);
  if (deltaA === W && deltaB === -W) return choice(PathFrame.SOUTH_LINE, PathFrame.SOUTH_ARROW, SOUTH_OFFSET);
  if (deltaA === -W && deltaB === -1) return choice(PathFrame.N_TO_E_LINE, PathFrame.EAST_ARROW, EAST_OFFSET);
  if (deltaA === W && deltaB === 1) return choice(PathFrame.S_TO_W_LINE, PathFrame.WEST_ARROW, WEST_OFFSET);
  if (deltaA === 1 && deltaB === -W) return choice(PathFrame.E_TO_S_LINE, PathFrame.SOUTH_ARROW, SOUTH_OFFSET);
  if (deltaA === -1 && deltaB === W) return choice(PathFrame.W_TO_N_LINE, PathFrame.NORTH_ARROW, NORTH_OFFSET);
  if (deltaA === -1 && deltaB === -W) return choice(PathFrame.W_TO_S_LINE, PathFrame.SOUTH_ARROW, SOUTH_OFFSET);
  if (deltaA === -W && deltaB === 1) return choice(PathFrame.N_TO_W_LINE, PathFrame.WEST_ARROW, WEST_OFFSET);
  if (deltaA === W && deltaB === -1) return choice(PathFrame.S_TO_E_LINE, PathFrame.EAST_ARROW, EAST_OFFSET);
  if (deltaA === 1 && deltaB === W) return choice(PathFrame.E_TO_N_LINE, PathFrame.NORTH_ARROW, NORTH_OFFSET);
  return NO_CHOICE;
}

function endChoice(node: number, prev: number | undefined, next: number | undefined): { choice: Choice; uTurn: boolean } {
  const W = WORLD_MAP_X;
  let picked = NO_CHOICE;
  let turn = false;
  if (prev !== undefined) {
    turn = true;
    const deltaA = node - prev;
    const red =
      deltaA === -1
        ? PathFrame.RED_X_WEST
        : deltaA === 1
          ? PathFrame.RED_X_EAST
          : deltaA === -W
            ? PathFrame.RED_X_NORTH
            : PathFrame.RED_X_SOUTH;
    picked = choice(red, -1, { x: 0, y: 0 });
  }
  if (next !== undefined) {
    turn = false;
    const deltaB = node - next;
    if (deltaB === -1) picked = choice(PathFrame.GREEN_X_EAST, PathFrame.EAST_ARROW, EAST_OFFSET);
    else if (deltaB === 1) picked = choice(PathFrame.GREEN_X_WEST, PathFrame.WEST_ARROW, WEST_OFFSET);
    else if (deltaB === W) picked = choice(PathFrame.GREEN_X_NORTH, PathFrame.NORTH_ARROW, NORTH_OFFSET);
    else picked = choice(PathFrame.GREEN_X_SOUTH, PathFrame.SOUTH_ARROW, SOUTH_OFFSET);
  }
  return { choice: picked, uTurn: turn };
}

function drawn(g: PathGeometry, origin: { readonly x: number; readonly y: number }, x: number, y: number): boolean {
  const left = origin.x + g.startX;
  const top = origin.y + g.startY;
  return left < x && x < g.screenWidth - g.gridX * 2 && top < y && y < top + g.viewHeight;
}

function withoutOffset(c: Choice): Choice {
  return { ...c, offset: { x: 0, y: 0 } };
}

export function tracePathRoute(nodes: readonly Sector[], g: PathGeometry, origin: { readonly x: number; readonly y: number }): PathPiece[] {
  const ids = nodes.map((s) => strategicIndex(s));
  const pieces: PathPiece[] = [];
  let last: Choice = NO_CHOICE;
  for (let k = 0; k < ids.length; k++) {
    const node = ids[k] as number;
    const prev = ids[k - 1];
    const next = ids[k + 1];
    const s = nodes[k] as Sector;
    const x = origin.x + s.x * g.gridX + g.startX;
    const y = origin.y + s.y * g.gridY + g.startY;
    let picked = last;
    let turn = false;
    if (prev !== undefined && next !== undefined) {
      const deltaA = node - prev;
      const deltaB = node - next;
      if (deltaA === 0) return pieces;
      const prevPrev = ids[k - 2];
      const nextNext = ids[k + 2];
      if (prevPrev !== undefined && nextNext !== undefined) turn = uTurn(deltaA, deltaB, next - nextNext);
      const middle = middleChoice(prev, node, next, deltaA, deltaB);
      picked = middle.line !== -1 ? middle : withoutOffset(last);
    } else {
      const end = endChoice(node, prev, next);
      picked = end.choice.line === -1 ? withoutOffset(last) : end.choice.arrow === -1 ? { ...end.choice, arrow: last.arrow } : end.choice;
      turn = end.uTurn;
    }
    last = picked;
    if (picked.line === -1) continue;
    if (!drawn(g, origin, x, y)) continue;
    const arrow = turn || picked.arrow === -1 ? null : { frame: picked.arrow, x: x + picked.offset.x, y: y + picked.offset.y };
    pieces.push({ frame: picked.line, x, y, arrow });
  }
  return pieces;
}

export function whiteArrow(piece: PathPiece): PathPiece | null {
  if (!piece.arrow) return null;
  return { ...piece, arrow: { ...piece.arrow, frame: piece.arrow.frame + WHITE_ARROW_OFFSET } };
}

export const ARROW_DELAY = 20;
export const PAUSE_DELAY = 1000;

export class RouteAnimation {
  #index = 0;
  #since = -1;
  #pausing = true;
  #length = 0;

  reset(): void {
    this.#index = 0;
    this.#since = -1;
    this.#pausing = true;
  }

  update(now: number, length: number): number {
    if (length !== this.#length) {
      this.#length = length;
      if (this.#index >= length) this.reset();
    }
    if (this.#since < 0) {
      this.#since = now;
      return -1;
    }
    if (this.#pausing) {
      if (now - this.#since < PAUSE_DELAY) return -1;
      this.#pausing = false;
      this.#since = now;
      this.#index = 0;
    }
    while (now - this.#since >= ARROW_DELAY * 2) {
      this.#since += ARROW_DELAY * 2;
      this.#index++;
      if (this.#index >= length) {
        this.#pausing = true;
        this.#since = now;
        this.#index = 0;
        return -1;
      }
    }
    return this.#index;
  }
}
