import { FormatError } from '../binary/errors.ts';

export const WAVE_FORMAT_PCM = 0x0001;
export const WAVE_FORMAT_IMA_ADPCM = 0x0011;
export const IMA_ADPCM_BITS = 4;

export const IMA_STEP_TABLE: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173,
  190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
export const IMA_INDEX_TABLE: readonly number[] = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
export const IMA_MAX_STEP_INDEX = IMA_STEP_TABLE.length - 1;
export const IMA_BLOCK_HEADER_BYTES = 4;
export const IMA_GROUP_BYTES = 4;
const NIBBLES_PER_BYTE = 2;
const SAMPLES_PER_GROUP = IMA_GROUP_BYTES * NIBBLES_PER_BYTE;

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MIN_FMT_BYTES = 16;
const IMA_EXTENSION_BYTES = 4;
const PCM_8_BIAS = 128;
const INT16_SCALE = 32768;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
const MS_PER_SECOND = 1000;
const PCM_BIT_DEPTHS: ReadonlySet<number> = new Set([8, 16]);
const NIBBLE_SIGN = 8;
const NIBBLE_MAGNITUDE_HIGH = 4;
const NIBBLE_MAGNITUDE_MID = 2;
const NIBBLE_MAGNITUDE_LOW = 1;
const NIBBLE_MASK = 0x0f;
const BITS_PER_BYTE = 8;

export type WavEncoding = 'pcm' | 'imaAdpcm';

export interface WavInfo {
  readonly encoding: WavEncoding;
  readonly formatTag: number;
  readonly channelCount: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly blockAlign: number;
  readonly samplesPerBlock: number;
  readonly frameCount: number;
  readonly dataOffset: number;
  readonly dataLength: number;
}

export interface WavAudio {
  readonly info: WavInfo;
  readonly sampleRate: number;
  readonly frameCount: number;
  readonly channels: readonly Float32Array[];
}

export interface ImaAdpcmState {
  predictor: number;
  stepIndex: number;
}

interface Chunks {
  fmtOffset: number;
  fmtLength: number;
  dataOffset: number;
  dataLength: number;
  factFrames: number | null;
}

function fourCc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

function findChunks(bytes: Uint8Array, view: DataView, fileSize: number): Chunks {
  if (bytes.length < RIFF_HEADER_BYTES || fourCc(bytes, 0) !== 'RIFF' || fourCc(bytes, 8) !== 'WAVE') {
    throw new FormatError('not a RIFF/WAVE file');
  }
  const found: Chunks = { fmtOffset: -1, fmtLength: 0, dataOffset: -1, dataLength: 0, factFrames: null };
  let pos = RIFF_HEADER_BYTES;
  while (pos + CHUNK_HEADER_BYTES <= bytes.length && (found.fmtOffset < 0 || found.dataOffset < 0)) {
    const id = fourCc(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + CHUNK_HEADER_BYTES;
    if (id === 'data') {
      found.dataOffset = body;
      found.dataLength = Math.min(size, fileSize - body);
    } else if (body + size > bytes.length) {
      break;
    } else if (id === 'fmt ') {
      found.fmtOffset = body;
      found.fmtLength = size;
    } else if (id === 'fact' && size >= 4) {
      found.factFrames = view.getUint32(body, true);
    }
    pos = body + size + (size & 1);
  }
  if (found.fmtOffset < 0) throw new FormatError('WAV file has no fmt chunk');
  if (found.dataOffset < 0) throw new FormatError('WAV file has no data chunk');
  if (found.fmtLength < MIN_FMT_BYTES) throw new FormatError(`WAV fmt chunk too short: ${found.fmtLength} bytes`);
  return found;
}

function imaFramesPerBlock(blockAlign: number, channelCount: number): number {
  const groups = Math.floor((blockAlign - IMA_BLOCK_HEADER_BYTES * channelCount) / (IMA_GROUP_BYTES * channelCount));
  return 1 + groups * SAMPLES_PER_GROUP;
}

function imaFrames(dataLength: number, blockAlign: number, channelCount: number, samplesPerBlock: number): number {
  const whole = Math.floor(dataLength / blockAlign);
  const rest = dataLength - whole * blockAlign;
  const partial = rest >= IMA_BLOCK_HEADER_BYTES * channelCount ? imaFramesPerBlock(rest, channelCount) : 0;
  return whole * samplesPerBlock + partial;
}

function unsupportedTag(tag: number): FormatError {
  return new FormatError(
    `unsupported WAV format tag 0x${tag.toString(16).padStart(4, '0')}: only PCM (0x0001) and IMA ADPCM (0x0011) are decoded`,
  );
}

export function readWavInfo(bytes: Uint8Array, fileSize = bytes.length): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = findChunks(bytes, view, fileSize);
  const at = chunks.fmtOffset;
  const formatTag = view.getUint16(at, true);
  const channelCount = view.getUint16(at + 2, true);
  const sampleRate = view.getUint32(at + 4, true);
  const blockAlign = view.getUint16(at + 12, true);
  const bitsPerSample = view.getUint16(at + 14, true);
  if (channelCount === 0) throw new FormatError('WAV file has no channels');
  if (sampleRate === 0) throw new FormatError('WAV file has a zero sample rate');
  const base = { formatTag, channelCount, sampleRate, bitsPerSample, dataOffset: chunks.dataOffset, dataLength: chunks.dataLength };
  if (formatTag === WAVE_FORMAT_PCM) {
    if (!PCM_BIT_DEPTHS.has(bitsPerSample)) throw new FormatError(`unsupported PCM bit depth ${bitsPerSample}: only 8 and 16`);
    const frameBytes = (channelCount * bitsPerSample) / BITS_PER_BYTE;
    if (blockAlign !== frameBytes) throw new FormatError(`PCM block align ${blockAlign} does not match ${frameBytes} bytes per frame`);
    return { ...base, encoding: 'pcm', blockAlign, samplesPerBlock: 1, frameCount: Math.floor(chunks.dataLength / frameBytes) };
  }
  if (formatTag === WAVE_FORMAT_IMA_ADPCM) {
    if (bitsPerSample !== IMA_ADPCM_BITS) throw new FormatError(`unsupported IMA ADPCM bit depth ${bitsPerSample}: only 4`);
    if (blockAlign < (IMA_BLOCK_HEADER_BYTES + IMA_GROUP_BYTES) * channelCount || blockAlign % (IMA_GROUP_BYTES * channelCount) !== 0) {
      throw new FormatError(`bad IMA ADPCM block align ${blockAlign} for ${channelCount} channel(s)`);
    }
    const expected = imaFramesPerBlock(blockAlign, channelCount);
    const declared = chunks.fmtLength >= MIN_FMT_BYTES + IMA_EXTENSION_BYTES ? view.getUint16(at + MIN_FMT_BYTES + 2, true) : expected;
    if (declared !== expected) throw new FormatError(`IMA ADPCM samples per block ${declared} do not fit block align ${blockAlign}`);
    const frames = imaFrames(chunks.dataLength, blockAlign, channelCount, expected);
    const frameCount = chunks.factFrames === null ? frames : Math.min(frames, chunks.factFrames);
    return { ...base, encoding: 'imaAdpcm', blockAlign, samplesPerBlock: expected, frameCount };
  }
  throw unsupportedTag(formatTag);
}

