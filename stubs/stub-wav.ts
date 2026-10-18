import { encodeWavImaAdpcm, encodeWavPcm } from './wav-encode.ts';

export type StubEncoding = 'pcm8' | 'pcm16' | 'ima';

export interface StubFormat {
  readonly encoding: StubEncoding;
  readonly rate: number;
  readonly stereo?: boolean;
}

export const LOW_RATE = 11025;
export const HIGH_RATE = 22050;
export const IMA_BLOCK_ALIGN = 256;

export const LOW: StubFormat = { encoding: 'pcm8', rate: LOW_RATE };
export const HIGH: StubFormat = { encoding: 'pcm16', rate: HIGH_RATE };
export const WIDE: StubFormat = { encoding: 'pcm16', rate: HIGH_RATE, stereo: true };
export const VOICE: StubFormat = { encoding: 'ima', rate: LOW_RATE };

export function encodeStubWav(format: StubFormat, channels: readonly Float32Array[]): Uint8Array {
  const signal = { sampleRate: format.rate, channels };
  if (format.encoding === 'ima') return encodeWavImaAdpcm(signal, IMA_BLOCK_ALIGN).bytes;
  return encodeWavPcm(signal, format.encoding === 'pcm8' ? 8 : 16);
}
