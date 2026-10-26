import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { createFrameReader, decodeAudio, openSmk } from './smk.ts';

const DECODE_TIMEOUT_MS = 120_000;

const PLAYED_VIDEOS = [
  'rebel_cr',
  'omerta',
  'prague_cr',
  'prague',
  'throne_mig',
  'throne_nomig',
  'heli_flyby',
  'heli_sky',
  'heli_nosky',
  'splashscreen',
] as const;
const UNUSED_LOGO = 'talonsoftid_endhold';
const FIFTEEN_FPS_MICROS = 66_660;
const THIRTY_FPS_MICROS = 33_330;
const FIRST_FRAMES = 12;
const MICROS_PER_SECOND = 1_000_000;

describe.skipIf(!ORIGINAL_DATA_DIR)('Smacker videos of the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it(
    'opens all eleven videos of the intro archive',
    async () => {
      const videos = data.vfs.list().filter((f) => f.path.endsWith('.smk'));
      expect(videos.map((f) => f.path.replace(/^intro\/|\.smk$/g, '')).sort()).toEqual([...PLAYED_VIDEOS, UNUSED_LOGO].sort());
      for (const f of videos) expect(openSmk(await data.vfs.read(f.path)).frameCount, f.path).toBeGreaterThan(0);
    },
    DECODE_TIMEOUT_MS,
  );

  it.each(PLAYED_VIDEOS)('%s is SMK2 640x480 with one 16-bit stereo 44.1 kHz track, and its first frames decode', async (name) => {
    const video = openSmk(await data.vfs.read(`intro/${name}.smk`));
    expect([video.width, video.height, video.flags]).toEqual([640, 480, 0]);
    expect(video.microsPerFrame).toBe(name === 'splashscreen' ? THIRTY_FPS_MICROS : FIFTEEN_FPS_MICROS);
    expect(video.audioTracks).toEqual([{ track: 0, sampleRate: 44100, channels: 2, bitsPerSample: 16, compressed: true }]);
    const reader = createFrameReader(video);
    for (let i = 0; i < FIRST_FRAMES; i++) expect(reader.nextFrame()?.index).toBe(i);
  });

  it(
    'decodes every frame of the beginning and the splash, and audio as long as the video',
    async () => {
      for (const name of ['rebel_cr', 'prague_cr', 'splashscreen']) {
        const video = openSmk(await data.vfs.read(`intro/${name}.smk`));
        const reader = createFrameReader(video);
        let colours = 0;
        for (let frame = reader.nextFrame(); frame; frame = reader.nextFrame()) colours = Math.max(colours, new Set(frame.indices).size);
        expect(reader.frameIndex, name).toBe(video.frameCount);
        expect(colours, name).toBeGreaterThan(1);
        const [track] = video.audioTracks;
        if (!track) throw new Error(`${name} has no audio`);
        const channels = decodeAudio(video, track);
        const videoSamples = (video.frameCount * video.microsPerFrame * track.sampleRate) / MICROS_PER_SECOND;
        expect(channels.length).toBe(2);
        expect(channels[0]?.length).toBe(channels[1]?.length);
        expect(Math.abs((channels[0]?.length ?? 0) - videoSamples), name).toBeLessThan(
          (track.sampleRate * video.microsPerFrame) / MICROS_PER_SECOND,
        );
      }
    },
    DECODE_TIMEOUT_MS,
  );
});
