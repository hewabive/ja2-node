import { DIRECTION_INCREMENT, newGridNo } from '../world/grid.ts';

export type HeardDirection = number | 'above' | 'below';

export interface Heard {
  readonly by: number;
  readonly direction: HeardDirection;
  readonly volumeClass: number;
}

const TILES_AWAY_BY_VOLUME_CLASS: readonly number[] = [30, 18, 10, 4];

export function heardSoundTile(listenerGridNo: number, direction: HeardDirection, volumeClass: number): number {
  if (typeof direction !== 'number') return listenerGridNo;
  const step = DIRECTION_INCREMENT[direction] ?? 0;
  const tiles = TILES_AWAY_BY_VOLUME_CLASS[volumeClass] ?? TILES_AWAY_BY_VOLUME_CLASS[0] ?? 0;
  let g = listenerGridNo;
  for (let k = 0; k < tiles; k++) g = newGridNo(g, step);
  return g;
}
