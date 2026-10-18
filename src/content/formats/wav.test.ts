import { describe, expect, it } from 'vitest';
import { encodeWavImaAdpcm, encodeWavPcm, type Signal, toInt16 } from '../../../stubs/wav-encode.ts';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { decodeWav, IMA_STEP_TABLE, imaAdpcmExpand, readWavInfo, WAVE_FORMAT_IMA_ADPCM, wavDurationMs } from './wav.ts';

const RATE = 11025;

function sine(frames: number, frequency: number, amplitude = 0.6, phase = 0): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin(phase + (2 * Math.PI * frequency * i) / RATE));
}

function mono(samples: Float32Array): Signal {
  return { sampleRate: RATE, channels: [samples] };
}

function snrDb(reference: Float32Array, decoded: Float32Array): number {
  let signal = 0;
  let error = 0;
  reference.forEach((v, i) => {
    signal += v * v;
    error += (v - (decoded[i] ?? 0)) ** 2;
  });
  return 10 * Math.log10(signal / error);
}

function maxError(reference: Float32Array, decoded: Float32Array | undefined): number {
  if (!decoded || decoded.length !== reference.length) return Number.POSITIVE_INFINITY;
  return reference.reduce((max, v, i) => Math.max(max, Math.abs(v - (decoded[i] ?? 0))), 0);
}

function riff(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const w = new BinaryWriter();
  const body = chunks.reduce((n, [, b]) => n + 8 + b.length + (b.length & 1), 4);
  w.bytes(new TextEncoder().encode('RIFF')).u32(body).bytes(new TextEncoder().encode('WAVE'));
  for (const [id, b] of chunks) {
    w.bytes(new TextEncoder().encode(id)).u32(b.length).bytes(b);
    if (b.length & 1) w.u8(0);
  }
  return w.toBytes();
}

function pcmFmt(tag: number, channels: number, bits: number, blockAlign = (channels * bits) / 8): Uint8Array {
  return new BinaryWriter()
    .u16(tag)
    .u16(channels)
    .u32(RATE)
    .u32(RATE * blockAlign)
    .u16(blockAlign)
    .u16(bits)
    .toBytes();
}

describe('PCM WAV', () => {
  it('decodes 16-bit mono to floats within one step', () => {
    const source = sine(500, 440);
    const audio = decodeWav(encodeWavPcm(mono(source), 16));
    expect(audio.info).toMatchObject({ encoding: 'pcm', channelCount: 1, sampleRate: RATE, bitsPerSample: 16, frameCount: 500 });
    expect(audio.channels).toHaveLength(1);
    expect(maxError(source, audio.channels[0])).toBeLessThan(2 / 32768);
  });

  it('decodes 8-bit stereo, keeping the channels apart', () => {
    const left = sine(300, 300);
    const right = sine(300, 700, 0.3);
    const audio = decodeWav(encodeWavPcm({ sampleRate: RATE, channels: [left, right] }, 8));
    expect(audio.info).toMatchObject({ channelCount: 2, bitsPerSample: 8, blockAlign: 2, frameCount: 300 });
    expect(maxError(left, audio.channels[0])).toBeLessThan(1.5 / 128);
    expect(maxError(right, audio.channels[1])).toBeLessThan(1.5 / 128);
  });

  it('maps 8-bit 0, 128 and 255 to -1, 0 and almost 1', () => {
    const bytes = riff([
      ['fmt ', pcmFmt(1, 1, 8)],
      ['data', Uint8Array.of(0, 128, 255)],
    ]);
    expect([...(decodeWav(bytes).channels[0] ?? [])]).toEqual([-1, 0, 127 / 128]);
  });

  it('skips unknown chunks and ignores a broken chunk after the data', () => {
    const data = new BinaryWriter().i16(1000).i16(-1000).i16(32767).toBytes();
    const bytes = riff([
      ['LIST', new Uint8Array(5)],
      ['fmt ', pcmFmt(1, 1, 16)],
      ['data', data],
    ]);
    const junk = new Uint8Array([...bytes, ...new TextEncoder().encode('IST>'), 0xff, 0xff, 0xff, 0x7f]);
    const audio = decodeWav(junk);
    expect(audio.frameCount).toBe(3);
    expect(audio.channels[0]).toEqual(Float32Array.of(1000 / 32768, -1000 / 32768, 32767 / 32768));
  });

  it('clamps a data size past the end of the file and reports durations', () => {
    const bytes = riff([
      ['fmt ', pcmFmt(1, 1, 16)],
      ['data', new Uint8Array(10)],
    ]);
    new DataView(bytes.buffer).setUint32(bytes.length - 14, 1000, true);
    expect(readWavInfo(bytes)).toMatchObject({ dataLength: 10, frameCount: 5 });
    expect(wavDurationMs(readWavInfo(encodeWavPcm(mono(new Float32Array(RATE)), 16)))).toBe(1000);
  });
});

