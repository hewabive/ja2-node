import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asArray, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { encodeStubWav, LOW } from './stub-wav.ts';
import { envelope, highpass, noise, normalize, type Part, StubRandom, sequence, tone, type Wave } from './synth.ts';

export const MUSIC_TABLE_PATH = 'externalized/music.json';

interface MusicStyle {
  readonly tempo: number;
  readonly root: number;
  readonly scale: readonly number[];
  readonly lead: Wave;
  readonly bass: Wave;
  readonly drums: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const PENTATONIC = [0, 2, 4, 7, 9, 12];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12];
const DIMINISHED = [0, 1, 3, 4, 6, 7, 9, 10, 12];

const CALM: MusicStyle = { tempo: 84, root: 196, scale: MINOR_PENTATONIC, lead: 'triangle', bass: 'triangle', drums: false };
const STYLES: Readonly<Record<string, MusicStyle>> = {
  main_menu: { tempo: 96, root: 220, scale: MAJOR, lead: 'square', bass: 'triangle', drums: false },
  laptop: { tempo: 112, root: 262, scale: PENTATONIC, lead: 'triangle', bass: 'square', drums: true },
  tactical: CALM,
  tactical_enemypresent: { tempo: 100, root: 185, scale: MINOR, lead: 'square', bass: 'triangle', drums: true },
  tactical_battle: { tempo: 144, root: 165, scale: MINOR, lead: 'saw', bass: 'square', drums: true },
  tactical_creature: { tempo: 72, root: 147, scale: DIMINISHED, lead: 'sine', bass: 'triangle', drums: false },
  tactical_creature_enemypresent: { tempo: 72, root: 147, scale: DIMINISHED, lead: 'sine', bass: 'triangle', drums: false },
  tactical_creature_battle: { tempo: 132, root: 139, scale: DIMINISHED, lead: 'saw', bass: 'square', drums: true },
  tactical_victory: { tempo: 120, root: 262, scale: MAJOR, lead: 'square', bass: 'triangle', drums: true },
  tactical_defeat: { tempo: 60, root: 131, scale: MINOR, lead: 'triangle', bass: 'triangle', drums: false },
};

const TARGET_SECONDS = 4;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 2;
const SECONDS_PER_MINUTE = 60;
const SEMITONES_PER_OCTAVE = 12;
const FIFTH = 7;
const LEAD_GAIN = 0.45;
const BASS_GAIN = 0.35;
const KICK_GAIN = 0.5;
const HAT_GAIN = 0.12;
const REST_CHANCE = 0.2;
const PEAK = 0.8;

export interface MusicTrack {
  readonly mode: string;
  readonly path: string;
}

function pitch(root: number, semitones: number): number {
  return root * 2 ** (semitones / SEMITONES_PER_OCTAVE);
}

function note(rate: number, seconds: number, frequency: number, wave: Wave): Float32Array {
  return envelope(tone(rate, seconds, frequency, frequency, wave), rate, 0.004, seconds * 0.5);
}

function melody(r: StubRandom, style: MusicStyle, rate: number, steps: number, stepSeconds: number): Part[] {
  const parts: Part[] = [];
  let degree = Math.floor(style.scale.length / 2);
  for (let k = 0; k < steps; k++) {
    degree = Math.max(0, Math.min(style.scale.length - 1, degree + r.pick([-2, -1, -1, 0, 1, 1, 2])));
    if (k % STEPS_PER_BEAT !== 0 && r.next() < REST_CHANCE) continue;
    const semitones = (style.scale[degree] ?? 0) + SEMITONES_PER_OCTAVE;
    parts.push({ at: k * stepSeconds, samples: note(rate, stepSeconds * 0.9, pitch(style.root, semitones), style.lead), gain: LEAD_GAIN });
  }
  return parts;
}

function bassLine(style: MusicStyle, rate: number, beats: number, beatSeconds: number): Part[] {
  return Array.from({ length: beats }, (_, k): Part => {
    const semitones = k % BEATS_PER_BAR === 2 ? FIFTH - SEMITONES_PER_OCTAVE : -SEMITONES_PER_OCTAVE;
    return { at: k * beatSeconds, samples: note(rate, beatSeconds * 0.8, pitch(style.root, semitones), style.bass), gain: BASS_GAIN };
  });
}

function drums(r: StubRandom, rate: number, beats: number, beatSeconds: number): Part[] {
  const kick = envelope(tone(rate, 0.15, 120, 45), rate, 0.002, 0.05);
  const hat = envelope(highpass(noise(r, rate, 0.05), rate, 4000), rate, 0.001, 0.01);
  return Array.from({ length: beats }, (_, k): Part[] => [
    ...(k % 2 === 0 ? [{ at: k * beatSeconds, samples: kick, gain: KICK_GAIN }] : []),
    { at: (k + 0.5) * beatSeconds, samples: hat, gain: HAT_GAIN },
  ]).flat();
}

export function renderTrack(track: MusicTrack): Uint8Array {
  const style = STYLES[track.mode] ?? CALM;
  const rate = LOW.rate;
  const beatSeconds = SECONDS_PER_MINUTE / style.tempo;
  const bars = Math.max(1, Math.round(TARGET_SECONDS / (beatSeconds * BEATS_PER_BAR)));
  const beats = bars * BEATS_PER_BAR;
  const r = new StubRandom(track.path);
  const parts = [
    ...melody(r, style, rate, beats * STEPS_PER_BEAT, beatSeconds / STEPS_PER_BEAT),
    ...bassLine(style, rate, beats, beatSeconds),
    ...(style.drums ? drums(r, rate, beats, beatSeconds) : []),
  ];
  const loop = sequence(rate, parts, beats * beatSeconds).subarray(0, Math.round(beats * beatSeconds * rate));
  return encodeStubWav(LOW, [normalize(loop, PEAK)]);
}

export async function musicTracks(): Promise<MusicTrack[]> {
  const table = asObject(parseJsonc(await readFile(join(PROJECT_DATA_DIR, MUSIC_TABLE_PATH), 'utf8')), 'music');
  const tracks = new Map<string, MusicTrack>();
  for (const [mode, list] of Object.entries(table)) {
    for (const [i, value] of asArray(list, `music.${mode}`).entries()) {
      const path = asString(value, `music.${mode}[${i}]`).toLowerCase();
      if (!tracks.has(path)) tracks.set(path, { mode, path });
    }
  }
  return [...tracks.values()];
}

export async function buildStubMusic(out: string): Promise<string[]> {
  const written: string[] = [];
  for (const track of await musicTracks()) {
    await mkdir(dirname(join(out, track.path)), { recursive: true });
    await writeFile(join(out, track.path), renderTrack(track));
    written.push(track.path);
  }
  return written;
}
