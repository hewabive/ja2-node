import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SMK_PALETTE_BYTES, sixBitToEight } from '../src/content/formats/smk.ts';
import { IndexedRaster } from './raster.ts';
import { encodeSmk, type SmkEncodeAudio, type SmkEncodeFrame } from './smk-encode.ts';

export const STUB_SPLASH_PATH = 'intro/splashscreen.smk';
export const STUB_SPLASH_WIDTH = 640;
export const STUB_SPLASH_HEIGHT = 480;
export const STUB_SPLASH_FRAMES = 30;
export const STUB_SPLASH_FRAME_RATE = -6666;
export const STUB_SPLASH_SAMPLE_RATE = 22050;
export const STUB_SPLASH_TITLE = 'ja2-node';

export const SplashColour = { BACKGROUND: 0, TITLE: 1, RAMP_FIRST: 2, RAMP_COUNT: 32, GREY_FIRST: 34 } as const;

const GLYPH_ROWS: Readonly<Record<string, readonly string[]>> = {
  j: ['...#.', '.....', '..##.', '...#.', '...#.', '#..#.', '.##..'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
};
const GLYPH_COLUMNS = 5;
const GLYPH_SCALE = 10;
const GLYPH_ADVANCE = (GLYPH_COLUMNS + 1) * GLYPH_SCALE;
const TITLE_X = 82;
const TITLE_Y = 150;
const BAND_X = 80;
const BAND_Y = 260;
const BAND_WIDTH = 480;
const BAND_HEIGHT = 16;
const BAND_STEP_X = 7;
const BAND_STEP_Y = 3;
const PROGRESS_Y = 300;
const PROGRESS_HEIGHT = 8;
const BLOCK = 4;
const ROTATE_EVERY = 3;
const GREY_LEVELS = 256 - SplashColour.GREY_FIRST;
const SIX_BIT_MAX = 63;

const NOTES = [
  { frequency: 440, amplitude: 6000, seconds: 1 },
  { frequency: 660, amplitude: 5000, seconds: 1 },
] as const;
const RIGHT_GAIN_NUMERATOR = 3;
const RIGHT_GAIN_DENOMINATOR = 4;
const ENVELOPE_STEPS = 8;
const TRIANGLE_SLOPE = 4;

function rgb6(palette: Uint8Array, index: number, r: number, g: number, b: number): void {
  palette[index * 3] = sixBitToEight(r);
  palette[index * 3 + 1] = sixBitToEight(g);
  palette[index * 3 + 2] = sixBitToEight(b);
}

function rampColour(step: number): [number, number, number] {
  const third = SplashColour.RAMP_COUNT / 3;
  const phase = (step % SplashColour.RAMP_COUNT) / third;
  const rise = Math.round((phase % 1) * SIX_BIT_MAX);
  const fall = SIX_BIT_MAX - rise;
  if (phase < 1) return [fall, rise, 16];
  if (phase < 2) return [16, fall, rise];
  return [rise, 16, fall];
}

function basePalette(): Uint8Array {
  const palette = new Uint8Array(SMK_PALETTE_BYTES);
  rgb6(palette, SplashColour.BACKGROUND, 3, 5, 10);
  rgb6(palette, SplashColour.TITLE, 60, 46, 18);
  for (let i = 0; i < SplashColour.RAMP_COUNT; i++) rgb6(palette, SplashColour.RAMP_FIRST + i, ...rampColour(i));
  for (let i = 0; i < GREY_LEVELS; i++) {
    const level = 1 + Math.floor((i * (SIX_BIT_MAX - 1)) / (GREY_LEVELS - 1));
    rgb6(palette, SplashColour.GREY_FIRST + i, level, level, level);
  }
  return palette;
}

function rotateRamp(palette: Uint8Array): Uint8Array {
  const next = palette.slice();
  const first = SplashColour.RAMP_FIRST * 3;
  const ramp = palette.subarray(first, first + SplashColour.RAMP_COUNT * 3);
  next.set(ramp.subarray(3), first);
  next.set(ramp.subarray(0, 3), first + (SplashColour.RAMP_COUNT - 1) * 3);
  return next;
}

function drawTitle(raster: IndexedRaster): void {
  [...STUB_SPLASH_TITLE].forEach((char, n) => {
    const rows = GLYPH_ROWS[char];
    if (!rows) throw new Error(`no stub glyph for ${char}`);
    rows.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '#') {
          raster.rect(
            TITLE_X + n * GLYPH_ADVANCE + x * GLYPH_SCALE,
            TITLE_Y + y * GLYPH_SCALE,
            GLYPH_SCALE,
            GLYPH_SCALE,
            SplashColour.TITLE,
          );
        }
      });
    });
  });
}

