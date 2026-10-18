import { describe, expect, it } from 'vitest';
import { dialogueSpeechPath, type SpeechSource } from './speech-path.ts';

const merc: SpeechSource = { profile: 7, voice: 7, quote: 12, alternate: false, usesNpcFile: false, recruitedNpcOrRpc: false };

describe('dialogue speech paths', () => {
  it('name merc speech by voice and quote', () => {
    expect(dialogueSpeechPath(merc, false)).toBe('speech/007_012.wav');
    expect(dialogueSpeechPath(merc, true)).toBe('speech/007_012.wav');
  });

  it('name NPC speech by profile, folding 151-154 into 151', () => {
    expect(dialogueSpeechPath({ ...merc, profile: 94, usesNpcFile: true }, false)).toBe('npc_speech/094_012.wav');
    expect(dialogueSpeechPath({ ...merc, profile: 153, usesNpcFile: true }, false)).toBe('npc_speech/151_012.wav');
  });

  it('name alternate lines with d_ and keep the profile', () => {
    expect(dialogueSpeechPath({ ...merc, profile: 153, alternate: true, usesNpcFile: true }, true)).toBe('npc_speech/d_153_012.wav');
  });

  it('prefix recruited R.P.C. speech with r_ only in the Russian versions', () => {
    const rpc = { ...merc, profile: 57, voice: 57, recruitedNpcOrRpc: true };
    expect(dialogueSpeechPath(rpc, true)).toBe('speech/r_057_012.wav');
    expect(dialogueSpeechPath(rpc, false)).toBe('speech/057_012.wav');
  });
});
