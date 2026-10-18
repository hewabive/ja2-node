import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AudioGap, encodeGap, gapPathFor } from '../src/content/formats/gap.ts';
import { npcDialogueFile } from '../src/content/narrative/dialogue-text.ts';
import { dialogueSpeechPath, type SpeechSource } from '../src/content/narrative/speech-path.ts';
import { asArray, asInt, asObject } from '../src/content/strategic/json-fields.ts';
import { SYNTH_DIR } from './audio.ts';
import { encodeStubWav, VOICE } from './stub-wav.ts';
import { formantVoice, normalize, type Part, StubRandom, sequence } from './synth.ts';

export type SpeechFamily = 'merc' | 'npc';

export interface SpeechSet {
  readonly profile: number;
  readonly family: SpeechFamily;
  readonly quotes: number;
}

const SPEECH_SYNTH_DIR = `${SYNTH_DIR}/speech`;
const STUB_PROFILES_FILE = 'profiles.json';
const NPC_TEXT_FILE = 'npc/text.json';
const FEMALE = 1;
const PITCH = { male: [100, 145], female: [190, 245] } as const;
const FORMANT = { male: 700, female: 900 } as const;
const NPC_PITCH_SHIFT = 0.92;
const LEAD_IN = 0.03;
const SYLLABLES = { min: 3, spread: 3 } as const;
const SYLLABLE_SECONDS = [0.06, 0.11] as const;
const GAP_SECONDS = [0.03, 0.07] as const;
const MS_PER_SECOND = 1000;
const PEAK = 0.8;

export interface Blip {
  readonly wav: Uint8Array;
  readonly gaps: readonly AudioGap[];
}

function ms(seconds: number): number {
  return Math.round(seconds * MS_PER_SECOND);
}

export function renderBlip(set: SpeechSet, female: boolean): Blip {
  const r = new StubRandom(`speech/${set.family}/${set.profile}`);
  const range = female ? PITCH.female : PITCH.male;
  const pitch = r.range(range[0], range[1]) * (set.family === 'npc' ? NPC_PITCH_SHIFT : 1);
  const formant = female ? FORMANT.female : FORMANT.male;
  const count = SYLLABLES.min + Math.floor(r.next() * SYLLABLES.spread);
  const parts: Part[] = [];
  const gaps: AudioGap[] = [];
  let at = LEAD_IN;
  for (let k = 0; k < count; k++) {
    const seconds = r.range(SYLLABLE_SECONDS[0], SYLLABLE_SECONDS[1]);
    const from = pitch * r.range(0.95, 1.15);
    parts.push({ at, samples: formantVoice(VOICE.rate, seconds, from, from * r.range(0.85, 1.05), formant) });
    at += seconds;
    if (k === count - 1) break;
    const gap = r.range(GAP_SECONDS[0], GAP_SECONDS[1]);
    gaps.push({ start: ms(at), end: ms(at + gap) });
    at += gap;
  }
  return { wav: encodeStubWav(VOICE, [normalize(sequence(VOICE.rate, parts, at + LEAD_IN), PEAK)]), gaps };
}

function sourceOf(set: SpeechSet, quote: number): SpeechSource {
  const npc = set.family === 'npc';
  return { profile: set.profile, voice: set.profile, quote, alternate: false, usesNpcFile: npc, recruitedNpcOrRpc: false };
}

export function speechPaths(set: SpeechSet): string[] {
  return Array.from({ length: set.quotes }, (_, quote) => dialogueSpeechPath(sourceOf(set, quote), false));
}

async function femaleProfiles(): Promise<Set<number>> {
  const json = JSON.parse(await readFile(join(import.meta.dirname, STUB_PROFILES_FILE), 'utf8'));
  const female = new Set<number>();
  for (const [i, p] of asArray(asObject(json, 'stub profiles').profiles, 'stub profiles').entries()) {
    const o = asObject(p, `stub profiles[${i}]`);
    if (o.sex === FEMALE) female.add(asInt(o.id, `stub profiles[${i}].id`));
  }
  return female;
}

export async function npcSpeechSets(): Promise<SpeechSet[]> {
  const json = JSON.parse(await readFile(join(import.meta.dirname, NPC_TEXT_FILE), 'utf8'));
  const files = asObject(asObject(json, 'stub npc text').files, 'stub npc text.files');
  const sets: SpeechSet[] = [];
  for (const [path, rows] of Object.entries(files)) {
    const m = /^npcdata\/(\d{3})\.edt$/.exec(path);
    if (!m) continue;
    const profile = Number(m[1]);
    if (npcDialogueFile(profile) !== path) continue;
    sets.push({ profile, family: 'npc', quotes: asArray(rows, path).length });
  }
  return sets;
}

export function mercSpeechSets(mercDialogue: ReadonlyMap<number, number>): SpeechSet[] {
  return [...mercDialogue].map(([profile, quotes]) => ({ profile, family: 'merc', quotes }));
}

async function put(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

export async function buildStubSpeech(out: string, sets: readonly SpeechSet[], aliases: Map<string, string>): Promise<string[]> {
  const female = await femaleProfiles();
  const written: string[] = [];
  for (const set of sets) {
    const blip = renderBlip(set, female.has(set.profile));
    const base = `${SPEECH_SYNTH_DIR}/${String(set.profile).padStart(3, '0')}-${set.family}`;
    const wav = await put(out, `${base}.wav`, blip.wav);
    const gap = await put(out, gapPathFor(`${base}.wav`), encodeGap(blip.gaps));
    written.push(wav, gap);
    for (const path of speechPaths(set)) {
      aliases.set(path, wav);
      aliases.set(gapPathFor(path), gap);
    }
  }
  return written;
}
