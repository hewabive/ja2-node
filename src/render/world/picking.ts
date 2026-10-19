import type { PlacedSoldier } from './dynamic-scene.ts';

const TRANSPARENT = 0;
const SHADOW_INDEX = 254;

function opaqueAt(s: PlacedSoldier, sx: number, sy: number): boolean {
  const x = Math.floor(sx) - s.x;
  const y = Math.floor(sy) - s.y;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return false;
  const index = s.sprite.pixels[y * s.width + x] ?? TRANSPARENT;
  return index !== TRANSPARENT && index !== SHADOW_INDEX;
}

export function pickSoldierAt(placed: readonly PlacedSoldier[], sx: number, sy: number): number | null {
  for (const topmost of [true, false]) {
    for (let i = placed.length - 1; i >= 0; i--) {
      const s = placed[i] as PlacedSoldier;
      if (s.topmost === topmost && opaqueAt(s, sx, sy)) return s.id;
    }
  }
  return null;
}