export function wavDurationMs(info: Pick<WavInfo, 'frameCount' | 'sampleRate'>): number {
  return (info.frameCount * MS_PER_SECOND) / info.sampleRate;
}

function decodePcm(bytes: Uint8Array, info: WavInfo): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = Array.from({ length: info.channelCount }, () => new Float32Array(info.frameCount));
  const sampleBytes = info.bitsPerSample / BITS_PER_BYTE;
  let at = info.dataOffset;
  for (let frame = 0; frame < info.frameCount; frame++) {
    for (const channel of channels) {
      channel[frame] = sampleBytes === 1 ? ((bytes[at] ?? PCM_8_BIAS) - PCM_8_BIAS) / PCM_8_BIAS : view.getInt16(at, true) / INT16_SCALE;
      at += sampleBytes;
    }
  }
  return channels;
}

export function imaAdpcmExpand(state: ImaAdpcmState, nibble: number): number {
  const step = IMA_STEP_TABLE[state.stepIndex] ?? 0;
  let diff = step >> 3;
  if (nibble & NIBBLE_MAGNITUDE_HIGH) diff += step;
  if (nibble & NIBBLE_MAGNITUDE_MID) diff += step >> 1;
  if (nibble & NIBBLE_MAGNITUDE_LOW) diff += step >> 2;
  const next = nibble & NIBBLE_SIGN ? state.predictor - diff : state.predictor + diff;
  state.predictor = Math.max(INT16_MIN, Math.min(INT16_MAX, next));
  state.stepIndex = Math.max(0, Math.min(IMA_MAX_STEP_INDEX, state.stepIndex + (IMA_INDEX_TABLE[nibble] ?? 0)));
  return state.predictor;
}

function decodeImaBlock(bytes: Uint8Array, view: DataView, start: number, length: number, channels: Float32Array[], first: number): number {
  const count = channels.length;
  const states = channels.map((channel, ch): ImaAdpcmState => {
    const header = start + ch * IMA_BLOCK_HEADER_BYTES;
    const predictor = view.getInt16(header, true);
    channel[first] = predictor / INT16_SCALE;
    return { predictor, stepIndex: Math.min(IMA_MAX_STEP_INDEX, bytes[header + 2] ?? 0) };
  });
  const frames = Math.min(imaFramesPerBlock(length, count), (channels[0]?.length ?? 0) - first);
  let at = start + IMA_BLOCK_HEADER_BYTES * count;
  for (let group = 1; group < frames; group += SAMPLES_PER_GROUP) {
    channels.forEach((channel, ch) => {
      const state = states[ch] as ImaAdpcmState;
      for (let k = 0; k < SAMPLES_PER_GROUP && group + k < frames; k++) {
        const byte = bytes[at + (k >> 1)] ?? 0;
        const nibble = k & 1 ? byte >> 4 : byte & NIBBLE_MASK;
        channel[first + group + k] = imaAdpcmExpand(state, nibble) / INT16_SCALE;
      }
      at += IMA_GROUP_BYTES;
    });
  }
  return frames;
}

function decodeIma(bytes: Uint8Array, info: WavInfo): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = Array.from({ length: info.channelCount }, () => new Float32Array(info.frameCount));
  const end = info.dataOffset + info.dataLength;
  let frame = 0;
  for (let at = info.dataOffset; at < end && frame < info.frameCount; at += info.blockAlign) {
    const length = Math.min(info.blockAlign, end - at);
    if (length < IMA_BLOCK_HEADER_BYTES * info.channelCount) break;
    frame += decodeImaBlock(bytes, view, at, length, channels, frame);
  }
  return channels;
}

export function decodeWav(bytes: Uint8Array): WavAudio {
  const info = readWavInfo(bytes);
  const channels = info.encoding === 'pcm' ? decodePcm(bytes, info) : decodeIma(bytes, info);
  return { info, sampleRate: info.sampleRate, frameCount: info.frameCount, channels };
}
