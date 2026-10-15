import { rgb565ToRgba } from '../formats/rgb565.ts';
import type { Sti } from '../formats/sti.ts';
import type { Picture } from './picture.ts';

export function pictureFromSti(sti: Sti): Picture {
  if (sti.kind === 'rgb') {
    return { kind: 'rgba', width: sti.width, height: sti.height, pixels: rgb565ToRgba(sti.pixels) };
  }
  return {
    kind: 'indexed',
    palette: sti.palette,
    frames: sti.subImages.map((s) => ({
      width: s.width,
      height: s.height,
      offsetX: s.offsetX,
      offsetY: s.offsetY,
      pixels: s.pixels,
    })),
  };
}
