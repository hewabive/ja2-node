import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AmbientEntry, AmbientTime, ambientSoundPath, ambientTablePath, encodeAmbientTable } from '../src/content/formats/ambient.ts';
import { SYNTH_DIR, soundClassOf } from './audio.ts';

export const STUB_AMBIENT_ID = 0;
const SFX_DIR = `${SYNTH_DIR}/sfx`;

export const STUB_AMBIENT_ENTRIES: readonly AmbientEntry[] = [
  { minTimeMs: 3000, maxTimeMs: 8000, timeCategory: AmbientTime.DAWN, file: 'birdsong.wav', volume: 30 },
  { minTimeMs: 6000, maxTimeMs: 15000, timeCategory: AmbientTime.DAY, file: 'birdsong.wav', volume: 25 },
  { minTimeMs: 5000, maxTimeMs: 12000, timeCategory: AmbientTime.DUSK, file: 'owl.wav', volume: 30 },
  { minTimeMs: 2000, maxTimeMs: 6000, timeCategory: AmbientTime.NIGHT, file: 'crickets.wav', volume: 20 },
  { minTimeMs: 10000, maxTimeMs: 25000, timeCategory: AmbientTime.NIGHT, file: 'owl.wav', volume: 25 },
];

export async function buildStubAmbient(out: string, written: readonly string[], aliases: Map<string, string>): Promise<string[]> {
  const path = ambientTablePath(STUB_AMBIENT_ID);
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), encodeAmbientTable(STUB_AMBIENT_ENTRIES));
  for (const entry of STUB_AMBIENT_ENTRIES) {
    const sound = ambientSoundPath(entry);
    const target = `${SFX_DIR}/${soundClassOf(sound)}.wav`;
    if (!written.includes(target)) throw new RangeError(`no stub sound for ambient ${sound}`);
    aliases.set(sound, target);
  }
  return [path];
}
