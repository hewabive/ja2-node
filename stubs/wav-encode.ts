import { BinaryWriter } from '../src/content/binary/writer.ts';
import {
  IMA_ADPCM_BITS,
  IMA_BLOCK_HEADER_BYTES,
  IMA_GROUP_BYTES,
  IMA_INDEX_TABLE,
  IMA_MAX_STEP_INDEX,
  IMA_STEP_TABLE,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_FORMAT_PCM,
} from '../src/content/formats/wav.ts';

export type PcmBits = 8 | 16;

export interface Signal {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export interface ImaEncoding {
  readonly bytes: Uint8Array;
  readonly reconstructed: readonly Int16Array[];
}

const INT16_MAX = 32767;
const INT16_MIN = -32768;
const INT8_MAX = 127;
const PCM_8_BIAS = 128;
const BITS_PER_BYTE = 8;
const IMA_FMT_BYTES = 20;
const IMA_EXTENSION_BYTES = 2;
const FACT_BYTES = 4;
const RIFF_FORM_BYTES = 4;
const CHUNK_HEADER_BYTES = 8;
const SAMPLES_PER_GROUP = IMA_GROUP_BYTES * 2;
const SIGN_BIT = 8;
const MAGNITUDE_BITS = [4, 2, 1] as const;

function frameCount(signal: Signal): number {
  const first = signal.channels[0];
  if (!first) throw new RangeError('a signal needs at least one channel');
  if (signal.channels.some((c) => c.length !== first.length)) throw new RangeError('channels differ in length');
  return first.length;
}

function clampUnit(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

export function toInt16(x: number): number {
  return Math.round(clampUnit(x) * INT16_MAX);
}

function riff(chunks: readonly { readonly id: string; readonly body: Uint8Array }[]): Uint8Array {
  const size = RIFF_FORM_BYTES + chunks.reduce((n, c) => n + CHUNK_HEADER_BYTES + c.body.length + (c.body.length & 1), 0);
  const w = new BinaryWriter(size + CHUNK_HEADER_BYTES);
  w.bytes(new TextEncoder().encode('RIFF')).u32(size).bytes(new TextEncoder().encode('WAVE'));
  for (const c of chunks) {
    w.bytes(new TextEncoder().encode(c.id)).u32(c.body.length).bytes(c.body);
    if (c.body.length & 1) w.u8(0);
  }
  return w.toBytes();
}

function fmtChunk(tag: number, channels: number, rate: number, byteRate: number, blockAlign: number, bits: number): BinaryWriter {
  return new BinaryWriter(IMA_FMT_BYTES).u16(tag).u16(channels).u32(rate).u32(byteRate).u16(blockAlign).u16(bits);
}

export function encodeWavPcm(signal: Signal, bits: PcmBits): Uint8Array {
  const frames = frameCount(signal);
  const channels = signal.channels.length;
  const sampleBytes = bits / BITS_PER_BYTE;
  const blockAlign = channels * sampleBytes;
  const data = new Uint8Array(frames * blockAlign);
  const view = new DataView(data.buffer);
  let at = 0;
  for (let i = 0; i < frames; i++) {
    for (const channel of signal.channels) {
      const x = channel[i] ?? 0;
      if (bits === 8) view.setUint8(at, Math.round(clampUnit(x) * INT8_MAX) + PCM_8_BIAS);
      else view.setInt16(at, toInt16(x), true);
      at += sampleBytes;
    }
  }
  const fmt = fmtChunk(WAVE_FORMAT_PCM, channels, signal.sampleRate, signal.sampleRate * blockAlign, blockAlign, bits);
  return riff([
    { id: 'fmt ', body: fmt.toBytes() },
    { id: 'data', body: data },
  ]);
}

export function imaSamplesPerBlock(blockAlign: number, channels: number): number {
  return 1 + ((blockAlign - IMA_BLOCK_HEADER_BYTES * channels) / (IMA_GROUP_BYTES * channels)) * SAMPLES_PER_GROUP;
}

class ImaChannelEncoder {
  predictor = 0;
  stepIndex = 0;

  quantize(sample: number): number {
    const step = IMA_STEP_TABLE[this.stepIndex] ?? 0;
    let diff = sample - this.predictor;
    let nibble = 0;
    if (diff < 0) {
      nibble = SIGN_BIT;
      diff = -diff;
    }
    let bitStep = step;
    for (const bit of MAGNITUDE_BITS) {
      if (diff >= bitStep) {
        nibble |= bit;
        diff -= bitStep;
      }
      bitStep >>= 1;
    }
    this.#advance(nibble, step);
    return nibble;
  }

  #advance(nibble: number, step: number): void {
    const magnitude = (step >> 3) + (nibble & 4 ? step : 0) + (nibble & 2 ? step >> 1 : 0) + (nibble & 1 ? step >> 2 : 0);
    const next = nibble & SIGN_BIT ? this.predictor - magnitude : this.predictor + magnitude;
    this.predictor = Math.max(INT16_MIN, Math.min(INT16_MAX, next));
    this.stepIndex = Math.max(0, Math.min(IMA_MAX_STEP_INDEX, this.stepIndex + (IMA_INDEX_TABLE[nibble] ?? 0)));
  }
}

function encodeImaBlock(
  pcm: readonly Int16Array[],
  encoders: readonly ImaChannelEncoder[],
  first: number,
  count: number,
  out: BinaryWriter,
  reconstructed: readonly Int16Array[],
): void {
  pcm.forEach((samples, ch) => {
    const encoder = encoders[ch] as ImaChannelEncoder;
    encoder.predictor = samples[first] ?? 0;
    (reconstructed[ch] as Int16Array)[first] = encoder.predictor;
    out.i16(encoder.predictor).u8(encoder.stepIndex).u8(0);
  });
  for (let group = 1; group < count; group += SAMPLES_PER_GROUP) {
    pcm.forEach((samples, ch) => {
      const encoder = encoders[ch] as ImaChannelEncoder;
      const target = reconstructed[ch] as Int16Array;
      for (let pair = 0; pair < SAMPLES_PER_GROUP; pair += 2) {
        const nibbles = [0, 1].map((k) => {
          const at = first + group + pair + k;
          const sample = samples[Math.min(at, samples.length - 1)] ?? 0;
          const nibble = encoder.quantize(sample);
          if (group + pair + k < count) target[at] = encoder.predictor;
          return nibble;
        });
        out.u8((nibbles[0] ?? 0) | ((nibbles[1] ?? 0) << 4));
      }
    });
  }
}

export function encodeWavImaAdpcm(signal: Signal, blockAlign: number): ImaEncoding {
  const frames = frameCount(signal);
  const channels = signal.channels.length;
  const samplesPerBlock = imaSamplesPerBlock(blockAlign, channels);
  if (!Number.isInteger(samplesPerBlock)) throw new RangeError(`block align ${blockAlign} does not fit ${channels} channel(s)`);
  const pcm = signal.channels.map((c) => Int16Array.from(c, toInt16));
  const reconstructed = signal.channels.map(() => new Int16Array(frames));
  const encoders = signal.channels.map(() => new ImaChannelEncoder());
  const data = new BinaryWriter(Math.max(1, Math.ceil(frames / samplesPerBlock) * blockAlign));
  for (let first = 0; first < frames; first += samplesPerBlock) {
    encodeImaBlock(pcm, encoders, first, Math.min(samplesPerBlock, frames - first), data, reconstructed);
  }
  const byteRate = Math.round((signal.sampleRate * blockAlign) / samplesPerBlock);
  const fmt = fmtChunk(WAVE_FORMAT_IMA_ADPCM, channels, signal.sampleRate, byteRate, blockAlign, IMA_ADPCM_BITS)
    .u16(IMA_EXTENSION_BYTES)
    .u16(samplesPerBlock);
  const fact = new BinaryWriter(FACT_BYTES).u32(frames);
  const bytes = riff([
    { id: 'fmt ', body: fmt.toBytes() },
    { id: 'fact', body: fact.toBytes() },
    { id: 'data', body: data.toBytes() },
  ]);
  return { bytes, reconstructed };
}
