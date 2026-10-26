import type { Viewport } from './geometry.ts';

export const MAX_DIRTY_RECTS = 8;

export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ScreenShift {
  readonly x: number;
  readonly y: number;
}

export function rectArea(r: ScreenRect): number {
  return (r.x1 - r.x0) * (r.y1 - r.y0);
}

export function wholeViewport(v: Viewport): ScreenRect {
  return { x0: 0, y0: 0, x1: v.width, y1: v.height };
}

export function clipRect(x: number, y: number, width: number, height: number, v: Viewport): ScreenRect | null {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(v.width, Math.ceil(x + width));
  const y1 = Math.min(v.height, Math.ceil(y + height));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function exposedStrips(v: Viewport, shift: ScreenShift): ScreenRect[] {
  const strips: ScreenRect[] = [];
  if (shift.x > 0) strips.push({ x0: 0, y0: 0, x1: shift.x, y1: v.height });
  if (shift.x < 0) strips.push({ x0: v.width + shift.x, y0: 0, x1: v.width, y1: v.height });
  if (shift.y > 0) strips.push({ x0: 0, y0: 0, x1: v.width, y1: shift.y });
  if (shift.y < 0) strips.push({ x0: 0, y0: v.height + shift.y, x1: v.width, y1: v.height });
  return strips;
}

export function boundingRect(rects: readonly ScreenRect[]): ScreenRect {
  return rects.reduce(union);
}

function union(a: ScreenRect, b: ScreenRect): ScreenRect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function growth(into: ScreenRect, r: ScreenRect): number {
  return rectArea(union(into, r)) - rectArea(into) - rectArea(r);
}

export function mergeRects(rects: readonly ScreenRect[], max = MAX_DIRTY_RECTS): ScreenRect[] {
  const merged: ScreenRect[] = [];
  for (const r of rects) {
    let best = -1;
    let bestGrowth = Number.POSITIVE_INFINITY;
    merged.forEach((m, i) => {
      const g = growth(m, r);
      if (g < bestGrowth) {
        best = i;
        bestGrowth = g;
      }
    });
    const into = merged[best];
    if (into && (bestGrowth <= 0 || intersects(into, r) || merged.length >= max)) merged[best] = union(into, r);
    else merged.push(r);
  }
  return merged;
}