function drawBand(raster: IndexedRaster): void {
  for (let y = 0; y < BAND_HEIGHT; y++) {
    for (let x = 0; x < BAND_WIDTH; x++) {
      raster.set(BAND_X + x, BAND_Y + y, SplashColour.RAMP_FIRST + ((x * BAND_STEP_X + y * BAND_STEP_Y) % SplashColour.RAMP_COUNT));
    }
  }
}

function progressWidth(frame: number): number {
  return Math.floor((BAND_WIDTH * frame) / (STUB_SPLASH_FRAMES - 1) / BLOCK) * BLOCK;
}

export function stubSplashFrames(): SmkEncodeFrame[] {
  const raster = new IndexedRaster(STUB_SPLASH_WIDTH, STUB_SPLASH_HEIGHT);
  drawTitle(raster);
  drawBand(raster);
  let palette = basePalette();
  return Array.from({ length: STUB_SPLASH_FRAMES }, (_, frame) => {
    raster.rect(BAND_X, PROGRESS_Y, progressWidth(frame), PROGRESS_HEIGHT, SplashColour.TITLE);
    const indices = raster.pixels.slice();
    if (frame === 0) return { indices, palette };
    if (frame % ROTATE_EVERY !== 0) return { indices };
    palette = rotateRamp(palette);
    return { indices, palette };
  });
}

function triangle(samples: number, frequency: number, amplitude: number): Int16Array {
  const out = new Int16Array(samples);
  const segment = Math.ceil(samples / ENVELOPE_STEPS);
  let value = 0;
  let direction = 1;
  for (let i = 0; i < samples; i++) {
    const level = Math.round((amplitude * (ENVELOPE_STEPS - Math.floor(i / segment))) / ENVELOPE_STEPS);
    const step = Math.max(1, Math.round((TRIANGLE_SLOPE * level * frequency) / STUB_SPLASH_SAMPLE_RATE));
    value += direction * step;
    if (value >= level) {
      value = level;
      direction = -1;
    } else if (value <= -level) {
      value = -level;
      direction = 1;
    }
    out[i] = value;
  }
  return out;
}

export function stubSplashAudio(): SmkEncodeAudio {
  const left = NOTES.map((note) => triangle(note.seconds * STUB_SPLASH_SAMPLE_RATE, note.frequency, note.amplitude));
  const right = NOTES.map((note) =>
    triangle(note.seconds * STUB_SPLASH_SAMPLE_RATE, note.frequency, (note.amplitude * RIGHT_GAIN_NUMERATOR) / RIGHT_GAIN_DENOMINATOR),
  );
  const join = (parts: Int16Array[]): Int16Array => {
    const out = new Int16Array(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  return { sampleRate: STUB_SPLASH_SAMPLE_RATE, bitsPerSample: 16, compressed: true, channels: [join(left), join(right)] };
}

export function encodeStubSplash(): Uint8Array {
  return encodeSmk({
    width: STUB_SPLASH_WIDTH,
    height: STUB_SPLASH_HEIGHT,
    frameRate: STUB_SPLASH_FRAME_RATE,
    frames: stubSplashFrames(),
    audio: stubSplashAudio(),
  }).bytes;
}

export async function buildStubVideo(out: string): Promise<string[]> {
  const path = join(out, STUB_SPLASH_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encodeStubSplash());
  return [STUB_SPLASH_PATH];
}
