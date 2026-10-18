import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { FormatError } from '../binary/errors.ts';
import {
  AMBIENT_ENTRY_BYTES,
  AmbientTime,
  ambientSoundPath,
  ambientTablePath,
  encodeAmbientTable,
  MAX_AMBIENT_SOUNDS,
  parseAmbientTable,
} from './ambient.ts';
import { parseTilesetDatabase, TILESET_DATABASE_PATH } from './ja2set.ts';

const entries = [
  { minTimeMs: 4000, maxTimeMs: 9000, timeCategory: AmbientTime.DAY, file: 'Bird.wav', volume: 40 },
  { minTimeMs: 2500, maxTimeMs: 2500, timeCategory: AmbientTime.NIGHT, file: 'cricket.wav', volume: 127 },
];

describe('.bad ambient tables', () => {
  it('round-trips a count and 116-byte entries with the file name at offset 9 and the volume at 112', () => {
    const bytes = encodeAmbientTable(entries);
    expect(bytes.length).toBe(2 + 2 * AMBIENT_ENTRY_BYTES);
    expect([...bytes.subarray(0, 2)]).toEqual([2, 0]);
    expect(String.fromCharCode(...bytes.subarray(2 + 9, 2 + 13))).toBe('Bird');
    expect(bytes[2 + 112]).toBe(40);
    expect(parseAmbientTable(bytes)).toEqual(entries);
  });

  it('rejects negative, oversized and truncated counts', () => {
    expect(() => parseAmbientTable(new Uint8Array([0xff, 0xff]))).toThrow(FormatError);
    expect(() => parseAmbientTable(new Uint8Array([MAX_AMBIENT_SOUNDS + 1, 0]))).toThrow(FormatError);
    expect(() => parseAmbientTable(encodeAmbientTable(entries).subarray(0, 200))).toThrow(FormatError);
    expect(parseAmbientTable(new Uint8Array([0, 0]))).toEqual([]);
  });

  it('names the table by the tileset ambient id and the sounds under ambient/', () => {
    expect(ambientTablePath(0)).toBe('ambient/0.bad');
    expect(ambientSoundPath({ file: 'Bird.WAV' })).toBe('ambient/bird.wav');
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('ambient tables of the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ dataDir: process.env.JA2_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('decodes the table of every tileset ambient id and finds each sound it names', async () => {
    const tilesets = parseTilesetDatabase(await data.vfs.read(TILESET_DATABASE_PATH));
    const ids = [...new Set(tilesets.tilesets.map((t) => t.ambientId))];
    for (const id of ids) {
      const bytes = await data.vfs.read(ambientTablePath(id));
      const table = parseAmbientTable(bytes);
      expect(bytes.length).toBe(2 + table.length * AMBIENT_ENTRY_BYTES);
      expect(table.length).toBeGreaterThan(0);
      for (const entry of table) {
        expect(Object.values(AmbientTime)).toContain(entry.timeCategory);
        expect(entry.maxTimeMs).toBeGreaterThanOrEqual(entry.minTimeMs);
        expect(entry.volume).toBeLessThanOrEqual(127);
        expect(data.vfs.stat(ambientSoundPath(entry)), entry.file).toBeDefined();
      }
    }
  });
});
