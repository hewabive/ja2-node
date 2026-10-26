import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { decodeSti } from '../formats/sti.ts';
import { displayRgbFrom565, rgbTo565, shadedDisplayPalette, shadedPalette565 } from './shading.ts';

describe('shade palettes', () => {
  const palette = Uint8Array.from({ length: 768 }, (_, i) => (i * 7) & 0xff);

  it('scales channels by the shade level and quantises to RGB565', () => {
    const normal = shadedPalette565(Uint8Array.of(255, 128, 8, ...new Array(765).fill(0)), 4);
    expect(normal[0]).toBe(rgbTo565(254, 127, 7));
    const [r, g, b] = [palette[15] ?? 0, palette[16] ?? 0, palette[17] ?? 0].map((c) => Math.min(Math.trunc((450 * c) / 256), 255));
    expect(shadedPalette565(palette, 1)[5]).toBe(rgbTo565(r ?? 0, g ?? 0, b ?? 0));
  });

  it('uses luminance for shade 0 and keeps dark colours off pure black', () => {
    const p = new Uint8Array(768);
    p.set([100, 100, 100, 8, 0, 0]);
    const mono = shadedPalette565(p, 0);
    expect(mono[0]).toBe(rgbTo565(195, 195, 195));
    expect(shadedPalette565(p, 4)[1]).toBe(0x0001);
  });

  it('expands RGB565 like SDL', () => {
    expect(displayRgbFrom565(0xffff)).toEqual([255, 255, 255]);
    expect(displayRgbFrom565(0x8410)).toEqual([132, 130, 132]);
    expect(shadedDisplayPalette(palette, 4).length).toBe(768);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('vanilla shade tables', () => {
  it('match shades 1–15 of the original Data/ShadeTables', async () => {
    const dataDir = ORIGINAL_DATA_DIR;
    const d = await openDataVfs({ dataDir });
    try {
      const dir = join(d.dataDir ?? dataDir, 'ShadeTables');
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sha'))
        .slice(0, 25);
      let compared = 0;
      for (const sha of files) {
        const path = d.vfs
          .list()
          .find((f) => f.path.startsWith('tilesets/') && f.path.endsWith(`/${sha.slice(0, -4).toLowerCase()}.sti`))?.path;
        if (!path) continue;
        const sti = decodeSti(await d.vfs.read(path));
        if (sti.kind !== 'indexed') continue;
        const table = new Uint16Array(new Uint8Array(readFileSync(join(dir, sha))).buffer);
        for (let s = 1; s < 16; s++) expect([...shadedPalette565(sti.palette, s)]).toEqual([...table.subarray(s * 256, (s + 1) * 256)]);
        compared++;
      }
      expect(compared).toBeGreaterThan(10);
    } finally {
      await d.close();
    }
  });
});
