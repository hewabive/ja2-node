import { describe, expect, it } from 'vitest';
import { encodePaletteChunk, encodeSmk, type SmkEncodeAudio, type SmkEncodeFrame } from '../../../stubs/smk-encode.ts';
import { FormatError } from '../binary/errors.ts';
import {
  createFrameReader,
  decodeAudio,
  microsPerFrameOf,
  openSmk,
  SMK_PALETTE_BYTES,
  SMK_RUN_LENGTHS,
  SmkFlag,
  SmkPaletteCommand,
  sixBitToEight,
} from './smk.ts';

const WIDTH = 32;
const HEIGHT = 16;

function paletteOf(colours: readonly [number, number, number][]): Uint8Array {
  const palette = new Uint8Array(SMK_PALETTE_BYTES);
  colours.forEach(([r, g, b], i) => {
    palette.set([sixBitToEight(r), sixBitToEight(g), sixBitToEight(b)], i * 3);
  });
  return palette;
}

function blockFrame(fill: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) pixels[y * WIDTH + x] = fill(x, y);
  return pixels;
}

const PALETTE = paletteOf([
  [0, 0, 0],
  [63, 0, 0],
  [0, 63, 0],
  [0, 0, 63],
  [32, 32, 32],
]);

const FRAMES: SmkEncodeFrame[] = [
  { indices: blockFrame((x, y) => (x < 8 ? 1 : x < 16 ? (((x + y) & 1) === 0 ? 2 : 3) : x < 24 ? (x + y * 3) % 5 : 0)), palette: PALETTE },
  { indices: blockFrame((x, y) => (x < 8 ? 1 : x < 16 ? (((x + y) & 1) === 0 ? 2 : 3) : x < 24 ? (x + y * 3) % 5 : y < 4 ? 4 : 0)) },
  { indices: blockFrame((x, y) => (x < 8 ? 4 : x < 16 ? (((x + y) & 1) === 0 ? 3 : 2) : x < 24 ? (x * y) % 5 : 0)) },
];

function decodeAll(bytes: Uint8Array): Uint8Array[] {
  const reader = createFrameReader(openSmk(bytes));
  const out: Uint8Array[] = [];
  for (let frame = reader.nextFrame(); frame; frame = reader.nextFrame()) out.push(frame.indices.slice());
  return out;
}

function tone(samples: number, period: number, amplitude: number): Int16Array {
  return Int16Array.from({ length: samples }, (_, i) => Math.round(amplitude * Math.sin((2 * Math.PI * i) / period)));
}

describe('Smacker header', () => {
  it('reads the size, frame count, frame rate and audio tracks', () => {
    const audio: SmkEncodeAudio = {
      sampleRate: 22050,
      bitsPerSample: 16,
      compressed: true,
      channels: [tone(100, 20, 1000), tone(100, 25, 900)],
    };
    const video = openSmk(encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: -6666, frames: FRAMES, audio }).bytes);
    expect([video.width, video.height, video.frameCount, video.microsPerFrame]).toEqual([WIDTH, HEIGHT, 3, 66660]);
    expect(video.audioTracks).toEqual([{ track: 0, sampleRate: 22050, channels: 2, bitsPerSample: 16, compressed: true }]);
    expect(video.frames.map((f) => f.hasPalette)).toEqual([true, false, false]);
  });

  it('converts the three frame rate encodings to microseconds', () => {
    expect(microsPerFrameOf(100)).toBe(100_000);
    expect(microsPerFrameOf(-3333)).toBe(33_330);
    expect(microsPerFrameOf(0)).toBe(100_000);
  });

  it('rejects ring frames, Y doubling and interlacing, SMK4, other files and truncation', () => {
    const encode = (flags: number) => encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: 100, frames: FRAMES, flags }).bytes;
    expect(() => openSmk(encode(SmkFlag.RING_FRAME))).toThrow(/ring frames/);
    expect(() => openSmk(encode(SmkFlag.Y_DOUBLED))).toThrow(/Y-interlaced and Y-doubled/);
    expect(() => openSmk(encode(SmkFlag.Y_INTERLACED))).toThrow(/Y-interlaced and Y-doubled/);
    const smk4 = encode(0);
    smk4[3] = '4'.charCodeAt(0);
    expect(() => openSmk(smk4)).toThrow(/Smacker 4/);
    expect(() => openSmk(new TextEncoder().encode('RIFF'.padEnd(200, ' ')))).toThrow(FormatError);
    const whole = encode(0);
    expect(() => openSmk(whole.subarray(0, whole.length - 3))).toThrow(/past the end/);
  });
});

