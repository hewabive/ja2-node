import { describe, expect, it } from 'vitest';
import { AUDIO_GAP_BYTES, encodeGap, gapPathFor, inAudioGap, parseGap } from './gap.ts';

describe('.gap lip-sync files', () => {
  it('round-trips start and end pairs as little-endian 32-bit milliseconds', () => {
    const gaps = [
      { start: 120, end: 180 },
      { start: 400, end: 70000 },
    ];
    const bytes = encodeGap(gaps);
    expect(bytes.length).toBe(2 * AUDIO_GAP_BYTES);
    expect([...bytes.subarray(0, 4)]).toEqual([120, 0, 0, 0]);
    expect(parseGap(bytes)).toEqual(gaps);
  });

  it('ignores a trailing partial pair and reads an empty file as no gaps', () => {
    const bytes = new Uint8Array([...encodeGap([{ start: 1, end: 2 }]), 9, 9, 9]);
    expect(parseGap(bytes)).toEqual([{ start: 1, end: 2 }]);
    expect(parseGap(new Uint8Array(0))).toEqual([]);
  });

  it('names the .gap file beside its sound', () => {
    expect(gapPathFor('speech/007_012.wav')).toBe('speech/007_012.gap');
    expect(gapPathFor('npc_speech/d_153_001.WAV')).toBe('npc_speech/d_153_001.gap');
    expect(gapPathFor('a.b/noext')).toBe('a.b/noext.gap');
  });

  it('polls like PollAudioGap: strictly inside the first gap not yet ended', () => {
    const gaps = [
      { start: 100, end: 200 },
      { start: 300, end: 350 },
    ];
    const polled = [50, 100, 150, 200, 250, 320, 350, 400].map((t) => inAudioGap(gaps, t));
    expect(polled).toEqual([false, false, true, false, false, true, false, false]);
    expect(inAudioGap([], 10)).toBe(false);
  });
});
