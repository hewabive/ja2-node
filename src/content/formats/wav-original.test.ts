import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { AUDIO_GAP_BYTES, parseGap } from './gap.ts';
import { decodeWav, type WavEncoding } from './wav.ts';

const SPEECH_SAMPLE_STRIDE = 25;

describe.skipIf(!process.env.JA2_DATA_DIR)('sound files of the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ dataDir: process.env.JA2_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  const wavsIn = (layer: string) => data.vfs.list().filter((f) => f.layer === layer && f.path.endsWith('.wav'));

  async function decodeAll(paths: readonly string[]): Promise<Map<WavEncoding, number>> {
    const encodings = new Map<WavEncoding, number>();
    for (const path of paths) {
      const audio = decodeWav(await data.vfs.read(path));
      expect(audio.frameCount, path).toBeGreaterThan(0);
      expect(audio.channels.every((c) => c.length === audio.frameCount)).toBe(true);
      const first = audio.channels[0] ?? new Float32Array();
      expect(
        first.every((v) => v >= -1 && v <= 1),
        path,
      ).toBe(true);
      encodings.set(audio.info.encoding, (encodings.get(audio.info.encoding) ?? 0) + 1);
    }
    return encodings;
  }

  it('decodes every WAV in sounds.slf, battlesnds.slf and music.slf', async () => {
    const sounds = await decodeAll(wavsIn('sounds.slf').map((f) => f.path));
    expect(Object.fromEntries(sounds)).toEqual({ pcm: 370 });
    const battle = await decodeAll(wavsIn('battlesnds.slf').map((f) => f.path));
    expect(Object.fromEntries(battle)).toEqual({ pcm: 67, imaAdpcm: 1514 });
    const music = await decodeAll(wavsIn('music.slf').map((f) => f.path));
    expect(Object.fromEntries(music)).toEqual({ pcm: 14 });
  });

  it('decodes a sample of the IMA ADPCM speech in speech.slf and npc_speech.slf', async () => {
    const speech = wavsIn('speech.slf');
    const npc = wavsIn('npc_speech.slf');
    expect([speech.length, npc.length]).toEqual([5774, 2794]);
    const sample = [...speech, ...npc].filter((_, i) => i % SPEECH_SAMPLE_STRIDE === 0).map((f) => f.path);
    expect(Object.fromEntries(await decodeAll(sample))).toEqual({ imaAdpcm: sample.length });
  });

  it('parses every .gap file into whole start and end pairs', async () => {
    const gaps = data.vfs.list().filter((f) => f.path.endsWith('.gap'));
    expect(gaps.length).toBe(8353);
    let pairs = 0;
    for (const f of gaps) {
      expect(f.size % AUDIO_GAP_BYTES, f.path).toBe(0);
      const list = parseGap(await data.vfs.read(f.path));
      expect(
        list.every((g) => g.start <= g.end),
        f.path,
      ).toBe(true);
      pairs += list.length;
    }
    expect(pairs).toBeGreaterThan(gaps.length);
  });
});