describe('IMA ADPCM WAV', () => {
  it('expands nibbles with the shift-and-add rule and the 89-step table', () => {
    expect(IMA_STEP_TABLE).toHaveLength(89);
    expect([IMA_STEP_TABLE[0], IMA_STEP_TABLE[8], IMA_STEP_TABLE[88]]).toEqual([7, 16, 32767]);
    const state = { predictor: 0, stepIndex: 0 };
    expect([7, 0, 8, 15].map((n) => imaAdpcmExpand(state, n))).toEqual([11, 13, 12, -11]);
    expect(state.stepIndex).toBe(14);
    const top = { predictor: 32760, stepIndex: 88 };
    expect(imaAdpcmExpand(top, 7)).toBe(32767);
  });

  it('decodes a synthetic signal exactly as the encoder reconstructed it, close to the source', () => {
    const source = Float32Array.from(
      { length: 3000 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / RATE) + 0.2 * Math.sin((2 * Math.PI * 1300 * i) / RATE),
    );
    const encoded = encodeWavImaAdpcm(mono(source), 256);
    const audio = decodeWav(encoded.bytes);
    expect(audio.info).toMatchObject({
      encoding: 'imaAdpcm',
      formatTag: WAVE_FORMAT_IMA_ADPCM,
      bitsPerSample: 4,
      blockAlign: 256,
      samplesPerBlock: 505,
    });
    expect(audio.frameCount).toBe(3000);
    const decoded = Int16Array.from(audio.channels[0] ?? [], (v) => Math.round(v * 32768));
    expect(decoded).toEqual(encoded.reconstructed[0]);
    expect(snrDb(source, audio.channels[0] ?? new Float32Array())).toBeGreaterThan(20);
    expect(Math.abs((audio.channels[0]?.[505] ?? 0) - toInt16(source[505] ?? 0) / 32768)).toBeLessThan(1e-6);
  });

  it('decodes stereo blocks with interleaved four-byte groups and a short last block', () => {
    const left = sine(1234, 350);
    const right = sine(1234, 900, 0.4, 1);
    const encoded = encodeWavImaAdpcm({ sampleRate: RATE, channels: [left, right] }, 512);
    const audio = decodeWav(encoded.bytes);
    expect(audio.info).toMatchObject({ channelCount: 2, samplesPerBlock: 505, frameCount: 1234 });
    audio.channels.forEach((channel, ch) => {
      expect(Int16Array.from(channel, (v) => Math.round(v * 32768))).toEqual(encoded.reconstructed[ch]);
    });
  });

  it('reads the frame count from the data size without a fact chunk', () => {
    const encoded = encodeWavImaAdpcm(mono(sine(505 * 2, 440)), 256);
    expect(new TextDecoder().decode(encoded.bytes.subarray(40, 44))).toBe('fact');
    encoded.bytes.set(new TextEncoder().encode('junk'), 40);
    expect(readWavInfo(encoded.bytes).frameCount).toBe(1010);
  });
});

describe('malformed WAV', () => {
  it('rejects other format tags, bit depths and broken headers with a clear error', () => {
    const msAdpcm = riff([
      ['fmt ', pcmFmt(2, 1, 4, 256)],
      ['data', new Uint8Array(256)],
    ]);
    expect(() => decodeWav(msAdpcm)).toThrow(/format tag 0x0002.*PCM \(0x0001\) and IMA ADPCM \(0x0011\)/);
    const float = riff([
      ['fmt ', pcmFmt(3, 1, 32)],
      ['data', new Uint8Array(8)],
    ]);
    expect(() => decodeWav(float)).toThrow(/format tag 0x0003/);
    const pcm24 = riff([
      ['fmt ', pcmFmt(1, 1, 24)],
      ['data', new Uint8Array(6)],
    ]);
    expect(() => decodeWav(pcm24)).toThrow(/bit depth 24/);
    expect(() => decodeWav(new TextEncoder().encode('RIFX....WAVE'))).toThrow(FormatError);
    expect(() => decodeWav(riff([['data', new Uint8Array(4)]]))).toThrow(/no fmt chunk/);
    expect(() => decodeWav(riff([['fmt ', pcmFmt(1, 1, 16)]]))).toThrow(/no data chunk/);
  });
});