describe('Smacker palette chunks', () => {
  it('scales 6-bit components to 8 bits like the format table', () => {
    expect([0, 15, 16, 32, 63].map(sixBitToEight)).toEqual([0, 0x3c, 0x41, 0x82, 0xff]);
  });

  it('applies skip, copy and colour commands against the previous palette', () => {
    const first = paletteOf([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]);
    const second = first.slice();
    second.set(first.subarray(3, 9), 6 * 3);
    second.set([sixBitToEight(40), sixBitToEight(41), sixBitToEight(42)], 3 * 3);
    const chunk = encodePaletteChunk(
      first.map((v) => v >> 2),
      second.map((v) => v >> 2),
    );
    expect(chunk.slice(1).some((c) => (c & 0xc0) === SmkPaletteCommand.COPY)).toBe(true);
    expect(chunk.slice(1).some((c) => (c & SmkPaletteCommand.SKIP) !== 0)).toBe(true);
    const frames = [
      { indices: new Uint8Array(WIDTH * HEIGHT), palette: first },
      { indices: new Uint8Array(WIDTH * HEIGHT) },
      { indices: new Uint8Array(WIDTH * HEIGHT), palette: second },
    ];
    const reader = createFrameReader(openSmk(encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: 100, frames }).bytes));
    const decoded = [reader.nextFrame(), reader.nextFrame(), reader.nextFrame()];
    expect(decoded.map((f) => f?.paletteChanged)).toEqual([true, false, true]);
    expect([...(decoded[2]?.palette ?? [])]).toEqual([...second]);
    expect(reader.nextFrame()).toBeNull();
  });
});

describe('Smacker video blocks', () => {
  it('decodes solid, mono, full and void blocks back to the source frames', () => {
    const encoded = encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: 100, frames: FRAMES });
    expect(Object.values(encoded.blocks).every((n) => n > 0)).toBe(true);
    expect(decodeAll(encoded.bytes)).toEqual(FRAMES.map((f) => f.indices));
  });

  it('follows the three-value cache of the escape leaves', () => {
    const encoded = encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: 100, frames: FRAMES, useEscapes: true });
    expect(encoded.escapesUsed).toBeGreaterThan(0);
    expect(decodeAll(encoded.bytes)).toEqual(FRAMES.map((f) => f.indices));
  });

  it('splits long chains with the run length table', () => {
    expect(SMK_RUN_LENGTHS.length).toBe(64);
    expect(SMK_RUN_LENGTHS.slice(57)).toEqual([58, 59, 128, 256, 512, 1024, 2048]);
    const width = 512;
    const height = 64;
    const frames = [
      { indices: new Uint8Array(width * height).fill(3), palette: PALETTE },
      { indices: new Uint8Array(width * height).fill(3) },
    ];
    const encoded = encodeSmk({ width, height, frameRate: 100, frames });
    expect(encoded.blocks).toEqual({ mono: 0, full: 0, solid: 2048, void: 2048 });
    expect(decodeAll(encoded.bytes)).toEqual(frames.map((f) => f.indices));
  });

  it('leaves the columns right of the last whole block untouched', () => {
    const width = 10;
    const frames = [{ indices: new Uint8Array(width * 4).fill(2), palette: PALETTE }];
    const reader = createFrameReader(openSmk(encodeSmk({ width, height: 4, frameRate: 100, frames }).bytes));
    const frame = reader.nextFrame();
    expect([...(frame?.indices.subarray(0, width) ?? [])]).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 0, 0]);
  });
});

describe('Smacker audio', () => {
  const frameCount = 3;
  const frames = Array.from({ length: frameCount }, () => ({ indices: new Uint8Array(WIDTH * HEIGHT) }));
  const decode = (audio: SmkEncodeAudio) => {
    const video = openSmk(encodeSmk({ width: WIDTH, height: HEIGHT, frameRate: 10, frames, audio }).bytes);
    const track = video.audioTracks[0];
    if (!track) throw new Error('no audio track');
    return { track, channels: decodeAudio(video, track) };
  };
  const to8Bit = (samples: Int16Array) => samples.map((s) => ((((s >> 8) + 128) & 0xff) - 128) << 8);

  it('decodes compressed 16-bit stereo losslessly across chunks', () => {
    const channels = [tone(1500, 37, 20000), tone(1500, 50, 30000)];
    const { track, channels: out } = decode({ sampleRate: 44100, bitsPerSample: 16, compressed: true, channels });
    expect(track).toMatchObject({ channels: 2, bitsPerSample: 16, compressed: true });
    expect(out).toEqual(channels);
  });

  it('decodes compressed 8-bit mono with wrap-around deltas', () => {
    const channels = [tone(900, 9, 32000)];
    const { channels: out } = decode({ sampleRate: 11025, bitsPerSample: 8, compressed: true, channels });
    expect(out).toEqual(channels.map(to8Bit));
  });

  it('copies uncompressed 16-bit and 8-bit samples', () => {
    const stereo = [tone(600, 10, 5000), tone(600, 12, -7000)];
    expect(decode({ sampleRate: 22050, bitsPerSample: 16, compressed: false, channels: stereo }).channels).toEqual(stereo);
    const mono = [tone(600, 14, 12000)];
    expect(decode({ sampleRate: 22050, bitsPerSample: 8, compressed: false, channels: mono }).channels).toEqual(mono.map(to8Bit));
  });
});
