import { describe, expect, it } from 'vitest';
import { pcmWav } from '../../../tests/support/fake-audio.ts';
import { mercDialogueFile, npcDialogueFile, textKey } from '../narrative/dialogue-text.ts';
import {
  decodeSpeechLengths,
  encodeSpeechLengths,
  isSpeechFile,
  SPEECH_LENGTHS_PATH,
  SpeechLengths,
  speechLengthMs,
  withSpeechLengths,
} from './speech-lengths.ts';

describe('the voice lengths', () => {
  it('times a sample by its frames, rounded up to a whole millisecond, and skips what is not a sample', () => {
    expect(speechLengthMs(pcmWav(11_025))).toBe(1000);
    expect(speechLengthMs(pcmWav(11_026))).toBe(1001);
    expect(speechLengthMs(new TextEncoder().encode('noise'))).toBeNull();
  });

  it('knows the speech files of the two speech folders only', () => {
    expect(isSpeechFile('npc_speech/057_000.wav')).toBe(true);
    expect(isSpeechFile('speech/r_003_010.wav')).toBe(true);
    expect(isSpeechFile('sounds/shot.wav')).toBe(false);
    expect(isSpeechFile('speech/sub/003_010.wav')).toBe(false);
  });

  it('round-trips by path and finds a line by its speech file, with the Russian prefix of a recruited R.P.C.', async () => {
    const lengths = new Map([
      ['npc_speech/057_003.wav', 2008],
      ['speech/057_010.wav', 900],
      ['speech/r_057_010.wav', 950],
    ]);
    expect(decodeSpeechLengths(encodeSpeechLengths(lengths))).toEqual(lengths);
    const npcLine = { profile: 57, textKey: textKey(npcDialogueFile(57), 3), recruitedNpcOrRpc: false };
    const mercLine = { profile: 57, textKey: textKey(mercDialogueFile(57), 10), recruitedNpcOrRpc: true };
    const english = new SpeechLengths(lengths, false);
    expect(english.ms(npcLine)).toBe(2008);
    expect(english.ms(mercLine)).toBe(900);
    expect(english.ms({ ...npcLine, textKey: textKey(npcDialogueFile(57), 4) })).toBeNull();
    expect(new SpeechLengths(lengths, true).ms(mercLine)).toBe(950);
    const loaded = await SpeechLengths.load(async (path) => (path === SPEECH_LENGTHS_PATH ? encodeSpeechLengths(lengths) : null), false);
    expect(loaded.size).toBe(3);
    expect((await SpeechLengths.load(async () => null, false)).size).toBe(0);
  });

  it('derives the lengths file from the speech files of a listing, those of the stub pack behind those of the data, reading only their headers', async () => {
    const files = new Map([
      ['npc_speech/057_000.wav', pcmWav(22_050)],
      ['stubs/npc_speech/057_000.wav', pcmWav(11_025)],
      ['stubs/npc_speech/094_014.wav', pcmWav(5_513)],
      ['sounds/shot.wav', pcmWav(10)],
    ]);
    const reads: [string, number | undefined, number | undefined][] = [];
    const source = {
      list: () => [...files].map(([path, bytes]) => ({ path, size: bytes.length, layer: 'data-dir' })),
      read: async (path: string, start?: number, end?: number) => {
        reads.push([path, start, end]);
        return (files.get(path) ?? new Uint8Array()).slice(start, end);
      },
    };
    const map = new TextEncoder().encode('map');
    const read = withSpeechLengths(async (path) => (path === 'maps/a9.dat' ? map : null), source);
    const lengths = await SpeechLengths.load(read, false);
    expect(lengths.ms({ profile: 57, textKey: textKey(npcDialogueFile(57), 0), recruitedNpcOrRpc: false })).toBe(2000);
    expect(lengths.ms({ profile: 94, textKey: textKey(npcDialogueFile(94), 14), recruitedNpcOrRpc: false })).toBe(501);
    expect(reads).toEqual([
      ['npc_speech/057_000.wav', 0, 256],
      ['stubs/npc_speech/094_014.wav', 0, 256],
    ]);
    expect(await read('maps/a9.dat')).toBe(map);
    expect(await withSpeechLengths(async () => null, { list: () => [], read: source.read })(SPEECH_LENGTHS_PATH)).toBeNull();
  });
});
