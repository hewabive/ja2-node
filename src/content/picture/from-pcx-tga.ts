import type { Pcx } from '../formats/pcx.ts';
import type { Tga } from '../formats/tga.ts';
import type { RgbaPicture } from './picture.ts';

export function pictureFromPcx(pcx: Pcx): RgbaPicture {
  const pixels = new Uint8Array(pcx.width * pcx.height * 4);
  pcx.pixels.forEach((index, i) => {
    pixels.set([pcx.palette[index * 3] ?? 0, pcx.palette[index * 3 + 1] ?? 0, pcx.palette[index * 3 + 2] ?? 0, 255], i * 4);
  });
  return { kind: 'rgba', width: pcx.width, height: pcx.height, pixels };
}

export function pictureFromTga(tga: Tga): RgbaPicture {
  return { kind: 'rgba', width: tga.width, height: tga.height, pixels: tga.rgba };
}
