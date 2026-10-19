// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Line.cc LineDraw (both end points drawn), RectangleDraw (four lines). Diagonal lines use a plain
// @src Bresenham walk instead of the run-length variant.

import type { Area } from '../../ui/draw-list.ts';

function span(x1: number, y1: number, x2: number, y2: number): Area {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1) + 1, height: Math.abs(y2 - y1) + 1 };
}

function bresenhamPoints(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x2 - x1);
  const dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  let x = x1;
  let y = y1;
  for (;;) {
    points.push([x, y]);
    if (x === x2 && y === y2) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function mergeRuns(points: readonly [number, number][], horizontal: boolean): Area[] {
  const runs: Area[] = [];
  let start = points[0];
  let end = start;
  for (const p of points.slice(1)) {
    if (!start || !end) break;
    const sameLine = horizontal ? p[1] === end[1] : p[0] === end[0];
    if (sameLine) {
      end = p;
      continue;
    }
    runs.push(span(start[0], start[1], end[0], end[1]));
    start = p;
    end = p;
  }
  if (start && end) runs.push(span(start[0], start[1], end[0], end[1]));
  return runs;
}

export function lineRuns(x1: number, y1: number, x2: number, y2: number): Area[] {
  if (x1 === x2 || y1 === y2) return [span(x1, y1, x2, y2)];
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  return mergeRuns(bresenhamPoints(x1, y1, x2, y2), horizontal);
}

export function rectangleRuns(x1: number, y1: number, x2: number, y2: number): Area[] {
  return [span(x1, y1, x2, y1), span(x1, y2, x2, y2), span(x1, y1, x1, y2), span(x2, y1, x2, y2)];
}
