export const WORLD_SIDE = 160;

export function column(g: number): number {
  return g % WORLD_SIDE;
}

export function row(g: number): number {
  return Math.trunc(g / WORLD_SIDE);
}

export function gridNo(x: number, y: number): number {
  return y * WORLD_SIDE + x;
}

export function tiles(a: number, b: number): number {
  return Math.hypot(column(a) - column(b), row(a) - row(b));
}

export function towards(from: number, to: number, steps: number): number {
  const dx = column(to) - column(from);
  const dy = row(to) - row(from);
  const length = Math.hypot(dx, dy);
  if (length <= steps) return to;
  const scale = steps / length;
  return gridNo(column(from) + Math.round(dx * scale), row(from) + Math.round(dy * scale));
}

export function centroid(points: readonly number[]): number {
  const n = points.length;
  if (n === 0) throw new Error('centroid of nothing');
  const x = Math.round(points.reduce((sum, g) => sum + column(g), 0) / n);
  const y = Math.round(points.reduce((sum, g) => sum + row(g), 0) / n);
  return gridNo(x, y);
}

export function nearest(from: number, points: readonly number[]): number | null {
  let best: number | null = null;
  for (const g of points) if (best === null || tiles(from, g) < tiles(from, best)) best = g;
  return best;
}

export function ring(center: number, radius: number): number[] {
  const out: number[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = column(center) + dx;
      const y = row(center) + dy;
      if (x >= 0 && y >= 0 && x < WORLD_SIDE && y < WORLD_SIDE) out.push(gridNo(x, y));
    }
  return out;
}
